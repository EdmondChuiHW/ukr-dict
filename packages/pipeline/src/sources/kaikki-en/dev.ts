/**
 * Dev script: run the kaikki-en translation extraction (uses / refreshes the cache) and print stats + samples.
 *
 *   node src/sources/kaikki-en/dev.ts                 # uses the cache if present
 *   node src/sources/kaikki-en/dev.ts --no-cache пес  # force re-extraction, show translations to "пес"
 */
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { searchKey } from '@ukdict/shared';
import { consoleProgress } from '../dev-progress.ts';
import { ingestKaikkiEn } from './index.ts';

const args = process.argv.slice(2);
let file = fileURLToPath(new URL('../../../../../data/kaikki-en/kaikki.org-dictionary-English.jsonl', import.meta.url));
let cacheDir = fileURLToPath(new URL('../../../../../data/cache/', import.meta.url));
let workers = Math.max(1, os.availableParallelism() - 1);
let noCache = false;
const words: string[] = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--file') file = args[++i];
  else if (a === '--cache-dir') cacheDir = args[++i];
  else if (a === '--workers') workers = Number(args[++i]);
  else if (a === '--no-cache') noCache = true;
  else words.push(a);
}

const t0 = performance.now();
const res = await ingestKaikkiEn(file, { workers, progress: consoleProgress(), cacheDir, noCache });
const mem = process.memoryUsage();
console.log('stats', res.stats);
console.log(`wall ${((performance.now() - t0) / 1000).toFixed(2)}s, rss ${(mem.rss / 2 ** 20).toFixed(0)} MiB`);
const uk = new Set(res.translations.map((t) => searchKey(t.ukWord)));
const en = new Set(res.translations.map((t) => t.enWord));
console.log(`distinct uk keys ${uk.size}, distinct en words ${en.size}`);
const multi = res.translations.filter((t) => t.ukWord.includes(' ')).length;
console.log(`multi-word translations ${multi}, with tags ${res.translations.filter((t) => t.tags).length}`);
console.log('sample', res.translations.slice(0, 3));
for (const w of words) {
  const k = searchKey(w);
  console.log(`\n=== ${w}`, res.translations.filter((t) => searchKey(t.ukWord) === k || t.enWord === w).slice(0, 40));
}
