import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { findBucket } from '@ukdict/shared';
import type { FormsBucketFile, Manifest } from '@ukdict/shared';
import type { IgnoredEntry, LcorpClient } from './contracts.ts';
import { ensureSources, runPipeline, parseCli } from './cli.ts';
import type { PipelineDeps } from './cli.ts';
import { resolveConfig } from './config.ts';
import { createTui } from './tui/index.ts';
import { draft } from './stages/_fixtures.ts';
import { createExampleSentencesPlugin } from './plugins/example-sentences.ts';

test('parseCli', () => {
  const p = parseCli(['--workers', '3', '--no-sync', '--lcorp-offline', '--samples', 'кіт, пес', '--shard-size', '50']);
  assert.equal(p.overrides.workers, 3);
  assert.equal(p.overrides.sync, false);
  assert.equal(p.overrides.lcorpOffline, true);
  assert.equal(p.overrides.shardSize, 50);
  assert.deepEqual(p.samples, ['кіт', 'пес']);
  assert.throws(() => parseCli(['--bogus']));
  assert.throws(() => parseCli(['--workers', 'x']));
  assert.equal(p.downloadOnly, false);
  assert.equal(p.overrides.download, true);
  assert.equal(parseCli(['--download-only']).downloadOnly, true);
  assert.equal(parseCli(['--no-download']).overrides.download, false);
  assert.throws(() => parseCli(['--download-only', '--no-download']));
});

