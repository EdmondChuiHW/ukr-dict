/** A real <a href="?q=…"> (open-in-new-tab works) intercepted for SPA navigation. */
import type { ReactNode } from 'react';
import { stripStress } from '@ukdict/shared';
import { hrefFor, navigate } from '../lib/router.ts';
import { isPlainClick } from '../lib/url.ts';
import type { Route } from '../lib/url.ts';
import { Stressed } from './Stressed.tsx';

interface Props {
  /** Target word (may contain stress marks; the query uses the unstressed form). */
  word: string;
  /** Optional entry slug (&e=). */
  e?: string;
  className?: string;
  title?: string;
  /** Custom content; defaults to the stressed word. */
  children?: ReactNode;
  /** Dim style for words without an entry. */
  dead?: boolean;
}

export function WordLink({ word, e, className, title, children, dead }: Props) {
  const route: Route = { q: stripStress(word).trim(), e };
  return (
    <a
      href={hrefFor(route)}
      className={[className, dead ? 'dead' : ''].filter(Boolean).join(' ') || undefined}
      title={title ?? (dead ? 'No entry for this word yet; searches for it' : undefined)}
      lang="uk"
      onClick={(ev) => {
        if (!isPlainClick(ev)) return;
        ev.preventDefault();
        navigate(route);
      }}
    >
      {children ?? <Stressed text={word} />}
    </a>
  );
}

/** Same as WordLink but for in-app routes like the About view. */
export function RouteLink({ route, className, children }: { route: Route; className?: string; children: ReactNode }) {
  return (
    <a
      href={hrefFor(route)}
      className={className}
      onClick={(ev) => {
        if (!isPlainClick(ev)) return;
        ev.preventDefault();
        navigate(route);
      }}
    >
      {children}
    </a>
  );
}
