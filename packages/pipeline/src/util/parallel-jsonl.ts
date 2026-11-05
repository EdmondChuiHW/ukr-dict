/**
 * Parallel JSONL processing with worker_threads.
 *
 * Main thread (`runParallelJsonl`):
 *   1. splits the file into byte ranges aligned on newline boundaries (more ranges than workers, so faster
 *      workers pick up more work),
 *   2. optionally counts lines per range (one sequential pass; ~70 ms for 300 MB from page cache) so that every
 *      line gets its exact global 1-based line number,
 *   3. hands ranges to a pool of workers and collects their results in file order.
 *
 * Worker side (`serveJsonlWorker`, called from a source's worker.ts): streams its range with fixed-size
 * `readSync` chunks (never loads the file), splits lines, optionally skips lines that do not contain a byte
 * pattern (`prefilter`, checked on the raw Buffer before any UTF-8 decoding), runs the transform and posts
 * results back in batches plus byte-progress messages.
 */
import fs from 'node:fs';
import os from 'node:os';
import { Worker, parentPort, workerData } from 'node:worker_threads';
import type { StageHandle } from '../contracts.ts';

// ───────────────────────────── shared protocol ─────────────────────────────

interface JobMessage {
  type: 'job';
  rangeIndex: number;
  start: number;
  end: number;
  /** Global 1-based line number of the first line in the range (1 when line numbers are not computed). */
  firstLine: number;
}

type WorkerMessage =
  | { type: 'ready' }
  | { type: 'batch'; rangeIndex: number; items: unknown[] }
  | { type: 'progress'; bytes: number }
  | { type: 'line-error'; line: number; message: string }
  | { type: 'done'; rangeIndex: number; lines: number; matched: number; bytes: number }
  | { type: 'finished'; extra: unknown }
  | { type: 'fatal'; message: string; stack?: string };

export interface ByteRange {
  start: number;
  /** Exclusive. */
  end: number;
}

// ───────────────────────────── range splitting ─────────────────────────────

/**
 * Split `file` into at most `parts` ranges whose boundaries sit right after a '\n'. Every range except possibly
 * the last ends with a newline. Empty ranges are dropped.
 */
export function splitRanges(file: string, parts: number): ByteRange[] {
  const size = fs.statSync(file).size;
  if (size === 0) return [];
  parts = Math.max(1, Math.min(parts, Math.ceil(size / 4096)));
  const fd = fs.openSync(file, 'r');
  try {
    const boundaries = [0];
    const probe = Buffer.allocUnsafe(1 << 16);
    for (let i = 1; i < parts; i++) {
      let pos = Math.max(Math.floor((size * i) / parts), boundaries[boundaries.length - 1]);
      let boundary = size;
      while (pos < size) {
        const n = fs.readSync(fd, probe, 0, probe.length, pos);
        if (n <= 0) break;
        const idx = probe.subarray(0, n).indexOf(10);
        if (idx !== -1) {
          boundary = pos + idx + 1;
          break;
        }
        pos += n;
      }
      if (boundary > boundaries[boundaries.length - 1] && boundary < size) boundaries.push(boundary);
    }
    boundaries.push(size);
    const ranges: ByteRange[] = [];
    for (let i = 0; i + 1 < boundaries.length; i++) {
      if (boundaries[i + 1] > boundaries[i]) ranges.push({ start: boundaries[i], end: boundaries[i + 1] });
    }
    return ranges;
  } finally {
    fs.closeSync(fd);
  }
}

