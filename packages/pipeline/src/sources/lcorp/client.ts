/**
 * lcorp ("Словники України online", https://lcorp.ulif.org.ua/dictua/) inflection-table client.
 *
 * Protocol (ASP.NET WebForms):
 *   GET dictua.aspx → cookie ASP.NET_SessionId + hidden fields (__VIEWSTATE, __VIEWSTATEGENERATOR, __EVENTVALIDATION…)
 *   search  = POST hidden fields + tsearch=<word> + search=Знайти            (lands on the alphabetically nearest entry!)
 *   select  = POST hidden fields + registryClickUid=<uid> + __EVENTTARGET=…registrySelectButton
 *   registry feed = GET registry-feed.aspx?start=<order>&count=<n>&dir=down → {items:[{order,uid,word}]}
 * Every page carries fresh hidden fields which are chained into the next postback of the same session.
 *
 * Lookup of a word: search → if the landed headword has a different search key, the word is not in lcorp
 * (1 request). Otherwise read the registry window around the landed position, collect all items whose
 * unstressed spelling equals the word exactly (case-sensitive; homonyms, stress variants), fetch each
 * article (reusing the search result) and cache them all. Selection among the cached homonyms happens per
 * request (stress of `heads`, then POS compatibility, then registry order), so later lookups of the same
 * word with different heads/POS never need the network.
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { normalizeApostrophes, searchKey, stressedKey, stripStress, type PartOfSpeech } from '@ukdict/shared';
import type {
  LcorpClient,
  LcorpEntry,
  LcorpLookupRequest,
  LcorpLookupResult,
  LcorpOptions,
  LcorpStats,
} from '../../contracts.ts';
import { LCORP_PARSER_VERSION, parseLcorpArticle, parseLcorpPage, splitHomonym, type LcorpPage } from './parse.ts';

export const LCORP_BASE_URL = 'https://lcorp.ulif.org.ua/dictua/dictua.aspx';
export const LCORP_FEED_URL = 'https://lcorp.ulif.org.ua/dictua/registry-feed.aspx';
export const LCORP_USER_AGENT = 'ukdict-pipeline/0.1 (offline dictionary build; contact: local)';
/** Bump only on incompatible cache-format changes (parser changes use LCORP_PARSER_VERSION → re-parse). */
export const LCORP_CACHE_VERSION = 1;

const FIELD_SEARCH_TEXT = 'ctl00$ContentPlaceHolder1$tsearch';
const FIELD_SEARCH_BUTTON = 'ctl00$ContentPlaceHolder1$search';
const FIELD_CLICK_UID = 'ctl00$ContentPlaceHolder1$registryClickUid';
const TARGET_REGISTRY_SELECT = 'ctl00$ContentPlaceHolder1$registrySelectButton';

export interface LcorpClientOptions extends LcorpOptions {
  /** Injected fetch (tests). Default: global fetch. */
  fetchImpl?: typeof fetch;
  /** Injected sleep (tests). */
  sleep?: (ms: number) => Promise<void>;
  /** Per-request timeout (default 30 s). */
  timeoutMs?: number;
  /** Retries per request after the first attempt (default 4). */
  maxRetries?: number;
  /** First back-off delay; doubles per retry (default 2000 ms). */
  retryBaseMs?: number;
  /** After this many consecutive failed requests the client stops using the network for the run (default 10). */
  maxConsecutiveErrors?: number;
  userAgent?: string;
  baseUrl?: string;
  feedUrl?: string;
  /** Registry items read on each side of the landed position (default 8). */
  registryRadius?: number;
}

export interface LcorpRegistryItem {
  order: number;
  uid: number;
  /** Stressed registry word (no homonym number). */
  word: string;
}

export interface LcorpCachedArticle {
  uid: number;
  order?: number;
  /** Stressed headword (from the article, else from the registry). */
  headword?: string;
  homonym?: number;
  /** lcorp returned an empty article container (happens for personal pronouns, "хто"…). */
  empty: boolean;
  /** Article inner HTML without the <style> block (source for re-parsing). */
  html: string;
  /** Parse result of `html` with the record's parserVersion. */
  parsed?: LcorpEntry;
}

