/**
 * Defensive clean-up of word strings coming from the sources (run before merge). Wiktionary templates
 * occasionally leak markup or annotations into head / relation / form-of words, e.g.
 *   "с (s)", "ма́впа f animal ]", "ти́снути impf [transitive", "прі́сний[unleavened]]>", "реформува́ти impf or".
 * Every change is counted in the stats (reported in reports/summary.*).
 */
import { hasCyrillic, hasLatin, searchKey } from '@ukdict/shared';
import type { RelatedTerm, Relations, WordRef } from '@ukdict/shared';
import type { DraftEntry } from '../contracts.ts';
import { walkSenses } from './common.ts';

export interface SanitizeStats {
  headsCleaned: number;
  headsDropped: number;
  primaryHeadFixed: number;
  relationWordsCleaned: number;
  relationWordsDropped: number;
  refWordsCleaned: number;
  partnerWordsCleaned: number;
}

const TRAILING_ANNOTATION = /^(m|f|n|pl|sg|impf|pf|or|and|animal|anim|inan|person|p)\.?$/i;

/** Cleans one word string; returns '' when nothing usable remains. */
export function cleanWord(raw: string): string {
  let s = raw.normalize('NFC').trim();
  s = s.replace(/\s*\[[^[\]]*\]/g, '');
  const br = s.indexOf('[');
  if (br > 0) s = s.slice(0, br);
  s = s.replace(/\s*\([^()]*\)/g, (m) => (/[A-Za-z]/.test(m) || /^\s*\(\s*\)$/.test(m) ? '' : m));
  s = s.replace(/[\s>\]*!?|]+$/u, '').replace(/^[\s<[|]+/u, '');
  const toks = s.split(/\s+/).filter(Boolean);
  while (toks.length > 1 && TRAILING_ANNOTATION.test(toks[toks.length - 1])) toks.pop();
  s = toks.join(' ');
  if (!s || hasLatin(s) || !hasCyrillic(s)) return '';
  return s;
}

function cleanTerms(list: RelatedTerm[], stats: SanitizeStats): RelatedTerm[] {
  const out: RelatedTerm[] = [];
  for (const t of list) {
    const c = cleanWord(t.word);
    if (!c) {
      stats.relationWordsDropped++;
      continue;
    }
    if (c !== t.word.normalize('NFC')) {
      stats.relationWordsCleaned++;
      out.push({ ...t, word: c });
    } else out.push(t);
  }
  return out;
}

function cleanRelations(rel: Relations | undefined, stats: SanitizeStats): Relations | undefined {
  if (!rel) return rel;
  const out: Relations = {};
  for (const [type, list] of Object.entries(rel) as [keyof Relations, RelatedTerm[] | undefined][]) {
    if (!list?.length) continue;
    const c = cleanTerms(list, stats);
    if (c.length) out[type] = c;
  }
  return Object.keys(out).length ? out : undefined;
}

function cleanRefs(list: WordRef[] | undefined, stats: SanitizeStats): WordRef[] | undefined {
  if (!list) return list;
  return list.map((r) => {
    const c = cleanWord(r.word);
    if (c && c !== r.word.normalize('NFC')) {
      stats.refWordsCleaned++;
      return { ...r, word: c };
    }
    return r;
  });
}

export function sanitizeDrafts(entries: DraftEntry[]): SanitizeStats {
  const stats: SanitizeStats = {
    headsCleaned: 0,
    headsDropped: 0,
    primaryHeadFixed: 0,
    relationWordsCleaned: 0,
    relationWordsDropped: 0,
    refWordsCleaned: 0,
    partnerWordsCleaned: 0,
  };
  for (const e of entries) {
    // heads
    const heads: string[] = [];
    for (const h of e.heads) {
      const c = cleanWord(h);
      if (!c) {
        stats.headsDropped++;
        continue;
      }
      if (c !== h.normalize('NFC')) stats.headsCleaned++;
      if (!heads.includes(c)) heads.push(c);
    }
    const i = heads.findIndex((h) => searchKey(h) === e.key);
    if (i > 0) {
      heads.unshift(...heads.splice(i, 1));
      stats.primaryHeadFixed++;
    } else if (i < 0) {
      heads.unshift(e.word);
      stats.primaryHeadFixed++;
    }
    e.heads = heads;

    if (e.relations) {
      const r = cleanRelations(e.relations, stats);
      if (r) e.relations = r;
      else delete e.relations;
    }
    if (e.aspectPartners) {
      e.aspectPartners = e.aspectPartners
        .map((p) => {
          const c = cleanWord(p.word);
          if (c && c !== p.word.normalize('NFC')) stats.partnerWordsCleaned++;
          return c ? { ...p, word: c } : undefined;
        })
        .filter((p): p is NonNullable<typeof p> => !!p);
      if (!e.aspectPartners.length) delete e.aspectPartners;
    }
    walkSenses(e.senses, (s) => {
      if (s.relations) {
        const r = cleanRelations(s.relations, stats);
        if (r) s.relations = r;
        else delete s.relations;
      }
      if (s.formOf) s.formOf = cleanRefs(s.formOf, stats);
      if (s.altOf) s.altOf = cleanRefs(s.altOf, stats);
    });
  }
  return stats;
}
