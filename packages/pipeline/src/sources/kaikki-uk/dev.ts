/**
 * Dev script: run the full kaikki-uk ingestion and print stats + selected drafts.
 *
 *   node src/sources/kaikki-uk/dev.ts собака співати          # pretty-print drafts for these words
 *   node src/sources/kaikki-uk/dev.ts --workers 8 --file path/to.jsonl --unmapped 30
 */
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { searchKey } from '@ukdict/shared';
import { consoleProgress } from '../dev-progress.ts';
import { ingestKaikkiUk } from './index.ts';

const args = process.argv.slice(2);
let file = fileURLToPath(new URL('../../../../../data/kaikki-uk/kaikki.org-dictionary-Ukrainian.jsonl', import.meta.url));
let workers = Math.max(1, os.availableParallelism() - 1);
let topUnmapped = 15;
const words: string[] = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--file') file = args[++i];
  else if (a === '--workers') workers = Number(args[++i]);
  else if (a === '--unmapped') topUnmapped = Number(args[++i]);
  else words.push(a);
}

const progress = consoleProgress();
const t0 = performance.now();
const res = await ingestKaikkiUk(file, { workers, progress });
const wall = performance.now() - t0;
const mem = process.memoryUsage();

const count = <T>(items: T[], key: (t: T) => string) => {
  const m = new Map<string, number>();
  for (const it of items) m.set(key(it), (m.get(key(it)) ?? 0) + 1);
  return Object.fromEntries([...m].sort((a, b) => b[1] - a[1]));
};

console.log('stats', res.stats);
console.log(`wall ${(wall / 1000).toFixed(2)}s, rss ${(mem.rss / 2 ** 20).toFixed(0)} MiB, heapUsed ${(mem.heapUsed / 2 ** 20).toFixed(0)} MiB`);
console.log('ignored by reason', count(res.ignored, (i) => i.reason));
console.log('entries by pos', count(res.entries, (e) => e.pos));
console.log('paradigm kinds', count(res.entries, (e) => e.paradigm?.kind ?? '(none)'));
const d = res.details;
console.log(
  `table forms ${d.tableForms}, unmapped ${d.unmappedTableForms} (${((100 * (d.tableForms - d.unmappedTableForms)) / Math.max(1, d.tableForms)).toFixed(2)}% mapped), line errors ${d.lineErrorCount}`,
);
console.log('top unmapped tag-sets', Object.entries(res.unmappedForms).slice(0, topUnmapped));
for (const e of d.lineErrors.slice(0, 5)) console.log('line error', e);

for (const w of words) {
  const k = searchKey(w);
  for (const e of res.entries.filter((x) => x.key === k)) console.log(`\n=== ${e.word} (${e.pos}) line ${e.origin.line}\n${JSON.stringify(e, null, 2)}`);
  for (const ig of res.ignored.filter((x) => searchKey(x.word) === k)) console.log(`\n=== IGNORED ${ig.word} (${ig.pos})\n${JSON.stringify(ig, null, 2)}`);
}
