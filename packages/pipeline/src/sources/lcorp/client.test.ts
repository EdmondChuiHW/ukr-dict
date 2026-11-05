import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LcorpLookupResult } from '../../contracts.ts';
import {
  createLcorpClient,
  lcorpCachePath,
  lcorpPosCompatible,
  lcorpWordKey,
  selectLcorpResult,
  type LcorpCacheRecord,
  type LcorpClientOptions,
} from './client.ts';
import { createFakeLcorp, type FakeLcorp } from './fake-server.ts';

function setup(extra: Partial<LcorpClientOptions> = {}, fake: FakeLcorp = createFakeLcorp()) {
  const cacheDir = mkdtempSync(join(tmpdir(), 'lcorp-test-'));
  const mk = (more: Partial<LcorpClientOptions> = {}) =>
    createLcorpClient({
      cacheDir,
      ratePerSec: 10_000,
      concurrency: 1,
      budget: 100,
      offline: false,
      fetchImpl: fake.fetch,
      sleep: async () => {},
      retryBaseMs: 1,
      ...extra,
      ...more,
    });
  return { cacheDir, fake, client: mk(), mk, cleanup: () => rmSync(cacheDir, { recursive: true, force: true }) };
}

function found(r: LcorpLookupResult) {
  assert.equal(r.status, 'found', JSON.stringify(r));
  return r as Extract<LcorpLookupResult, { status: 'found' }>;
}
function notFound(r: LcorpLookupResult) {
  assert.equal(r.status, 'not-found', JSON.stringify(r));
  return r as Extract<LcorpLookupResult, { status: 'not-found' }>;
}

test('nearest-match rejection: search lands on another word → not-found without registry reads', async () => {
  const { client, fake, cleanup } = setup();
  try {
    const r = notFound(await client.lookup({ word: 'абракадабрище', pos: 'noun' }));
    assert.equal(r.nearest, 'Абра́м');
    assert.equal(r.fromCache, false);
    const f = notFound(await client.lookup({ word: 'собаки', pos: 'noun' }));
    assert.equal(f.nearest, 'Собаке́вич');
    assert.equal(fake.count('feed'), 0);
    assert.equal(fake.count('start'), 1); // one session for both words (viewstate chained)
    assert.equal(fake.count('search'), 2);
    // cached not-found
    const again = notFound(await client.lookup({ word: 'собаки', pos: 'noun' }));
    assert.equal(again.fromCache, true);
    assert.equal(fake.count('search'), 2);
  } finally {
    cleanup();
  }
});

test('homonyms: all exact-spelling registry items are fetched once; selection by stress, then POS', async () => {
  const { client, fake, cleanup } = setup();
  try {
    const a = found(await client.lookup({ word: 'замок', heads: ['замо́к'], pos: 'noun' }));
    assert.equal(a.entry.headword, 'замо́к');
    assert.deepEqual(a.entry.paradigm?.forms['gen.sg'], [{ form: 'замка́' }]);
    assert.equal(a.fromCache, false);
    // search landed on "За́мок" (case differs) → registry → select за́мок + замо́к
    assert.equal(fake.count('search'), 1);
    assert.equal(fake.count('feed'), 1);
    assert.deepEqual(fake.calls.filter((c) => c.kind === 'select').map((c) => c.uid), [47336, 47335]);
    const before = fake.calls.length;

    const b = found(await client.lookup({ word: 'замок', heads: ['за́мок'], pos: 'noun' }));
    assert.equal(b.entry.headword, 'за́мок');
    assert.deepEqual(b.entry.paradigm?.forms['gen.sg'], [{ form: 'за́мку' }]);
    assert.equal(b.fromCache, true);

    const c = found(await client.lookup({ word: 'замок', pos: 'noun' }));
    assert.equal(c.entry.headword, 'за́мок'); // no heads → first in registry order

    const v = notFound(await client.lookup({ word: 'замок', pos: 'verb' }));
    assert.match(v.note ?? '', /POS mismatch/);
    assert.equal(v.fromCache, true);
    assert.equal(fake.calls.length, before, 'no network for cached word');

    // Capitalized word = different cache key; the landed article itself is the match (no select needed).
    const p = found(await client.lookup({ word: 'Замок', heads: ['За́мок'], pos: 'proper-noun' }));
    assert.equal(p.entry.headword, 'За́мок');
    assert.equal(p.entry.pos, 'proper-noun');
    assert.equal(fake.count('select'), 2);
  } finally {
    cleanup();
  }
});

test('cache record layout: one file per exact word with all homonym articles, atomic writes', async () => {
  const { client, cacheDir, cleanup } = setup();
  try {
    found(await client.lookup({ word: 'замок', heads: ['замо́к'], pos: 'noun' }));
    const file = lcorpCachePath(cacheDir, 'замок');
    assert.match(file, /lcorp\/[0-9a-f]{2}\/[0-9a-f]{40}\.json$/);
    const rec = JSON.parse(readFileSync(file, 'utf8')) as LcorpCacheRecord;
    assert.equal(rec.word, 'замок');
    assert.equal(rec.status, 'found');
    assert.deepEqual(rec.articles.map((a) => [a.uid, a.headword]), [
      [47336, 'за́мок'],
      [47335, 'замо́к'],
    ]);
    assert.ok(rec.articles.every((a) => a.html.includes('word_style') && !a.html.includes('<style')));
    assert.ok(rec.fetchedAt && rec.parserVersion >= 1);
    const dir = join(cacheDir, 'lcorp', file.split('/').at(-2)!);
    assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith('.tmp')), []);
  } finally {
    cleanup();
  }
});

