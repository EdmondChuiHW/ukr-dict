/**
 * Merge entries with identical definitions (DECISIONS 10): same headword key + same POS + same set of
 * normalized glosses + compatible stressed heads ⇒ one entry. The entry with the earliest origin is kept;
 * paradigms (more complete one preferred, missing slots filled), pronunciations, relations, sources,
 * extra forms, aspect partners and examples are unioned.
 */
import { hasStressMark, searchKey, stressedKey } from '@ukdict/shared';
import type { AspectPartner, Example, ExtraForm, Paradigm, Pronunciation, Sense } from '@ukdict/shared';
import type { DraftEntry } from '../contracts.ts';
import {
  headsCompatible,
  normalizeGloss,
  unionRelations,
  unionSources,
  unionStrings,
  walkSenses,
} from './common.ts';
import { posCompatible } from '../util/pos.ts';

export interface MergeLog {
  kept: { word: string; pos: string; heads: string[]; origin: string };
  merged: { word: string; heads: string[]; origin: string; etymologyNumber?: number }[];
  reason: string;
}

function originLabel(e: DraftEntry): string {
  return e.origin.source === 'kaikki-uk' ? `kaikki-uk:${e.origin.line ?? '?'}` : `english-translation:${e.origin.line ?? '?'}`;
}

/** Sort key of an origin: kaikki before translations, then by line. */
function originRank(e: DraftEntry): number {
  return (e.origin.source === 'kaikki-uk' ? 0 : 1e12) + (e.origin.line ?? 0);
}

export function glossSignature(e: DraftEntry): string {
  const set = new Set<string>();
  walkSenses(e.senses, (s) => {
    if (s.gloss && !s.headerOnly) set.add(normalizeGloss(s.gloss));
  });
  return [...set].sort().join('\u0001');
}

function paradigmSize(p?: Paradigm): number {
  if (!p) return 0;
  let n = 0;
  for (const forms of Object.values(p.forms)) n += forms?.length ? 1 : 0;
  return n;
}

export function mergeParadigms(a?: Paradigm, b?: Paradigm): Paradigm | undefined {
  if (!a) return b;
  if (!b) return a;
  const [base, other] = paradigmSize(b) > paradigmSize(a) ? [b, a] : [a, b];
  if (base.kind !== other.kind) return base;
  const forms = { ...base.forms };
  for (const [slot, list] of Object.entries(other.forms)) {
    if (!forms[slot]?.length && list?.length) forms[slot] = list;
  }
  const notes = unionStrings(base.notes, other.notes);
  return { ...base, forms, ...(notes ? { notes } : {}) };
}

function mergePronunciation(a?: Pronunciation, b?: Pronunciation): Pronunciation | undefined {
  if (!a) return b;
  if (!b) return a;
  const ipa = [...(a.ipa ?? [])];
  for (const x of b.ipa ?? []) if (!ipa.some((y) => y.value === x.value)) ipa.push(x);
  const audio = [...(a.audio ?? [])];
  const akey = (x: { mp3?: string; ogg?: string }) => x.mp3 ?? x.ogg ?? '';
  for (const x of b.audio ?? []) if (!audio.some((y) => akey(y) === akey(x))) audio.push(x);
  const out: Pronunciation = {};
  if (ipa.length) out.ipa = ipa;
  if (audio.length) out.audio = audio;
  return out;
}

