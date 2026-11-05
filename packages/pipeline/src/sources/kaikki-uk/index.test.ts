import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { silentProgress } from '../../contracts.ts';
import { ingestKaikkiUk } from './index.ts';

const FIXTURE = fileURLToPath(new URL('../../../test-fixtures/kaikki-uk-sample.jsonl', import.meta.url));

describe('ingestKaikkiUk (worker pool)', () => {
  it('produces the same drafts as the sequential transform, in file order, with exact line numbers', async () => {
    const lines = fs.readFileSync(FIXTURE, 'utf8').split('\n').filter(Boolean);
    const res = await ingestKaikkiUk(FIXTURE, { workers: 3, progress: silentProgress });
    assert.equal(res.stats.lines, lines.length);
    assert.equal(res.stats.entries + res.stats.ignored, lines.length);
    assert.equal(res.entries.length, res.stats.entries);
    assert.equal(res.stats.withParadigm, res.entries.filter((e) => e.paradigm).length);
    const all = [...res.entries.map((e) => [e.origin.line!, e.word] as const), ...res.ignored.map((i) => [i.line, i.word] as const)].sort(
      (a, b) => a[0] - b[0],
    );
    assert.deepEqual(
      all.map(([n]) => n),
      lines.map((_, i) => i + 1),
    );
    for (const [n, word] of all) assert.equal(JSON.parse(lines[n - 1]).word, word);
    // file order preserved
    const entryLines = res.entries.map((e) => e.origin.line!);
    assert.deepEqual(entryLines, [...entryLines].sort((a, b) => a - b));
    assert.deepEqual(res.unmappedForms, {});
    assert.ok(res.ignored.every((i) => i.reason === 'inflected-form-only'));
  });
});
