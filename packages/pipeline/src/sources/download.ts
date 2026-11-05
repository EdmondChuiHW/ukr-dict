/**
 * Resumable HTTP download of the kaikki source dumps.
 *
 * Bytes are streamed to `<dest>.part` and renamed onto `dest` only when complete, so the pipeline never reads a
 * truncated dump. An interrupted download (Ctrl-C, network error) keeps the `.part` file plus a `.part.json`
 * sidecar with the server's validators; the next run resumes with `Range` + `If-Range`, so a dump that changed on
 * the server in the meantime (kaikki.org rebuilds regularly) is restarted from zero instead of being spliced.
 */
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';

export const KAIKKI_UK_URL = 'https://kaikki.org/dictionary/Ukrainian/kaikki.org-dictionary-Ukrainian.jsonl';
export const KAIKKI_EN_URL = 'https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl';

export interface DownloadOptions {
  /** Called as bytes arrive: bytes on disk so far (including a resumed prefix) and the full size if known. */
  onProgress?: (received: number, total: number | undefined) => void;
  signal?: AbortSignal;
  /** Injectable for tests. */
  fetch?: typeof fetch;
}

export interface DownloadResult {
  bytes: number;
  /** Bytes reused from an earlier interrupted download. */
  resumedFrom: number;
}

interface PartMeta {
  url: string;
  etag?: string;
  lastModified?: string;
}

async function sizeOf(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

async function readMeta(path: string): Promise<PartMeta | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as PartMeta;
  } catch {
    return undefined;
  }
}

// "bytes 100-199/1000" → { start: 100, total: 1000 }; "bytes */1000" (416 answer) → { total: 1000 }.
function parseContentRange(h: string | null): { start?: number; total?: number } {
  const m = h ? /^bytes\s+(?:(\d+)-\d+|\*)\/(\d+|\*)/i.exec(h) : null;
  if (!m) return {};
  return { start: m[1] !== undefined ? Number(m[1]) : undefined, total: m[2] !== '*' ? Number(m[2]) : undefined };
}

export async function downloadFile(url: string, dest: string, opts: DownloadOptions = {}): Promise<DownloadResult> {
  const doFetch = opts.fetch ?? fetch;
  const part = `${dest}.part`;
  const metaFile = `${part}.json`;
  await mkdir(dirname(dest), { recursive: true });

  let have = await sizeOf(part);
  const meta = have > 0 ? await readMeta(metaFile) : undefined;
  const validator = meta?.url === url ? (meta.etag ?? meta.lastModified) : undefined;
  if (have > 0 && !validator) have = 0; // can't prove the partial file matches the current dump → start over

  const headers: Record<string, string> = { 'accept-encoding': 'identity' };
  if (have > 0) {
    headers.range = `bytes=${have}-`;
    headers['if-range'] = validator!;
  }
  const res = await doFetch(url, { headers, signal: opts.signal, redirect: 'follow' });

  if (res.status === 416 && have > 0) {
    // Range not satisfiable: the partial file is already complete (crash between last write and rename) or stale.
    await res.body?.cancel();
    if (parseContentRange(res.headers.get('content-range')).total === have) {
      await rename(part, dest);
      await rm(metaFile, { force: true });
      return { bytes: have, resumedFrom: have };
    }
    await rm(part, { force: true });
    await rm(metaFile, { force: true });
    return downloadFile(url, dest, opts);
  }
  if (res.status !== 200 && res.status !== 206) {
    await res.body?.cancel();
    throw new Error(`GET ${url}: HTTP ${res.status} ${res.statusText}`);
  }
  if (!res.body) throw new Error(`GET ${url}: empty response body`);

  let resumedFrom = 0;
  let total: number | undefined;
  if (res.status === 206) {
    const cr = parseContentRange(res.headers.get('content-range'));
    if (cr.start !== have) {
      await res.body.cancel();
      throw new Error(`GET ${url}: server resumed at byte ${cr.start ?? '?'}, expected ${have}`);
    }
    resumedFrom = have;
    total = cr.total;
  } else {
    const len = Number(res.headers.get('content-length'));
    total = Number.isFinite(len) && len > 0 ? len : undefined;
  }

  const newMeta: PartMeta = { url, etag: res.headers.get('etag') ?? undefined, lastModified: res.headers.get('last-modified') ?? undefined };
  await writeFile(metaFile, JSON.stringify(newMeta));

  let received = resumedFrom;
  opts.onProgress?.(received, total);
  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      received += chunk.length;
      opts.onProgress?.(received, total);
      cb(null, chunk);
    },
  });
  await pipeline(
    Readable.fromWeb(res.body as WebReadableStream<Uint8Array>),
    counter,
    createWriteStream(part, { flags: resumedFrom > 0 ? 'a' : 'w' }),
    { signal: opts.signal },
  );

  const bytes = await sizeOf(part);
  if (total !== undefined && bytes !== total) {
    throw new Error(`GET ${url}: incomplete download (${bytes} of ${total} bytes); re-run to resume`);
  }
  await rename(part, dest);
  await rm(metaFile, { force: true });
  return { bytes, resumedFrom };
}