export interface LcorpCacheRecord {
  cacheVersion: number;
  parserVersion: number;
  /** Exact requested word (unstressed, case-sensitive, apostrophes normalized) = cache key. */
  word: string;
  fetchedAt: string;
  /** 'found' = the registry has ≥1 item spelled exactly like `word` (articles may still be empty). */
  status: 'found' | 'not-found';
  /** Headword lcorp landed on when the word is not in the registry. */
  nearest?: string;
  note?: string;
  centerOrder?: number;
  /** Registry items spelled exactly like `word`. */
  registry?: LcorpRegistryItem[];
  articles: LcorpCachedArticle[];
}

export interface LcorpClientStats extends LcorpStats {
  /** HTTP requests issued (all kinds). */
  requests: number;
  /** ASP.NET sessions opened. */
  sessions: number;
  /** Failed HTTP attempts (incl. retried ones). */
  failedRequests: number;
  /** True once the consecutive-error breaker tripped. */
  circuitOpen: boolean;
}

export interface LcorpClientExt extends LcorpClient {
  stats(): LcorpClientStats;
  /** Read a cache record without touching the network (debug tools). */
  readCached(word: string): Promise<LcorpCacheRecord | undefined>;
}

// ───────────────────────────── word keys / cache paths ─────────────────────────────

