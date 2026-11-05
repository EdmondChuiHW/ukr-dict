/**
 * Query-param routing: `?q=<query>[&e=<slug>]`, `?view=about`. A `data=<dir>` param (dev override of the data
 * directory) is preserved across navigations. Pure helpers + a tiny history policy (unit-tested in url.test.ts).
 */

export interface Route {
  q: string;
  /** Entry slug to scroll to / highlight. */
  e?: string;
  view?: 'about';
}

const PRESERVED = ['data'] as const;

export function parseRoute(search: string): Route {
  const p = new URLSearchParams(search);
  const route: Route = { q: p.get('q') ?? '' };
  const e = p.get('e');
  if (e) route.e = e;
  if (p.get('view') === 'about') route.view = 'about';
  return route;
}

/** Builds "?q=…&e=…" (or "?view=about"), keeping preserved params from `current`. Empty route → "?" + preserved or "./". */
export function routeToSearch(route: Route, current = ''): string {
  const cur = new URLSearchParams(current);
  const p = new URLSearchParams();
  if (route.view) p.set('view', route.view);
  else if (route.q) {
    p.set('q', route.q);
    if (route.e) p.set('e', route.e);
  }
  for (const k of PRESERVED) {
    const v = cur.get(k);
    if (v) p.set(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** href for a word link (relative, so it works from any sub-path). */
export function hrefForRoute(route: Route, current = ''): string {
  return routeToSearch(route, current) || './';
}

export function sameRoute(a: Route, b: Route): boolean {
  return a.q === b.q && (a.e ?? '') === (b.e ?? '') && (a.view ?? '') === (b.view ?? '');
}

/**
 * History policy: typing replaces the current entry, except that the first keystroke after a navigation
 * (initial load, back/forward, link click, Enter) pushes once, so Back returns to the previous word.
 */
export class HistoryPolicy {
  private pushNext = true;
  /** Called for each keystroke-driven URL update. */
  onType(): 'push' | 'replace' {
    const kind = this.pushNext ? 'push' : 'replace';
    this.pushNext = false;
    return kind;
  }
  /** Called after any navigation (load, popstate, link click, commit). */
  onNavigate(): void {
    this.pushNext = true;
  }
}

/** Is this a plain left click that the SPA should intercept (no modifier, no middle click, same target)? */
export function isPlainClick(ev: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; defaultPrevented: boolean }): boolean {
  return ev.button === 0 && !ev.metaKey && !ev.ctrlKey && !ev.shiftKey && !ev.altKey && !ev.defaultPrevented;
}
