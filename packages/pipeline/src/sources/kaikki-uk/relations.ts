/**
 * kaikki relation lists (synonyms, derived, …) → `Relations`, with the collapsing rules of DECISIONS item 9.
 */
import type { RelatedTerm, RelationType, Relations } from '@ukdict/shared';
import { hasCyrillic, hasLatin, hasStressMark, searchKey, sortTags, stripStress } from '@ukdict/shared';
import { isJunkTag } from './tags.ts';

/** kaikki list key → RelationType. */
export const RELATION_KEYS: Readonly<Record<string, RelationType>> = {
  synonyms: 'synonym',
  antonyms: 'antonym',
  hypernyms: 'hypernym',
  hyponyms: 'hyponym',
  meronyms: 'meronym',
  holonyms: 'holonym',
  coordinate_terms: 'coordinate',
  troponyms: 'troponym',
  related: 'related',
  derived: 'derived',
  abbreviations: 'abbreviation',
};

/** Order in which relation types are emitted (stable JSON output). */
export const RELATION_ORDER: readonly RelationType[] = [
  'synonym',
  'antonym',
  'hypernym',
  'hyponym',
  'meronym',
  'holonym',
  'coordinate',
  'troponym',
  'alternative',
  'abbreviation',
  'diminutive',
  'augmentative',
  'feminine',
  'masculine',
  'relational-adjective',
  'abstract-noun',
  'adverb',
  'derived',
  'related',
];

const TRAILING_PAREN = /\s*\(([^()]*)\)\s*$/;
const TRAILING_BRACKET = /\s*\[([^\]]*)\]\s*$/;
const BRACKETED = /\[[^\]]*\]|\([^)]*\)/g;
const SENSE_PLACEHOLDERS = new Set(['default', 'all senses']);

/**
 * Clean a related word: drop "#Language" anchors and trailing romanizations in parentheses ("Ненька (Nenʹka)").
 * Returns undefined when nothing Ukrainian remains or Latin letters remain outside brackets (extraction garbage).
 */
export interface CleanInfo {
  /** Trailing label tokens ("gender-neutral"). */
  tags: string[];
  /** Trailing bracketed annotation ("January 1940–June 1957"). */
  note?: string;
}

export function cleanRelatedWord(word: unknown, info?: CleanInfo, allowLatin = false): string | undefined {
  if (typeof word !== 'string') return undefined;
  let w = word.replace(/#.*$/, '').replace(/\s+/g, ' ').trim();
  const b = TRAILING_BRACKET.exec(w);
  if (b && hasLatin(b[1])) {
    if (info) info.note = b[1].trim();
    w = w.slice(0, b.index).trim();
  }
  const m = TRAILING_PAREN.exec(w);
  if (m && hasLatin(m[1])) w = w.slice(0, m.index).trim();
  // Trailing grammar / label tokens glued to the word: "ка́ва f", "пия́к gender-neutral".
  for (let i = 0; i < 3; i++) {
    const t = TRAILING_TOKEN.exec(w);
    if (!t || !hasCyrillic(w.slice(0, t.index))) break;
    if (!GRAMMAR_TOKENS.has(t[1])) {
      if (t[1].length < 3) break;
      info?.tags.push(t[1]);
    }
    w = w.slice(0, t.index).trim();
  }
  if (!w || !hasCyrillic(w)) return undefined;
  if (!allowLatin && hasLatin(w.replace(BRACKETED, ''))) return undefined;
  return w;
}

const TRAILING_TOKEN = /\s+([a-z][a-z-]*)\.?$/;
const GRAMMAR_TOKENS = new Set(['m', 'f', 'n', 'pl', 'sg', 'impf', 'pf', 'anim', 'inan', 'pers']);

const DIGRAPH_LETTERS = new Set(['я', 'ю', 'є', 'ї', 'щ']);

/**
 * Navbox extraction artefact: several words of a table cell glued together ("цесе", "будь-щоаби́щощо-не́будь")
 * while `roman` only covers the first one. Detected by comparing the expected romanization length.
 */
export function looksConcatenated(word: string, roman: unknown): boolean {
  if (typeof roman !== 'string' || !roman.trim()) return false;
  let expected = 0;
  for (const ch of stripStress(word).toLowerCase()) expected += DIGRAPH_LETTERS.has(ch) ? 2 : 1;
  return expected >= 4 && roman.normalize('NFC').length < expected * 0.6;
}

export function toRelatedTerm(raw: any, extraTags: readonly string[] = []): RelatedTerm | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const info: CleanInfo = { tags: [] };
  const word = cleanRelatedWord(raw.word, info);
  if (!word || looksConcatenated(word.replace(BRACKETED, ''), raw.roman)) return undefined;
  const t: RelatedTerm = { word };
  const tags = [...(Array.isArray(raw.tags) ? raw.tags : []), ...extraTags, ...info.tags].filter((x: unknown) => typeof x === 'string' && !isJunkTag(x));
  if (tags.length) t.tags = sortTags([...new Set(tags as string[])]);
  if (typeof raw.sense === 'string' && raw.sense.trim() && !SENSE_PLACEHOLDERS.has(raw.sense.trim())) t.sense = raw.sense.trim();
  if (info.note) t.sense = t.sense ? `${t.sense} (${info.note})` : info.note;
  const en = typeof raw.english === 'string' ? raw.english : typeof raw.translation === 'string' ? raw.translation : undefined;
  if (en && en.trim()) t.english = en.trim();
  return t;
}

