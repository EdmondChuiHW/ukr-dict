/**
 * lcorp cache warm-up: look up every kaikki-uk lcorp candidate (most frequent first) so the pipeline later
 * gets cache hits only.
 *
 *   node src/sources/lcorp/warm.ts [--budget N] [--rate R] [--concurrency C] [--limit N] [--dry-run]
 *                                  [--offline] [--cache-dir DIR] [--log FILE]
 *
 * Re-running is cheap: cached words cost no requests. Ctrl-C stops after the lookups in flight.
 */
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import type { StageHandle } from '../../contracts.ts';
import { scanLcorpCandidates, type LcorpCandidate } from './candidates.ts';
import { createLcorpClient } from './client.ts';
import { DEFAULT_CACHE_DIR, DEFAULT_FREQUENCY_CSV, DEFAULT_KAIKKI_UK, DEFAULT_WARM_LOG } from './paths.ts';

const { values: args } = parseArgs({
  options: {
    budget: { type: 'string' },
    rate: { type: 'string', default: '1' },
    concurrency: { type: 'string', default: '1' },
    limit: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    offline: { type: 'boolean', default: false },
    'cache-dir': { type: 'string', default: DEFAULT_CACHE_DIR },
    log: { type: 'string', default: DEFAULT_WARM_LOG },
    kaikki: { type: 'string', default: DEFAULT_KAIKKI_UK },
    frequency: { type: 'string', default: DEFAULT_FREQUENCY_CSV },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (args.help) {
  console.log('usage: node src/sources/lcorp/warm.ts [--budget N] [--rate R] [--concurrency C] [--limit N] [--dry-run] [--offline] [--cache-dir DIR] [--log FILE]');
  process.exit(0);
}

function num(v: string | undefined, def: number): number {
  if (v === undefined) return def;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`invalid number: ${v}`);
  return n;
}

const isTTY = process.stdout.isTTY;
function line(text: string): void {
  if (isTTY) process.stdout.write(`\r\x1b[2K${text}`);
}

function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '?';
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h${String(m).padStart(2, '0')}m` : `${m}m${String(s % 60).padStart(2, '0')}s`;
}

// ── 1. candidates ──
const t0 = Date.now();
const scan = await scanLcorpCandidates({
  kaikkiFile: args.kaikki!,
  frequencyFile: args.frequency,
  onProgress: (bytes, lines) => line(`scanning kaikki-uk… ${(bytes / 1e6).toFixed(0)} MB, ${lines} lines`),
});
line('');
const all = scan.candidates;
const uniqueWords = new Set(all.map((c) => c.word)).size;
const ranked = all.filter((c) => c.rank !== undefined).length;
console.log(
  `lcorp candidates: ${all.length} entries (${uniqueWords} distinct words, ${ranked} in the frequency list) from ${scan.lines} lines in ${((Date.now() - t0) / 1000).toFixed(1)} s`,
);
console.log(`  exclusions: ${Object.entries(scan.stats).map(([k, v]) => `${k}=${v}`).join(', ')}`);

const limit = args.limit !== undefined ? num(args.limit, all.length) : all.length;
const todo: LcorpCandidate[] = all.slice(0, limit);

if (args['dry-run']) {
  console.log('first 30 candidates:');
  for (const c of all.slice(0, 30)) {
    console.log(`  ${String(c.rank ?? '-').padStart(6)}  ${c.word.padEnd(20)} ${c.pos.padEnd(12)} heads=${c.heads.join(',')}  (line ${c.line})`);
  }
  process.exit(0);
}

// ── 2. lookups ──
const counts = { done: 0, found: 0, notFound: 0, errors: 0, skipped: 0, cached: 0 };
let latestStatus = '';
const startedAt = Date.now();
let networkMs = 0;
let networkDone = 0;

function render(): void {
  const pct = todo.length ? ((counts.done / todo.length) * 100).toFixed(1) : '100';
  const perNet = networkDone ? networkMs / networkDone : 0;
  const uncachedLeft = todo.length - counts.done;
  const eta = perNet && uncachedLeft ? fmtDuration((perNet * uncachedLeft) / Math.max(1, num(args.concurrency, 1))) : '-';
  const rps = /([\d.]+) req\/s/.exec(latestStatus)?.[1] ?? '0.00';
  line(
    `[lcorp warm] ${counts.done}/${todo.length} (${pct}%) · found ${counts.found} · n/f ${counts.notFound} · err ${counts.errors} · skip ${counts.skipped} · cached ${counts.cached} · ${rps} req/s · ETA ${eta}`,
  );
}

const progress: StageHandle = {
  setTotal() {},
  set() {},
  tick() {},
  status(text) {
    latestStatus = text;
  },
  done() {},
  fail() {},
};

const client = createLcorpClient({
  cacheDir: args['cache-dir']!,
  ratePerSec: num(args.rate, 1),
  concurrency: Math.max(1, Math.floor(num(args.concurrency, 1))),
  budget: args.budget !== undefined ? num(args.budget, Infinity) : Infinity,
  offline: args.offline!,
  progress,
});

await mkdir(dirname(args.log!), { recursive: true });
let stop = false;
process.on('SIGINT', () => {
  if (stop) process.exit(130);
  stop = true;
  line('');
  console.log('\nstopping after lookups in flight (Ctrl-C again to abort)…');
});

let next = 0;
const ticker = setInterval(render, 500);
async function worker(): Promise<void> {
  while (!stop) {
    const i = next++;
    if (i >= todo.length) return;
    const c = todo[i];
    const t = Date.now();
    const r = await client.lookup({ word: c.word, heads: c.heads, pos: c.pos });
    const ms = Date.now() - t;
    counts.done++;
    const fromCache = 'fromCache' in r && r.fromCache;
    if (fromCache) counts.cached++;
    else if (r.status === 'found' || r.status === 'not-found') {
      networkMs += ms;
      networkDone++;
    }
    if (r.status === 'found') counts.found++;
    else if (r.status === 'not-found') counts.notFound++;
    else if (r.status === 'error') counts.errors++;
    else counts.skipped++;
    const rec: Record<string, unknown> = { ts: new Date().toISOString(), word: c.word, pos: c.pos, heads: c.heads, rank: c.rank, status: r.status, ms };
    if (r.status === 'found') {
      rec.headword = r.entry.headword;
      rec.gram = r.entry.gram;
      rec.lcorpPos = r.entry.pos;
      rec.kind = r.entry.paradigm?.kind;
      rec.slots = r.entry.paradigm ? Object.keys(r.entry.paradigm.forms).length : 0;
      rec.fromCache = r.fromCache;
    } else if (r.status === 'not-found') {
      rec.nearest = r.nearest;
      rec.note = r.note;
      rec.fromCache = r.fromCache;
    } else if (r.status === 'skipped') rec.reason = r.reason;
    else rec.message = r.message;
    await appendFile(args.log!, JSON.stringify(rec) + '\n');
    if (r.status === 'error' && client.stats().circuitOpen) stop = true;
  }
}

const conc = Math.max(1, Math.floor(num(args.concurrency, 1)));
await Promise.all(Array.from({ length: conc }, () => worker()));
clearInterval(ticker);
render();
await client.close();
line('');
const s = client.stats();
console.log(
  `\nlcorp warm-up: ${counts.done}/${todo.length} looked up in ${fmtDuration(Date.now() - startedAt)} — found ${counts.found}, not found ${counts.notFound}, errors ${counts.errors}, skipped ${counts.skipped}, cache hits ${s.cacheHits}; ${s.requests} HTTP requests, ${s.sessions} sessions${s.circuitOpen ? ' — NETWORK DISABLED after consecutive errors' : ''}`,
);
console.log(`log: ${args.log}`);
