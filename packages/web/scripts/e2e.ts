/**
 * End-to-end browser test against `vite preview` (run `pnpm --filter @ukdict/web build` first).
 *   node scripts/e2e.ts                 # real data (public/data)
 *   node scripts/e2e.ts --fixture       # hand-written fixture (public/data-fixture, via ?data=data-fixture)
 *   node scripts/e2e.ts --no-shots      # skip screenshots
 * Uses the installed Google Chrome (playwright channel "chrome").
 */
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = process.argv.includes('--fixture');
const shots = !process.argv.includes('--no-shots');
const port = 4300 + Math.floor(Math.random() * 500);
const base = `http://localhost:${port}/`;
const dataParam = fixture ? 'data=data-fixture&' : '';
const url = (qs: string) => `${base}?${dataParam}${qs}`;
const shotDir = join(root, 'screenshots');

const results: { name: string; ok: boolean; detail?: string }[] = [];
async function check(name: string, fn: () => Promise<void>) {
  const t = Date.now();
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✔ ${name} (${Date.now() - t} ms)`);
  } catch (err) {
    const detail = String((err as Error)?.message ?? err).split('\n')[0];
    results.push({ name, ok: false, detail });
    console.log(`  ✘ ${name}: ${detail}`);
  }
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function startPreview(): Promise<() => void> {
  const vite = join(root, 'node_modules', '.bin', 'vite');
  const child = spawn(vite, ['preview', '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('vite preview did not start')), 20000);
    const onData = (b: Buffer) => {
      if (b.toString().includes(String(port))) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => reject(new Error(`vite preview exited ${code}`)));
  });
  return () => child.kill();
}

async function open(page: Page, qs: string) {
  await page.goto(url(qs));
  await waitSettled(page);
}

/** Wait until the results are complete (aria-busy=false) or the home/about view is shown. */
async function waitSettled(page: Page) {
  await page.waitForFunction(
    () => {
      const r = document.querySelector('.results');
      if (r) return r.getAttribute('aria-busy') === 'false' && !r.classList.contains('stale');
      return !!document.querySelector('.home, .about, .empty-state');
    },
    undefined,
    { timeout: 20000 },
  );
  await page.waitForTimeout(50);
}

const noStressMarks = (page: Page) => page.evaluate(() => !/[̀́]/.test(document.body.innerText));
const stressRanges = (page: Page) => page.evaluate(() => (CSS as unknown as { highlights?: Map<string, Set<Range>> }).highlights?.get('stress')?.size ?? -1);

async function screenshot(page: Page, name: string) {
  if (!shots) return;
  await page.screenshot({ path: join(shotDir, `${name}.png`), fullPage: false });
}

async function main() {
  await mkdir(shotDir, { recursive: true });
  const stop = await startPreview();
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ channel: 'chrome' });
    const ctx: BrowserContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    console.log(`e2e against ${fixture ? 'fixture' : 'real'} data at ${base}`);

    await check('home screen loads with examples', async () => {
      await open(page, '');
      assert(await page.locator('.example-chip').count() >= 5, 'example chips missing');
      await screenshot(page, `desktop-home${fixture ? '-fixture' : ''}`);
    });

    await check('?q=співати → entry card, conjugation table, partner link', async () => {
      await open(page, 'q=співати');
      const card = page.locator('article.entry').first();
      assert((await card.locator('.headword').innerText()).trim() === 'співати', 'headword');
      assert(await card.locator('.match-badge.exact').count() === 1, 'exact badge');
      assert(await card.locator('table.paradigm-verb').count() === 1, 'verb table');
      assert(await card.locator('details.inflection[open]').count() === 1, 'table expanded for top result');
      assert((await card.locator('a.partner').allInnerTexts()).includes('заспівати'), 'partner заспівати');
      assert((await card.locator('.gram').innerText()).includes('imperfective'), 'aspect badge');
      // past plural spans the three gender rows
      assert(await card.locator('tbody.sec-past td[rowspan="3"]').count() === 1, 'past plural rowspan');
      await screenshot(page, `desktop-spivaty${fixture ? '-fixture' : ''}`);
    });

    await check('no U+0301 in rendered text; CSS.highlights "stress" has ranges', async () => {
      assert(await noStressMarks(page), 'combining stress mark found in innerText');
      const n = await stressRanges(page);
      assert(n > 10, `stress highlight ranges: ${n}`);
    });

    await check('?q=співаю → form-match badge + highlighted cell', async () => {
      await open(page, 'q=співаю');
      const badge = page.locator('.form-badge').first();
      assert((await badge.innerText()).includes('1st person singular present'), 'badge text');
      const hit = page.locator('td.hit');
      assert(await hit.count() >= 1, 'no highlighted cell');
      assert((await hit.first().innerText()).includes('співаю'), 'hit cell content');
      assert(await noStressMarks(page), 'stress mark in text');
      await screenshot(page, `desktop-spivayu${fixture ? '-fixture' : ''}`);
    });

    await check('?q=співа́ти → exact stress match', async () => {
      await open(page, 'q=' + encodeURIComponent('співа́ти'));
      assert(await page.locator('.match-badge.stress').count() >= 1, 'no stress-match badge');
      assert((await page.locator('input[type=search]').inputValue()).includes('́'), 'query kept as typed');
    });

    await check('?q=співа → prefix list', async () => {
      await open(page, 'q=співа');
      const rows = page.locator('#prefix-h + .rows a.row');
      assert(await rows.count() >= 2, `prefix rows: ${await rows.count()}`);
      const heads = await page.locator('#prefix-h + .rows .row-head').allInnerTexts();
      assert(heads.includes('співати'), 'співати in prefix list');
      const match = await page.evaluate(() => (CSS as unknown as { highlights?: Map<string, Set<Range>> }).highlights?.get('search-match')?.size ?? 0);
      assert(match > 0, 'search-match highlight');
    });

    await check('?q=dog → English results incl. собака', async () => {
      await open(page, 'q=dog');
      const heads = await page.locator('#english-h + .rows .row-head').allInnerTexts();
      assert(heads.length > 0, 'no English rows');
      assert(heads.includes('собака'), `собака not in ${heads.slice(0, 8).join(',')}`);
      await screenshot(page, `desktop-dog${fixture ? '-fixture' : ''}`);
    });

    await check('?q=замок → homonyms grouped (noun 1 / noun 2), stress differs', async () => {
      await open(page, 'q=замок');
      const subs = await page.locator('.exact-group .subhead').allInnerTexts();
      assert(subs.length >= 2, `subheads: ${subs}`);
      assert(subs.some((s) => /noun 1/i.test(s)) && subs.some((s) => /noun 2/i.test(s)), `subheads: ${subs}`);
      await screenshot(page, `desktop-zamok${fixture ? '-fixture' : ''}`);
    });

    await check('?q=ручка → Ukrainian gloss link to рука', async () => {
      await open(page, 'q=ручка');
      const links = await page.locator('article.entry .gloss a').allInnerTexts();
      assert(links.some((l) => l.includes('рука')), `gloss links: ${links}`);
    });

    await check('?q=по → nested senses (header / tag groups)', async () => {
      await open(page, 'q=по');
      const nested = await page.locator('article.entry ol.senses ol.senses').count();
      assert(nested > 0, 'no nested sense lists');
    });

    await check('?q=собака audio button + noun table; стіл nom = acc merged', async () => {
      await open(page, 'q=собака');
      const card = page.locator('article.entry').first();
      assert(await card.locator('.audio-btn').count() >= 1, 'no audio button');
      assert(await card.locator('table.paradigm-noun').count() === 1, 'noun table');
      await open(page, 'q=стіл');
      const stil = page.locator('article.entry').first();
      assert(await stil.locator('table.paradigm-noun td[rowspan="2"]').count() >= 1, 'стіл: no merged nom = acc cell');
    });

    await check('link click pushes history; Back returns', async () => {
      await open(page, 'q=співати');
      const before = await page.evaluate(() => history.length);
      await page.locator('a.partner', { hasText: 'заспівати' }).first().click();
      await waitSettled(page);
      assert(new URL(page.url()).searchParams.get('q') === 'заспівати', `url after click: ${page.url()}`);
      assert((await page.evaluate(() => history.length)) === before + 1, 'history not pushed');
      assert((await page.locator('article.entry .headword').first().innerText()).includes('заспівати'), 'card after click');
      await page.goBack();
      await waitSettled(page);
      assert(new URL(page.url()).searchParams.get('q') === 'співати', `url after back: ${page.url()}`);
      assert((await page.locator('input[type=search]').inputValue()) === 'співати', 'input after back');
    });

    await check('typing: first keystroke pushes once, then replaces', async () => {
      await open(page, 'q=співати');
      const input = page.locator('input[type=search]');
      await input.click();
      await input.press('ControlOrMeta+a');
      await input.pressSequentially('собака', { delay: 30 });
      await page.waitForTimeout(500);
      await waitSettled(page);
      assert(new URL(page.url()).searchParams.get('q') === 'собака', `url ${page.url()}`);
      await page.goBack();
      await waitSettled(page);
      assert(new URL(page.url()).searchParams.get('q') === 'співати', `back → ${page.url()}`);
      await page.goForward();
      await waitSettled(page);
      // Intermediate states (с, со, соб…) were replaced, so Forward lands on the final word.
      assert(new URL(page.url()).searchParams.get('q') === 'собака', `forward → ${page.url()}`);
      assert((await input.inputValue()) === 'собака', 'input after forward');
    });

    await check('&e=<slug> highlights one entry', async () => {
      await open(page, 'q=замок');
      const slugs = await page.locator('.exact-group article.entry').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.slug));
      const target = slugs[1]!;
      await open(page, `q=замок&e=${encodeURIComponent(target)}`);
      const hl = await page.locator('article.entry.highlighted').getAttribute('data-slug');
      assert(hl === target, `highlighted ${hl}, expected ${target}`);
    });

    await check('?view=about shows attributions and build info', async () => {
      await open(page, 'view=about');
      assert(await page.locator('.attributions li').count() >= 4, 'attributions');
      assert((await page.locator('.build-info').innerText()).includes('Entries'), 'build info');
    });

    await check('no-results state', async () => {
      await open(page, 'q=жжжжщщщ');
      assert(await page.locator('.empty-state').count() === 1, 'empty state missing');
    });

    await check('offline: prefetch completes, reload offline, search works', async () => {
      await open(page, 'q=собака');
      await page.waitForFunction(() => document.querySelector('.status-pill')?.textContent?.includes('Offline ready'), undefined, { timeout: 180000 });
      await page.waitForFunction(() => !!navigator.serviceWorker?.controller, undefined, { timeout: 20000 });
      await ctx.setOffline(true);
      await page.goto(url('q=' + encodeURIComponent('співаю')));
      await waitSettled(page);
      assert(await page.locator('td.hit').count() >= 1, 'form search offline');
      await page.locator('input[type=search]').fill('dog');
      await waitSettled(page);
      assert((await page.locator('#english-h + .rows .row-head').count()) > 0, 'English search offline');
      await page.locator('input[type=search]').fill('зелений');
      await waitSettled(page);
      assert(await page.locator('table.paradigm-adjectival').count() >= 1, 'adjective offline');
      await ctx.setOffline(false);
    });

    await check('no uncaught page errors', async () => {
      assert(errors.length === 0, errors.join(' | '));
    });

    if (shots) {
      // Phone screenshots
      const phone = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      const p = await phone.newPage();
      for (const [q, name] of [
        ['', 'home'],
        ['q=співаю', 'spivayu'],
        ['q=стіл', 'stil'],
        ['q=зелений', 'zelenyi'],
        ['q=dog', 'dog'],
      ] as const) {
        await open(p, q);
        await p.screenshot({ path: join(shotDir, `phone-${name}${fixture ? '-fixture' : ''}.png`) });
      }
      await phone.close();
      for (const [q, name] of [
        ['q=стіл', 'stil'],
        ['q=зелений', 'zelenyi'],
        ['q=по', 'po'],
        ['q=співа', 'spiva'],
      ] as const) {
        await open(page, q);
        await screenshot(page, `desktop-${name}${fixture ? '-fixture' : ''}`);
      }
    }
    await ctx.close();
  } finally {
    await browser?.close();
    stop();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exitCode = 1;
}

await main();
