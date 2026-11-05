/**
 * Selection of kaikki-uk entries that need an lcorp inflection table (DECISIONS.md #5), ordered by frequency.
 *
 * Criteria (all must hold):
 *   - kaikki POS is inflectable: noun, name, verb, adj, pron, det, num
 *   - no kaikki table: no form with source "declension" / "conjugation" / "inflection"
 *   - not every sense is a `form_of` sense (pure inflected-form / derivation-pointer entries)
 *   - not an inflected-form or predicative head line ("verb form", "noun form", "vf", "predicative"…)
 *   - a single word (letters, apostrophe, hyphen; Cyrillic) — no spaces, digits or dots; not an abbreviation
 *   - not indeclinable (canonical form tags, head template expansion, entry tags or all sense tags)
 * Order: rank in the publicistic frequency list (rate_abs desc, ties by rowid), unranked words last (file order).
 */
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { hasCyrillic, searchKey, type PartOfSpeech } from '@ukdict/shared';
import type { LcorpLookupRequest } from '../../contracts.ts';

/** Minimal kaikki POS mapping for lcorp lookups (kept local so lookup keys stay stable). */
export const LCORP_KAIKKI_POS: Readonly<Record<string, PartOfSpeech>> = {
  noun: 'noun',
  name: 'proper-noun',
  verb: 'verb',
  adj: 'adjective',
  pron: 'pronoun',
  det: 'determiner',
  num: 'numeral',
};

