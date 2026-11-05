/**
 * Variable-length prefix bucketing for the forms / English indexes (see `findBucket` in @ukdict/shared).
 *
 * Algorithm: start with one bucket per first character. A bucket that is too large (key count or JSON bytes)
 * and whose prefix is shorter than BUCKET_MAX_PREFIX is split: its keys are grouped by the next-longer prefix,
 * and the largest groups are moved into child buckets until the parent is within limits. Keys that are not
 * longer than the parent prefix, and small groups, stay in the parent (they still route there because
 * `findBucket` picks the longest prefix that exists). Children are split recursively.
 */
import { BUCKET_MAX_PREFIX, findBucket } from '@ukdict/shared';

export interface BucketLimits {
  /** Max keys per bucket before splitting. */
  maxKeys: number;
  /** Max approximate JSON bytes per bucket before splitting. */
  maxBytes: number;
}

export const DEFAULT_BUCKET_LIMITS: BucketLimits = { maxKeys: 3000, maxBytes: 150_000 };

interface Item<V> {
  key: string;
  chars: string[];
  value: V;
  bytes: number;
}

function approxBytes(key: string, value: unknown): number {
  // "key":value, — UTF-8 length of the key + JSON length of the value (values are ASCII number arrays).
  return Buffer.byteLength(key, 'utf8') + JSON.stringify(value).length + 4;
}

/**
 * Splits `map` into prefix buckets. Returns prefix → (key → value). Every key lands in exactly one bucket,
 * and `findBucket(result, key)` returns that bucket's prefix (verified; throws otherwise).
 */
export function buildBuckets<V>(
  map: Map<string, V>,
  limits: BucketLimits = DEFAULT_BUCKET_LIMITS,
): Record<string, Record<string, V>> {
  const out: Record<string, Item<V>[]> = {};
  const top = new Map<string, Item<V>[]>();
  for (const [key, value] of map) {
    if (key.length === 0) continue;
    const chars = Array.from(key);
    const item: Item<V> = { key, chars, value, bytes: approxBytes(key, value) };
    const p = chars[0];
    let list = top.get(p);
    if (!list) top.set(p, (list = []));
    list.push(item);
  }

  const tooBig = (count: number, bytes: number) => count > limits.maxKeys || bytes > limits.maxBytes;

  const place = (prefix: string, len: number, items: Item<V>[]) => {
    let bytes = 0;
    for (const it of items) bytes += it.bytes;
    if (len >= BUCKET_MAX_PREFIX || !tooBig(items.length, bytes)) {
      out[prefix] = items;
      return;
    }
    const stay: Item<V>[] = [];
    const groups = new Map<string, { items: Item<V>[]; bytes: number }>();
    for (const it of items) {
      if (it.chars.length <= len) {
        stay.push(it);
        continue;
      }
      const child = it.chars.slice(0, len + 1).join('');
      let g = groups.get(child);
      if (!g) groups.set(child, (g = { items: [], bytes: 0 }));
      g.items.push(it);
      g.bytes += it.bytes;
    }
    // Move the largest groups (by bytes) out until the parent fits.
    const sorted = [...groups.entries()].sort((a, b) => b[1].bytes - a[1].bytes || (a[0] < b[0] ? -1 : 1));
    let parentCount = items.length;
    let parentBytes = bytes;
    const children: [string, Item<V>[]][] = [];
    for (const [child, g] of sorted) {
      if (!tooBig(parentCount, parentBytes)) {
        stay.push(...g.items);
        continue;
      }
      children.push([child, g.items]);
      parentCount -= g.items.length;
      parentBytes -= g.bytes;
    }
    if (stay.length > 0) out[prefix] = stay;
    for (const [child, list] of children) place(child, len + 1, list);
  };

  for (const [p, items] of top) place(p, 1, items);

  const result: Record<string, Record<string, V>> = {};
  for (const prefix of Object.keys(out).sort()) {
    const items = out[prefix].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const obj = Object.create(null) as Record<string, V>;
    for (const it of items) obj[it.key] = it.value;
    result[prefix] = obj;
  }
  // Self-check: every key routes to the bucket it was written to.
  for (const [prefix, obj] of Object.entries(result)) {
    for (const key of Object.keys(obj)) {
      const b = findBucket(result, key);
      if (b !== prefix) throw new Error(`bucket routing error: key "${key}" written to "${prefix}" but routes to "${b}"`);
    }
  }
  return result;
}
