import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { silentProgress } from '../../contracts.ts';
import { extractUkTranslations } from './extract.ts';
import { enCachePath, ingestKaikkiEn } from './index.ts';

const FIXTURE = fileURLToPath(new URL('../../../test-fixtures/kaikki-en-sample.jsonl', import.meta.url));

describe('kaikki-en', () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'en-cache-'));
  after(() => fs.rmSync(cacheDir, { recursive: true, force: true }));

  it('extractUkTranslations: top-level and sense-level items, Cyrillic only, trimmed, deduped, stress kept', () => {
    const lines = fs.readFileSync(FIXTURE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const dog = extractUkTranslations(lines[0]);
    assert.deepEqual(dog, [
      { ukWord: 'соба́ка', enWord: 'dog', enPos: 'noun', sense: 'animal', tags: ['masculine', 'feminine'], roman: 'sobáka' },
      { ukWord: 'пес', enWord: 'dog', enPos: 'noun', sense: 'male canine', tags: ['masculine'], roman: 'pes' },
    ]);
    assert.deepEqual(extractUkTranslations(lines[1]), []);
    const free = extractUkTranslations(lines[2]);
    assert.deepEqual(
      free.map((t) => [t.ukWord, t.sense]),
      [
        ['ві́льний', 'not imprisoned'],
        ['безкоштовно', 'Without needing to pay.'],
        ['за́дарма́ ні за що', 'Without needing to pay.'],
      ],
    );
  });

  it('ingestKaikkiEn: prefilters lines, extracts, writes and reuses the cache', async () => {
    const first = await ingestKaikkiEn(FIXTURE, { workers: 2, progress: silentProgress, cacheDir });
    assert.equal(first.stats.fromCache, false);
    assert.equal(first.stats.lines, 7);
    assert.equal(first.stats.matchedLines, 5, 'the cat line has no "code": "uk"');
    assert.deepEqual(
      first.translations.map((t) => t.ukWord),
      ['соба́ка', 'пес', 'ві́льний', 'безкоштовно', 'за́дарма́ ні за що', 'співа́ти', 'заспіва́ти', 'стіл', 'замо́к'],
    );
    assert.equal(first.stats.translations, 9);
    assert.ok(fs.existsSync(enCachePath(cacheDir, FIXTURE)));
    const second = await ingestKaikkiEn(FIXTURE, { workers: 2, progress: silentProgress, cacheDir });
    assert.equal(second.stats.fromCache, true);
    assert.deepEqual(second.translations, first.translations);
    assert.equal(second.stats.matchedLines, 5);
  });
});
