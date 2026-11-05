/**
 * Web artifact emitter: writes exactly the formats specified in packages/shared/src/artifacts.ts.
 *
 * Standalone-importable (only depends on @ukdict/shared and node built-ins) so the web app can generate
 * fixture data with it:
 *
 *   import { emitWebArtifacts } from '@ukdict/pipeline/src/emit/web.ts';
 *   await emitWebArtifacts(entries, { outDir, shardSize: 200, attributions, provenance: {}, ignoredCount: 0 });
 *
 * `entries` must be sorted by id with `entries[i].id === i`.
 */
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  bucketFileStem,
  englishIndexTokens,
  findBucket,
  searchKey,
  SCHEMA_VERSION,
  SUMMARY_FLAG_AUDIO,
  SUMMARY_FLAG_CREATED,
  SUMMARY_FLAG_PARADIGM,
} from '@ukdict/shared';
import type {
  Attribution,
  CoreFile,
  Entry,
  FileRef,
  Manifest,
  Sense,
  ShardFile,
  SummariesFile,
  SummaryRow,
} from '@ukdict/shared';
import { buildBuckets, DEFAULT_BUCKET_LIMITS } from './buckets.ts';
import type { BucketLimits } from './buckets.ts';
import { mapLimit, sha256Hex, writeHashedGzipJson } from './files.ts';
import type { WrittenFile } from './files.ts';

/** Minimal progress sink (structurally compatible with the pipeline's StageHandle). */
interface ProgressSink {
  setTotal(total: number, unit?: 'bytes' | 'items' | 'requests' | 'lines'): void;
  tick(delta?: number): void;
  status(text: string): void;
}

export interface WebEmitOptions {
  /** Output directory (e.g. artifacts/web). Stale artifact files in it are deleted first. */
  outDir: string;
  /** Entries per shard file. */
  shardSize: number;
  attributions: Attribution[];
  provenance: Record<string, string | number>;
  ignoredCount: number;
  /** Override the manifest timestamp (tests). */
  builtAt?: string;
  bucketLimits?: BucketLimits;
  /** Parallel gzip jobs (default 16). */
  concurrency?: number;
  progress?: ProgressSink;
}

export type WebFileCategory = 'manifest' | 'core' | 'summaries' | 'shards' | 'forms' | 'english';

export interface WebEmitResult {
  manifest: Manifest;
  files: (WrittenFile & { category: WebFileCategory })[];
  manifestBytes: number;
}

// ───────────────────────────── summaries ─────────────────────────────

const GENDER_ORDER = { m: 0, f: 1, n: 2 } as const;

