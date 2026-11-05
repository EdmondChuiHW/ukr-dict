/**
 * Curated verb aspect pairs (raw_sources/verb_aspect_known_pairs.json): `[["співати", "заспівати"], …]`,
 * each pair = [imperfective, perfective]. DECISIONS item 7.
 */
import fs from 'node:fs';
import { searchKey } from '@ukdict/shared';
import type { KnownAspectPair } from '../contracts.ts';

/** Validate + normalize parsed JSON (exported for tests). Invalid items are skipped; duplicates removed. */
export function parseKnownAspectPairs(data: unknown): KnownAspectPair[] {
  if (!Array.isArray(data)) throw new Error('verb aspect pairs: expected a JSON array of [imperfective, perfective] pairs');
  const out: KnownAspectPair[] = [];
  const seen = new Set<string>();
  for (const item of data) {
    let impf: unknown;
    let pf: unknown;
    if (Array.isArray(item) && item.length >= 2) [impf, pf] = item;
    else if (item && typeof item === 'object') ({ imperfective: impf, perfective: pf } = item as Record<string, unknown>);
    if (typeof impf !== 'string' || typeof pf !== 'string') continue;
    const imperfective = impf.replace(/\s+/g, ' ').trim();
    const perfective = pf.replace(/\s+/g, ' ').trim();
    if (!imperfective || !perfective) continue;
    const k = `${searchKey(imperfective)}|${searchKey(perfective)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ imperfective, perfective });
  }
  return out;
}

export async function loadKnownAspectPairs(file: string): Promise<KnownAspectPair[]> {
  const text = await fs.promises.readFile(file, 'utf8');
  return parseKnownAspectPairs(JSON.parse(text));
}