/** Count lines (newline-terminated, plus a trailing unterminated one) in each range with one sequential pass. */
export function countLinesPerRange(file: string, ranges: readonly ByteRange[]): number[] {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.allocUnsafe(8 << 20);
  try {
    return ranges.map(({ start, end }) => {
      let lines = 0;
      let pos = start;
      let lastByte = 10;
      while (pos < end) {
        const n = fs.readSync(fd, buf, 0, Math.min(buf.length, end - pos), pos);
        if (n <= 0) break;
        const chunk = n === buf.length ? buf : buf.subarray(0, n);
        let p = 0;
        while ((p = chunk.indexOf(10, p)) !== -1) {
          lines++;
          p++;
        }
        lastByte = chunk[n - 1];
        pos += n;
      }
      if (end > start && lastByte !== 10) lines++;
      return lines;
    });
  } finally {
    fs.closeSync(fd);
  }
}

// ───────────────────────────── main thread ─────────────────────────────

export interface ParallelJsonlOptions {
  file: string;
  /** Module that calls `serveJsonlWorker(...)` at top level. */
  workerUrl: URL;
  workers: number;
  stage?: StageHandle;
  /** Compute exact global line numbers (adds a fast sequential newline-count pass). Default false. */
  lineNumbers?: boolean;
  /** Passed to the worker's handler factory. Must be structured-cloneable. */
  init?: unknown;
  /** Ranges per worker (load balancing). Default 4. */
  rangesPerWorker?: number;
  /** Called on every received batch (in arrival order, not file order). */
  onBatch?: (items: unknown[], rangeIndex: number) => void;
}

export interface ParallelJsonlResult<R> {
  /** All transform outputs, in file order. */
  results: R[];
  /** Total number of lines in the file. */
  lines: number;
  /** Lines that passed the prefilter (= lines when there is no prefilter). */
  matchedLines: number;
  bytes: number;
  durationMs: number;
  /** One value per worker: whatever the handler's `finish()` returned. */
  extras: unknown[];
  lineErrors: { line: number; message: string }[];
  lineErrorCount: number;
}

export async function runParallelJsonl<R>(opts: ParallelJsonlOptions): Promise<ParallelJsonlResult<R>> {
  const t0 = performance.now();
  const size = fs.statSync(opts.file).size;
  const workerCount = Math.max(1, Math.min(opts.workers, os.availableParallelism()));
  const ranges = splitRanges(opts.file, workerCount * (opts.rangesPerWorker ?? 4));
  const stage = opts.stage;
  stage?.setTotal(size, 'bytes');
  stage?.set(0);
  stage?.status(`${workerCount} workers`);

  if (ranges.length === 0) {
    return { results: [], lines: 0, matchedLines: 0, bytes: 0, durationMs: 0, extras: [], lineErrors: [], lineErrorCount: 0 };
  }

  // Spawn first (workers boot while we count lines).
  const workers: Worker[] = [];
  for (let i = 0; i < Math.min(workerCount, ranges.length); i++) {
    workers.push(new Worker(opts.workerUrl, { workerData: { init: opts.init ?? null, file: opts.file } }));
  }

  const firstLines: number[] = new Array(ranges.length).fill(1);
  if (opts.lineNumbers) {
    const counts = countLinesPerRange(opts.file, ranges);
    let acc = 1;
    for (let i = 0; i < ranges.length; i++) {
      firstLines[i] = acc;
      acc += counts[i];
    }
  }

  const perRange: unknown[][] = ranges.map(() => []);
  const extras: unknown[] = [];
  const lineErrors: { line: number; message: string }[] = [];
  let lineErrorCount = 0;
  let lines = 0;
  let matched = 0;
  let processed = 0;
  let nextRange = 0;

  try {
    await new Promise<void>((resolve, reject) => {
      let finished = 0;
      let failed = false;
      const fail = (err: unknown) => {
        if (failed) return;
        failed = true;
        reject(err instanceof Error ? err : new Error(String(err)));
      };
      const dispatch = (w: Worker) => {
        if (nextRange < ranges.length) {
          const i = nextRange++;
          const job: JobMessage = { type: 'job', rangeIndex: i, start: ranges[i].start, end: ranges[i].end, firstLine: firstLines[i] };
          w.postMessage(job);
        } else {
          w.postMessage({ type: 'finish' });
        }
      };
      for (const w of workers) {
        w.on('message', (msg: WorkerMessage) => {
          switch (msg.type) {
            case 'ready':
              dispatch(w);
              break;
            case 'batch':
              for (const it of msg.items) perRange[msg.rangeIndex].push(it);
              opts.onBatch?.(msg.items, msg.rangeIndex);
              break;
            case 'progress':
              processed += msg.bytes;
              stage?.set(processed);
              break;
            case 'line-error':
              lineErrorCount++;
              if (lineErrors.length < 50) lineErrors.push({ line: msg.line, message: msg.message });
              break;
            case 'done':
              lines += msg.lines;
              matched += msg.matched;
              dispatch(w);
              break;
            case 'finished':
              extras.push(msg.extra);
              if (++finished === workers.length) resolve();
              break;
            case 'fatal':
              fail(new Error(`worker failed: ${msg.message}\n${msg.stack ?? ''}`));
              break;
          }
        });
        w.on('error', fail);
        w.on('exit', (code) => {
          if (code !== 0) fail(new Error(`worker exited with code ${code}`));
        });
      }
    });
  } finally {
    await Promise.all(workers.map((w) => w.terminate()));
  }

  stage?.set(size);
  const results: R[] = [];
  for (const arr of perRange) for (const it of arr) results.push(it as R);
  return {
    results,
    lines,
    matchedLines: matched,
    bytes: size,
    durationMs: performance.now() - t0,
    extras,
    lineErrors,
    lineErrorCount,
  };
}

