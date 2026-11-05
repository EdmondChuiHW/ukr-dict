/**
 * Definitions: gloss hierarchy (subsenses) as nested lists; sibling senses sharing tags grouped under a tag
 * header (groupByTags, several levels); only the remaining tags are shown inline.
 */
import type { ReactNode } from 'react';
import { groupByTags, isTagGroup, remainingTags, searchKey, stripStress, tagLabel } from '@ukdict/shared';
import type { GlossLink, Sense, TagGroup, WordRef } from '@ukdict/shared';
import { Stressed } from './Stressed.tsx';
import { WordLink } from './WordLink.tsx';
import { Relations } from './Relations.tsx';

type Node = Sense | TagGroup<Sense>;

const tagsOf = (s: Sense) => s.tags ?? [];

/** Links from `sense.links`, plus formOf/altOf targets located in the gloss text when not linked already. */
function effectiveLinks(sense: Sense): { links: GlossLink[]; unlinked: WordRef[] } {
  const g = sense.gloss;
  const links = (sense.links ?? [])
    .filter((l) => l.start >= 0 && l.end <= g.length && l.start < l.end)
    .sort((a, b) => a.start - b.start)
    .filter((l, i, arr) => i === 0 || l.start >= arr[i - 1].end);
  const unlinked: WordRef[] = [];
  for (const ref of [...(sense.formOf ?? []), ...(sense.altOf ?? [])]) {
    const k = searchKey(ref.word);
    if (links.some((l) => searchKey(l.target) === k)) continue;
    let at = g.indexOf(ref.word);
    let len = ref.word.length;
    if (at < 0) {
      at = g.indexOf(stripStress(ref.word));
      len = stripStress(ref.word).length;
    }
    if (at >= 0 && !links.some((l) => at < l.end && at + len > l.start)) {
      links.push({ start: at, end: at + len, target: ref.word });
      links.sort((a, b) => a.start - b.start);
    } else unlinked.push(ref);
  }
  return { links, unlinked };
}

function Gloss({ sense }: { sense: Sense }) {
  const g = sense.gloss;
  const { links, unlinked } = effectiveLinks(sense);
  const parts: ReactNode[] = [];
  let pos = 0;
  links.forEach((l, i) => {
    if (l.start > pos) parts.push(<Stressed key={`t${i}`} text={g.slice(pos, l.start)} lang={null} />);
    parts.push(
      <WordLink key={`l${i}`} word={l.target} className="gloss-link">
        <Stressed text={g.slice(l.start, l.end)} />
      </WordLink>,
    );
    pos = l.end;
  });
  if (pos < g.length) parts.push(<Stressed key="tail" text={g.slice(pos)} lang={null} />);
  return (
    <span className="gloss">
      {parts}
      {unlinked.length > 0 ? (
        <span className="form-of">
          {g ? (/\bof\s*$/.test(g) ? ' ' : ' — ') : sense.altOf?.length ? 'alternative form of ' : 'form of '}
          {unlinked.map((r, i) => (
            <span key={i}>
              {i > 0 ? ', ' : ''}
              <WordLink word={r.word} dead={r.linked === false} />
            </span>
          ))}
        </span>
      ) : null}
    </span>
  );
}

function TagLabels({ tags, gloss }: { tags: string[]; gloss: string }) {
  const lower = gloss.toLowerCase();
  const shown = tags.filter((t) => !lower.includes(tagLabel(t).toLowerCase()));
  if (shown.length === 0) return null;
  return (
    <>
      {shown.map((t) => (
        <span key={t} className="tag">
          {tagLabel(t)}
        </span>
      ))}{' '}
    </>
  );
}

function SenseItem({ sense, consumed, depth }: { sense: Sense; consumed: ReadonlySet<string>; depth: number }) {
  const tags = remainingTags(sense.tags, consumed);
  const childConsumed = new Set([...consumed, ...(sense.tags ?? [])]);
  return (
    <li className={sense.headerOnly ? 'sense header-only' : 'sense'}>
      <div className="sense-line">
        <TagLabels tags={tags} gloss={sense.gloss} />
        {sense.qualifier ? <i className="qualifier">({sense.qualifier}) </i> : null}
        {sense.headerOnly ? <span className="sense-header-text">{sense.gloss}</span> : <Gloss sense={sense} />}
        {sense.topics?.length ? <span className="topics"> · {sense.topics.join(', ')}</span> : null}
      </div>
      {sense.examples?.length ? (
        <ul className="examples">
          {sense.examples.map((ex, i) => (
            <li key={i}>
              <Stressed text={ex.text} className="ex-uk" />
              {ex.translation ? <span className="ex-en"> — {ex.translation}</span> : null}
              {ex.ref ? <cite className="ex-ref"> {ex.ref}</cite> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {sense.relations ? <Relations relations={sense.relations} compact /> : null}
      {sense.subsenses?.length ? <Senses senses={sense.subsenses} consumed={childConsumed} depth={depth + 1} /> : null}
    </li>
  );
}

function Nodes({ nodes, consumed, depth }: { nodes: Node[]; consumed: ReadonlySet<string>; depth: number }) {
  return (
    <>
      {nodes.map((n, i) => {
        if (isTagGroup(n)) {
          const inner = new Set([...consumed, n.tag]);
          return (
            <li key={`g${i}`} className="tag-group">
              <div className="tag-group-head">
                <span className="tag strong">{tagLabel(n.tag)}</span>
              </div>
              <ol className={`senses depth-${depth + 1}`}>
                <Nodes nodes={n.children} consumed={inner} depth={depth + 1} />
              </ol>
            </li>
          );
        }
        return <SenseItem key={i} sense={n} consumed={consumed} depth={depth} />;
      })}
    </>
  );
}

export function Senses({ senses, consumed = new Set<string>(), depth = 0 }: { senses: Sense[]; consumed?: ReadonlySet<string>; depth?: number }) {
  const nodes = groupByTags(senses, tagsOf, consumed);
  return (
    <ol className={`senses depth-${depth}`}>
      <Nodes nodes={nodes} consumed={consumed} depth={depth} />
    </ol>
  );
}