/** Short grammatical label, e.g. "m inan", "m/f anim", "pl only", "impf", "pf", "impf/pf". */
export function gramLabel(e: Pick<Entry, 'genders' | 'animacy' | 'number' | 'aspect'>): string {
  const parts: string[] = [];
  if (e.genders && e.genders.length > 0) {
    parts.push([...new Set(e.genders)].sort((a, b) => GENDER_ORDER[a] - GENDER_ORDER[b]).join('/'));
  }
  if (e.animacy) parts.push(e.animacy === 'animate' ? 'anim' : 'inan');
  if (e.number === 'plural-only') parts.push('pl only');
  else if (e.number === 'singular-only') parts.push('sg only');
  if (e.aspect) parts.push(e.aspect === 'imperfective' ? 'impf' : e.aspect === 'perfective' ? 'pf' : 'impf/pf');
  return parts.join(' ');
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  let cut = text.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  if (sp > max * 0.6) cut = cut.slice(0, sp);
  return cut.replace(/[\s,;:(]+$/u, '') + '…';
}

/** First non-header gloss(es) (depth-first), joined with "; ", truncated to ~`max` chars. */
export function summaryGloss(senses: readonly Sense[], max = 100): string {
  const parts: string[] = [];
  let len = 0;
  let full = false;
  const walk = (list: readonly Sense[]) => {
    for (const s of list) {
      if (full) return;
      if (!s.headerOnly && s.gloss) {
        const add = (parts.length > 0 ? 2 : 0) + s.gloss.length;
        if (parts.length > 0 && len + add > max) {
          full = true;
          return;
        }
        parts.push(s.gloss);
        len += add;
      }
      if (s.subsenses) walk(s.subsenses);
    }
  };
  walk(senses);
  return truncate(parts.join('; '), max);
}

export function summaryFlags(e: Entry): number {
  let f = 0;
  if (e.created) f |= SUMMARY_FLAG_CREATED;
  if (e.paradigm && Object.keys(e.paradigm.forms).length > 0) f |= SUMMARY_FLAG_PARADIGM;
  if (e.pronunciation?.audio && e.pronunciation.audio.length > 0) f |= SUMMARY_FLAG_AUDIO;
  return f;
}

export function summaryRow(e: Entry): SummaryRow {
  return [e.heads[0] ?? e.word, e.pos, gramLabel(e), summaryGloss(e.senses), summaryFlags(e)];
}

// ───────────────────────────── indexes ─────────────────────────────

export function buildCore(entries: readonly Entry[]): CoreFile {
  const map = new Map<string, number[]>();
  for (const e of entries) {
    let ids = map.get(e.key);
    if (!ids) map.set(e.key, (ids = []));
    ids.push(e.id);
  }
  const keys = [...map.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return { keys, ids: keys.map((k) => map.get(k)!.sort((a, b) => a - b)) };
}

const HAS_LETTER = /\p{L}/u;

/** searchKey(form) → ascending entry ids, for every paradigm form and extra form (excluding the entry's own key). */
export function buildFormsIndex(entries: readonly Entry[]): Map<string, number[]> {
  const map = new Map<string, number[]>();
  const sorted = [...entries].sort((a, b) => a.id - b.id);
  for (const e of sorted) {
    const add = (form: string) => {
      const k = searchKey(form);
      if (!k || k === e.key || !HAS_LETTER.test(k)) return;
      let ids = map.get(k);
      if (!ids) map.set(k, (ids = []));
      if (ids[ids.length - 1] !== e.id) ids.push(e.id);
    };
    if (e.paradigm) for (const forms of Object.values(e.paradigm.forms)) for (const f of forms ?? []) add(f.form);
    for (const x of e.extraForms ?? []) add(x.form);
  }
  return map;
}

/** Split a gloss into items on , ; / after removing parenthesised / bracketed text. */
export function glossItems(gloss: string): string[] {
  let s = gloss;
  for (let i = 0; i < 4; i++) {
    const t = s.replace(/\([^()]*\)/g, ' ').replace(/\[[^[\]]*\]/g, ' ');
    if (t === s) break;
    s = t;
  }
  return s.split(/[,;/]/).map((x) => x.trim()).filter((x) => x.length > 0);
}

/** Token → max weight for one entry (3 = whole gloss item, 2 = first gloss, 1 = other gloss). */
export function entryEnglishWeights(senses: readonly Sense[]): Map<string, number> {
  const w = new Map<string, number>();
  const put = (t: string, weight: number) => {
    const cur = w.get(t);
    if (cur === undefined || weight > cur) w.set(t, weight);
  };
  let firstSeen = false;
  const walk = (list: readonly Sense[]) => {
    for (const s of list) {
      if (s.gloss) {
        const isFirst = !s.headerOnly && !firstSeen;
        if (!s.headerOnly) firstSeen = true;
        const base = isFirst ? 2 : 1;
        for (const t of englishIndexTokens(s.gloss)) put(t, base);
        for (const item of glossItems(s.gloss)) {
          const toks = englishIndexTokens(item);
          if (toks.length === 1) put(toks[0], 3);
        }
      }
      if (s.subsenses) walk(s.subsenses);
    }
  };
  walk(senses);
  return w;
}

/** Stemmed token → flattened postings [id, weight, …] sorted by weight desc, id asc. */
export function buildEnglishIndex(entries: readonly Entry[]): Map<string, number[]> {
  const postings = new Map<string, number[][]>();
  for (const e of entries) {
    for (const [t, weight] of entryEnglishWeights(e.senses)) {
      let list = postings.get(t);
      if (!list) postings.set(t, (list = []));
      list.push([e.id, weight]);
    }
  }
  const out = new Map<string, number[]>();
  for (const [t, list] of postings) {
    list.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    const flat = new Array<number>(list.length * 2);
    for (let i = 0; i < list.length; i++) {
      flat[2 * i] = list[i][0];
      flat[2 * i + 1] = list[i][1];
    }
    out.set(t, flat);
  }
  return out;
}

// ───────────────────────────── emission ─────────────────────────────

const STALE_FILE_RE = /^(manifest\.json|(core|summaries)\.[0-9a-f]{8}\.json\.gz)$/;
const STALE_DIRS = ['shards', 'forms', 'english'];

async function clearStale(outDir: string): Promise<void> {
  await mkdir(outDir, { recursive: true });
  for (const name of await readdir(outDir)) {
    if (STALE_FILE_RE.test(name)) await rm(join(outDir, name), { force: true });
  }
  for (const d of STALE_DIRS) await rm(join(outDir, d), { recursive: true, force: true });
}

export async function emitWebArtifactsDetailed(entries: Entry[], opts: WebEmitOptions): Promise<WebEmitResult> {
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].id !== i) throw new Error(`emitWebArtifacts: entries must be sorted by id with dense ids (entries[${i}].id = ${entries[i].id})`);
  }
  if (!(opts.shardSize > 0)) throw new Error('emitWebArtifacts: shardSize must be > 0');
  const limits = opts.bucketLimits ?? DEFAULT_BUCKET_LIMITS;
  const concurrency = opts.concurrency ?? 16;

  const core = buildCore(entries);
  const summaries: SummariesFile = { rows: entries.map(summaryRow) };
  const formsMap = buildFormsIndex(entries);
  const englishMap = buildEnglishIndex(entries);
  const formBuckets = buildBuckets(formsMap, limits);
  const englishBuckets = buildBuckets(englishMap, limits);

  type Job = { category: WebFileCategory; dir: string; stem: string; value: unknown; key?: string };
  const jobs: Job[] = [
    { category: 'core', dir: '', stem: 'core', value: core },
    { category: 'summaries', dir: '', stem: 'summaries', value: summaries },
  ];
  for (let start = 0, n = 0; start < entries.length; start += opts.shardSize, n++) {
    const shard: ShardFile = { start, entries: entries.slice(start, start + opts.shardSize) };
    jobs.push({ category: 'shards', dir: 'shards', stem: String(n), value: shard });
  }
  for (const [prefix, bucket] of Object.entries(formBuckets)) {
    jobs.push({ category: 'forms', dir: 'forms', stem: bucketFileStem(prefix), value: bucket, key: prefix });
  }
  for (const [prefix, bucket] of Object.entries(englishBuckets)) {
    jobs.push({ category: 'english', dir: 'english', stem: bucketFileStem(prefix), value: bucket, key: prefix });
  }

  await clearStale(opts.outDir);
  opts.progress?.setTotal(jobs.length, 'items');
  opts.progress?.status(`${jobs.length} files`);
  const written = await mapLimit(jobs, concurrency, async (job) => {
    const w = await writeHashedGzipJson(opts.outDir, job.dir, job.stem, job.value);
    opts.progress?.tick(1);
    return { ...w, category: job.category, key: job.key };
  });

  const ref = (w: WrittenFile): FileRef => ({ path: w.path, bytes: w.bytes });
  const forms: Record<string, FileRef> = {};
  const english: Record<string, FileRef> = {};
  const shards: FileRef[] = [];
  let coreRef: FileRef | undefined;
  let summariesRef: FileRef | undefined;
  for (const w of written) {
    if (w.category === 'core') coreRef = ref(w);
    else if (w.category === 'summaries') summariesRef = ref(w);
    else if (w.category === 'shards') shards.push(ref(w));
    else if (w.category === 'forms') forms[w.key!] = ref(w);
    else if (w.category === 'english') english[w.key!] = ref(w);
  }
  // Routing self-check against the manifest maps (what the web app will see).
  for (const k of formsMap.keys()) if (findBucket(forms, k) === undefined || !(k in formBuckets[findBucket(forms, k)!])) throw new Error(`forms key "${k}" not routable`);
  for (const k of englishMap.keys()) if (findBucket(english, k) === undefined || !(k in englishBuckets[findBucket(english, k)!])) throw new Error(`english token "${k}" not routable`);

  const totalBytes = written.reduce((s, w) => s + w.bytes, 0);
  const buildId = sha256Hex(
    written
      .map((w) => `${w.path}:${w.hash}`)
      .sort()
      .join('\n'),
  ).slice(0, 16);

  const manifest: Manifest = {
    schemaVersion: SCHEMA_VERSION,
    buildId,
    builtAt: opts.builtAt ?? new Date().toISOString(),
    counts: {
      entries: entries.length,
      createdEntries: entries.reduce((n, e) => n + (e.created ? 1 : 0), 0),
      ignoredEntries: opts.ignoredCount,
      headwordKeys: core.keys.length,
      formKeys: formsMap.size,
      englishTokens: englishMap.size,
    },
    shardSize: opts.shardSize,
    files: { core: coreRef!, summaries: summariesRef!, shards, forms, english },
    totalBytes,
    attributions: opts.attributions,
    provenance: opts.provenance,
  };
  const manifestJson = JSON.stringify(manifest);
  await writeFile(join(opts.outDir, 'manifest.json'), manifestJson);
  return {
    manifest,
    files: written.map(({ key: _k, ...w }) => w),
    manifestBytes: Buffer.byteLength(manifestJson, 'utf8'),
  };
}

/** Writes manifest.json + all gzip data files to `opts.outDir`; returns the manifest. */
export async function emitWebArtifacts(entries: Entry[], opts: WebEmitOptions): Promise<Manifest> {
  return (await emitWebArtifactsDetailed(entries, opts)).manifest;
}
