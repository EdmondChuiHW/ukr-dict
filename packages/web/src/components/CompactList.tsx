import { useState } from 'react';
import { stripStress } from '@ukdict/shared';
import type { CompactHit } from '../lib/protocol.ts';
import { gramShort, posLabel } from '../lib/labels.ts';
import { WordLink } from './WordLink.tsx';
import { Stressed } from './Stressed.tsx';

const INITIAL = 20;

interface Props {
  id: string;
  title: React.ReactNode;
  hits: CompactHit[];
  total: number;
  /** Search key to highlight inside headwords. */
  match?: string;
}

function Row({ hit, match }: { hit: CompactHit; match?: string }) {
  if (!hit.row) {
    return (
      <li className="row skeleton" aria-hidden="true">
        <span className="sk sk-head" />
        <span className="sk sk-gloss" />
      </li>
    );
  }
  const [head, pos, gram, gloss, flags] = hit.row;
  const word = stripStress(head);
  // Several entries with this headword → point at this one (slug prefix "word~pos"; homonyms resolve to the first).
  const e = hit.sameKey > 1 ? `${word}~${pos}` : undefined;
  return (
    <li>
      <WordLink word={head} e={e} className="row">
        <span className="row-head">
          <Stressed text={head} match={match} />
        </span>
        <span className="row-gram">
          {posLabel(pos)}
          {gram ? ` · ${gramShort(gram)}` : ''}
          {flags & 1 ? <span className="badge created mini">created</span> : null}
        </span>
        <span className="row-gloss" lang="en">
          <Stressed text={gloss} lang={null} />
        </span>
      </WordLink>
    </li>
  );
}

export function CompactList({ id, title, hits, total, match }: Props) {
  const [expanded, setExpanded] = useState(false);
  if (hits.length === 0) return null;
  const shown = expanded ? hits : hits.slice(0, INITIAL);
  return (
    <section className="compact" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="section-title">
        {title} <span className="count">{total.toLocaleString('en-US')}</span>
      </h2>
      <ul className="rows">
        {shown.map((h) => (
          <Row key={h.id} hit={h} match={match} />
        ))}
      </ul>
      {hits.length > INITIAL ? (
        <button type="button" className="more-btn" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show fewer' : `Show ${hits.length - INITIAL} more`}
        </button>
      ) : null}
      {expanded && total > hits.length ? <p className="muted small">…and {(total - hits.length).toLocaleString('en-US')} more — type more letters to narrow down.</p> : null}
    </section>
  );
}

export function PendingSection({ title, label }: { title: string; label: string }) {
  return (
    <section className="compact pending" aria-busy="true">
      <h2 className="section-title">{title}</h2>
      <p className="pending-label">
        <span className="spinner" aria-hidden="true" /> {label}
      </p>
      <ul className="rows" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <li key={i} className="row skeleton">
            <span className="sk sk-head" />
            <span className="sk sk-gloss" />
          </li>
        ))}
      </ul>
    </section>
  );
}
