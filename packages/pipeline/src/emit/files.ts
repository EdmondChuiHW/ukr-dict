/** Helpers for writing content-hashed gzip JSON files with bounded parallel compression. */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { gzip as gzipCb, constants as zc } from 'node:zlib';
import { promisify } from 'node:util';

const gzipAsync = promisify(gzipCb);

export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export async function gzipBuffer(data: string | Buffer, level = 9): Promise<Buffer> {
  return gzipAsync(typeof data === 'string' ? Buffer.from(data, 'utf8') : data, { level, memLevel: zc.Z_MAX_MEMLEVEL });
}

export interface WrittenFile {
  /** Path relative to the output root (POSIX separators). */
  path: string;
  /** Compressed bytes. */
  bytes: number;
  /** Uncompressed JSON bytes. */
  rawBytes: number;
  /** 8-hex-char content hash (sha256 of the uncompressed JSON). */
  hash: string;
}

/** Runs async tasks with a concurrency limit, preserving result order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Serializes `value` as JSON, hashes it, gzips it and writes `<root>/<dir>/<stem>.<hash8>.json.gz`.
 * Gzip output is deterministic (Node writes MTIME=0), so equal content ⇒ equal file.
 */
export async function writeHashedGzipJson(root: string, dir: string, stem: string, value: unknown): Promise<WrittenFile> {
  const json = JSON.stringify(value);
  const raw = Buffer.from(json, 'utf8');
  const hash = sha256Hex(raw).slice(0, 8);
  const rel = (dir ? `${dir}/` : '') + `${stem}.${hash}.json.gz`;
  const gz = await gzipBuffer(raw, 9);
  const abs = join(root, rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, gz);
  return { path: rel, bytes: gz.length, rawBytes: raw.length, hash };
}
