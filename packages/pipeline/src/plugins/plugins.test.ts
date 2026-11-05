import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { silentProgress } from '../contracts.ts';
import { resolveConfig } from '../config.ts';
import { createExampleSentencesPlugin, parseExampleTsv } from './example-sentences.ts';
import { runPlugins } from './index.ts';
import { sampleEntries } from '../stages/_fixtures.ts';

test('parseExampleTsv', () => {
  const rows = parseExampleTsv('word\tsentence\ttranslation\n# comment\nпо\tПо обіді.\tAfter lunch.\tCorpus X\nбез речення\n');
  assert.deepEqual(rows, [{ word: 'по', text: 'По обіді.', translation: 'After lunch.', ref: 'Corpus X' }]);
});

test('example-sentences plugin attaches to first non-header sense; no-op without file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ukdict-plugin-'));
  try {
    const cfg = resolveConfig({}, dir);
    const entries = sampleEntries();
    const logs: string[] = [];
    const missing = await runPlugins([createExampleSentencesPlugin(join(dir, 'nope.tsv'))], { config: cfg, entries, progress: silentProgress, log: (m) => logs.push(m) });
    assert.deepEqual(missing.attributions, []);
    assert.match(logs[0], /not found/);

    const file = join(dir, 'ex.tsv');
    await writeFile(file, 'по\tПо обіді.\tAfter lunch.\n');
    const res = await runPlugins([createExampleSentencesPlugin(file)], { config: cfg, entries, progress: silentProgress, log: () => {} });
    const po = entries.find((e) => e.key === 'по')!;
    assert.equal(po.senses[0].subsenses![0].examples![0].source, 'example-sentences');
    assert.equal(res.attributions[0].id, 'example-sentences');
    assert.ok(po.sources.some((s) => s.source === 'example-sentences'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
