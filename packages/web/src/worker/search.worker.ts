/**
 * Search worker: owns all dictionary data.
 *
 * Loading: manifest.json (no-cache) → core (phase 1, headword search) → summaries (phase 2a).
 * Shards / forms buckets / English buckets are fetched on demand and memoized (in-flight dedupe).
 * Every data file is gzip'd JSON (decoded with DecompressionStream; plain JSON tolerated when a server already
 * removed the Content-Encoding). Files are also written to Cache Storage ("ukdict-data", the same cache the
 * service worker's CacheFirst route uses), so offline works even before the service worker controls the page.
 */
import {
  bucketsForPrefix,
  englishQueryTokens,
  findBucket,
  hasStressMark,
  searchKey,
  stressedKey,
  stripStress,
} from '@ukdict/shared';
import type { CoreFile, Entry, EnglishBucketFile, FileRef, FormsBucketFile, Manifest, ShardFile, SummariesFile, SummaryRow } from '@ukdict/shared';
import type { CompactHit, DataInfo, FromWorker, OfflineProgress, SearchResult, ToWorker } from '../lib/protocol.ts';
import { detectScript, englishNeeds, englishSearch, exactIds, findKey, infixIds, prefixIds, prefixPostings } from './search.ts';

interface WorkerScope {
  postMessage(msg: FromWorker): void;
  onmessage: ((ev: MessageEvent<ToWorker>) => void) | null;
}
const scope = self as unknown as WorkerScope;
const post = (msg: FromWorker) => scope.postMessage(msg);

const CACHE_NAME = 'ukdict-data';
/** Full entries sent for the exact / form tiers. */
const FULL_CAP = 12;
const LIST_CAP = 100;
/** Don't flash "pending" skeletons for loads that finish within this time. */
const FIRST_POST_DELAY_MS = 45;

let dataUrl = '';
let manifest: Manifest | undefined;
let core: CoreFile | undefined;
let summaries: SummaryRow[] | undefined;
let latestSeq = 0;

const inflight = new Map<string, Promise<unknown>>();
const loaded = new Map<string, unknown>();
const failed = new Set<string>();

let readyResolve!: () => void;
const coreReady = new Promise<void>((r) => (readyResolve = r));

// ───────────────────────────── fetching / decoding ─────────────────────────────

let cachePromise: Promise<Cache | undefined> | undefined;
function openCache(): Promise<Cache | undefined> {
  cachePromise ??= (async () => {
    try {
      return typeof caches !== 'undefined' ? await caches.open(CACHE_NAME) : undefined;
    } catch {
      return undefined;
    }
  })();
  return cachePromise;
}

const urlOf = (path: string) => new URL(path, dataUrl).href;

function isGzip(buf: Uint8Array): boolean {
  return buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
}

async function decodeJson<T>(buf: Uint8Array<ArrayBuffer>): Promise<T> {
  let text: string;
  if (isGzip(buf)) {
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    text = await new Response(stream).text();
  } else {
    text = new TextDecoder().decode(buf);
  }
  return JSON.parse(text) as T;
}

