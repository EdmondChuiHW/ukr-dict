/**
 * In-memory fake of lcorp for tests, backed by the recorded fixture pages in ./fixtures.
 *
 * - GET dictua.aspx → start page + new session cookie
 * - POST search → fixture chosen via `searchMap` (word → file), default = "nearest entry" page (Абра́м)
 * - POST registry select → fixture page whose registryCurrentUid equals the clicked uid
 * - GET registry-feed.aspx → union of recorded feed files + one item per fixture page
 * Every HTML response gets a fresh __VIEWSTATE token; a POST must echo the latest token of its session,
 * otherwise the fake answers HTTP 500 (as ASP.NET does for a broken viewstate chain).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseLcorpPage } from './parse.ts';

export const FIXTURES_DIR = join(import.meta.dirname, 'fixtures');

export function fixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), 'utf8');
}

export interface FakeCall {
  kind: 'start' | 'search' | 'select' | 'feed' | 'injected';
  word?: string;
  uid?: number;
  status: number;
}

export interface FakeLcorp {
  fetch: typeof fetch;
  calls: FakeCall[];
  /** Answer the next `n` requests with `status` (+ headers) instead of serving them. */
  failNext(n: number, status: number, headers?: Record<string, string>): void;
  /** Answer the next POST with a 200 page that has no viewstate (e.g. a maintenance page). */
  breakNextPost(): void;
  count(kind: FakeCall['kind']): number;
}

export const DEFAULT_SEARCH_MAP: Record<string, string> = {
  співати: 'verb-spivaty.html',
  заспівати: 'verb-zaspivaty.html',
  стіл: 'noun-stil2.html',
  замок: 'homonym-zamok-place.html',
  Замок: 'homonym-zamok-place.html',
  собаки: 'form-sobaky.html',
  вони: 'pron-vony-empty.html',
  зелений: 'adj-zelenyi.html',
  "п'ять": 'num-piat.html',
};

export function createFakeLcorp(searchMap: Record<string, string> = DEFAULT_SEARCH_MAP): FakeLcorp {
  const files = readdirSync(FIXTURES_DIR);
  const byUid = new Map<number, string>();
  const registry = new Map<number, { order: number; uid: number; word: string }>();
  for (const f of files.filter((f) => f.endsWith('.json'))) {
    const data = JSON.parse(fixture(f)) as { items: { order: number; uid: number; word: string }[] };
    for (const i of data.items) registry.set(i.order, i);
  }
  for (const f of files.filter((f) => f.endsWith('.html'))) {
    const p = parseLcorpPage(fixture(f));
    if (p.currentUid !== undefined && !byUid.has(p.currentUid)) byUid.set(p.currentUid, f);
    if (p.centerOrder !== undefined && p.currentUid !== undefined && p.article && !registry.has(p.centerOrder)) {
      registry.set(p.centerOrder, { order: p.centerOrder, uid: p.currentUid, word: p.article.headword });
    }
  }
  const calls: FakeCall[] = [];
  const injected: { status: number; headers: Record<string, string> }[] = [];
  let breakPost = false;
  const sessions = new Map<string, string>(); // cookie → latest viewstate token
  let n = 0;

  function html(body: string, session: string, setCookie = false): Response {
    const token = `VS-${++n}`;
    sessions.set(session, token);
    const out = body.replace(/(id="__VIEWSTATE" value=")[^"]*"/, `$1${token}"`);
    const headers: Record<string, string> = { 'content-type': 'text/html; charset=utf-8' };
    if (setCookie) headers['set-cookie'] = `ASP.NET_SessionId=${session}; path=/; HttpOnly; SameSite=Lax`;
    return new Response(out, { status: 200, headers });
  }

  const fakeFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? 'GET').toUpperCase();
    const inj = injected.shift();
    if (inj) {
      calls.push({ kind: 'injected', status: inj.status });
      return new Response('<html><title>Runtime Error</title></html>', { status: inj.status, headers: inj.headers });
    }
    const cookie = /ASP\.NET_SessionId=([^;]+)/.exec(String((init?.headers as Record<string, string> | undefined)?.Cookie ?? ''))?.[1];
    if (url.pathname.endsWith('registry-feed.aspx')) {
      const start = Number(url.searchParams.get('start'));
      const count = Math.min(100, Number(url.searchParams.get('count')));
      const items = [...registry.values()].filter((i) => i.order >= start && i.order < start + count).sort((a, b) => a.order - b.order);
      calls.push({ kind: 'feed', status: 200 });
      return new Response(JSON.stringify({ start, count, total: 262812, items }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (method === 'GET') {
      const session = `fake${++n}`;
      calls.push({ kind: 'start', status: 200 });
      return html(fixture('index-pryvit.html'), session, true);
    }
    const form = new URLSearchParams(String(init?.body ?? ''));
    if (breakPost) {
      breakPost = false;
      calls.push({ kind: 'injected', status: 200 });
      return new Response('<html><body>Service temporarily unavailable</body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (!cookie || sessions.get(cookie) !== form.get('__VIEWSTATE')) {
      calls.push({ kind: 'injected', status: 500 });
      return new Response(fixture('error-500-badviewstate.html'), { status: 500, headers: { 'content-type': 'text/html' } });
    }
    if (form.get('__EVENTTARGET') === 'ctl00$ContentPlaceHolder1$registrySelectButton') {
      const uid = Number(form.get('ctl00$ContentPlaceHolder1$registryClickUid'));
      const file = byUid.get(uid) ?? 'index-pryvit.html';
      calls.push({ kind: 'select', uid, status: 200 });
      return html(fixture(file), cookie);
    }
    const word = form.get('ctl00$ContentPlaceHolder1$tsearch') ?? '';
    calls.push({ kind: 'search', word, status: 200 });
    return html(fixture(searchMap[word] ?? 'none-abrakadabryshche.html'), cookie);
  };

  return {
    fetch: fakeFetch as typeof fetch,
    calls,
    failNext(count, status, headers = {}) {
      for (let i = 0; i < count; i++) injected.push({ status, headers });
    },
    breakNextPost() {
      breakPost = true;
    },
    count(kind) {
      return calls.filter((c) => c.kind === kind).length;
    },
  };
}
