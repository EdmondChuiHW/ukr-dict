/** Human-oriented debug artifacts: sample entries, merge/lcorp logs, unmapped form tags, top entries. */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { searchKey } from '@ukdict/shared';
import type { Entry } from '@ukdict/shared';
import type { IgnoredEntry } from '../contracts.ts';
import { writeJsonl } from './jsonl.ts';

export const DEFAULT_SAMPLES = [
  'собака',
  'стіл',
  'співати',
  'заспівати',
  'зелений',
  'мій',
  'два',
  'я',
  'по',
  'ручка',
  'є',
  'ножиці',
  'Україна',
  'замок',
  'що',
  'кращий',
  'кіт',
  'вода',
  'бути',
  'мати',
  'Київ',
];

export interface DebugEmitInput {
  entries: readonly Entry[];
  ignored: readonly IgnoredEntry[];
  merges: readonly unknown[];
  lcorp: readonly unknown[];
  unmappedForms: Record<string, number>;
  samples: readonly string[];
}

function safeFileName(word: string): string {
  return word.replace(/[/\\:*?"<>|\0]/g, '_').slice(0, 80) || '_';
}

export async function emitDebugArtifacts(input: DebugEmitInput, opts: { outDir: string }): Promise<{ files: number; missingSamples: string[] }> {
  const dir = opts.outDir;
  await rm(dir, { recursive: true, force: true });
  await mkdir(join(dir, 'samples'), { recursive: true });
  const byKey = new Map<string, Entry[]>();
  for (const e of input.entries) {
    let l = byKey.get(e.key);
    if (!l) byKey.set(e.key, (l = []));
    l.push(e);
  }
  const ignoredByKey = new Map<string, IgnoredEntry[]>();
  for (const ig of input.ignored) {
    const k = searchKey(ig.word);
    let l = ignoredByKey.get(k);
    if (!l) ignoredByKey.set(k, (l = []));
    l.push(ig);
  }
  const missing: string[] = [];
  let files = 0;
  const uniq = [...new Set(input.samples.map((s) => s.trim()).filter(Boolean))];
  await Promise.all(
    uniq.map(async (word) => {
      const k = searchKey(word);
      const entries = byKey.get(k) ?? [];
      const ignored = ignoredByKey.get(k) ?? [];
      if (entries.length === 0) missing.push(word);
      const body = { query: word, key: k, entries, ignoredEntriesWithThisWord: ignored };
      await writeFile(join(dir, 'samples', `${safeFileName(word)}.json`), JSON.stringify(body, null, 2) + '\n');
      files++;
    }),
  );
  await writeJsonl(join(dir, 'merges.jsonl'), input.merges);
  await writeJsonl(join(dir, 'lcorp.jsonl'), input.lcorp);
  const unmapped = Object.fromEntries(Object.entries(input.unmappedForms).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)));
  await writeFile(join(dir, 'unmapped-forms.json'), JSON.stringify(unmapped, null, 2) + '\n');
  const top = input.entries
    .slice(0, 300)
    .map((e) => `${String(e.id).padStart(5)}  ${e.heads[0] ?? e.word}  ${e.pos}  ${e.freqRank ?? '-'}`)
    .join('\n');
  await writeFile(join(dir, 'top-entries.txt'), `   id  head  pos  freqRank\n${top}\n`);
  files += 4;
  return { files, missingSamples: missing.sort() };
}
