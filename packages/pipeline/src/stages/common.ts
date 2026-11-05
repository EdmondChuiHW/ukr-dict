/** Small helpers shared by the assembly stages. */
import { hasStressMark, searchKey, stressedKey, stripStress } from '@ukdict/shared';
import type { PartOfSpeech, Relations, RelatedTerm, Sense, SourceRef } from '@ukdict/shared';
import { INFLECTABLE_POS } from '../util/pos.ts';

/** Canonical POS order (as declared in types.ts) for deterministic tie-breaking. */
export const POS_ORDER: readonly PartOfSpeech[] = [
  'noun',
  'proper-noun',
  'verb',
  'adjective',
  'adverb',
  'pronoun',
  'determiner',
  'numeral',
  'preposition',
  'postposition',
  'conjunction',
  'particle',
  'interjection',
  'predicative',
  'prefix',
  'suffix',
  'interfix',
  'combining-form',
  'phrase',
  'prepositional-phrase',
  'proverb',
  'letter',
  'symbol',
  'punctuation',
  'other',
];

const POS_INDEX = new Map(POS_ORDER.map((p, i) => [p, i]));
export function posIndex(p: PartOfSpeech): number {
  return POS_INDEX.get(p) ?? POS_ORDER.length;
}

/** Depth-first visit of every sense node (including header nodes and subsenses). */
export function walkSenses(senses: readonly Sense[] | undefined, fn: (s: Sense, depth: number) => void, depth = 0): void {
  if (!senses) return;
  for (const s of senses) {
    fn(s, depth);
    walkSenses(s.subsenses, fn, depth + 1);
  }
}

/** Gloss normalized for equality comparison (stress/case/whitespace/trailing punctuation insensitive). */
export function normalizeGloss(g: string): string {
  return stripStress(g)
    .toLowerCase()
    .replace(/[’ʼ‘`]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/[\s.;,:]+$/u, '')
    .trim();
}

/** Picks the "better" spelling of two variants of the same key: stressed wins over unstressed. */
export function preferStressed(a: string, b: string): string {
  if (!hasStressMark(a) && hasStressMark(b)) return b;
  return a;
}

function unionStrings(a?: string[], b?: string[]): string[] | undefined {
  if (!a?.length) return b?.length ? [...b] : a;
  if (!b?.length) return a;
  const out = [...a];
  for (const x of b) if (!out.includes(x)) out.push(x);
  return out;
}

export { unionStrings };

/** Collapses a related-term list by search key (DECISIONS 9): tags unioned, stressed spelling preferred. */
export function dedupeTerms(list: readonly RelatedTerm[], ownKey?: string): RelatedTerm[] {
  const out: RelatedTerm[] = [];
  const index = new Map<string, number>();
  for (const t of list) {
    const k = searchKey(t.word);
    if (!k || k === ownKey) continue;
    const i = index.get(k);
    if (i === undefined) {
      index.set(k, out.length);
      out.push({ ...t });
      continue;
    }
    const cur = out[i];
    cur.word = preferStressed(cur.word, t.word);
    cur.tags = unionStrings(cur.tags, t.tags);
    if (!cur.sense && t.sense) cur.sense = t.sense;
    else if (cur.sense && t.sense && cur.sense !== t.sense && !cur.sense.includes(t.sense)) cur.sense = `${cur.sense}; ${t.sense}`;
    if (!cur.english && t.english) cur.english = t.english;
    if (t.linked) cur.linked = true;
  }
  return out;
}

export function unionRelations(a: Relations | undefined, b: Relations | undefined, ownKey?: string): Relations | undefined {
  if (!a && !b) return undefined;
  const out: Relations = {};
  const types = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]) as Set<keyof Relations>;
  for (const t of types) {
    const list = dedupeTerms([...(a?.[t] ?? []), ...(b?.[t] ?? [])], ownKey);
    if (list.length > 0) out[t] = list;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function unionSources(a: readonly SourceRef[], b: readonly SourceRef[]): SourceRef[] {
  const out = [...a];
  const seen = new Set(a.map((s) => `${s.source}|${s.url ?? ''}|${s.label ?? ''}`));
  for (const s of b) {
    const k = `${s.source}|${s.url ?? ''}|${s.label ?? ''}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(s);
    }
  }
  return out;
}

/** True when two head lists are compatible: they share a stressed spelling, or either side has no stress marks. */
export function headsCompatible(a: readonly string[], b: readonly string[]): boolean {
  const sa = a.filter(hasStressMark);
  const sb = b.filter(hasStressMark);
  if (sa.length === 0 || sb.length === 0) return true;
  const set = new Set(sa.map(stressedKey));
  return sb.some((h) => set.has(stressedKey(h)));
}

/** Inflectable POS (DECISIONS 5) — from util/pos.ts. */
export const INFLECTABLE: ReadonlySet<PartOfSpeech> = INFLECTABLE_POS;