/** Cache/lookup key: unstressed, case-sensitive, apostrophes + hyphens normalized, NFC. */
export function lcorpWordKey(word: string): string {
  return normalizeApostrophes(stripStress(word))
    .replace(/[‐‑]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .normalize('NFC');
}

export function lcorpCachePath(cacheDir: string, word: string): string {
  const h = createHash('sha1').update(lcorpWordKey(word), 'utf8').digest('hex');
  return join(cacheDir, 'lcorp', h.slice(0, 2), `${h}.json`);
}

// ───────────────────────────── selection ─────────────────────────────

const NOMINAL = new Set<PartOfSpeech>(['noun', 'proper-noun']);
const ADJECTIVAL = new Set<PartOfSpeech>(['adjective', 'pronoun', 'determiner', 'numeral']);

/** Is an lcorp article with POS `got` acceptable for a dictionary entry with POS `want`? */
export function lcorpPosCompatible(want: PartOfSpeech, got: PartOfSpeech | undefined): boolean {
  if (!got || want === got) return true;
  if (NOMINAL.has(want) && NOMINAL.has(got)) return true;
  if (want === 'verb' || got === 'verb') return false;
  if (want === 'numeral') return NOMINAL.has(got) || ADJECTIVAL.has(got); // тисяча (іменник), перший (прикм.)
  if (NOMINAL.has(want)) return got === 'numeral' || (want === 'noun' && got === 'pronoun');
  if (want === 'pronoun' || want === 'determiner') return ADJECTIVAL.has(got) || got === 'noun';
  if (want === 'adjective') return ADJECTIVAL.has(got);
  return false;
}

function acuteOnly(s: string): string {
  return s.replace(/̀/g, '');
}

function stressScore(headword: string, heads: string[] | undefined): number {
  if (!heads?.length) return 0;
  const hk = stressedKey(headword);
  const keys = heads.map(stressedKey);
  if (keys.includes(hk)) return 2;
  if (keys.map(acuteOnly).includes(acuteOnly(hk))) return 1;
  return 0;
}

/** Pick the best article of a cache record for a request (pure; no I/O). */
export function selectLcorpResult(rec: LcorpCacheRecord, req: LcorpLookupRequest, fromCache: boolean): LcorpLookupResult {
  const key = lcorpWordKey(req.word);
  if (rec.status === 'not-found') {
    return { status: 'not-found', fromCache, ...(rec.nearest ? { nearest: rec.nearest } : {}), ...(rec.note ? { note: rec.note } : {}) };
  }
  const cands = rec.articles.filter((a) => a.parsed && lcorpWordKey(a.parsed.headword) === key);
  if (!cands.length) {
    const empty = rec.articles.some((a) => a.empty);
    const nearest = rec.nearest ?? rec.registry?.[0]?.word;
    return {
      status: 'not-found',
      fromCache,
      ...(nearest ? { nearest } : {}),
      note: empty
        ? 'word is in the lcorp registry but lcorp shows no article/inflection table (uninflected word or personal pronoun)'
        : (rec.note ?? 'no matching article'),
    };
  }
  const compat = cands.filter((a) => lcorpPosCompatible(req.pos, a.parsed!.pos));
  if (!compat.length) {
    return {
      status: 'not-found',
      fromCache,
      nearest: cands[0].parsed!.headword,
      note: `POS mismatch: requested ${req.pos}, lcorp has ${cands.map((a) => `${a.parsed!.headword} (${a.parsed!.gram || '?'})`).join('; ')}`,
    };
  }
  let best = compat[0];
  let bestScore = -1;
  for (const a of compat) {
    const e = a.parsed!;
    const score =
      stressScore(e.headword, req.heads) * 100 + (e.pos === req.pos ? 10 : 0) + (e.paradigm && Object.keys(e.paradigm.forms).length ? 1 : 0);
    if (score > bestScore) {
      best = a;
      bestScore = score;
    }
  }
  return { status: 'found', entry: best.parsed!, fromCache };
}

// ───────────────────────────── errors / helpers ─────────────────────────────

class RetryableError extends Error {
  status?: number;
  retryAfterMs?: number;
  constructor(message: string, status?: number, retryAfterMs?: number) {
    super(message);
    this.name = 'RetryableError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

class CircuitOpenError extends Error {
  constructor() {
    super('lcorp disabled for this run after too many consecutive network errors');
    this.name = 'CircuitOpenError';
  }
}

function parseRetryAfter(v: string | null, now: number): number | undefined {
  if (!v) return undefined;
  const s = v.trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Math.min(600_000, Math.round(Number(s) * 1000));
  const t = Date.parse(s);
  return Number.isFinite(t) ? Math.min(600_000, Math.max(0, t - now)) : undefined;
}

function errMessage(e: unknown): string {
  if (e instanceof Error) return e.cause instanceof Error ? `${e.message} (${e.cause.message})` : e.message;
  return String(e);
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface Session {
  id: number;
  busy: boolean;
  cookie?: string;
  hidden?: Record<string, string>;
}

// ───────────────────────────── client ─────────────────────────────

export function createLcorpClient(opts: LcorpClientOptions): LcorpClientExt {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const sleep = opts.sleep ?? realSleep;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const maxRetries = opts.maxRetries ?? 4;
  const retryBaseMs = opts.retryBaseMs ?? 2000;
  const maxConsecutiveErrors = opts.maxConsecutiveErrors ?? 10;
  const userAgent = opts.userAgent ?? LCORP_USER_AGENT;
  const baseUrl = opts.baseUrl ?? LCORP_BASE_URL;
  const feedUrl = opts.feedUrl ?? LCORP_FEED_URL;
  const radius = opts.registryRadius ?? 8;
  const rate = opts.ratePerSec > 0 ? opts.ratePerSec : 1;
  const budget = Number.isFinite(opts.budget) || opts.budget === Infinity ? Math.max(0, opts.budget) : Infinity;
  const progress = opts.progress;

  const st: LcorpClientStats = {
    network: 0,
    cacheHits: 0,
    found: 0,
    notFound: 0,
    errors: 0,
    skipped: 0,
    requests: 0,
    sessions: 0,
    failedRequests: 0,
    circuitOpen: false,
  };
  let consecutiveErrors = 0;
  /** Distinct words that went to the network this run (budget accounting). */
  const networkWords = new Set<string>();
  const inflight = new Map<string, Promise<LcorpCacheRecord>>();
  const requestTimes: number[] = [];

  // ── token bucket (capacity 1, shared by all sessions) ──
  let nextSlot = 0;
  async function takeToken(): Promise<void> {
    const interval = 1000 / rate;
    const now = Date.now();
    const at = Math.max(now, nextSlot);
    nextSlot = at + interval;
    if (at > now) await sleep(at - now);
  }
  function pauseAll(ms: number): void {
    nextSlot = Math.max(nextSlot, Date.now() + ms);
  }

  // ── session pool ──
  const sessions: Session[] = Array.from({ length: Math.max(1, Math.floor(opts.concurrency) || 1) }, (_, id) => ({ id, busy: false }));
  const waiters: ((s: Session) => void)[] = [];
  function acquire(): Promise<Session> {
    const free = sessions.find((s) => !s.busy);
    if (free) {
      free.busy = true;
      return Promise.resolve(free);
    }
    return new Promise((res) => waiters.push(res));
  }
  function release(s: Session): void {
    const w = waiters.shift();
    if (w) w(s);
    else s.busy = false;
  }
  function resetSession(s: Session): void {
    s.cookie = undefined;
    s.hidden = undefined;
  }

  // ── progress ──
  let lastStatus = 0;
  function reqPerSec(): number {
    const now = Date.now();
    while (requestTimes.length && requestTimes[0] < now - 30_000) requestTimes.shift();
    if (requestTimes.length < 2) return requestTimes.length / 30;
    const span = Math.max(1000, now - requestTimes[0]);
    return (requestTimes.length * 1000) / span;
  }
  function report(force = false): void {
    if (!progress) return;
    const now = Date.now();
    if (!force && now - lastStatus < 250) return;
    lastStatus = now;
    progress.status(
      `${reqPerSec().toFixed(2)} req/s · ${st.requests} req · ${st.cacheHits} cached · ${st.found} found · ${st.notFound} n/f` +
        (st.errors ? ` · ${st.errors} err` : '') +
        (st.skipped ? ` · ${st.skipped} skipped` : '') +
        (st.circuitOpen ? ' · NETWORK DISABLED' : ''),
    );
  }

  // ── HTTP ──
  async function http(s: Session, method: 'GET' | 'POST', url: string, body?: string): Promise<string> {
    await takeToken();
    st.requests++;
    requestTimes.push(Date.now());
    const headers: Record<string, string> = {
      'User-Agent': userAgent,
      Accept: method === 'GET' && url.startsWith(feedUrl) ? 'application/json' : 'text/html,application/xhtml+xml',
      'Accept-Language': 'uk,en;q=0.5',
    };
    if (s.cookie) headers.Cookie = s.cookie;
    if (body !== undefined) headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
    let res: Response;
    try {
      res = await fetchImpl(url, { method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      throw new RetryableError(`network error: ${errMessage(e)}`);
    }
    const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [res.headers.get('set-cookie') ?? ''];
    for (const c of setCookies) {
      const m = /ASP\.NET_SessionId=([^;]*)/.exec(c);
      if (m) s.cookie = `ASP.NET_SessionId=${m[1]}`;
    }
    let text: string;
    try {
      text = await res.text();
    } catch (e) {
      throw new RetryableError(`error reading response: ${errMessage(e)}`);
    }
    if (res.status === 429 || res.status >= 500) {
      // 500 is what ASP.NET returns for a broken viewstate chain → start a fresh session on retry.
      if (res.status === 500) resetSession(s);
      throw new RetryableError(`HTTP ${res.status}`, res.status, parseRetryAfter(res.headers.get('retry-after'), Date.now()));
    }
    if (res.status >= 300 && res.status < 400) {
      resetSession(s); // redirect = error page / expired session
      throw new RetryableError(`HTTP ${res.status} redirect to ${res.headers.get('location') ?? '?'}`, res.status);
    }
    if (res.status !== 200) throw new Error(`HTTP ${res.status} for ${method} ${url}`);
    return text;
  }

  async function withRetry<T>(what: string, fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      if (st.circuitOpen) throw new CircuitOpenError();
      try {
        const r = await fn();
        consecutiveErrors = 0;
        return r;
      } catch (e) {
        st.failedRequests++;
        consecutiveErrors++;
        if (consecutiveErrors >= maxConsecutiveErrors) {
          st.circuitOpen = true;
          report(true);
          throw new CircuitOpenError();
        }
        if (!(e instanceof RetryableError) || attempt >= maxRetries) throw new Error(`${what}: ${errMessage(e)}`);
        const backoff = Math.min(120_000, retryBaseMs * 2 ** attempt * (1 + Math.random() * 0.25));
        const delay = e.retryAfterMs !== undefined ? Math.max(e.retryAfterMs, retryBaseMs) : backoff;
        if (e.status === 429 || (e.status !== undefined && e.status >= 500)) pauseAll(delay);
        await sleep(delay);
      }
    }
  }

  async function ensureSession(s: Session): Promise<void> {
    if (s.hidden) return;
    resetSession(s);
    const page = parseLcorpPage(await http(s, 'GET', baseUrl));
    if (!page.valid) throw new RetryableError('start page without __VIEWSTATE');
    s.hidden = page.hidden;
    st.sessions++;
  }

  type Action = { kind: 'search'; word: string } | { kind: 'select'; word: string; uid: number };

  function postback(s: Session, action: Action): Promise<LcorpPage> {
    return withRetry(`${action.kind} ${action.word}`, async () => {
      await ensureSession(s);
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(s.hidden!)) p.set(k, v);
      p.set('__EVENTTARGET', '');
      p.set('__EVENTARGUMENT', '');
      p.set(FIELD_SEARCH_TEXT, action.word);
      if (action.kind === 'search') {
        p.set(FIELD_SEARCH_BUTTON, 'Знайти');
      } else {
        p.set(FIELD_CLICK_UID, String(action.uid));
        p.set('__EVENTTARGET', TARGET_REGISTRY_SELECT);
      }
      const page = parseLcorpPage(await http(s, 'POST', baseUrl, p.toString()));
      if (!page.valid) {
        resetSession(s);
        throw new RetryableError('response without __VIEWSTATE (viewstate chain broken)');
      }
      s.hidden = page.hidden;
      return page;
    });
  }

  function feed(s: Session, start: number, count: number): Promise<LcorpRegistryItem[]> {
    return withRetry(`registry ${start}+${count}`, async () => {
      const text = await http(s, 'GET', `${feedUrl}?start=${start}&count=${count}&dir=down`);
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        throw new RetryableError('registry feed: invalid JSON');
      }
      const items = (data as { items?: unknown }).items;
      if (!Array.isArray(items)) throw new RetryableError('registry feed: no items');
      return items
        .filter((i): i is { order: number; uid: number; word: string } => !!i && typeof i.word === 'string' && Number.isFinite(Number(i.uid)))
        .map((i) => ({ order: Number(i.order), uid: Number(i.uid), word: splitHomonym(String(i.word)).headword }));
    });
  }

  /** Registry items around `center`, widened while exact matches touch the window edge. */
  async function registryWindow(s: Session, center: number, word: string): Promise<LcorpRegistryItem[]> {
    const isMatch = (i: LcorpRegistryItem) => lcorpWordKey(i.word) === word;
    let start = Math.max(0, center - radius);
    let end = center + radius + 1;
    let items = await feed(s, start, end - start);
    for (let ext = 0; ext < 4; ext++) {
      if (!items.some(isMatch)) break;
      let grew = false;
      if (start > 0 && isMatch(items[0])) {
        const ns = Math.max(0, start - 2 * radius);
        items = [...(await feed(s, ns, start - ns)), ...items];
        start = ns;
        grew = true;
      }
      if (items.length >= end - start && isMatch(items[items.length - 1])) {
        const more = await feed(s, end, 2 * radius);
        items = [...items, ...more];
        end += 2 * radius;
        grew = more.length > 0 || grew;
      }
      if (!grew) break;
    }
    const seen = new Set<number>();
    return items.filter((i) => (seen.has(i.uid) ? false : (seen.add(i.uid), true)));
  }

  function cachedArticle(item: LcorpRegistryItem, page: LcorpPage): LcorpCachedArticle {
    const a = page.article;
    return {
      uid: item.uid,
      order: item.order,
      headword: a?.headword ?? item.word,
      ...(a?.homonym !== undefined ? { homonym: a.homonym } : {}),
      empty: !a,
      html: page.articleHtml,
      ...(a ? { parsed: parseLcorpArticle(a) } : {}),
    };
  }

  async function fetchWord(word: string): Promise<LcorpCacheRecord> {
    const s = await acquire();
    try {
      const page = await postback(s, { kind: 'search', word });
      const base = {
        cacheVersion: LCORP_CACHE_VERSION,
        parserVersion: LCORP_PARSER_VERSION,
        word,
        fetchedAt: new Date().toISOString(),
        ...(page.centerOrder !== undefined ? { centerOrder: page.centerOrder } : {}),
      };
      const landed = page.article?.headword;
      if (landed && searchKey(landed) !== searchKey(word)) {
        return { ...base, status: 'not-found', nearest: landed, articles: [] };
      }
      if (page.centerOrder === undefined) {
        return { ...base, status: 'not-found', ...(landed ? { nearest: landed } : {}), note: 'no registry position in response', articles: [] };
      }
      const items = await registryWindow(s, page.centerOrder, word);
      const matches = items.filter((i) => lcorpWordKey(i.word) === word);
      if (!matches.length) {
        const variants = items.filter((i) => searchKey(i.word) === searchKey(word)).map((i) => i.word);
        const nearest = landed ?? items.find((i) => i.order === page.centerOrder)?.word;
        return {
          ...base,
          status: 'not-found',
          ...(nearest ? { nearest } : {}),
          ...(variants.length ? { note: `lcorp only has other spellings/case: ${[...new Set(variants)].join(', ')}` } : {}),
          articles: [],
        };
      }
      const articles: LcorpCachedArticle[] = [];
      for (const m of matches) {
        if (page.currentUid === m.uid) {
          articles.push(cachedArticle(m, page));
          continue;
        }
        const p = await postback(s, { kind: 'select', word, uid: m.uid });
        if (p.currentUid !== undefined && p.currentUid !== m.uid) continue; // server ignored the selection
        articles.push(cachedArticle(m, p));
      }
      return { ...base, status: 'found', registry: matches, articles };
    } finally {
      release(s);
    }
  }

  // ── cache ──
  async function readCached(word: string): Promise<LcorpCacheRecord | undefined> {
    const file = lcorpCachePath(opts.cacheDir, word);
    let rec: LcorpCacheRecord;
    try {
      rec = JSON.parse(await readFile(file, 'utf8')) as LcorpCacheRecord;
    } catch {
      return undefined; // missing or corrupt → refetch
    }
    if (rec.cacheVersion !== LCORP_CACHE_VERSION || rec.word !== lcorpWordKey(word) || !Array.isArray(rec.articles)) return undefined;
    if (rec.parserVersion !== LCORP_PARSER_VERSION) {
      for (const a of rec.articles) {
        const parsed = a.empty || !a.html ? undefined : parseLcorpArticle(a.html);
        if (parsed) a.parsed = parsed;
        else delete a.parsed;
      }
      rec.parserVersion = LCORP_PARSER_VERSION;
      await writeCache(rec).catch(() => {});
    }
    return rec;
  }

  async function writeCache(rec: LcorpCacheRecord): Promise<void> {
    const file = lcorpCachePath(opts.cacheDir, rec.word);
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    try {
      await writeFile(tmp, JSON.stringify(rec));
      await rename(tmp, file);
    } catch (e) {
      await unlink(tmp).catch(() => {});
      throw e;
    }
  }

  function count(r: LcorpLookupResult): LcorpLookupResult {
    if (r.status === 'found') st.found++;
    else if (r.status === 'not-found') st.notFound++;
    else if (r.status === 'skipped') st.skipped++;
    else st.errors++;
    progress?.tick(1);
    report();
    return r;
  }

  async function lookup(req: LcorpLookupRequest): Promise<LcorpLookupResult> {
    const word = lcorpWordKey(req.word ?? '');
    if (!word) return count({ status: 'not-found', fromCache: false, note: 'empty word' });
    try {
      const cached = await readCached(word);
      if (cached) {
        st.cacheHits++;
        return count(selectLcorpResult(cached, req, true));
      }
      if (opts.offline) return count({ status: 'skipped', reason: 'offline' });
      let p = inflight.get(word);
      if (!p) {
        if (st.circuitOpen) return count({ status: 'error', message: new CircuitOpenError().message });
        if (!networkWords.has(word)) {
          if (networkWords.size >= budget) return count({ status: 'skipped', reason: 'budget' });
          networkWords.add(word);
        }
        st.network++;
        p = fetchWord(word).then(async (rec) => {
          await writeCache(rec);
          return rec;
        });
        inflight.set(word, p);
        p.then(
          () => inflight.delete(word),
          () => inflight.delete(word),
        );
      }
      const rec = await p;
      return count(selectLcorpResult(rec, req, false));
    } catch (e) {
      return count({ status: 'error', message: errMessage(e) });
    }
  }

  return {
    lookup,
    readCached,
    stats: () => ({ ...st }),
    async close() {
      await Promise.allSettled([...inflight.values()]);
      report(true);
    },
  };
}