/** Collect relation lists of a kaikki object (entry or sense). */
export function collectRelations(obj: any): Relations {
  const rel: Relations = {};
  if (!obj || typeof obj !== 'object') return rel;
  for (const [key, type] of Object.entries(RELATION_KEYS)) {
    const list = obj[key];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const t = toRelatedTerm(item);
      if (t) (rel[type] ??= []).push(t);
    }
  }
  return rel;
}

export function addRelation(rel: Relations, type: RelationType, term: RelatedTerm): void {
  (rel[type] ??= []).push(term);
}

export function mergeRelationsInto(target: Relations, src: Relations | undefined): void {
  if (!src) return;
  for (const [type, list] of Object.entries(src) as [RelationType, RelatedTerm[]][]) {
    if (list?.length) (target[type] ??= []).push(...list);
  }
}

function joinUnique(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b;
  if (!b || a === b) return a;
  const parts = a.split('; ');
  return parts.includes(b) ? a : `${a}; ${b}`;
}

/** Dedupe one list by search key (DECISIONS 9): union tags/sense/english, prefer stressed spelling, drop the headword. */
export function collapseList(list: readonly RelatedTerm[], headKey: string): RelatedTerm[] {
  const byKey = new Map<string, RelatedTerm>();
  for (const t of list) {
    const k = searchKey(t.word);
    if (!k || k === headKey) continue;
    const cur = byKey.get(k);
    if (!cur) {
      byKey.set(k, { ...t, ...(t.tags ? { tags: [...t.tags] } : {}) });
      continue;
    }
    if (!hasStressMark(cur.word) && hasStressMark(t.word)) cur.word = t.word;
    if (t.tags?.length) cur.tags = sortTags([...new Set([...(cur.tags ?? []), ...t.tags])]);
    const sense = joinUnique(cur.sense, t.sense);
    if (sense) cur.sense = sense;
    const english = joinUnique(cur.english, t.english);
    if (english) cur.english = english;
  }
  return [...byKey.values()];
}

/** Collapse every list; returns undefined when empty. Lists are emitted in RELATION_ORDER. */
export function collapseRelations(rel: Relations, headKey: string): Relations | undefined {
  const out: Relations = {};
  let any = false;
  for (const type of RELATION_ORDER) {
    const list = rel[type];
    if (!list?.length) continue;
    const c = collapseList(list, headKey);
    if (c.length) {
      out[type] = c;
      any = true;
    }
  }
  return any ? out : undefined;
}

/** Remove from `entryRel` the items whose key appears in `senseKeys` for the same type. */
export function removeSenseDuplicates(entryRel: Relations | undefined, senseKeys: Map<RelationType, Set<string>>): Relations | undefined {
  if (!entryRel) return undefined;
  const out: Relations = {};
  let any = false;
  for (const type of RELATION_ORDER) {
    const list = entryRel[type];
    if (!list?.length) continue;
    const keys = senseKeys.get(type);
    const kept = keys ? list.filter((t) => !keys.has(searchKey(t.word))) : list;
    if (kept.length) {
      out[type] = kept;
      any = true;
    }
  }
  return any ? out : undefined;
}