test('word in registry but empty article (personal pronoun) → not-found with note', async () => {
  const { client, fake, cleanup } = setup();
  try {
    const r = notFound(await client.lookup({ word: 'вони', pos: 'pronoun' }));
    assert.match(r.note ?? '', /no article/);
    assert.equal(fake.count('feed'), 1);
    assert.equal(fake.count('select'), 0); // the landed (empty) article is the only match
  } finally {
    cleanup();
  }
});

test('found: verb with stressed heads; stress mismatch still accepted (preference only)', async () => {
  const { client, cleanup } = setup();
  try {
    const r = found(await client.lookup({ word: 'співати', heads: ['співа́ти'], pos: 'verb' }));
    assert.equal(r.entry.aspect, 'imperfective');
    assert.deepEqual(r.entry.paradigm?.forms['pres.1sg'], [{ form: 'співа́ю' }]);
    const s = found(await client.lookup({ word: 'стіл', heads: ['стіл'], pos: 'noun' }));
    assert.equal(s.entry.headword, 'стіл');
    assert.deepEqual(s.entry.paradigm?.forms['gen.sg'], [{ form: 'стола́' }]);
    const n = notFound(await client.lookup({ word: 'стіл', pos: 'verb' }));
    assert.match(n.note!, /requested verb, lcorp has стіл \(іменник чоловічого роду\)/);
  } finally {
    cleanup();
  }
});

test('budget: distinct network words are capped; cache hits stay free; offline mode', async () => {
  const { client, mk, fake, cleanup } = setup({ budget: 1 });
  try {
    found(await client.lookup({ word: 'стіл', pos: 'noun' }));
    const s = await client.lookup({ word: 'співати', pos: 'verb' });
    assert.deepEqual(s, { status: 'skipped', reason: 'budget' });
    assert.equal(found(await client.lookup({ word: 'стіл', pos: 'noun' })).fromCache, true);
    const st = client.stats();
    assert.equal(st.network, 1);
    assert.equal(st.cacheHits, 1);
    assert.equal(st.skipped, 1);
    assert.equal(st.found, 2);

    const calls = fake.calls.length;
    const off = mk({ offline: true, budget: 100 });
    assert.equal(found(await off.lookup({ word: 'стіл', pos: 'noun' })).fromCache, true);
    assert.deepEqual(await off.lookup({ word: 'співати', pos: 'verb' }), { status: 'skipped', reason: 'offline' });
    assert.equal(fake.calls.length, calls);
  } finally {
    cleanup();
  }
});

test('concurrent lookups of one word share a single fetch', async () => {
  const { client, fake, cleanup } = setup({ concurrency: 2 });
  try {
    const [a, b] = await Promise.all([
      client.lookup({ word: 'замок', heads: ['за́мок'], pos: 'noun' }),
      client.lookup({ word: 'замок', heads: ['замо́к'], pos: 'noun' }),
    ]);
    assert.equal(found(a).entry.headword, 'за́мок');
    assert.equal(found(b).entry.headword, 'замо́к');
    assert.equal(fake.count('search'), 1);
    assert.equal(client.stats().network, 1);
  } finally {
    cleanup();
  }
});

test('retries: 503 / 429 with Retry-After are retried; broken viewstate chain renews the session', async () => {
  const sleeps: number[] = [];
  const { client, fake, cleanup } = setup({ sleep: async (ms) => void sleeps.push(ms) });
  try {
    fake.failNext(1, 503);
    fake.failNext(1, 429, { 'retry-after': '3' });
    found(await client.lookup({ word: 'стіл', pos: 'noun' }));
    assert.ok(sleeps.includes(3000), `honours Retry-After: ${sleeps}`);
    assert.equal(client.stats().failedRequests, 2);

    fake.breakNextPost(); // 200 page without viewstate
    found(await client.lookup({ word: 'співати', pos: 'verb' }));
    assert.equal(client.stats().sessions, 2);
    assert.equal(fake.count('start'), 2);
  } finally {
    cleanup();
  }
});

test('stale viewstate (HTTP 500) → new session and retry', async () => {
  const { client, fake, cleanup } = setup();
  try {
    found(await client.lookup({ word: 'стіл', pos: 'noun' }));
    fake.failNext(1, 500); // ASP.NET answers 500 for an invalid/expired viewstate
    found(await client.lookup({ word: 'співати', pos: 'verb' }));
    assert.equal(fake.count('start'), 2);
  } finally {
    cleanup();
  }
});

