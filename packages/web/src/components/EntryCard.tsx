import { useState } from 'react';
import { kaikkiUrl, LCORP_URL, sourceLabel, stripStress, tagLabel, wiktionaryUrl } from '@ukdict/shared';
import type { Aspect, Entry } from '@ukdict/shared';
import { describeSlots, grammarBadges } from '../lib/labels.ts';
import type { FormMatch } from '../lib/match.ts';
import { toggleAudio, useAudioState } from '../lib/audio.ts';
import { Stressed } from './Stressed.tsx';
import { WordLink } from './WordLink.tsx';
import { Senses } from './Senses.tsx';
import { Relations } from './Relations.tsx';
import { InflectionTable } from './InflectionTable.tsx';

export type MatchKind = 'stress' | 'exact' | 'form';

interface Props {
  entry: Entry;
  match: MatchKind;
  /** e.g. "noun 1" when several entries share the headword. */
  subhead?: string;
  /** The user's query (as typed, stress stripped) for the form-match badge. */
  query: string;
  queryKey: string;
  formMatch?: FormMatch;
  expandTable: boolean;
  highlighted?: boolean;
}

function Pronunciation({ entry }: { entry: Entry }) {
  const audioState = useAudioState();
  const p = entry.pronunciation;
  if (!p || (!p.ipa?.length && !p.audio?.length)) return null;
  return (
    <div className="pron">
      {p.ipa?.map((i, n) => (
        <span key={n} className="ipa" title={i.note}>
          {i.value}
          {i.tags?.length ? <small className="muted"> {i.tags.map(tagLabel).join(', ')}</small> : null}
        </span>
      ))}
      {p.audio?.map((a, n) => {
        const id = `${entry.slug}#${n}`;
        const active = audioState.current === id;
        const label = a.tags?.length ? a.tags.map(tagLabel).join(', ') : p.audio!.length > 1 ? `${n + 1}` : 'listen';
        return (
          <button
            key={n}
            type="button"
            className={`audio-btn${active ? ` ${audioState.phase}` : ''}`}
            onClick={() => void toggleAudio(id, a)}
            aria-pressed={active}
            aria-label={`${active ? 'Stop' : 'Play'} pronunciation${a.label ? ` (${a.label})` : ''}`}
            title={a.label}
          >
            <span className="audio-icon" aria-hidden="true">
              {active ? '■' : '▶'}
            </span>
            {label}
          </button>
        );
      })}
    </div>
  );
}

const ASPECT_LABEL: Record<Aspect, string> = { perfective: 'perfective', imperfective: 'imperfective', biaspectual: 'biaspectual' };

function AspectPartners({ entry }: { entry: Entry }) {
  const list = entry.aspectPartners;
  if (!list?.length) return null;
  const byAspect = new Map<Aspect, typeof list>();
  for (const p of list) {
    if (!byAspect.has(p.aspect)) byAspect.set(p.aspect, []);
    byAspect.get(p.aspect)!.push(p);
  }
  return (
    <p className="partners">
      {[...byAspect].map(([aspect, ps]) => (
        <span key={aspect} className="partner-group">
          <span className="partner-label">{ASPECT_LABEL[aspect]}:</span>{' '}
          {ps.map((p, i) => (
            <span key={p.word}>
              {i > 0 ? ', ' : ''}
              <WordLink word={p.word} dead={p.linked === false} className="partner" />
            </span>
          ))}
        </span>
      ))}
    </p>
  );
}

function CreatedNote({ entry }: { entry: Entry }) {
  const c = entry.created;
  if (!c) return null;
  return (
    <div className="created-note">
      <span className="badge created" title="This entry was generated automatically">
        created
      </span>
      <span>
        Created from English Wiktionary translation tables; no Ukrainian Wiktionary entry exists. Listed as a translation of{' '}
        {c.from.map((f, i) => (
          <span key={i}>
            {i > 0 ? ', ' : ''}
            <a href={f.url} target="_blank" rel="noopener">
              {f.enWord}
            </a>
            <span className="muted">
              {' '}
              ({f.enPos}
              {f.sense ? `: ${f.sense}` : ''})
            </span>
          </span>
        ))}
        .
      </span>
    </div>
  );
}

interface SourceLink {
  url: string;
  label: string;
  note?: string;
}

function sourceLinks(e: Entry): SourceLink[] {
  const out: SourceLink[] = [];
  const add = (l: SourceLink) => {
    if (l.url && !out.some((x) => x.url === l.url)) out.push(l);
  };
  const isCreated = !!e.created;
  const hasSrc = (id: string) => e.sources.some((s) => s.source === id);
  if (!isCreated || hasSrc('wiktionary')) add({ url: e.sources.find((s) => s.source === 'wiktionary')?.url ?? wiktionaryUrl(e.word), label: 'Wiktionary' });
  if (!isCreated || hasSrc('kaikki')) add({ url: e.sources.find((s) => s.source === 'kaikki')?.url ?? kaikkiUrl(e.word), label: 'kaikki.org' });
  for (const f of e.created?.from ?? []) add({ url: f.url, label: `English Wiktionary: ${f.enWord}` });
  if (e.paradigm?.source === 'lcorp' || hasSrc('lcorp')) {
    add({ url: LCORP_URL, label: 'Словники України (lcorp)', note: `no direct link: search for “${stripStress(e.word)}”` });
  }
  for (const s of e.sources) {
    if (s.url && !['wiktionary', 'kaikki', 'lcorp'].includes(s.source)) add({ url: s.url, label: s.label ?? sourceLabel(s.source), note: s.note });
  }
  return out;
}

