import { useEffect, useRef } from 'react';
import { stripStress } from '@ukdict/shared';
import type { Entry } from '@ukdict/shared';
import type { SearchResult } from '../lib/protocol.ts';
import { posLabel } from '../lib/labels.ts';
import { matchEntryForms } from '../lib/match.ts';
import { EntryCard } from './EntryCard.tsx';
import { CompactList, PendingSection } from './CompactList.tsx';
import { WordLink } from './WordLink.tsx';

interface Props {
  result: SearchResult;
  /** `&e=` slug to scroll to / highlight. */
  focusSlug?: string;
  /** Changes on every navigation (scroll to the focused entry once per navigation). */
  navId: number;
  /** True while a newer query is in flight (results shown are for an older query). */
  stale: boolean;
}

/** "noun 1", "noun 2", "verb" for entries sharing a headword. */
function subheads(entries: Entry[]): Map<number, string> {
  const count = new Map<string, number>();
  for (const e of entries) count.set(e.pos, (count.get(e.pos) ?? 0) + 1);
  const seen = new Map<string, number>();
  const out = new Map<number, string>();
  // Number homonyms by id (frequency order), so "noun 1" stays the same entry when a stress match reorders the cards.
  for (const e of [...entries].sort((a, b) => a.id - b.id)) {
    const n = (seen.get(e.pos) ?? 0) + 1;
    seen.set(e.pos, n);
    out.set(e.id, count.get(e.pos)! > 1 ? `${posLabel(e.pos)} ${n}` : posLabel(e.pos));
  }
  return out;
}

function matchesSlug(e: Entry, slug: string | undefined): boolean {
  return !!slug && (e.slug === slug || e.slug.startsWith(`${slug}~`));
}

function SkeletonCard() {
  return (
    <div className="entry skeleton-card" aria-hidden="true">
      <span className="sk sk-title" />
      <span className="sk sk-line" />
      <span className="sk sk-line short" />
    </div>
  );
}

export function Results({ result, focusSlug, navId, stale }: Props) {
  const { exact, forms, prefix, infix, english, key } = result;
  const shown = stripStress(result.query).trim();
  const q = <q lang={result.script === 'latin' ? 'en' : 'uk'}>{shown}</q>;
  const containerRef = useRef<HTMLDivElement>(null);

  const focusEntry = [...exact.entries, ...forms.entries].find((e) => matchesSlug(e, focusSlug));
  const focusId = focusEntry?.slug;
  const scrolledFor = useRef(-1);
  useEffect(() => {
    if (!focusId || scrolledFor.current === navId) return;
    const el = document.getElementById(`entry-${focusId}`);
    if (el) {
      scrolledFor.current = navId;
      el.scrollIntoView({ block: 'start', behavior: 'instant' });
    }
  }, [focusId, navId]);

  const multi = exact.ids.length > 1;
  const heads = subheads(exact.entries);
  const hasCards = exact.ids.length > 0 || forms.ids.length > 0;
  const hasLists = prefix.hits.length + infix.hits.length + english.hits.length > 0 || english.pending;
  const nothing =
    result.done && !hasCards && prefix.hits.length + infix.hits.length + english.hits.length === 0;
  const firstCardId = exact.entries[0]?.id ?? forms.entries[0]?.id;

  const lists = (
    <>
      <CompactList id="prefix" title={<>Words starting with {q}</>} hits={prefix.hits} total={prefix.total} match={key} />
      <CompactList id="infix" title={<>Words containing {q}</>} hits={infix.hits} total={infix.total} match={key} />
      {english.pending ? (
        <PendingSection title="English definitions" label="Searching English definitions…" />
      ) : (
        <CompactList id="english" title={<>English definitions matching {q}</>} hits={english.hits} total={english.total} />
      )}
    </>
  );

  return (
    <div ref={containerRef} className={`results${hasCards && hasLists ? ' with-side' : ''}${stale ? ' stale' : ''}`} aria-busy={!result.done}>
      {result.failed ? (
        <p className="notice warn">Some data files could not be loaded (offline and not downloaded yet?) — results may be incomplete.</p>
      ) : null}
      <div className="results-main">
        {exact.ids.length > 0 ? (
          <section className="exact-group" aria-label="Exact matches">
            {multi ? (
              <h2 className="group-head">
                <span lang="uk">{exact.entries[0]?.word ?? shown}</span>
                <span className="count">{exact.ids.length} entries</span>
              </h2>
            ) : null}
            {exact.pending ? (
              exact.ids.slice(0, 2).map((id) => <SkeletonCard key={id} />)
            ) : (
              exact.entries.map((e) => (
                <EntryCard
                  key={e.id}
                  entry={e}
                  match={exact.stressIds.includes(e.id) ? 'stress' : 'exact'}
                  subhead={multi ? heads.get(e.id) : undefined}
                  query={shown}
                  queryKey={key}
                  expandTable={e.id === firstCardId || matchesSlug(e, focusSlug)}
                  highlighted={e.slug === focusId}
                />
              ))
            )}
            {!exact.pending && exact.ids.length > exact.entries.length ? (
              <p className="muted small">+{exact.ids.length - exact.entries.length} more entries with this headword.</p>
            ) : null}
          </section>
        ) : null}

        {forms.ids.length > 0 ? (
          <section className="forms-group" aria-label="Inflected-form matches">
            <h2 className="section-title">
              {exact.ids.length > 0 ? <>{q} is also an inflected form of</> : <>{q} is an inflected form of</>}
              <span className="count">{forms.ids.length}</span>
            </h2>
            {forms.pending && forms.entries.length === 0
              ? forms.ids.slice(0, 2).map((id) => <SkeletonCard key={id} />)
              : forms.entries.map((e) => (
                  <EntryCard
                    key={e.id}
                    entry={e}
                    match="form"
                    query={shown}
                    queryKey={key}
                    formMatch={matchEntryForms(e, key)}
                    expandTable
                    highlighted={e.slug === focusId}
                  />
                ))}
            {forms.ids.length > forms.entries.length && forms.entries.length > 0 ? (
              <p className="muted small">+{forms.ids.length - forms.entries.length} more words have this form.</p>
            ) : null}
          </section>
        ) : forms.pending ? (
          <p className="pending-label inline" aria-live="polite">
            <span className="spinner" aria-hidden="true" /> Searching inflected forms…
          </p>
        ) : null}

        {!hasCards ? lists : null}

        {nothing ? <NoResults result={result} /> : null}
      </div>
      {hasCards && hasLists ? <aside className="results-side">{lists}</aside> : null}
    </div>
  );
}

function NoResults({ result }: { result: SearchResult }) {
  const shown = stripStress(result.query).trim();
  const shorter = Array.from(shown).slice(0, Math.max(1, Array.from(shown).length - 2)).join('');
  return (
    <div className="empty-state">
      <h2>
        No matches for <q>{shown}</q>
      </h2>
      <ul>
        {result.script === 'latin' ? (
          <li>English search looks for words in the definitions — try a simpler or more common English word (e.g. “dog”, “sing”).</li>
        ) : (
          <>
            <li>
              Check the spelling, or search for the beginning of the word: <WordLink word={shorter} />
            </li>
            <li>Inflected forms are found too (e.g. <WordLink word="співаю" />), but only for words that have a table.</li>
            <li>To search the English definitions, type an English word.</li>
          </>
        )}
      </ul>
    </div>
  );
}