test('circuit breaker: after N consecutive failures the network is not used any more', async () => {
  const { client, fake, cleanup } = setup({ maxConsecutiveErrors: 3, maxRetries: 4 });
  try {
    fake.failNext(50, 502);
    const r = await client.lookup({ word: 'стіл', pos: 'noun' });
    assert.equal(r.status, 'error');
    const calls = fake.calls.length;
    assert.equal(calls, 3);
    const r2 = await client.lookup({ word: 'співати', pos: 'verb' });
    assert.equal(r2.status, 'error');
    assert.match((r2 as { message: string }).message, /disabled/);
    assert.equal(fake.calls.length, calls);
    assert.equal(client.stats().circuitOpen, true);
    assert.equal(client.stats().errors, 2);
  } finally {
    cleanup();
  }
});

test('non-retryable HTTP status → error result, nothing cached', async () => {
  const { client, mk, fake, cleanup } = setup();
  try {
    fake.failNext(1, 403);
    const r = await client.lookup({ word: 'стіл', pos: 'noun' });
    assert.equal(r.status, 'error');
    assert.match((r as { message: string }).message, /403/);
    assert.deepEqual(await mk({ offline: true }).lookup({ word: 'стіл', pos: 'noun' }), { status: 'skipped', reason: 'offline' });
  } finally {
    cleanup();
  }
});

test('re-parse from cached HTML when the parser version changes (no network)', async () => {
  const { client, mk, cacheDir, fake, cleanup } = setup();
  try {
    found(await client.lookup({ word: 'зелений', pos: 'adjective' }));
    const file = lcorpCachePath(cacheDir, 'зелений');
    const rec = JSON.parse(readFileSync(file, 'utf8')) as LcorpCacheRecord;
    rec.parserVersion = 0;
    for (const a of rec.articles) delete a.parsed;
    writeFileSync(file, JSON.stringify(rec));
    const calls = fake.calls.length;
    const r = found(await mk({ offline: true }).lookup({ word: 'зелений', heads: ['зеле́ний'], pos: 'adjective' }));
    assert.deepEqual(r.entry.paradigm?.forms['acc.m.anim'], [{ form: 'зеле́ного' }]);
    assert.equal(fake.calls.length, calls);
    const updated = JSON.parse(readFileSync(file, 'utf8')) as LcorpCacheRecord;
    assert.ok(updated.parserVersion >= 1 && updated.articles[0].parsed);
  } finally {
    cleanup();
  }
});

test('progress: one tick per lookup and a status line', async () => {
  const ticks: number[] = [];
  const statuses: string[] = [];
  const progress = {
    setTotal() {},
    set() {},
    tick: (d = 1) => void ticks.push(d),
    status: (t: string) => void statuses.push(t),
    done() {},
    fail() {},
  };
  const { client, cleanup } = setup({ progress });
  try {
    await client.lookup({ word: 'стіл', pos: 'noun' });
    await client.lookup({ word: 'стіл', pos: 'noun' });
    await client.close();
    assert.equal(ticks.length, 2);
    assert.match(statuses.at(-1)!, /req\/s .* 1 cached · 2 found/);
  } finally {
    cleanup();
  }
});

test('selection helpers', () => {
  assert.equal(lcorpWordKey('П’я́ть'), "П'ять");
  assert.equal(lcorpPosCompatible('proper-noun', 'noun'), true);
  assert.equal(lcorpPosCompatible('noun', 'verb'), false);
  assert.equal(lcorpPosCompatible('verb', 'noun'), false);
  assert.equal(lcorpPosCompatible('numeral', 'noun'), true);
  assert.equal(lcorpPosCompatible('adjective', 'pronoun'), true);
  assert.equal(lcorpPosCompatible('determiner', 'pronoun'), true);
  assert.equal(lcorpPosCompatible('noun', 'adjective'), false);
  assert.equal(lcorpPosCompatible('adjective', 'adverb'), false);

  const mkArt = (uid: number, headword: string, pos: 'noun' | 'verb') => ({
    uid,
    empty: false,
    html: '',
    headword,
    parsed: { headword, gram: pos === 'noun' ? 'іменник' : 'дієслово', pos, paradigm: { kind: pos, source: 'lcorp', forms: { x: [{ form: headword }] } } },
  });
  const rec: LcorpCacheRecord = {
    cacheVersion: 1,
    parserVersion: 1,
    word: 'мука',
    fetchedAt: '',
    status: 'found',
    articles: [mkArt(1, 'му́ка', 'noun'), mkArt(2, 'мука́', 'noun')],
  };
  assert.equal((selectLcorpResult(rec, { word: 'мука', heads: ['мука́'], pos: 'noun' }, true) as { entry: { headword: string } }).entry.headword, 'мука́');
  assert.equal((selectLcorpResult(rec, { word: 'мука', heads: ['му́ка'], pos: 'noun' }, true) as { entry: { headword: string } }).entry.headword, 'му́ка');
  assert.equal((selectLcorpResult(rec, { word: 'мука', pos: 'noun' }, true) as { entry: { headword: string } }).entry.headword, 'му́ка');
  // case-sensitive: "Мука" must not match "мука" articles
  assert.equal(selectLcorpResult(rec, { word: 'Мука', pos: 'proper-noun' }, true).status, 'not-found');
});
