/**
 * Frequency dictionary of modern Ukrainian publicistic texts (raw_sources/publicist_84k_lex_dict_orig.csv,
 * `rowid;name;part_sp;rate_abs;page_resp`, UTF-8, CRLF) → `FrequencyIndex` (DECISIONS item 12).
 *
 * rank = 1-based position after sorting rows by rate_abs descending, ties by rowid ascending.
 * Lookup by `searchKey(word)`; among rows with that key the best-ranked POS-compatible row wins; rows of an
 * incompatible POS are never used. Rows with an empty POS, "абревіатура" or "скорочення" are compatible with every POS.
 */
import fs from 'node:fs';
import type { PartOfSpeech } from '@ukdict/shared';
import { searchKey } from '@ukdict/shared';
import type { FrequencyIndex } from '../contracts.ts';
import { posCompatible } from '../util/pos.ts';

/** CSV POS label → compatible PartOfSpeech values; `null` = compatible with any POS. */
export const FREQ_POS: Readonly<Record<string, readonly PartOfSpeech[] | null>> = {
  прикметник: ['adjective'],
  'ім. ч. р.': ['noun', 'proper-noun'],
  'ім. ж. р.': ['noun', 'proper-noun'],
  'ім. с. р.': ['noun', 'proper-noun'],
  'ім. множ.': ['noun', 'proper-noun'],
  'дієсл.': ['verb'],
  'прислівн.': ['adverb'],
  'форма на -но/-то': ['verb', 'adverb', 'predicative'],
  'прийм.': ['preposition'],
  'займ.-прикм.': ['pronoun', 'determiner', 'adjective'],
  'займ.-ім.': ['pronoun', 'noun'],
  'займ.': ['pronoun', 'determiner'],
  'част.': ['particle'],
  абревіатура: null,
  скорочення: null,
  'сполучн.': ['conjunction'],
  'числ.': ['numeral', 'determiner', 'adjective'],
  'дієприсл.': ['verb', 'adverb'],
  'присудкова форма': ['predicative', 'adverb', 'adjective', 'noun'],
  вигук: ['interjection'],
  '': null,
};

export interface FrequencyRow {
  rowid: number;
  name: string;
  posLabel: string;
  rate: number;
  page: number;
  /** 1-based rank. */
  rank: number;
  pos: readonly PartOfSpeech[] | null;
}

export interface FrequencyIndexImpl extends FrequencyIndex {
  /** Rows with this search key, best rank first. */
  rows(word: string): readonly FrequencyRow[];
  /** POS labels that were not recognized (treated as "any POS"). */
  readonly unknownPosLabels: ReadonlyMap<string, number>;
}

/** Parse the CSV text (exported for tests). */
export function parseFrequencyCsv(text: string): { rows: FrequencyRow[]; unknownPosLabels: Map<string, number> } {
  const rows: FrequencyRow[] = [];
  const unknownPosLabels = new Map<string, number>();
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const f = line.split(';');
    if (f.length < 5) continue;
    // Robust against ';' inside the name: rowid first, the last three fields are part_sp, rate_abs, page_resp.
    const rowid = Number(f[0]);
    const rate = Number(f[f.length - 2]);
    if (i === 0 && !Number.isFinite(rowid)) continue; // header
    if (!Number.isFinite(rowid) || !Number.isFinite(rate)) continue;
    const name = f.slice(1, f.length - 3).join(';').trim();
    if (!name) continue;
    const posLabel = f[f.length - 3].trim();
    let pos: readonly PartOfSpeech[] | null;
    if (posLabel in FREQ_POS) pos = FREQ_POS[posLabel];
    else {
      pos = null;
      unknownPosLabels.set(posLabel, (unknownPosLabels.get(posLabel) ?? 0) + 1);
    }
    rows.push({ rowid, name, posLabel, rate, page: Number(f[f.length - 1]) || 0, rank: 0, pos });
  }
  rows.sort((a, b) => b.rate - a.rate || a.rowid - b.rowid);
  rows.forEach((r, i) => (r.rank = i + 1));
  return { rows, unknownPosLabels };
}

function isCapitalized(s: string): boolean {
  const c = s.trim().charAt(0);
  return c !== c.toLowerCase();
}

export function buildFrequencyIndex(rows: readonly FrequencyRow[], unknownPosLabels = new Map<string, number>()): FrequencyIndexImpl {
  const byKey = new Map<string, FrequencyRow[]>();
  for (const r of rows) {
    const k = searchKey(r.name);
    let list = byKey.get(k);
    if (!list) byKey.set(k, (list = []));
    list.push(r); // rows are already in rank order
  }
  const compatible = (r: FrequencyRow, pos: PartOfSpeech) => r.pos === null || r.pos.some((p) => posCompatible(p, pos));
  return {
    size: rows.length,
    unknownPosLabels,
    rows: (word) => byKey.get(searchKey(word)) ?? [],
    rank(word: string, pos?: PartOfSpeech): number | undefined {
      const list = byKey.get(searchKey(word));
      if (!list?.length) return undefined;
      if (!pos) return list[0].rank;
      // Strict: a row of an incompatible POS must not rank this entry (otherwise the river "По" or the
      // interjection "на" would inherit the rank of the preposition). The CSV keeps the capitalization of proper
      // names in POS-tagged rows ("Україна", "Київ"), so for nouns the initial case of a tagged row must agree too
      // ("Влада" ≠ "влада"). Untagged rows are lower-cased tokens ("ґустав") and match either case.
      const nounish = pos === 'noun' || pos === 'proper-noun';
      const caseOk = (r: FrequencyRow) => !nounish || r.pos === null || isCapitalized(r.name) === isCapitalized(word);
      return list.find((r) => compatible(r, pos) && caseOk(r))?.rank;
    },
  };
}

export async function loadFrequency(file: string): Promise<FrequencyIndexImpl> {
  const text = await fs.promises.readFile(file, 'utf8');
  const { rows, unknownPosLabels } = parseFrequencyCsv(text);
  return buildFrequencyIndex(rows, unknownPosLabels);
}