/** Reads a response body, reporting byte progress. */
async function readBody(res: Response, onBytes?: (n: number) => void): Promise<Uint8Array<ArrayBuffer>> {
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
    onBytes?.(value.length);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/** Cache-first fetch of an immutable data file; stores network responses in Cache Storage. */
async function fetchBytes(path: string, onBytes?: (n: number) => void): Promise<Uint8Array<ArrayBuffer>> {
  const url = urlOf(path);
  const cache = await openCache();
  if (cache) {
    const hit = await cache.match(url);
    if (hit) return new Uint8Array(await hit.arrayBuffer());
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  const buf = await readBody(res, onBytes);
  if (cache) {
    const headers = { 'content-type': isGzip(buf) ? 'application/gzip' : 'application/json' };
    await cache.put(url, new Response(buf.slice(), { headers })).catch(() => undefined);
  }
  return buf;
}

/** Memoized load + decode of a data file. */
function load<T>(path: string): Promise<T> {
  let p = inflight.get(path) as Promise<T> | undefined;
  if (!p) {
    p = fetchBytes(path)
      .then((buf) => decodeJson<T>(buf))
      .then((v) => {
        loaded.set(path, v);
        failed.delete(path);
        return v;
      })
      .catch((err: unknown) => {
        failed.add(path);
        inflight.delete(path);
        throw err;
      });
    inflight.set(path, p);
  }
  return p;
}

async function loadManifest(): Promise<Manifest> {
  const url = urlOf('manifest.json');
  const cache = await openCache();
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status} for manifest.json`);
    const text = await res.text();
    const m = JSON.parse(text) as Manifest;
    await cache?.put(url, new Response(text, { headers: { 'content-type': 'application/json' } })).catch(() => undefined);
    return m;
  } catch (err) {
    const hit = await cache?.match(url);
    if (hit) return (await hit.json()) as Manifest;
    throw err;
  }
}

function dataInfo(m: Manifest): DataInfo {
  return {
    buildId: m.buildId,
    builtAt: m.builtAt,
    counts: m.counts,
    totalBytes: m.totalBytes,
    fileCount: allFiles(m).length,
    shardSize: m.shardSize,
    attributions: m.attributions,
    provenance: m.provenance,
    coreBytes: m.files.core.bytes,
    summariesBytes: m.files.summaries.bytes,
  };
}

async function init(url: string) {
  dataUrl = url.endsWith('/') ? url : url + '/';
  post({ type: 'phase', phase: 'loading' });
  try {
    manifest = await loadManifest();
    core = await load<CoreFile>(manifest.files.core.path);
    post({ type: 'phase', phase: 'core', info: dataInfo(manifest) });
    readyResolve();
  } catch (err) {
    post({ type: 'phase', phase: 'error', error: String((err as Error)?.message ?? err) });
    return;
  }
  try {
    const s = await load<SummariesFile>(manifest.files.summaries.path);
    summaries = s.rows;
    post({ type: 'phase', phase: 'ready', info: dataInfo(manifest) });
  } catch (err) {
    post({ type: 'phase', phase: 'error', info: dataInfo(manifest), error: String((err as Error)?.message ?? err) });
  }
}

// ───────────────────────────── query evaluation ─────────────────────────────

function getLoaded<T>(path: string, missing: Set<string>): T | undefined {
  const v = loaded.get(path) as T | undefined;
  if (v === undefined && !failed.has(path)) missing.add(path);
  return v;
}

/** Full entries for ids, or undefined if some shard is not loaded yet (shard paths added to `missing`). */
function entriesFor(ids: number[], missing: Set<string>, failures: { failed: boolean }): Entry[] | undefined {
  const m = manifest!;
  const out: Entry[] = [];
  let complete = true;
  for (const id of ids) {
    const ref = m.files.shards[Math.floor(id / m.shardSize)];
    if (!ref) continue;
    if (failed.has(ref.path)) {
      failures.failed = true;
      continue;
    }
    const shard = getLoaded<ShardFile>(ref.path, missing);
    if (!shard) {
      complete = false;
      continue;
    }
    const e = shard.entries[id - shard.start];
    if (e) out.push(e);
  }
  return complete ? out : undefined;
}

function compact(ids: number[], scores?: Map<number, number>): CompactHit[] {
  return ids.map((id) => {
    const row = summaries?.[id];
    let sameKey = 1;
    if (row && core) {
      const i = findKey(core, searchKey(row[0]));
      if (i >= 0) sameKey = core.ids[i].length;
    }
    return { id, row, sameKey, score: scores?.get(id) };
  });
}

function emptyResult(seq: number, query: string, key: string): SearchResult {
  return {
    seq,
    query,
    key,
    script: detectScript(key),
    exact: { ids: [], entries: [], stressIds: [], pending: false },
    forms: { ids: [], entries: [], pending: false, enabled: false },
    prefix: { hits: [], total: 0 },
    infix: { hits: [], total: 0 },
    english: { hits: [], total: 0, pending: false, enabled: false, tokens: [] },
    summariesPending: false,
    failed: false,
    done: true,
  };
}

/** Evaluates a query against whatever data is loaded now. `missing` = files needed for a complete answer. */
function compute(seq: number, q: string): { result: SearchResult; missing: string[] } {
  const key = searchKey(q);
  const res = emptyResult(seq, q, key);
  if (!key || !core || !manifest) return { result: res, missing: [] };
  const m = manifest;
  const missing = new Set<string>();
  const failures = { failed: false };
  const script = res.script;
  const ukrainian = script !== 'latin';
  const english = script === 'latin' || script === 'mixed';

  // Tier 1 + 2: exact headword (stress-sensitive first).
  const exact = exactIds(core, key);
  const exactShown = exact.slice(0, FULL_CAP);
  const exactEntries = entriesFor(exactShown, missing, failures);
  let exactOrder = exact;
  let stressIds: number[] = [];
  if (exactEntries) {
    if (hasStressMark(q)) {
      const sk = stressedKey(q);
      stressIds = exactEntries.filter((e) => e.heads.some((h) => stressedKey(h) === sk)).map((e) => e.id);
    }
    // Within the exact tier: stress-exact first, then case-exact spelling ("по" before "По"), then by id.
    const plain = stripStress(q).trim().replace(/\s+/g, ' ');
    const caseExact = new Set(exactEntries.filter((e) => e.word === plain).map((e) => e.id));
    const st = new Set(stressIds);
    const rank = (id: number) => (st.has(id) ? 0 : caseExact.has(id) ? 1 : 2);
    exactOrder = [...exact].sort((a, b) => rank(a) - rank(b) || a - b);
  }
  const byId = new Map((exactEntries ?? []).map((e) => [e.id, e]));
  res.exact = {
    ids: exactOrder,
    entries: exactEntries ? exactOrder.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])) : [],
    stressIds,
    pending: !exactEntries,
  };
  const exclude = new Set(exact);

  // Tier 3: inflected forms.
  let formIds: number[] = [];
  if (ukrainian) {
    res.forms.enabled = true;
    const b = findBucket(m.files.forms, key);
    if (b !== undefined) {
      const path = m.files.forms[b].path;
      const bucket = getLoaded<FormsBucketFile>(path, missing);
      if (bucket) formIds = (bucket[key] ?? []).filter((id) => !exclude.has(id));
      else if (failed.has(path)) failures.failed = true;
      else res.forms.pending = true;
    }
    const shown = formIds.slice(0, FULL_CAP);
    const formEntries = entriesFor(shown, missing, failures);
    res.forms.ids = formIds;
    res.forms.entries = formEntries ?? [];
    res.forms.pending ||= !formEntries;
    for (const id of formIds) exclude.add(id);
  }

  // Tier 4 + 5: headword prefix / infix (core).
  if (script !== 'latin') {
    const pre = prefixIds(core, key, exclude, LIST_CAP);
    for (const id of pre.ids) exclude.add(id);
    const inf = script === 'other' ? { ids: [], total: 0 } : infixIds(core, key, exclude, LIST_CAP);
    for (const id of inf.ids) exclude.add(id);
    res.prefix = { hits: compact(pre.ids), total: pre.total };
    res.infix = { hits: compact(inf.ids), total: inf.total };
  }

  // Tier 6: English full text.
  if (english) {
    const eq = englishQueryTokens(q);
    const needs = englishNeeds(eq);
    res.english.enabled = true;
    res.english.tokens = eq.tokens;
    const pathFor = (bucketKey: string | undefined) => (bucketKey === undefined ? undefined : m.files.english[bucketKey]?.path);
    const paths = new Set<string>();
    for (const t of needs.tokens) {
      const p = pathFor(findBucket(m.files.english, t));
      if (p) paths.add(p);
    }
    const prefixBuckets = needs.prefix ? bucketsForPrefix(m.files.english, needs.prefix) : [];
    for (const b of prefixBuckets) paths.add(m.files.english[b].path);
    let ready = true;
    for (const p of paths) {
      if (!getLoaded(p, missing)) {
        if (failed.has(p)) failures.failed = true;
        else ready = false;
      }
    }
    if (ready) {
      const bucketOf = (t: string) => {
        const p = pathFor(findBucket(m.files.english, t));
        return p ? (loaded.get(p) as EnglishBucketFile | undefined) : undefined;
      };
      const ranked = englishSearch(
        eq,
        (t) => bucketOf(t)?.[t],
        function* (prefix) {
          for (const b of prefixBuckets) yield* prefixPostings(loaded.get(m.files.english[b].path) as EnglishBucketFile | undefined, prefix);
        },
      ).filter(([id]) => !exclude.has(id));
      const top = ranked.slice(0, LIST_CAP);
      res.english.hits = compact(
        top.map(([id]) => id),
        new Map(top),
      );
      res.english.total = ranked.length;
    } else {
      res.english.pending = true;
    }
  }

  const needRows = res.prefix.hits.length + res.infix.hits.length + res.english.hits.length > 0;
  if (needRows && !summaries) {
    if (!failed.has(m.files.summaries.path)) missing.add(m.files.summaries.path);
    res.summariesPending = true;
  }
  res.failed = failures.failed;
  const missingList = [...missing];
  res.done = missingList.length === 0;
  return { result: res, missing: missingList };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function handleQuery(seq: number, q: string) {
  await coreReady;
  const started = performance.now();
  for (let round = 0; round < 8; round++) {
    if (seq !== latestSeq) return;
    const { result, missing } = compute(seq, q);
    if (missing.length === 0) {
      post({ type: 'result', result });
      return;
    }
    const loads = missing.map((p) =>
      (p === manifest!.files.summaries.path ? load<SummariesFile>(p).then((s) => (summaries = s.rows)) : load(p)).then(
        () => undefined,
        () => undefined,
      ),
    );
    const left = FIRST_POST_DELAY_MS - (performance.now() - started);
    if (left > 0) {
      const all = await Promise.race([Promise.all(loads).then(() => true), sleep(left).then(() => false)]);
      if (all) continue;
      if (seq !== latestSeq) return;
      post({ type: 'result', result: compute(seq, q).result });
    } else {
      post({ type: 'result', result });
    }
    // Stream: recompute as soon as any pending file arrives.
    await Promise.race(loads);
  }
  if (seq === latestSeq) post({ type: 'result', result: compute(seq, q).result });
}

// ───────────────────────────── offline prefetch ─────────────────────────────

function allFiles(m: Manifest): FileRef[] {
  const seen = new Set<string>();
  const out: FileRef[] = [];
  for (const f of [m.files.core, m.files.summaries, ...m.files.shards, ...Object.values(m.files.forms), ...Object.values(m.files.english)]) {
    if (!seen.has(f.path)) {
      seen.add(f.path);
      out.push(f);
    }
  }
  return out;
}

let offline: OfflineProgress = { state: 'idle', loadedBytes: 0, totalBytes: 0, files: 0, filesTotal: 0 };
let lastProgressPost = 0;
function postOffline(force = false) {
  const now = performance.now();
  if (!force && now - lastProgressPost < 150) return;
  lastProgressPost = now;
  post({ type: 'offline', progress: { ...offline } });
}

async function prefetchAll() {
  await coreReady;
  if (!manifest || offline.state === 'running') return;
  const m = manifest;
  const files = allFiles(m);
  const total = m.totalBytes || files.reduce((s, f) => s + f.bytes, 0);
  offline = { state: 'running', loadedBytes: 0, totalBytes: total, files: 0, filesTotal: files.length };
  postOffline(true);
  const cache = await openCache();
  let next = 0;
  let errors = 0;
  const worker = async () => {
    while (next < files.length) {
      const f = files[next++];
      let counted = 0;
      try {
        const hit = cache ? await cache.match(urlOf(f.path)) : undefined;
        if (!hit) {
          await fetchBytes(f.path, (n) => {
            const add = Math.min(n, f.bytes - counted);
            counted += add;
            offline.loadedBytes += add;
            postOffline();
          });
        }
        offline.loadedBytes += f.bytes - counted;
        offline.files++;
      } catch {
        errors++;
        offline.loadedBytes -= counted;
      }
      postOffline();
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  if (errors > 0) {
    offline.state = 'error';
    offline.error = `${errors} file(s) could not be downloaded`;
  } else {
    offline.state = 'done';
    offline.loadedBytes = total;
    await removeStale(cache, files);
  }
  postOffline(true);
}

/** Drop cached files of older builds (same data directory only). */
async function removeStale(cache: Cache | undefined, files: FileRef[]) {
  if (!cache) return;
  try {
    const keep = new Set(files.map((f) => urlOf(f.path)));
    keep.add(urlOf('manifest.json'));
    for (const req of await cache.keys()) {
      if (req.url.startsWith(dataUrl) && !keep.has(req.url)) await cache.delete(req);
    }
  } catch {
    /* best effort */
  }
}

// ───────────────────────────── message loop ─────────────────────────────

scope.onmessage = (ev) => {
  const msg = ev.data;
  switch (msg.type) {
    case 'init':
      void init(msg.dataUrl);
      break;
    case 'query':
      latestSeq = msg.seq;
      void handleQuery(msg.seq, msg.q);
      break;
    case 'prefetch':
      void prefetchAll();
      break;
  }
};
