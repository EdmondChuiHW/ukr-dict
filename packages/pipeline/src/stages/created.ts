/**
 * Created entries (DECISIONS 11): Ukrainian words that only occur in English Wiktionary translation tables.
 * One DraftEntry per (searchKey, mapped POS). Senses are the English headwords (grouped by English POS) with
 * the translation-table sense label as qualifier.
 */
import { hasCyrillic, hasLatin, hasStressMark, searchKey, stripStress, wiktionaryEnglishUrl } from '@ukdict/shared';
import type { Aspect, Animacy, CreatedInfo, Gender, NumberRestriction, PartOfSpeech, Sense, SourceRef } from '@ukdict/shared';
import type { DraftEntry, EnTranslation } from '../contracts.ts';

export interface CreatedOptions {
  /** searchKey of every kaikki headword (kept entries). */
  headwordKeys: ReadonlySet<string>;
  /** searchKey of every ignored inflected-form entry. */
  ignoredFormKeys: ReadonlySet<string>;
  /** Max sources (English pages) listed per entry. */
  maxSources?: number;
  /** Max `created.from` items per entry. */
  maxFrom?: number;
  /** Max senses per entry. */
  maxSenses?: number;
}

export interface CreatedStats {
  translations: number;
  skippedLatinOrDigits: number;
  skippedTooLong: number;
  skippedInvalid: number;
  existingHeadword: number;
  existingForm: number;
  created: number;
  multiword: number;
}

const EN_POS: Record<string, PartOfSpeech> = {
  noun: 'noun',
  'proper noun': 'proper-noun',
  name: 'proper-noun',
  verb: 'verb',
  adj: 'adjective',
  adjective: 'adjective',
  adv: 'adverb',
  adverb: 'adverb',
  pron: 'pronoun',
  pronoun: 'pronoun',
  det: 'determiner',
  article: 'determiner',
  num: 'numeral',
  numeral: 'numeral',
  prep: 'preposition',
  preposition: 'preposition',
  postp: 'postposition',
  conj: 'conjunction',
  particle: 'particle',
  intj: 'interjection',
  interjection: 'interjection',
  phrase: 'phrase',
  prep_phrase: 'prepositional-phrase',
  proverb: 'proverb',
  prefix: 'prefix',
  suffix: 'suffix',
  infix: 'interfix',
  interfix: 'interfix',
  combining_form: 'combining-form',
  character: 'letter',
  letter: 'letter',
  symbol: 'symbol',
  punct: 'punctuation',
};

/** English kaikki POS → PartOfSpeech; unknown → 'phrase' if the Ukrainian translation is multi-word, else 'other'. */
export function mapEnglishPos(enPos: string, multiword: boolean): PartOfSpeech {
  return EN_POS[enPos.toLowerCase()] ?? (multiword ? 'phrase' : 'other');
}

const GENDER_TAG: Record<string, Gender> = { masculine: 'm', feminine: 'f', neuter: 'n' };
const GRAMMATICAL_TAGS = new Set([
  'masculine',
  'feminine',
  'neuter',
  'imperfective',
  'perfective',
  'animate',
  'inanimate',
  'plural',
  'singular',
  'plural-only',
  'singular-only',
  'common-gender',
]);

const DIGIT_RE = /\d/;
const LETTER_RE = /\p{L}/u;

interface Group {
  key: string;
  pos: PartOfSpeech;
  firstSeen: number;
  spellings: Map<string, number>; // NFC spelling → count
  enPosOrder: string[];
  senses: Map<string, Sense[]>; // enPos → senses
  senseKeys: Set<string>;
  from: CreatedInfo['from'];
  fromKeys: Set<string>;
  sources: SourceRef[];
  sourceKeys: Set<string>;
  genders: Set<Gender>;
  aspects: Set<'imperfective' | 'perfective'>;
  animacy: Set<Animacy>;
  occurrences: number;
  pluralTagged: number;
  singularOnly: number;
  multiword: boolean;
}

