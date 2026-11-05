import { lazy, Suspense, useEffect } from 'react';
import { stripStress } from '@ukdict/shared';
import { getClient, useClientState } from './lib/client.ts';
import { useRouter } from './lib/router.ts';
import { addRecent } from './lib/settings.ts';
import { SearchBar } from './components/SearchBar.tsx';
import { StatusPill } from './components/StatusPill.tsx';
import { Results } from './components/Results.tsx';
import { Home } from './components/Home.tsx';
import { RouteLink } from './components/WordLink.tsx';

const About = lazy(() => import('./components/About.tsx'));

export function App() {
  const { route, navId } = useRouter();
  const state = useClientState();
  const q = route.view ? '' : route.q;

  useEffect(() => {
    getClient().query(q);
  }, [q]);

  useEffect(() => {
    const t = q.trim();
    document.title = route.view === 'about' ? 'About · Словник' : t ? `${stripStress(t)} · Словник` : 'Словник · Ukrainian–English Dictionary';
  }, [q, route.view]);

  const result = state.result;
  const current = result && result.query === q ? result : undefined;

  // Remember looked-up words once the user dwells on a result.
  const top = current?.done ? (current.exact.entries[0] ?? current.forms.entries[0]) : undefined;
  const topHead = top?.heads[0] ?? top?.word;
  useEffect(() => {
    if (!topHead) return;
    const t = setTimeout(() => addRecent(topHead), 1500);
    return () => clearTimeout(t);
  }, [topHead]);

  let main: React.ReactNode;
  if (route.view === 'about') {
    main = (
      <Suspense fallback={<p className="muted">Loading…</p>}>
        <About state={state} />
      </Suspense>
    );
  } else if (!q.trim()) {
    main = <Home state={state} />;
  } else if (state.phase === 'error' && !result) {
    main = (
      <div className="empty-state">
        <h2>The dictionary data could not be loaded</h2>
        <p className="muted">{state.error}</p>
        <p>If you are offline, the data has not been downloaded on this device yet. Reconnect and reload.</p>
      </div>
    );
  } else if (!result || !result.key) {
    main = (
      <p className="pending-label">
        <span className="spinner" aria-hidden="true" /> Loading index…
      </p>
    );
  } else {
    main = <Results result={result} focusSlug={route.e} navId={navId} stale={!current || !current.done} />;
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <RouteLink route={{ q: '' }} className="brand">
            <img src="./icons/icon.svg" alt="" width="28" height="28" />
            <span className="brand-name">Словник</span>
          </RouteLink>
          <SearchBar value={q} navId={navId} />
          <StatusPill state={state} />
        </div>
      </header>
      <main className="content">{main}</main>
      <footer className="site-footer">
        <RouteLink route={{ q: '', view: 'about' }}>About &amp; sources</RouteLink>
        <span className="muted">
          Data: Wiktionary (CC BY-SA), kaikki.org, Словники України, mova.info frequency list
          {state.info ? ` · built ${state.info.builtAt.slice(0, 10)}` : ''}
        </span>
      </footer>
    </div>
  );
}
