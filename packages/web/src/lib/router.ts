/**
 * Router store on top of the History API. See HistoryPolicy (url.ts) for the push/replace rules.
 * Keystroke-driven URL replacements are debounced (Safari throws after 100 history calls / 30 s);
 * the push that starts a new history entry happens immediately.
 */
import { useSyncExternalStore } from 'react';
import { HistoryPolicy, hrefForRoute, parseRoute, sameRoute } from './url.ts';
import type { Route } from './url.ts';

let route: Route = parseRoute(location.search);
/** Increments on every navigation that is not typing (load, link, popstate, commit). */
let navId = 0;
let snapshot = { route, navId };
const policy = new HistoryPolicy();
const listeners = new Set<() => void>();
let replaceTimer: ReturnType<typeof setTimeout> | undefined;

function emit() {
  snapshot = { route, navId };
  for (const l of listeners) l();
}

function flushReplace() {
  if (replaceTimer !== undefined) {
    clearTimeout(replaceTimer);
    replaceTimer = undefined;
    history.replaceState(null, '', hrefForRoute(route, location.search));
  }
}

window.addEventListener('popstate', () => {
  clearTimeout(replaceTimer);
  replaceTimer = undefined;
  route = parseRoute(location.search);
  navId++;
  policy.onNavigate();
  emit();
});

export function useRouter(): { route: Route; navId: number } {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snapshot,
  );
}

export function currentRoute(): Route {
  return route;
}

/** Link click / programmatic navigation: always pushes a new history entry (unless identical). */
export function navigate(next: Route) {
  flushReplace();
  if (!sameRoute(next, route)) history.pushState(null, '', hrefForRoute(next, location.search));
  route = next;
  navId++;
  policy.onNavigate();
  emit();
  window.scrollTo({ top: 0 });
}

/** Typing in the search box. */
export function typeQuery(q: string) {
  const next: Route = { q };
  if (sameRoute(next, route)) return;
  route = next;
  if (policy.onType() === 'push') {
    clearTimeout(replaceTimer);
    replaceTimer = undefined;
    history.pushState(null, '', hrefForRoute(route, location.search));
  } else {
    clearTimeout(replaceTimer);
    replaceTimer = setTimeout(() => {
      replaceTimer = undefined;
      history.replaceState(null, '', hrefForRoute(route, location.search));
    }, 300);
  }
  emit();
}

/** Enter in the search box: the next keystroke starts a new history entry. */
export function commitQuery() {
  flushReplace();
  policy.onNavigate();
}

export function hrefFor(next: Route): string {
  return hrefForRoute(next, location.search);
}
