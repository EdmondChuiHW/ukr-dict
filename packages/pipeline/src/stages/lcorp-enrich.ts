/**
 * lcorp enrichment (DECISIONS 5): entries with an inflectable POS but no paradigm get an inflection table
 * from lcorp (via the rate-limited, cached, budgeted LcorpClient). Most frequent words are looked up first;
 * kaikki entries before created entries.
 */
import { LCORP_URL, hasCyrillic } from '@ukdict/shared';
import type { DraftEntry, FrequencyIndex, LcorpClient, LcorpLookupResult, StageHandle } from '../contracts.ts';
import { INFLECTABLE } from './common.ts';

export interface LcorpRecord {
  word: string;
  pos: string;
  heads: string[];
  created: boolean;
  freqRank?: number;
  status: LcorpLookupResult['status'];
  headword?: string;
  gram?: string;
  nearest?: string;
  fromCache?: boolean;
  reason?: string;
  message?: string;
  /** What was applied to the entry. */
  applied: string[];
}

export interface LcorpEnrichStats {
  candidates: number;
  candidatesKaikki: number;
  candidatesCreated: number;
  lookedUp: number;
  found: number;
  notFound: number;
  skipped: number;
  errors: number;
  paradigmsAdded: number;
  paradigmsAddedCreated: number;
  fieldsFilled: number;
  aborted: boolean;
}

export interface LcorpEnrichOptions {
  frequency?: FrequencyIndex;
  /**
   * Extra acceptance test for kaikki (non-created) entries, e.g. the lcorp module's own candidate rules
   * (`lcorpCandidateVerdict`, applied to the raw kaikki record) so lookups match the pre-warmed cache.
   */
  kaikkiFilter?: (e: DraftEntry) => boolean;
  progress?: StageHandle;
  /** Parallel lookups in flight (the client enforces its own rate/concurrency; cache hits are fast). */
  parallel?: number;
  signal?: AbortSignal;
  onRecord?: (r: LcorpRecord) => void;
}

const INFLECTION_GLOSS_RE =
  /^((first|second|third)-person |masculine |feminine |neuter |animate |inanimate )*(nominative|genitive|dative|accusative|instrumental|locative|vocative|singular|plural)\b[^:]* of /i;

/** Is this entry a candidate for an lcorp lookup? */
export function isLcorpCandidate(e: DraftEntry): boolean {
  if (!INFLECTABLE.has(e.pos)) return false;
  if (e.paradigm && Object.keys(e.paradigm.forms).length > 0) return false;
  if (/\s/.test(e.word.trim()) || !hasCyrillic(e.word)) return false;
  if (e.tags?.includes('indeclinable') || e.tags?.includes('invariable')) return false;
  const senses = e.senses.filter((s) => !s.headerOnly);
  if (senses.length > 0) {
    // predicative-only "adjectives" (мо́жна, тре́ба) and pure pointer entries (alt-of / inflection-of) have no table
    if (senses.every((s) => s.tags?.includes('predicative') || s.tags?.includes('indeclinable'))) return false;
    if (senses.every((s) => s.formOf?.length || s.altOf?.length || INFLECTION_GLOSS_RE.test(s.gloss))) return false;
  }
  // Acronyms (ВВП, США) are indeclinable in practice.
  if (e.word.length > 1 && e.word === e.word.toUpperCase() && e.word !== e.word.toLowerCase()) return false;
  return true;
}

/** Candidates in lookup order: kaikki before created; within each, ranked by frequency, then unranked. */
export function orderLcorpCandidates(
  entries: readonly DraftEntry[],
  frequency?: FrequencyIndex,
  kaikkiFilter?: (e: DraftEntry) => boolean,
): { entry: DraftEntry; rank?: number }[] {
  const list = entries
    .filter((e) => isLcorpCandidate(e) && (e.created || !kaikkiFilter || kaikkiFilter(e)))
    .map((entry, i) => ({ entry, i, rank: frequency?.rank(entry.word, entry.pos) }));
  list.sort((a, b) => {
    const ca = a.entry.created ? 1 : 0;
    const cb = b.entry.created ? 1 : 0;
    if (ca !== cb) return ca - cb;
    const ra = a.rank ?? Number.POSITIVE_INFINITY;
    const rb = b.rank ?? Number.POSITIVE_INFINITY;
    if (ra !== rb) return ra - rb;
    return a.i - b.i;
  });
  return list.map(({ entry, rank }) => ({ entry, rank }));
}

