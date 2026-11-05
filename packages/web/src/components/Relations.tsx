import { useState } from 'react';
import { tagLabel } from '@ukdict/shared';
import type { RelatedTerm, Relations as RelationsT, RelationType } from '@ukdict/shared';
import { RELATION_LABEL, RELATION_ORDER } from '../lib/labels.ts';
import { WordLink } from './WordLink.tsx';
import { Stressed } from './Stressed.tsx';

const LIMIT = 12;

function Chip({ term }: { term: RelatedTerm }) {
  const info = [term.tags?.map(tagLabel).join(', '), term.sense, term.english].filter(Boolean).join(' · ');
  return (
    <WordLink word={term.word} className="chip" dead={term.linked === false} title={info || undefined}>
      <Stressed text={term.word} />
      {term.tags?.length ? <small className="chip-tag">{term.tags.map(tagLabel).join(', ')}</small> : null}
      {term.english ? <small className="chip-en" lang="en">{term.english}</small> : null}
    </WordLink>
  );
}

function RelationRow({ type, list }: { type: RelationType; list: RelatedTerm[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? list : list.slice(0, LIMIT);
  return (
    <div className="rel-row">
      <span className="rel-label">{RELATION_LABEL[type] ?? type}</span>
      <span className="chips">
        {shown.map((t, i) => (
          <Chip key={`${t.word}-${i}`} term={t} />
        ))}
        {list.length > LIMIT ? (
          <button type="button" className="chip more" onClick={() => setAll(!all)} aria-expanded={all}>
            {all ? 'show fewer' : `show all ${list.length}`}
          </button>
        ) : null}
      </span>
    </div>
  );
}

export function Relations({ relations, compact }: { relations: RelationsT; compact?: boolean }) {
  const types = RELATION_ORDER.filter((t) => (relations[t]?.length ?? 0) > 0);
  const extra = (Object.keys(relations) as RelationType[]).filter((t) => !RELATION_ORDER.includes(t) && (relations[t]?.length ?? 0) > 0);
  if (types.length + extra.length === 0) return null;
  return (
    <div className={compact ? 'relations compact' : 'relations'}>
      {[...types, ...extra].map((t) => (
        <RelationRow key={t} type={t} list={relations[t]!} />
      ))}
    </div>
  );
}
