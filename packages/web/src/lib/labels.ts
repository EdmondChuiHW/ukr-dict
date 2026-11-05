/** Human-readable labels for grammatical metadata. */
import { describeSlot, CASES } from '@ukdict/shared';
import type { Entry, PartOfSpeech, RelationType, SlotKey } from '@ukdict/shared';

export function posLabel(pos: PartOfSpeech | string): string {
  return pos.replace(/-/g, ' ');
}

const GENDER: Record<string, string> = { m: 'masculine', f: 'feminine', n: 'neuter' };

/** Badges for an entry header, e.g. ["noun", "masculine", "inanimate"] or ["verb", "imperfective"]. */
export function grammarBadges(e: Pick<Entry, 'pos' | 'genders' | 'animacy' | 'number' | 'aspect'>): string[] {
  const out: string[] = [posLabel(e.pos)];
  if (e.genders?.length) out.push(e.genders.map((g) => GENDER[g] ?? g).join(' / '));
  if (e.animacy) out.push(e.animacy);
  if (e.number === 'plural-only') out.push('plural only');
  else if (e.number === 'singular-only') out.push('singular only');
  if (e.aspect) out.push(e.aspect === 'biaspectual' ? 'imperfective & perfective' : e.aspect);
  return out;
}

const GRAM_SHORT: Record<string, string> = { m: 'm', f: 'f', n: 'n', anim: 'anim.', inan: 'inan.', impf: 'impf.', pf: 'pf.' };
/** Summary-row gram label ("m inan") → display ("m inan.") */
export function gramShort(gram: string): string {
  return gram
    .split(' ')
    .filter(Boolean)
    .map((t) => GRAM_SHORT[t] ?? t)
    .join(' ');
}

export const RELATION_ORDER: RelationType[] = [
  'synonym',
  'antonym',
  'diminutive',
  'augmentative',
  'feminine',
  'masculine',
  'alternative',
  'abbreviation',
  'hypernym',
  'hyponym',
  'coordinate',
  'meronym',
  'holonym',
  'troponym',
  'relational-adjective',
  'abstract-noun',
  'adverb',
  'related',
  'derived',
];

export const RELATION_LABEL: Record<RelationType, string> = {
  synonym: 'Synonyms',
  antonym: 'Antonyms',
  hypernym: 'Hypernyms',
  hyponym: 'Hyponyms',
  meronym: 'Meronyms',
  holonym: 'Holonyms',
  coordinate: 'Coordinate terms',
  troponym: 'Troponyms',
  related: 'Related terms',
  derived: 'Derived terms',
  alternative: 'Alternative forms',
  diminutive: 'Diminutives',
  augmentative: 'Augmentatives',
  feminine: 'Feminine',
  masculine: 'Masculine',
  'relational-adjective': 'Relational adjectives',
  'abstract-noun': 'Abstract nouns',
  adverb: 'Adverbs',
  abbreviation: 'Abbreviations',
};

/** "nom.pl", "acc.pl", "voc.pl" → "nominative, accusative and vocative plural". */
export function describeSlots(slots: readonly SlotKey[]): string {
  const groups = new Map<string, string[]>();
  const order: string[] = [];
  for (const slot of [...new Set(slots)]) {
    const parts = slot.split('.');
    let head: string;
    let tail: string;
    if ((CASES as readonly string[]).includes(parts[0])) {
      const d = describeSlot(slot);
      const sp = d.indexOf(' ');
      head = d.slice(0, sp);
      tail = d.slice(sp + 1);
    } else {
      head = describeSlot(slot);
      tail = '';
    }
    if (!groups.has(tail)) {
      groups.set(tail, []);
      order.push(tail);
    }
    const list = groups.get(tail)!;
    if (!list.includes(head)) list.push(head);
  }
  // Tails with the same set of cases are merged: "dative and locative masculine and neuter".
  const byHeads = new Map<string, { heads: string[]; tails: string[] }>();
  for (const tail of order) {
    const heads = groups.get(tail)!;
    const k = tail ? heads.join('|') : `\u0000${tail}`;
    const g = byHeads.get(k);
    if (g) g.tails.push(tail);
    else byHeads.set(k, { heads, tails: [tail] });
  }
  return [...byHeads.values()]
    .map(({ heads, tails }) => joinAnd(heads) + (tails[0] ? ` ${joinAnd(tails)}` : ''))
    .join('; ');
}

export function joinAnd(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} kB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}
