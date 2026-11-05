/**
 * Formats of the web-facing artifacts written by the pipeline to `artifacts/web/` (copied to the web app's
 * `public/data/`). Every data file except `manifest.json` is gzip-compressed JSON with a content-hashed name,
 * decompressed in the browser with `DecompressionStream('gzip')` (works on any static host, no server config).
 *
 * Loading phases in the web app:
 *   1. manifest.json (tiny, no-cache) → core (headword keys → ids): exact / prefix / infix headword search.
 *   2. summaries (one row per entry, for compact result rows) and on-demand buckets:
 *      forms/<prefix> (inflected form → entry ids) and english/<prefix> (stemmed English token → entry ids).
 *      Shards (full entries) are fetched on demand for display.
 *   3. Background "offline" prefetch of every file (cached by the service worker).
 */
import type { Attribution, Entry, PartOfSpeech } from './types.ts';

export const SCHEMA_VERSION = 1;

export interface FileRef {
  /** Path relative to manifest.json, e.g. "core.3f9a1c2b.json.gz". */
  path: string;
  /** Compressed size in bytes. */
  bytes: number;
}

export interface Manifest {
  schemaVersion: number;
  /** Hash over all data files; changes whenever any data changes. */
  buildId: string;
  builtAt: string;
  counts: {
    entries: number;
    createdEntries: number;
    ignoredEntries: number;
    headwordKeys: number;
    formKeys: number;
    englishTokens: number;
  };
  /** Entry id → shard index = Math.floor(id / shardSize). */
  shardSize: number;
  files: {
    core: FileRef;
    summaries: FileRef;
    shards: FileRef[];
    /** Bucket prefix → file. See `findBucket`. */
    forms: Record<string, FileRef>;
    english: Record<string, FileRef>;
  };
  /** Sum of all FileRef.bytes (for offline-download progress). */
  totalBytes: number;
  attributions: Attribution[];
  /** Free-form pipeline provenance (source file dates, counts, lcorp stats…). */
  provenance: Record<string, string | number>;
}

/** Phase-1 index: headword search keys. */
export interface CoreFile {
  /** Unique `searchKey(entry.word)` values, sorted by JS code-unit order (`a < b`), so binary search works with `<`. */
  keys: string[];
  /** Parallel to `keys`: ids of entries with that key, ascending (= frequency order). */
  ids: number[][];
}

/**
 * Compact per-entry row for result lists. Index in `rows` = entry id.
 * - head: primary stressed headword
 * - pos: normalized part of speech
 * - gram: short grammatical label, e.g. "m inan", "f anim", "impf", "pf", "pl only"
 * - gloss: first gloss(es), truncated to ~100 chars
 * - flags: bit 0 = created (from English translations), bit 1 = has paradigm, bit 2 = has audio
 */
export type SummaryRow = [head: string, pos: PartOfSpeech, gram: string, gloss: string, flags: number];

export const SUMMARY_FLAG_CREATED = 1;
export const SUMMARY_FLAG_PARADIGM = 2;
export const SUMMARY_FLAG_AUDIO = 4;

export interface SummariesFile {
  rows: SummaryRow[];
}

export interface ShardFile {
  /** Id of the first entry in this shard. */
  start: number;
  entries: Entry[];
}

/**
 * Forms bucket: `searchKey(form)` → ids of entries having that form in `paradigm` or `extraForms`
 * (ascending). Keys equal to the entry's own headword key are omitted for that entry.
 */
export type FormsBucketFile = Record<string, number[]>;

/**
 * English bucket: stemmed token (see english.ts) → flattened postings
 * [entryId, weight, entryId, weight, …], sorted by weight desc then id asc.
 * weight 3: token forms an entire gloss item (gloss split on , ; / parentheses removed), e.g. "dog" in "dog, hound"
 * weight 2: token appears in the first sense's gloss
 * weight 1: token appears in any other gloss
 */
export type EnglishBucketFile = Record<string, number[]>;

export const BUCKET_MAX_PREFIX = 3;

/**
 * Buckets are keyed by a variable-length prefix (1..BUCKET_MAX_PREFIX chars of the key). A key belongs to the
 * bucket with the LONGEST prefix present in the bucket map. The pipeline splits large buckets into longer
 * prefixes; keys shorter than a child prefix stay in the parent bucket.
 */
export function findBucket(buckets: Record<string, unknown>, key: string): string | undefined {
  const chars = Array.from(key);
  for (let len = Math.min(BUCKET_MAX_PREFIX, chars.length); len >= 1; len--) {
    const p = chars.slice(0, len).join('');
    if (Object.prototype.hasOwnProperty.call(buckets, p)) return p;
  }
  return undefined;
}

/** All buckets that may contain keys starting with `prefix` (for prefix search). */
export function bucketsForPrefix(buckets: Record<string, unknown>, prefix: string): string[] {
  const out = new Set<string>();
  const own = findBucket(buckets, prefix);
  if (own !== undefined) out.add(own);
  for (const p of Object.keys(buckets)) if (p.startsWith(prefix)) out.add(p);
  return [...out];
}

/** File-system-safe name for a bucket prefix: hex code points joined with "-" (e.g. "441-43f"). */
export function bucketFileStem(prefix: string): string {
  return Array.from(prefix)
    .map((c) => c.codePointAt(0)!.toString(16))
    .join('-');
}