function SourcesFooter({ entry }: { entry: Entry }) {
  const [frame, setFrame] = useState(false);
  const links = sourceLinks(entry);
  const frameUrl = entry.created ? entry.created.from[0]?.url : wiktionaryUrl(entry.word);
  return (
    <footer className="sources">
      <div className="sources-line">
        <span className="muted">Sources:</span>
        {links.map((l) => (
          <span key={l.url} className="source">
            <a href={l.url} target="_blank" rel="noopener">
              {l.label}
            </a>
            {l.note ? <small className="muted"> ({l.note})</small> : null}
          </span>
        ))}
        {frameUrl ? (
          <button type="button" className="link-btn" aria-expanded={frame} onClick={() => setFrame(!frame)}>
            {frame ? 'Hide' : 'Show'} {entry.created ? 'English Wiktionary' : 'Wiktionary'} page
          </button>
        ) : null}
      </div>
      {frame && frameUrl ? (
        <iframe className="source-frame" src={frameUrl} loading="lazy" title={`Wiktionary: ${entry.word}`} referrerPolicy="no-referrer" />
      ) : null}
    </footer>
  );
}

export function EntryCard({ entry, match, subhead, query, queryKey, formMatch, expandTable, highlighted }: Props) {
  const badges = grammarBadges(entry);
  const tags = (entry.tags ?? []).filter((t) => !badges.includes(tagLabel(t)));
  return (
    <article id={`entry-${entry.slug}`} className={`entry${highlighted ? ' highlighted' : ''}`} data-slug={entry.slug} data-id={entry.id}>
      <header className="entry-head">
        {subhead ? <div className="subhead">{subhead}</div> : null}
        <div className="title-line">
          <h3 className="headword">
            <Stressed text={entry.heads[0] ?? entry.word} />
            {entry.heads.slice(1).map((h) => (
              <span key={h} className="alt-head">
                , <Stressed text={h} />
              </span>
            ))}
          </h3>
          {match === 'stress' ? <span className="match-badge stress">exact stress match</span> : null}
          {match === 'exact' ? <span className="match-badge exact">exact match</span> : null}
          {match === 'form' ? <span className="match-badge form">inflected form</span> : null}
        </div>
        <div className="badges">
          <span className="gram">{badges.join(' · ')}</span>
          {tags.map((t) => (
            <span key={t} className="badge">
              {tagLabel(t)}
            </span>
          ))}
          {entry.freqRank ? (
            <span className="badge freq" title="Rank in the frequency dictionary of modern Ukrainian publicistic texts (lower = more frequent)">
              #{entry.freqRank.toLocaleString('en-US')} most frequent
            </span>
          ) : null}
        </div>
        {match === 'form' && formMatch ? <FormBadge entry={entry} query={query} m={formMatch} /> : null}
        <CreatedNote entry={entry} />
      </header>
      <Pronunciation entry={entry} />
      <AspectPartners entry={entry} />
      <Senses senses={entry.senses} />
      {entry.relations ? <Relations relations={entry.relations} /> : null}
      <InflectionTable key={`${entry.id}-${expandTable}`} entry={entry} matchKey={match === 'form' ? queryKey : undefined} defaultOpen={expandTable} />
      <SourcesFooter entry={entry} />
    </article>
  );
}

function FormBadge({ entry, query, m }: { entry: Entry; query: string; m: FormMatch }) {
  const head = <Stressed text={entry.heads[0] ?? entry.word} className="lemma" />;
  const shown = m.form ? <Stressed text={m.form} /> : <span lang="uk">{query}</span>;
  return (
    <p className="form-badge">
      {m.slots.length > 0 ? (
        <span>
          ‘<b>{shown}</b>’ is the {describeSlots(m.slots)} of {head}
        </span>
      ) : null}
      {m.extra.map((x, i) => (
        <span key={i}>
          {m.slots.length > 0 || i > 0 ? '; ' : ''}‘<b><Stressed text={x.form} /></b>’ is {x.tags.length ? `the ${x.tags.map(tagLabel).join(' ')}` : 'a form'} of {head}
        </span>
      ))}
      {m.slots.length === 0 && m.extra.length === 0 ? (
        <span>
          ‘<b>{shown}</b>’ is a form of {head}
        </span>
      ) : null}
    </p>
  );
}
