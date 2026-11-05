/**
 * Debug tool: look a word up through the lcorp client (cache first, then network) and print the result.
 *
 *   node src/sources/lcorp/dev.ts <word> [pos] [--heads h1,h2] [--offline] [--forms] [--cache-dir DIR]
 *
 * pos: noun | proper-noun | verb | adjective | pronoun | determiner | numeral (default noun; capitalized → proper-noun)
 */
import { parseArgs } from 'node:util';
import type { PartOfSpeech } from '@ukdict/shared';
import { createLcorpClient } from './client.ts';
import { DEFAULT_CACHE_DIR } from './paths.ts';

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    heads: { type: 'string' },
    offline: { type: 'boolean', default: false },
    forms: { type: 'boolean', default: false },
    'cache-dir': { type: 'string', default: DEFAULT_CACHE_DIR },
  },
});

const [word, posArg] = positionals;
if (!word) {
  console.error('usage: node src/sources/lcorp/dev.ts <word> [pos] [--heads h1,h2] [--offline] [--forms]');
  process.exit(2);
}
const pos = (posArg ?? (word[0] !== word[0].toLowerCase() ? 'proper-noun' : 'noun')) as PartOfSpeech;
const heads = args.heads ? args.heads.split(',').map((h) => h.trim()).filter(Boolean) : undefined;

const client = createLcorpClient({ cacheDir: args['cache-dir']!, ratePerSec: 1, concurrency: 1, budget: 10, offline: args.offline! });
const t = Date.now();
const res = await client.lookup({ word, pos, ...(heads ? { heads } : {}) });
const ms = Date.now() - t;

if (res.status === 'found' && !args.forms) {
  const { paradigm, ...rest } = res.entry;
  console.log(JSON.stringify({ status: res.status, fromCache: res.fromCache, entry: rest }, null, 2));
  if (paradigm) {
    console.log(`paradigm (${paradigm.kind}, ${Object.keys(paradigm.forms).length} slots; notes: ${(paradigm.notes ?? []).join(' | ')}):`);
    for (const [slot, forms] of Object.entries(paradigm.forms)) console.log(`  ${slot.padEnd(16)} ${forms!.map((f) => f.form).join(', ')}`);
  }
} else {
  console.log(JSON.stringify(res, null, 2));
}

const rec = await client.readCached(word);
if (rec) {
  console.log(`cache: ${rec.status}, fetched ${rec.fetchedAt}, parser v${rec.parserVersion}, center ${rec.centerOrder ?? '-'}`);
  for (const a of rec.articles) {
    console.log(
      `  uid ${a.uid} order ${a.order ?? '-'}: ${a.headword ?? '?'}${a.homonym ? ` (${a.homonym})` : ''} — ${a.empty ? 'EMPTY ARTICLE' : `${a.parsed?.gram ?? '?'} → ${a.parsed?.pos ?? '?'}, ${a.parsed?.paradigm ? Object.keys(a.parsed.paradigm.forms).length : 0} slots`}`,
    );
  }
}
const s = client.stats();
console.log(`(${ms} ms, ${s.requests} HTTP requests)`);
await client.close();
