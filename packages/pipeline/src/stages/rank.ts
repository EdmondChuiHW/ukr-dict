/**
 * Rank stage (DECISIONS 12): frequency rank per entry, final sort order, dense ids and slugs.
 * Order: ranked entries by rank → unranked kaikki entries → unranked created entries;
 * ties: (same rank) entries whose senses are all dated/archaic/rare last, then Ukrainian collation of the word,
 * POS order, code-unit order of the word (case), origin (source line).
 */
import { ukCollator } from '@ukdict/shared';
import type { Entry } from '@ukdict/shared';
import type { DraftEntry, FrequencyIndex } from '../contracts.ts';
import { posIndex } from './common.ts';

export interface RankResult {
  entries: Entry[];
  /** Parallel to `entries` (by id): where each entry came from. */
  origins: DraftEntry['origin'][];
  stats: { ranked: number; unrankedKaikki: number; unrankedCreated: number; homonymSlugs: number };
}

/** Converts a draft to an Entry with canonical key order (undefined fields omitted). */
export function finalizeEntry(d: DraftEntry, id: number, slug: string, freqRank: number | undefined): Entry {
  const e: Entry = {
    id,
    slug,
    word: d.word,
    key: d.key,
    heads: d.heads,
    pos: d.pos,
    tags: d.tags,
    genders: d.genders,
    animacy: d.animacy,
    number: d.number,
    aspect: d.aspect,
    aspectPartners: d.aspectPartners,
    senses: d.senses,
    paradigm: d.paradigm,
    extraForms: d.extraForms,
    pronunciation: d.pronunciation,
    relations: d.relations,
    freqRank,
    created: d.created,
    sources: d.sources,
    ext: d.ext,
  };
  for (const k of Object.keys(e) as (keyof Entry)[]) {
    const v = e[k];
    if (v === undefined || (Array.isArray(v) && v.length === 0 && k !== 'senses' && k !== 'sources' && k !== 'heads')) delete e[k];
  }
  return e;
}

const OUTDATED = new Set(['dated', 'archaic', 'obsolete', 'historical', 'rare', 'dialectal', 'regional', 'nonstandard']);

/**
 * True when every top-level sense is tagged as dated/archaic/rare/dialectal… Used only to break ties between
 * homonyms that received the same frequency rank (the frequency list cannot tell them apart), so that e.g.
 * Україна "Ukraine" precedes the dated common noun украї́на "land".
 */
export function isOutdated(d: DraftEntry): boolean {
  const top = d.senses.filter((s) => !s.headerOnly);
  if (top.length === 0) return false;
  return top.every((s) => (s.tags ?? []).some((t) => OUTDATED.has(t)) || (d.tags ?? []).some((t) => OUTDATED.has(t)));
}

export function rankEntries(drafts: readonly DraftEntry[], frequency?: FrequencyIndex): RankResult {
  const items = drafts.map((d, i) => ({ d, i, rank: frequency?.rank(d.word, d.pos), dated: isOutdated(d) ? 1 : 0 }));
  const tier = (x: (typeof items)[number]) => (x.rank !== undefined ? 0 : x.d.created ? 2 : 1);
  items.sort((a, b) => {
    const ta = tier(a);
    const tb = tier(b);
    if (ta !== tb) return ta - tb;
    if (ta === 0 && a.rank !== b.rank) return a.rank! - b.rank!;
    if (ta === 0 && a.dated !== b.dated) return a.dated - b.dated;
    const c = ukCollator.compare(a.d.word, b.d.word);
    if (c !== 0) return c;
    const p = posIndex(a.d.pos) - posIndex(b.d.pos);
    if (p !== 0) return p;
    if (a.d.word !== b.d.word) return a.d.word < b.d.word ? -1 : 1;
    const oa = (a.d.origin.source === 'kaikki-uk' ? 0 : 1e12) + (a.d.origin.line ?? 0);
    const ob = (b.d.origin.source === 'kaikki-uk' ? 0 : 1e12) + (b.d.origin.line ?? 0);
    return oa - ob || a.i - b.i;
  });
  const seen = new Map<string, number>();
  const stats = { ranked: 0, unrankedKaikki: 0, unrankedCreated: 0, homonymSlugs: 0 };
  const entries: Entry[] = [];
  const origins: DraftEntry['origin'][] = [];
  items.forEach((x, id) => {
    const base = `${x.d.word}~${x.d.pos}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    if (n >= 2) stats.homonymSlugs++;
    const slug = n >= 2 ? `${base}~${n}` : base;
    const t = tier(x);
    if (t === 0) stats.ranked++;
    else if (t === 1) stats.unrankedKaikki++;
    else stats.unrankedCreated++;
    entries.push(finalizeEntry(x.d, id, slug, x.rank));
    origins.push(x.d.origin);
  });
  return { entries, origins, stats };
}
