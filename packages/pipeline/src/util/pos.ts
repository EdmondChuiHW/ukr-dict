/**
 * Part-of-speech normalization (DECISIONS item 8) and compatibility helpers shared by the sources
 * (kaikki-uk, kaikki-en, frequency list) and stages (merge, lcorp acceptance, ranking).
 */
import type { PartOfSpeech } from '@ukdict/shared';

const KAIKKI_POS: Record<string, PartOfSpeech> = {
  noun: 'noun',
  name: 'proper-noun',
  verb: 'verb',
  adj: 'adjective',
  adj_noun: 'adjective',
  adv: 'adverb',
  pron: 'pronoun',
  det: 'determiner',
  article: 'determiner',
  num: 'numeral',
  prep: 'preposition',
  postp: 'postposition',
  conj: 'conjunction',
  particle: 'particle',
  intj: 'interjection',
  prefix: 'prefix',
  suffix: 'suffix',
  infix: 'interfix',
  interfix: 'interfix',
  circumfix: 'combining-form',
  affix: 'combining-form',
  combining_form: 'combining-form',
  phrase: 'phrase',
  prep_phrase: 'prepositional-phrase',
  proverb: 'proverb',
  character: 'letter',
  symbol: 'symbol',
  punct: 'punctuation',
};

/** Map a raw kaikki (wiktextract) POS to the normalized `PartOfSpeech`. Unknown values → 'other'. */
export function mapKaikkiPos(pos: string): PartOfSpeech {
  return KAIKKI_POS[pos] ?? 'other';
}

/** POS whose words inflect (candidates for a paradigm / lcorp lookup). DECISIONS item 5. */
export const INFLECTABLE_POS: ReadonlySet<PartOfSpeech> = new Set<PartOfSpeech>([
  'noun',
  'proper-noun',
  'verb',
  'adjective',
  'pronoun',
  'determiner',
  'numeral',
]);

/** Undirected compatibility edges (besides identity). 'other' is compatible with everything. */
const COMPAT_EDGES: Array<[PartOfSpeech, PartOfSpeech]> = [
  ['noun', 'proper-noun'],
  ['adjective', 'determiner'],
  ['adjective', 'pronoun'],
  ['adjective', 'numeral'],
  ['determiner', 'pronoun'],
  ['determiner', 'numeral'],
  ['pronoun', 'numeral'],
  ['adverb', 'predicative'],
  ['adjective', 'predicative'],
  ['noun', 'predicative'],
  ['preposition', 'postposition'],
  ['preposition', 'prepositional-phrase'],
  ['phrase', 'prepositional-phrase'],
  ['phrase', 'proverb'],
  ['conjunction', 'particle'],
  ['prefix', 'combining-form'],
  ['suffix', 'combining-form'],
  ['suffix', 'interfix'],
  ['letter', 'symbol'],
  ['symbol', 'punctuation'],
];

const COMPAT = new Map<PartOfSpeech, Set<PartOfSpeech>>();
for (const [a, b] of COMPAT_EDGES) {
  if (!COMPAT.has(a)) COMPAT.set(a, new Set());
  if (!COMPAT.has(b)) COMPAT.set(b, new Set());
  COMPAT.get(a)!.add(b);
  COMPAT.get(b)!.add(a);
}

/**
 * Loose, symmetric POS compatibility, e.g. noun ~ proper-noun, adjective ~ determiner ~ pronoun ~ numeral,
 * adverb ~ predicative. Used to match the same lexeme across sources whose POS systems differ.
 */
export function posCompatible(a: PartOfSpeech, b: PartOfSpeech): boolean {
  if (a === b || a === 'other' || b === 'other') return true;
  return COMPAT.get(a)?.has(b) ?? false;
}

/** POS that are expected to have a declension (noun-like or adjective-like) table. */
export const DECLINABLE_POS: ReadonlySet<PartOfSpeech> = new Set<PartOfSpeech>([
  'noun',
  'proper-noun',
  'adjective',
  'pronoun',
  'determiner',
  'numeral',
]);