function mergeExtraForms(a?: ExtraForm[], b?: ExtraForm[]): ExtraForm[] | undefined {
  if (!a?.length) return b;
  if (!b?.length) return a;
  const out = [...a];
  const seen = new Set(a.map((x) => `${searchKey(x.form)}|${x.tags.join(',')}`));
  for (const x of b) {
    const k = `${searchKey(x.form)}|${x.tags.join(',')}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(x);
    }
  }
  return out;
}

function mergePartners(a?: AspectPartner[], b?: AspectPartner[]): AspectPartner[] | undefined {
  if (!a?.length) return b;
  if (!b?.length) return a;
  const out = [...a];
  const seen = new Set(a.map((x) => searchKey(x.word)));
  for (const x of b) {
    const k = searchKey(x.word);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(x);
    }
  }
  return out;
}

/** Adds examples / relations / tags of `from`'s senses into `into`'s senses with the same normalized gloss. */
function mergeSenseDetails(into: Sense[], from: Sense[], ownKey: string): void {
  const byGloss = new Map<string, Sense>();
  walkSenses(into, (s) => {
    const k = normalizeGloss(s.gloss);
    if (!byGloss.has(k)) byGloss.set(k, s);
  });
  walkSenses(from, (s) => {
    const target = byGloss.get(normalizeGloss(s.gloss));
    if (!target || target === s) return;
    if (s.examples?.length) {
      const ex: Example[] = [...(target.examples ?? [])];
      for (const x of s.examples) if (!ex.some((y) => y.text === x.text)) ex.push(x);
      target.examples = ex;
    }
    const rel = unionRelations(target.relations, s.relations, ownKey);
    if (rel) target.relations = rel;
    const tags = unionStrings(target.tags, s.tags);
    if (tags) target.tags = tags;
    const topics = unionStrings(target.topics, s.topics);
    if (topics) target.topics = topics;
  });
}

/** Merges `other` into `kept` (mutates `kept`). */
export function mergeInto(kept: DraftEntry, other: DraftEntry): void {
  for (const h of other.heads) {
    if (!hasStressMark(h)) continue; // an unstressed spelling adds nothing (same key)
    const sk = stressedKey(h);
    if (kept.heads.some((x) => stressedKey(x) === sk)) continue;
    kept.heads.push(h);
  }
  // Drop unstressed heads once a stressed spelling is known.
  if (kept.heads.some(hasStressMark)) kept.heads = kept.heads.filter(hasStressMark);
  kept.tags = unionStrings(kept.tags, other.tags);
  if (other.genders?.length) {
    const g = new Set([...(kept.genders ?? []), ...other.genders]);
    kept.genders = (['m', 'f', 'n'] as const).filter((x) => g.has(x));
  }
  kept.animacy ??= other.animacy;
  kept.number ??= other.number;
  kept.aspect ??= other.aspect;
  kept.aspectPartners = mergePartners(kept.aspectPartners, other.aspectPartners);
  mergeSenseDetails(kept.senses, other.senses, kept.key);
  kept.paradigm = mergeParadigms(kept.paradigm, other.paradigm);
  kept.extraForms = mergeExtraForms(kept.extraForms, other.extraForms);
  kept.pronunciation = mergePronunciation(kept.pronunciation, other.pronunciation);
  kept.relations = unionRelations(kept.relations, other.relations, kept.key);
  kept.sources = unionSources(kept.sources, other.sources);
  if (other.created) {
    if (kept.created) {
      for (const f of other.created.from) if (!kept.created.from.some((x) => x.enWord === f.enWord && x.sense === f.sense)) kept.created.from.push(f);
    }
  }
  if (other.ext) kept.ext = { ...other.ext, ...(kept.ext ?? {}) };
  for (const k of Object.keys(kept) as (keyof DraftEntry)[]) if (kept[k] === undefined) delete kept[k];
}

export function mergeEntries(entries: readonly DraftEntry[]): { entries: DraftEntry[]; merges: MergeLog[]; droppedStubs: number } {
  const groups = new Map<string, number[]>();
  entries.forEach((e, i) => {
    const gk = `${e.key}\u0000${e.pos}`;
    let g = groups.get(gk);
    if (!g) groups.set(gk, (g = []));
    g.push(i);
  });
  const removed = new Set<number>();
  const logs = new Map<number, MergeLog>();
  for (const idxs of groups.values()) {
    if (idxs.length < 2) continue;
    const sorted = [...idxs].sort((a, b) => originRank(entries[a]) - originRank(entries[b]));
    const clusters: { idx: number; sig: string }[] = [];
    for (const i of sorted) {
      const e = entries[i];
      const sig = glossSignature(e);
      const target = sig ? clusters.find((c) => c.sig === sig && headsCompatible(entries[c.idx].heads, e.heads)) : undefined;
      if (!target) {
        clusters.push({ idx: i, sig });
        continue;
      }
      const kept = entries[target.idx];
      let log = logs.get(target.idx);
      if (!log) {
        log = {
          kept: { word: kept.word, pos: kept.pos, heads: [...kept.heads], origin: originLabel(kept) },
          merged: [],
          reason: 'same key, POS and gloss set; compatible stressed heads',
        };
        logs.set(target.idx, log);
      }
      const item: MergeLog['merged'][number] = { word: e.word, heads: [...e.heads], origin: originLabel(e) };
      if (e.origin.etymologyNumber !== undefined) item.etymologyNumber = e.origin.etymologyNumber;
      log.merged.push(item);
      mergeInto(kept, e);
      removed.add(i);
    }
  }
  // Gloss-less stubs (e.g. kaikki entries generated from Thesaurus pages: only synonym lists) are folded into
  // an entry with the same key (same POS preferred, then a compatible POS, then any); dropped if none exists.
  const byKey = new Map<string, number[]>();
  entries.forEach((e, i) => {
    if (removed.has(i)) return;
    let l = byKey.get(e.key);
    if (!l) byKey.set(e.key, (l = []));
    l.push(i);
  });
  const stubLogs: MergeLog[] = [];
  let droppedStubs = 0;
  entries.forEach((e, i) => {
    if (removed.has(i) || glossSignature(e) !== '') return;
    const cands = (byKey.get(e.key) ?? []).filter((j) => j !== i && !removed.has(j) && glossSignature(entries[j]) !== '');
    const pick = cands.find((j) => entries[j].pos === e.pos) ?? cands.find((j) => posCompatible(entries[j].pos, e.pos)) ?? cands[0];
    const item: MergeLog['merged'][number] = { word: e.word, heads: [...e.heads], origin: originLabel(e) };
    removed.add(i);
    if (pick === undefined) {
      droppedStubs++;
      stubLogs.push({ kept: { word: '', pos: e.pos, heads: [], origin: '' }, merged: [item], reason: 'no glosses and no entry with the same key — dropped' });
      return;
    }
    const kept = entries[pick];
    const { heads: _h, ...rest } = e;
    mergeInto(kept, { ...rest, heads: [] });
    stubLogs.push({
      kept: { word: kept.word, pos: kept.pos, heads: [...kept.heads], origin: originLabel(kept) },
      merged: [item],
      reason: `no glosses (${e.pos}; e.g. Thesaurus page) — relations folded into same-key entry`,
    });
  });
  return {
    entries: entries.filter((_, i) => !removed.has(i)),
    merges: [...[...logs.entries()].sort((a, b) => a[0] - b[0]).map(([, l]) => l), ...stubLogs],
    droppedStubs,
  };
}