export function buildCreatedEntries(
  translations: readonly EnTranslation[],
  opts: CreatedOptions,
): { entries: DraftEntry[]; stats: CreatedStats } {
  const maxSources = opts.maxSources ?? 10;
  const maxFrom = opts.maxFrom ?? 50;
  const maxSenses = opts.maxSenses ?? 40;
  const stats: CreatedStats = {
    translations: translations.length,
    skippedLatinOrDigits: 0,
    skippedTooLong: 0,
    skippedInvalid: 0,
    existingHeadword: 0,
    existingForm: 0,
    created: 0,
    multiword: 0,
  };
  const groups = new Map<string, Group>();

  translations.forEach((t, idx) => {
    const raw = (t.ukWord ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
    if (!raw || !hasCyrillic(raw) || !LETTER_RE.test(raw) || /[()[\]{}<>=|#*]/.test(raw)) {
      stats.skippedInvalid++;
      return;
    }
    if (hasLatin(raw) || DIGIT_RE.test(raw)) {
      stats.skippedLatinOrDigits++;
      return;
    }
    const words = raw.split(' ');
    if (words.length > 4) {
      stats.skippedTooLong++;
      return;
    }
    const key = searchKey(raw);
    if (opts.headwordKeys.has(key)) {
      stats.existingHeadword++;
      return;
    }
    if (opts.ignoredFormKeys.has(key)) {
      stats.existingForm++;
      return;
    }
    const multiword = words.length > 1;
    const pos = mapEnglishPos(t.enPos ?? '', multiword);
    const gk = `${key}\u0000${pos}`;
    let g = groups.get(gk);
    if (!g) {
      g = {
        key,
        pos,
        firstSeen: idx,
        spellings: new Map(),
        enPosOrder: [],
        senses: new Map(),
        senseKeys: new Set(),
        from: [],
        fromKeys: new Set(),
        sources: [],
        sourceKeys: new Set(),
        genders: new Set(),
        aspects: new Set(),
        animacy: new Set(),
        occurrences: 0,
        pluralTagged: 0,
        singularOnly: 0,
        multiword,
      };
      groups.set(gk, g);
    }
    g.occurrences++;
    g.spellings.set(raw, (g.spellings.get(raw) ?? 0) + 1);

    const enWord = (t.enWord ?? '').trim();
    const enPos = t.enPos ?? '';
    const sense = t.sense?.trim() || undefined;
    const tags = t.tags ?? [];
    for (const tag of tags) {
      if (GENDER_TAG[tag]) g.genders.add(GENDER_TAG[tag]);
      else if (tag === 'imperfective' || tag === 'perfective') g.aspects.add(tag);
      else if (tag === 'animate' || tag === 'inanimate') g.animacy.add(tag);
      else if (tag === 'common-gender') {
        g.genders.add('m');
        g.genders.add('f');
      }
    }
    if (tags.includes('plural') || tags.includes('plural-only')) g.pluralTagged++;
    if (tags.includes('singular-only')) g.singularOnly++;

    if (!enWord) return;
    const sk = `${enWord}\u0000${sense ?? ''}`;
    if (!g.senseKeys.has(sk)) {
      g.senseKeys.add(sk);
      if (!g.senses.has(enPos)) {
        g.senses.set(enPos, []);
        g.enPosOrder.push(enPos);
      }
      // English verbs are glossed in the infinitive like the Wiktionary-sourced entries ("to sing").
      const gloss = enPos === 'verb' && !/^to\s/i.test(enWord) ? `to ${enWord}` : enWord;
      const s: Sense = { gloss };
      if (sense) s.qualifier = sense;
      const extraTags = tags.filter((x) => !GRAMMATICAL_TAGS.has(x));
      if (extraTags.length > 0) s.tags = [...new Set(extraTags)];
      g.senses.get(enPos)!.push(s);
    }
    const fk = `${enWord}\u0000${enPos}\u0000${sense ?? ''}`;
    if (!g.fromKeys.has(fk) && g.from.length < maxFrom) {
      g.fromKeys.add(fk);
      const item: CreatedInfo['from'][number] = { enWord, enPos, url: wiktionaryEnglishUrl(enWord) };
      if (sense) item.sense = sense;
      g.from.push(item);
    }
    if (!g.sourceKeys.has(enWord) && g.sources.length < maxSources) {
      g.sourceKeys.add(enWord);
      g.sources.push({ source: 'wiktionary-translations', url: wiktionaryEnglishUrl(enWord), label: `Wiktionary: ${enWord}` });
    }
  });

  const entries: DraftEntry[] = [];
  const ordered = [...groups.values()].sort((a, b) => a.firstSeen - b.firstSeen);
  for (const g of ordered) {
    const senses: Sense[] = [];
    for (const p of g.enPosOrder) senses.push(...g.senses.get(p)!);
    if (senses.length === 0) continue;
    // Display word: most frequent unstressed spelling (ties: first seen).
    const byWord = new Map<string, number>();
    for (const [sp, n] of g.spellings) {
      const w = stripStress(sp);
      byWord.set(w, (byWord.get(w) ?? 0) + n);
    }
    let word = '';
    let best = -1;
    for (const [w, n] of byWord) {
      if (n > best) {
        word = w;
        best = n;
      }
    }
    const spellings = [...g.spellings.keys()].filter((s) => stripStress(s) === word);
    const stressed = spellings.filter(hasStressMark);
    const heads = stressed.length > 0 ? stressed : [word];

    const e: DraftEntry = {
      word,
      key: g.key,
      heads,
      pos: g.pos,
      senses: senses.slice(0, maxSenses),
      created: { method: 'english-translation', from: g.from },
      sources: g.sources,
      origin: { source: 'english-translation', line: g.firstSeen + 1 },
    };
    if (g.genders.size > 0 && (g.pos === 'noun' || g.pos === 'proper-noun' || g.pos === 'pronoun' || g.pos === 'numeral')) {
      e.genders = (['m', 'f', 'n'] as Gender[]).filter((x) => g.genders.has(x));
    }
    if (g.pos === 'verb' && g.aspects.size > 0) {
      const aspect: Aspect = g.aspects.size === 2 ? 'biaspectual' : [...g.aspects][0];
      e.aspect = aspect;
    }
    if (g.animacy.size === 1 && (g.pos === 'noun' || g.pos === 'proper-noun')) e.animacy = [...g.animacy][0];
    if ((g.pos === 'noun' || g.pos === 'proper-noun') && g.pluralTagged > 0 && g.pluralTagged === g.occurrences) {
      const n: NumberRestriction = 'plural-only';
      e.number = n;
    }
    if (g.multiword) stats.multiword++;
    entries.push(e);
  }
  stats.created = entries.length;
  return { entries, stats };
}
