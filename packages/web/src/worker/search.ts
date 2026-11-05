/**
 * Pure search helpers used by the search worker (no I/O; unit-tested in search.test.ts).
 * Tier semantics: see docs/ARCHITECTURE.md "Ranking tiers".
 */
import { englishStem, hasCyrillic, hasLatin } from '@ukdict/shared';
import type { CoreFile, EnglishQuery } from '@ukdict/shared';
import type { Script } from '../lib/protocol.ts';

export function detectScript(key: string): Script {
  const c = hasCyrillic(key);
  const l = hasLatin(key);
  if (c && l) return 'mixed';
  if (c) return 'cyrillic';
  if (l) return 'latin';
  return 'other';
}

/** First index i with keys[i] >= key (JS code-unit order, matching the pipeline's sort). */
export function lowerBound(keys: readonly string[], key: string): number {
  let lo = 0;
  let hi = keys.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (keys[mid] < key) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Index of `key` in core.keys or -1. */
export function findKey(core: CoreFile, key: string): number {
  const i = lowerBound(core.keys, key);
  return i < core.keys.length && core.keys[i] === key ? i : -1;
}

export function exactIds(core: CoreFile, key: string): number[] {
  const i = findKey(core, key);
  return i < 0 ? [] : core.ids[i].slice();
}

export interface IdList {
  /** Ascending ids (= frequency order), capped. */
  ids: number[];
  /** Total number of matching entries before capping. */
  total: number;
}

function finish(ids: number[], exclude: ReadonlySet<number>, cap: number): IdList {
  const filtered = ids.filter((id) => !exclude.has(id));
  filtered.sort((a, b) => a - b);
  return { ids: filtered.slice(0, cap), total: filtered.length };
}

/** Tier 4: headwords starting with `key` (the exact key itself excluded), most frequent first. */
export function prefixIds(core: CoreFile, key: string, exclude: ReadonlySet<number>, cap = 100): IdList {
  if (!key) return { ids: [], total: 0 };
  const out: number[] = [];
  for (let i = lowerBound(core.keys, key); i < core.keys.length; i++) {
    const k = core.keys[i];
    if (!k.startsWith(key)) break;
    if (k === key) continue;
    for (const id of core.ids[i]) out.push(id);
  }
  return finish(out, exclude, cap);
}

/** Tier 5: headwords containing `key` but not starting with it. Requires ≥ 2 characters. */
export function infixIds(core: CoreFile, key: string, exclude: ReadonlySet<number>, cap = 100): IdList {
  if (Array.from(key).length < 2) return { ids: [], total: 0 };
  const out: number[] = [];
  const keys = core.keys;
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (k.length > key.length && k.indexOf(key, 1) > 0) for (const id of core.ids[i]) out.push(id);
  }
  return finish(out, exclude, cap);
}

/** Weight multiplier for last-token prefix matches (scored lower than exact token matches). */
export const PREFIX_WEIGHT = 0.5;

/** Reads flattened [id, weight, id, weight…] postings into `into`, keeping the max weight per id. */
function addPostings(into: Map<number, number>, postings: readonly number[] | undefined, factor = 1): void {
  if (!postings) return;
  for (let i = 0; i + 1 < postings.length; i += 2) {
    const id = postings[i];
    const w = postings[i + 1] * factor;
    const cur = into.get(id);
    if (cur === undefined || w > cur) into.set(id, w);
  }
}

/** English bucket contents relevant to a query: token → postings. */
export type PostingsLookup = (token: string) => readonly number[] | undefined;
/** All postings lists whose token starts with `prefix` (exact token excluded is fine either way). */
export type PrefixLookup = (prefix: string) => Iterable<readonly number[]>;

/** Which tokens / prefixes an English query needs (to know which buckets to load). */
export function englishNeeds(q: EnglishQuery): { tokens: string[]; prefix?: string } {
  const prefix = q.lastPrefix && q.lastPrefix.length >= 3 && q.tokens.includes(englishStem(q.lastPrefix)) ? q.lastPrefix : undefined;
  return { tokens: q.tokens, prefix };
}

/**
 * Tier 6: AND across tokens; score = sum of per-token weights; the last token also prefix-matches other
 * index tokens (lower weight) while the user is still typing. Returns [id, score] sorted by score desc, id asc.
 */
export function englishSearch(q: EnglishQuery, lookup: PostingsLookup, prefixLookup: PrefixLookup): [number, number][] {
  const { tokens, prefix } = englishNeeds(q);
  if (tokens.length === 0) return [];
  const prefixStem = prefix ? englishStem(prefix) : undefined;
  let acc: Map<number, number> | undefined;
  for (const t of tokens) {
    const m = new Map<number, number>();
    addPostings(m, lookup(t));
    if (prefix && t === prefixStem) {
      for (const list of prefixLookup(prefix)) addPostings(m, list, PREFIX_WEIGHT);
    }
    if (!acc) {
      acc = m;
    } else {
      const next = new Map<number, number>();
      for (const [id, w] of acc) {
        const w2 = m.get(id);
        if (w2 !== undefined) next.set(id, w + w2);
      }
      acc = next;
    }
    if (acc.size === 0) return [];
  }
  return [...acc!].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
}

/** Keys of a bucket object starting with `prefix` (bucket objects are small; linear scan is fine). */
export function* prefixPostings(bucket: Record<string, number[]> | undefined, prefix: string): Iterable<number[]> {
  if (!bucket) return;
  for (const k in bucket) if (k.startsWith(prefix)) yield bucket[k];
}