// ───────────────────────────── worker side ─────────────────────────────

export interface JsonlWorkerHandler<R> {
  /**
   * Only lines containing this exact substring are decoded and transformed (byte-level search on the raw
   * buffer — much cheaper than decoding + JSON.parse for every line).
   */
  prefilter?: string;
  /** Transform one line. Return undefined/null to skip, an array to emit several results. */
  transform(line: string, lineNo: number): R | R[] | undefined | null;
  /** Called once when the worker has no more work; the return value is passed to the main thread (`extras`). */
  finish?(): unknown;
}

export interface ServeOptions {
  /** Results per posted batch. Default 256. */
  batchSize?: number;
  /** Read chunk size. Default 4 MiB. */
  chunkSize?: number;
}

/**
 * Run inside a worker module: `serveJsonlWorker((init) => ({ transform(line, n) { … } }))`.
 * No-op when not running in a worker thread (so the module can be imported in tests).
 */
export function serveJsonlWorker<R>(factory: (init: any) => JsonlWorkerHandler<R>, options: ServeOptions = {}): void {
  const port = parentPort;
  if (!port) return;
  let handler: JsonlWorkerHandler<R>;
  try {
    handler = factory((workerData as { init?: unknown } | null)?.init ?? null);
  } catch (err) {
    port.postMessage({ type: 'fatal', message: String((err as Error)?.message ?? err), stack: (err as Error)?.stack });
    return;
  }
  const batchSize = options.batchSize ?? 256;
  const chunkSize = options.chunkSize ?? 4 << 20;
  const file: string = (workerData as { file: string }).file;
  const fd = fs.openSync(file, 'r');
  const readBuf = Buffer.allocUnsafe(chunkSize);
  const prefilter = handler.prefilter ? Buffer.from(handler.prefilter, 'utf8') : undefined;

  port.on('message', (msg: JobMessage | { type: 'finish' }) => {
    try {
      if (msg.type === 'finish') {
        port.postMessage({ type: 'finished', extra: handler.finish?.() ?? null });
        return;
      }
      if (msg.type === 'job') processRange(msg);
    } catch (err) {
      port.postMessage({ type: 'fatal', message: String((err as Error)?.message ?? err), stack: (err as Error)?.stack });
    }
  });

  function processRange(job: JobMessage): void {
    let carry: Buffer | undefined;
    let pos = job.start;
    let lineNo = job.firstLine; // line number of the first line in the current buffer
    let lines = 0;
    let matched = 0;
    let batch: R[] = [];
    let unreportedBytes = 0;

    const emit = (out: R | R[] | undefined | null) => {
      if (out === undefined || out === null) return;
      if (Array.isArray(out)) for (const o of out) batch.push(o);
      else batch.push(out);
      if (batch.length >= batchSize) {
        port!.postMessage({ type: 'batch', rangeIndex: job.rangeIndex, items: batch });
        batch = [];
      }
    };
    const runLine = (text: string, n: number) => {
      matched++;
      try {
        emit(handler.transform(text, n));
      } catch (err) {
        port!.postMessage({ type: 'line-error', line: n, message: String((err as Error)?.message ?? err) });
      }
    };

    while (pos < job.end || carry) {
      let buf: Buffer;
      let eof = false;
      if (pos < job.end) {
        const n = fs.readSync(fd, readBuf, 0, Math.min(chunkSize, job.end - pos), pos);
        if (n <= 0) {
          eof = true;
          buf = carry ?? Buffer.alloc(0);
        } else {
          pos += n;
          unreportedBytes += n;
          const fresh = readBuf.subarray(0, n);
          buf = carry ? Buffer.concat([carry, fresh]) : fresh;
        }
      } else {
        eof = true;
        buf = carry!;
      }
      carry = undefined;
      if (pos >= job.end) eof = true;

      // Process complete lines in buf; the trailing partial line (if any) is carried over.
      let lineStart = 0;
      if (prefilter) {
        // Count newlines and jump straight to matches.
        let searchFrom = 0;
        while (true) {
          const hit = buf.indexOf(prefilter, searchFrom);
          if (hit === -1) break;
          const ls = buf.lastIndexOf(10, hit) + 1;
          let le = buf.indexOf(10, hit);
          if (le === -1) {
            if (!eof) break; // incomplete line: carry it
            le = buf.length;
          }
          const skipped = countNewlines(buf, lineStart, ls);
          lineNo += skipped;
          lines += skipped;
          runLine(buf.toString('utf8', ls, le), lineNo);
          lineNo++;
          lines++;
          lineStart = Math.min(le + 1, buf.length);
          searchFrom = lineStart;
        }
        // Remaining complete lines without a match.
        const lastNl = buf.lastIndexOf(10);
        if (lastNl + 1 > lineStart) {
          const k = countNewlines(buf, lineStart, lastNl + 1);
          lineNo += k;
          lines += k;
          lineStart = lastNl + 1;
        }
      } else {
        while (true) {
          const le = buf.indexOf(10, lineStart);
          if (le === -1) break;
          if (le > lineStart) runLine(buf.toString('utf8', lineStart, le), lineNo);
          lineNo++;
          lines++;
          lineStart = le + 1;
        }
      }
      if (lineStart < buf.length) {
        if (eof) {
          // Unterminated last line of the range (only possible at EOF).
          if (!prefilter) runLine(buf.toString('utf8', lineStart), lineNo);
          lineNo++;
          lines++;
        } else {
          carry = Buffer.from(buf.subarray(lineStart)); // copy: readBuf is reused
        }
      }
      if (unreportedBytes >= 8 << 20 || eof) {
        port!.postMessage({ type: 'progress', bytes: unreportedBytes });
        unreportedBytes = 0;
      }
      if (eof) break;
    }
    if (batch.length) port!.postMessage({ type: 'batch', rangeIndex: job.rangeIndex, items: batch });
    port!.postMessage({ type: 'done', rangeIndex: job.rangeIndex, lines, matched, bytes: job.end - job.start });
  }

  port.postMessage({ type: 'ready' });
}

function countNewlines(buf: Buffer, from: number, to: number): number {
  let n = 0;
  let p = from;
  while (p < to) {
    const i = buf.indexOf(10, p);
    if (i === -1 || i >= to) break;
    n++;
    p = i + 1;
  }
  return n;
}