/** Applies a found lcorp entry to a draft; returns the list of applied fields. */
export function applyLcorp(e: DraftEntry, res: Extract<LcorpLookupResult, { status: 'found' }>): string[] {
  const applied: string[] = [];
  const le = res.entry;
  if (le.paradigm && Object.keys(le.paradigm.forms).length > 0 && !(e.paradigm && Object.keys(e.paradigm.forms).length > 0)) {
    e.paradigm = { ...le.paradigm, source: 'lcorp' };
    applied.push('paradigm');
  }
  if (le.genders?.length && !e.genders?.length && (e.pos === 'noun' || e.pos === 'proper-noun' || e.pos === 'pronoun' || e.pos === 'numeral')) {
    e.genders = [...le.genders];
    applied.push('genders');
  }
  if (le.animacy && !e.animacy && (e.pos === 'noun' || e.pos === 'proper-noun')) {
    e.animacy = le.animacy;
    applied.push('animacy');
  }
  if (le.aspect && !e.aspect && e.pos === 'verb') {
    e.aspect = le.aspect;
    applied.push('aspect');
  }
  if (le.number && !e.number && (e.pos === 'noun' || e.pos === 'proper-noun')) {
    e.number = le.number;
    applied.push('number');
  }
  if (applied.length > 0 && !e.sources.some((s) => s.source === 'lcorp')) {
    e.sources.push({ source: 'lcorp', url: LCORP_URL, label: `lcorp: ${e.word}`, note: 'inflection table — search for this word' });
  }
  return applied;
}

export async function enrichWithLcorp(
  entries: readonly DraftEntry[],
  client: LcorpClient,
  opts: LcorpEnrichOptions = {},
): Promise<{ stats: LcorpEnrichStats; records: LcorpRecord[] }> {
  const queue = orderLcorpCandidates(entries, opts.frequency, opts.kaikkiFilter);
  const stats: LcorpEnrichStats = {
    candidates: queue.length,
    candidatesKaikki: queue.filter((q) => !q.entry.created).length,
    candidatesCreated: queue.filter((q) => q.entry.created).length,
    lookedUp: 0,
    found: 0,
    notFound: 0,
    skipped: 0,
    errors: 0,
    paradigmsAdded: 0,
    paradigmsAddedCreated: 0,
    fieldsFilled: 0,
    aborted: false,
  };
  const records: LcorpRecord[] = [];
  opts.progress?.setTotal(queue.length, 'items');
  let next = 0;
  const parallel = Math.max(1, opts.parallel ?? 4);

  const worker = async () => {
    while (true) {
      if (opts.signal?.aborted) {
        stats.aborted = true;
        return;
      }
      const i = next++;
      if (i >= queue.length) return;
      const { entry: e, rank } = queue[i];
      let res: LcorpLookupResult;
      try {
        res = await client.lookup({ word: e.word, heads: e.heads, pos: e.pos });
      } catch (err) {
        res = { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
      stats.lookedUp++;
      const rec: LcorpRecord = { word: e.word, pos: e.pos, heads: e.heads, created: !!e.created, status: res.status, applied: [] };
      if (rank !== undefined) rec.freqRank = rank;
      switch (res.status) {
        case 'found': {
          stats.found++;
          rec.headword = res.entry.headword;
          rec.gram = res.entry.gram;
          rec.fromCache = res.fromCache;
          rec.applied = applyLcorp(e, res);
          if (rec.applied.includes('paradigm')) {
            stats.paradigmsAdded++;
            if (e.created) stats.paradigmsAddedCreated++;
          }
          stats.fieldsFilled += rec.applied.filter((x) => x !== 'paradigm').length;
          break;
        }
        case 'not-found':
          stats.notFound++;
          rec.nearest = res.nearest;
          rec.fromCache = res.fromCache;
          if ((res as { note?: string }).note) rec.reason = (res as { note?: string }).note;
          break;
        case 'skipped':
          stats.skipped++;
          rec.reason = res.reason;
          break;
        case 'error':
          stats.errors++;
          rec.message = res.message;
          break;
      }
      records.push(rec);
      opts.onRecord?.(rec);
      opts.progress?.tick(1);
      if (stats.lookedUp % 50 === 0 || i === queue.length - 1) {
        const cs = client.stats();
        opts.progress?.status(`found ${stats.found} · net ${cs.network} · cache ${cs.cacheHits} · skipped ${stats.skipped}`);
      }
    }
  };
  await Promise.all(Array.from({ length: parallel }, worker));
  return { stats, records };
}