const TABLE_SOURCES = new Set(['declension', 'conjugation', 'inflection']);
/** `head` template POS arguments that mark non-lemma or uninflectable head lines. */
const NON_LEMMA_HEAD_RE = /(^|\s)(form|forms|vf|predicative|participle form)$/i;
const WORD_RE = /^[\p{L}\p{M}'’ʼ-]+$/u;

export interface KaikkiLikeEntry {
  word?: string;
  pos?: string;
  tags?: string[];
  forms?: { form?: string; tags?: string[]; source?: string }[];
  head_templates?: { name?: string; args?: Record<string, string>; expansion?: string }[];
  senses?: { glosses?: string[]; tags?: string[]; form_of?: unknown[] }[];
}

export interface LcorpCandidate extends LcorpLookupRequest {
  heads: string[];
  kaikkiPos: string;
  /** 1-based line in the kaikki JSONL. */
  line: number;
  /** Frequency rank (1 = most frequent); undefined when not in the list. */
  rank?: number;
}

export type CandidateVerdict =
  | { ok: true; request: LcorpLookupRequest & { heads: string[] } }
  | {
      ok: false;
      reason: 'pos' | 'has-table' | 'form-of' | 'non-lemma-head' | 'multi-word' | 'not-a-word' | 'abbreviation' | 'indeclinable' | 'no-senses';
    };

/** Stressed heads from kaikki canonical forms (first token, must spell the word), falling back to head template args. */
export function kaikkiHeads(e: KaikkiLikeEntry): string[] {
  const word = e.word ?? '';
  const key = searchKey(word);
  const raw: string[] = [];
  for (const f of e.forms ?? []) if (f.form && f.tags?.includes('canonical')) raw.push(f.form);
  for (const h of e.head_templates ?? []) {
    if (h.args?.head) raw.push(h.args.head);
    else if (h.name?.startsWith('uk-') && h.args?.['1']) raw.push(h.args['1']);
  }
  const heads: string[] = [];
  for (const r of raw) {
    const tok = r.trim().split(/\s+/)[0]?.normalize('NFC');
    if (tok && searchKey(tok) === key && !heads.includes(tok)) heads.push(tok);
  }
  return heads.length ? heads : [word];
}

const ABBREV_TAGS = ['abbreviation', 'initialism', 'acronym'];

/** All-caps words ("ДП", "АТ") and entries whose every sense is an abbreviation are not inflected in lcorp. */
function isAbbreviation(word: string, senses: NonNullable<KaikkiLikeEntry['senses']>): boolean {
  const letters = word.replace(/[^\p{L}]/gu, '');
  if (letters.length >= 2 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()) return true;
  return senses.length > 0 && senses.every((s) => s.tags?.some((t) => ABBREV_TAGS.includes(t)));
}

function isIndeclinable(e: KaikkiLikeEntry): boolean {
  if (e.tags?.includes('indeclinable')) return true;
  if ((e.forms ?? []).some((f) => f.tags?.includes('canonical') && f.tags.includes('indeclinable'))) return true;
  if ((e.head_templates ?? []).some((h) => /\bindeclinable\b/.test(h.expansion ?? ''))) return true;
  const senses = e.senses ?? [];
  return senses.length > 0 && senses.every((s) => s.tags?.includes('indeclinable'));
}

/** Decide whether a kaikki entry should be looked up in lcorp; returns the lookup request when it should. */
export function lcorpCandidateVerdict(e: KaikkiLikeEntry): CandidateVerdict {
  const pos = LCORP_KAIKKI_POS[e.pos ?? ''];
  if (!pos) return { ok: false, reason: 'pos' };
  if ((e.forms ?? []).some((f) => f.source && TABLE_SOURCES.has(f.source))) return { ok: false, reason: 'has-table' };
  const senses = e.senses ?? [];
  if (!senses.length || senses.every((s) => !s.glosses?.length && !s.form_of?.length)) return { ok: false, reason: 'no-senses' };
  if (senses.every((s) => Array.isArray(s.form_of) && s.form_of.length > 0)) return { ok: false, reason: 'form-of' };
  if ((e.head_templates ?? []).some((h) => h.name === 'head' && NON_LEMMA_HEAD_RE.test(h.args?.['2'] ?? ''))) {
    return { ok: false, reason: 'non-lemma-head' };
  }
  const word = (e.word ?? '').normalize('NFC');
  if (/\s/.test(word.trim())) return { ok: false, reason: 'multi-word' };
  if (!WORD_RE.test(word) || !hasCyrillic(word)) return { ok: false, reason: 'not-a-word' };
  if (isAbbreviation(word, senses)) return { ok: false, reason: 'abbreviation' };
  if (isIndeclinable(e)) return { ok: false, reason: 'indeclinable' };
  return { ok: true, request: { word, heads: kaikkiHeads(e), pos } };
}

// ───────────────────────────── frequency ─────────────────────────────

/** Lower-cased lemma → best (smallest) rank. Rank by rate_abs desc, ties by rowid asc. */
export async function loadFrequencyRanks(csvFile: string): Promise<Map<string, number>> {
  const text = await readFile(csvFile, 'utf8');
  const rows: { rowid: number; name: string; rate: number }[] = [];
  for (const line of text.split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue;
    const [rowid, name, , rate] = line.split(';');
    if (!name) continue;
    rows.push({ rowid: Number(rowid) || 0, name: name.trim(), rate: Number(rate) || 0 });
  }
  rows.sort((a, b) => b.rate - a.rate || a.rowid - b.rowid);
  const ranks = new Map<string, number>();
  rows.forEach((r, i) => {
    const k = searchKey(r.name);
    if (!ranks.has(k)) ranks.set(k, i + 1);
  });
  return ranks;
}

// ───────────────────────────── scan ─────────────────────────────

export interface CandidateScanResult {
  candidates: LcorpCandidate[];
  /** Exclusion reasons (+ "candidate", "duplicate") → count, for entries with an inflectable POS. */
  stats: Record<string, number>;
  lines: number;
}

/** Fast pre-filter: lines with a kaikki table never become candidates, skip JSON.parse for them. */
const TABLE_MARKER_RE = /"source": ?"(declension|conjugation|inflection)"/;

export async function scanLcorpCandidates(opts: {
  kaikkiFile: string;
  frequencyFile?: string;
  onProgress?: (bytes: number, lines: number) => void;
}): Promise<CandidateScanResult> {
  const ranks = opts.frequencyFile ? await loadFrequencyRanks(opts.frequencyFile) : new Map<string, number>();
  const stats: Record<string, number> = {};
  const bump = (k: string) => (stats[k] = (stats[k] ?? 0) + 1);
  const seen = new Set<string>();
  const candidates: LcorpCandidate[] = [];
  const stream = createReadStream(opts.kaikkiFile, { encoding: 'utf8', highWaterMark: 1 << 20 });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let line = 0;
  let bytes = 0;
  for await (const text of rl) {
    line++;
    bytes += Buffer.byteLength(text, 'utf8') + 1;
    if (opts.onProgress && line % 2000 === 0) opts.onProgress(bytes, line);
    if (!text) continue;
    if (TABLE_MARKER_RE.test(text)) {
      bump('has-table');
      continue;
    }
    let e: KaikkiLikeEntry;
    try {
      e = JSON.parse(text) as KaikkiLikeEntry;
    } catch {
      bump('bad-json');
      continue;
    }
    const v = lcorpCandidateVerdict(e);
    if (!v.ok) {
      if (v.reason !== 'pos') bump(v.reason);
      continue;
    }
    const dedupe = `${v.request.word}\u0000${v.request.pos}\u0000${v.request.heads.join(',')}`;
    if (seen.has(dedupe)) {
      bump('duplicate');
      continue;
    }
    seen.add(dedupe);
    bump('candidate');
    candidates.push({ ...v.request, kaikkiPos: e.pos!, line, rank: ranks.get(searchKey(v.request.word)) });
  }
  opts.onProgress?.(bytes, line);
  candidates.sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.line - b.line);
  return { candidates, stats, lines: line };
}