test('ensureSources downloads only the missing dumps, in parallel, with a bar per file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ukdict-src-'));
  try {
    const cfg = resolveConfig({}, root);
    const calls: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const deps = {
      downloadFile: async (url: string, dest: string, o: { onProgress?: (g: number, t?: number) => void }) => {
        calls.push(url);
        maxInFlight = Math.max(maxInFlight, ++inFlight);
        o.onProgress?.(0, 100);
        await new Promise((r) => setTimeout(r, 20));
        o.onProgress?.(100, 100);
        await mkdir(dirname(dest), { recursive: true });
        await writeFile(dest, 'x');
        inFlight--;
        return { bytes: 100, resumedFrom: 0 };
      },
    } as unknown as PipelineDeps;
    const tui = createTui({ stream: { isTTY: false, write: () => true } as unknown as NodeJS.WriteStream });

    await ensureSources(cfg, tui, deps);
    assert.deepEqual(calls.sort(), [cfg.kaikkiEnUrl, cfg.kaikkiUkUrl].sort());
    assert.equal(maxInFlight, 2);
    const stages = tui.stages();
    assert.deepEqual(stages.map((s) => [s.id, s.state]), [['download', 'done'], ['download/uk', 'done'], ['download/en', 'done']]);
    assert.equal(stages[0].total, 200);

    calls.length = 0;
    await ensureSources(cfg, tui, deps); // both present now
    assert.equal(calls.length, 0);

    await rm(cfg.kaikkiEnFile);
    await assert.rejects(ensureSources({ ...cfg, download: false }, createTui({ stream: { isTTY: false, write: () => true } as unknown as NodeJS.WriteStream }), deps), /missing data\/kaikki-en/);
    await ensureSources({ ...cfg, createFromTranslations: false }, tui, deps); // English not needed with --no-created
    assert.equal(calls.length, 0);
    tui.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('runPipeline end-to-end with fake sources', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ukdict-run-'));
  try {
    await mkdir(join(root, 'raw_sources'), { recursive: true });
    await writeFile(join(root, 'raw_sources/example_sentences.tsv'), 'word\tsentence\ttranslation\tsource\nсобака\tСоба́ка гавкає.\tThe dog barks.\tTest corpus\n');
    const ignored: IgnoredEntry[] = [
      { word: 'собаці', kaikkiPos: 'noun', pos: 'noun', reason: 'inflected-form-only', formOf: [{ word: 'соба́ка', tags: ['dative', 'singular'] }], glosses: [], line: 9, url: '' },
      { word: 'собаки', kaikkiPos: 'noun', pos: 'noun', reason: 'inflected-form-only', formOf: [{ word: 'соба́ка', tags: ['genitive', 'singular'] }], glosses: [], line: 10, url: '' },
    ];
    const deps: PipelineDeps = {
      loadFrequency: async () => ({ rank: (w: string) => ({ собака: 100, співати: 50, кіт: 200 } as Record<string, number>)[w.toLowerCase()], size: 3 }),
      loadKnownAspectPairs: async () => [{ imperfective: 'співати', perfective: 'заспівати' }],
      ingestKaikkiUk: async (_f, { progress }) => {
        const h = progress.stage('uk', 'uk');
        h.setTotal(100, 'bytes');
        h.set(100);
        h.done();
        return {
          entries: [
            draft('соба́ка', 'noun', ['dog'], {
              genders: ['m', 'f'],
              paradigm: { kind: 'noun', source: 'wiktionary', forms: { 'nom.sg': [{ form: 'соба́ка' }], 'gen.sg': [{ form: 'соба́ки' }] } },
            }),
            draft('співа́ти', 'verb', ['to sing'], { aspect: 'imperfective' }),
            draft('заспіва́ти', 'verb', ['to start singing'], { aspect: 'perfective' }),
            draft('кіт', 'noun', ['tomcat']),
            draft('кіт', 'noun', ['tomcat']), // duplicate → merged
          ],
          ignored,
          unmappedForms: { 'declension:foo': 3 },
          stats: { lines: 7, entries: 5, ignored: 2, withParadigm: 1, durationMs: 1 },
        };
      },
      ingestKaikkiEn: async () => ({
        translations: [
          { ukWord: 'соба́ка', enWord: 'dog', enPos: 'noun' },
          { ukWord: 'песи́ще', enWord: 'big dog', enPos: 'noun', tags: ['neuter'] },
        ],
        stats: { lines: 10, matchedLines: 2, translations: 2, durationMs: 1, fromCache: false },
      }),
      createLcorpClient: (): LcorpClient => ({
        lookup: async (req) =>
          req.word === 'кіт'
            ? {
                status: 'found',
                fromCache: true,
                entry: { headword: 'кіт', gram: 'ім. ч. р., істота', genders: ['m'], animacy: 'animate', paradigm: { kind: 'noun', source: 'lcorp', forms: { 'nom.sg': [{ form: 'кіт' }], 'gen.sg': [{ form: 'кота́' }] } } },
              }
            : { status: 'not-found', fromCache: true },
        stats: () => ({ network: 0, cacheHits: 2, found: 1, notFound: 1, errors: 0, skipped: 0 }),
        close: async () => {},
      }),
    };
    const cfg = resolveConfig({ outDir: join(root, 'artifacts'), sync: true, lcorpOffline: true, workers: 2, shardSize: 2 }, root);
    const chunks: string[] = [];
    const tui = createTui({ stream: { isTTY: false, write: (s: string) => (chunks.push(s), true) } as unknown as NodeJS.WriteStream });
    const report = await runPipeline(cfg, tui, deps, { plugins: [createExampleSentencesPlugin()], samples: ['песище'] });
    tui.close();

    assert.equal(report.counts.entries, 5); // собака, співати, заспівати, кіт, песище(created)
    assert.equal(report.counts.mergedAway, 1);
    assert.equal(report.counts.createdEntriesFinal, 1);
    assert.equal(report.validation.ok, true, JSON.stringify(report.validation.checks.filter((c) => c.violations)));
    assert.deepEqual(report.ignored.byResolution, { 'in-paradigm': 1, 'added-as-extra-form': 1 });
    assert.equal(report.paradigms.bySource.lcorp, 1);
    assert.deepEqual(
      report.top20.map((e) => e.slug),
      ['співати~verb', 'собака~noun', 'кіт~noun', 'заспівати~verb', 'песище~noun'],
    );

    const manifest = JSON.parse(await readFile(join(root, 'artifacts/web/manifest.json'), 'utf8')) as Manifest;
    assert.equal(manifest.counts.ignoredEntries, 2);
    assert.ok(manifest.attributions.some((a) => a.id === 'lcorp'));
    assert.ok(manifest.attributions.some((a) => a.id === 'example-sentences'));
    const fb = findBucket(manifest.files.forms, 'собаці')!;
    const forms = JSON.parse(gunzipSync(await readFile(join(root, 'artifacts/web', manifest.files.forms[fb].path))).toString()) as FormsBucketFile;
    assert.deepEqual(forms['собаці'], [1]);

    const synced = await readdir(join(root, 'packages/web/public/data'));
    assert.ok(synced.includes('manifest.json'));
    const machine = (await readFile(join(root, 'artifacts/machine/entries.jsonl'), 'utf8')).trim().split('\n');
    assert.equal(machine.length, 5);
    const ign = (await readFile(join(root, 'artifacts/machine/ignored-entries.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(ign[0].resolution, 'added-as-extra-form');
    const sample = JSON.parse(await readFile(join(root, 'artifacts/debug/samples/собака.json'), 'utf8'));
    assert.equal(sample.entries[0].senses[0].examples[0].source, 'example-sentences');
    const spivaty = JSON.parse(await readFile(join(root, 'artifacts/debug/samples/співати.json'), 'utf8'));
    assert.equal(spivaty.entries[0].aspectPartners[0].word, 'заспіва́ти');
    assert.ok((await readdir(join(root, 'artifacts/debug/samples'))).includes('песище.json'));
    const md = await readFile(join(root, 'artifacts/reports/summary.md'), 'utf8');
    assert.match(md, /All checks passed/);
    assert.match(chunks.join(''), /✓ Emit web artifacts/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
