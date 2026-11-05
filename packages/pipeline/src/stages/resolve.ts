/**
 * Resolve stage:
 *  (a) ignored form-of entries → extra forms on their lemma entries (DECISIONS 2), resolution recorded;
 *  (b) `linked` flags on related terms, aspect partners and formOf/altOf word refs;
 *  (c) aspect partners: curated known pairs first, then symmetric partners (DECISIONS 7), deduped by key.
 */
import { hasStressMark, searchKey, stressedKey } from '@ukdict/shared';
import type { Aspect, AspectPartner, PartOfSpeech, Relations, Sense } from '@ukdict/shared';
import type { DraftEntry, IgnoredEntry, KnownAspectPair } from '../contracts.ts';
import { dedupeTerms, preferStressed, walkSenses } from './common.ts';
import { posCompatible } from '../util/pos.ts';

export interface ResolveStats {
  ignored: number;
  inParadigm: number;
  addedAsExtraForm: number;
  lemmaMissing: number;
  extraFormsAdded: number;
  knownPairsApplied: number;
  symmetricPartnersAdded: number;
  partnersStressFilled: number;
  linkedRefs: number;
  unlinkedRefs: number;
  relationDuplicatesRemoved: number;
}

export interface ResolveOptions {
  /** POS compatibility predicate (default: util/pos.ts posCompatible). */
  posCompatible?: (a: PartOfSpeech, b: PartOfSpeech) => boolean;
}

/** Strips trailing grammatical abbreviations kaikki sometimes leaves in form-of targets ("ску́чити pf"). */
export function cleanTarget(word: string): string {
  return word
    .normalize('NFC')
    .replace(/\s+(pf|impf|m|f|n|pl|sg|anim|inan)\.?$/u, '')
    .trim();
}

function indexByKey(entries: readonly DraftEntry[]): Map<string, DraftEntry[]> {
  const m = new Map<string, DraftEntry[]>();
  for (const e of entries) {
    let l = m.get(e.key);
    if (!l) m.set(e.key, (l = []));
    l.push(e);
  }
  return m;
}

function paradigmKeys(e: DraftEntry): Set<string> {
  const s = new Set<string>();
  if (e.paradigm) for (const list of Object.values(e.paradigm.forms)) for (const f of list ?? []) s.add(searchKey(f.form));
  return s;
}

/** Picks lemma entries for a form-of target: by key, preferring POS-compatible, then matching stress. */
export function findLemmas(
  byKey: Map<string, DraftEntry[]>,
  target: string,
  pos: PartOfSpeech,
  compat: (a: PartOfSpeech, b: PartOfSpeech) => boolean,
): DraftEntry[] {
  const cleaned = cleanTarget(target);
  let cands = byKey.get(searchKey(cleaned));
  if (!cands?.length) {
    const first = cleaned.split(/\s+/)[0];
    if (first && first !== cleaned) cands = byKey.get(searchKey(first));
  }
  if (!cands?.length) return [];
  const compatible = cands.filter((e) => compat(pos, e.pos));
  let chosen = compatible.length > 0 ? compatible : cands;
  if (hasStressMark(cleaned) && chosen.length > 1) {
    const sk = stressedKey(cleaned);
    const byStress = chosen.filter((e) => e.heads.some((h) => stressedKey(h) === sk));
    if (byStress.length > 0) chosen = byStress;
  }
  return chosen;
}

function opposite(a: Aspect): Aspect {
  return a === 'perfective' ? 'imperfective' : a === 'imperfective' ? 'perfective' : 'biaspectual';
}

/** Dedupes a partner list by key (first wins; stressed spelling preferred), dropping the entry itself. */
export function dedupePartners(list: readonly AspectPartner[], ownKey: string): AspectPartner[] {
  const out: AspectPartner[] = [];
  const idx = new Map<string, number>();
  for (const p of list) {
    const k = searchKey(p.word);
    if (!k || k === ownKey) continue;
    const i = idx.get(k);
    if (i === undefined) {
      idx.set(k, out.length);
      out.push({ ...p });
    } else {
      out[i].word = preferStressed(out[i].word, p.word);
    }
  }
  return out;
}

function sanitizeRelations(rel: Relations | undefined, ownKey: string, stats: ResolveStats): Relations | undefined {
  if (!rel) return rel;
  const out: Relations = {};
  for (const [type, list] of Object.entries(rel) as [keyof Relations, Relations[keyof Relations]][]) {
    if (!list?.length) continue;
    const d = dedupeTerms(list, ownKey);
    stats.relationDuplicatesRemoved += list.length - d.length;
    if (d.length > 0) out[type] = d;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function resolveEntries(
  entries: DraftEntry[],
  ignored: IgnoredEntry[],
  knownPairs: readonly KnownAspectPair[],
  opts: ResolveOptions = {},
): ResolveStats {
  const compat = opts.posCompatible ?? posCompatible;
  const stats: ResolveStats = {
    ignored: ignored.length,
    inParadigm: 0,
    addedAsExtraForm: 0,
    lemmaMissing: 0,
    extraFormsAdded: 0,
    knownPairsApplied: 0,
    symmetricPartnersAdded: 0,
    partnersStressFilled: 0,
    linkedRefs: 0,
    unlinkedRefs: 0,
    relationDuplicatesRemoved: 0,
  };
  const byKey = indexByKey(entries);
  const pkCache = new Map<DraftEntry, Set<string>>();
  const pkeys = (e: DraftEntry) => {
    let s = pkCache.get(e);
    if (!s) pkCache.set(e, (s = paradigmKeys(e)));
    return s;
  };

  // (a) ignored form-of entries
  for (const ig of ignored) {
    const formKey = searchKey(ig.word);
    let anyAdded = false;
    let anyIn = false;
    for (const fo of ig.formOf) {
      const lemmas = findLemmas(byKey, fo.word, ig.pos, compat);
      for (const lemma of lemmas) {
        if (formKey === lemma.key || pkeys(lemma).has(formKey)) {
          anyIn = true;
          continue;
        }
        const xs = (lemma.extraForms ??= []);
        if (!xs.some((x) => searchKey(x.form) === formKey)) {
          xs.push({ form: ig.word, tags: [...(fo.tags ?? [])], origin: 'form-of-entry' });
          stats.extraFormsAdded++;
        }
        anyAdded = true;
      }
    }
    ig.resolution = anyAdded ? 'added-as-extra-form' : anyIn ? 'in-paradigm' : 'lemma-missing';
    if (anyAdded) stats.addedAsExtraForm++;
    else if (anyIn) stats.inParadigm++;
    else stats.lemmaMissing++;
  }

  // (c) aspect partners: curated pairs first
  const verbsByKey = (k: string) => (byKey.get(k) ?? []).filter((e) => e.pos === 'verb');
  for (const pair of knownPairs) {
    const impfKey = searchKey(pair.imperfective);
    const pfKey = searchKey(pair.perfective);
    for (const e of verbsByKey(impfKey)) {
      e.aspectPartners = [{ word: pair.perfective, aspect: 'perfective', source: 'known-aspect-pairs' }, ...(e.aspectPartners ?? [])];
      stats.knownPairsApplied++;
    }
    for (const e of verbsByKey(pfKey)) {
      e.aspectPartners = [{ word: pair.imperfective, aspect: 'imperfective', source: 'known-aspect-pairs' }, ...(e.aspectPartners ?? [])];
      stats.knownPairsApplied++;
    }
  }
  for (const e of entries) if (e.aspectPartners) e.aspectPartners = dedupePartners(e.aspectPartners, e.key);

  // symmetric partners (snapshot first so additions don't cascade)
  const snapshot = entries
    .filter((e) => e.pos === 'verb' && e.aspectPartners?.length)
    .map((e) => ({ e, partners: [...e.aspectPartners!] }));
  for (const { e, partners } of snapshot) {
    for (const p of partners) {
      for (const b of verbsByKey(searchKey(p.word))) {
        if (b === e) continue;
        const list = (b.aspectPartners ??= []);
        if (list.some((x) => searchKey(x.word) === e.key)) continue;
        const item: AspectPartner = { word: e.heads[0] ?? e.word, aspect: e.aspect ?? opposite(p.aspect), source: p.source };
        if (p.source === 'known-aspect-pairs') list.unshift(item);
        else list.push(item);
        stats.symmetricPartnersAdded++;
      }
    }
  }

  // fill stress of partner words from the partner's entry; drop empty lists
  for (const e of entries) {
    if (!e.aspectPartners) continue;
    for (const p of e.aspectPartners) {
      if (hasStressMark(p.word)) continue;
      const vs = verbsByKey(searchKey(p.word));
      const stressed = vs.map((v) => v.heads.find(hasStressMark)).filter((h): h is string => !!h);
      if (stressed.length > 0 && new Set(stressed.map(stressedKey)).size === 1) {
        p.word = stressed[0];
        stats.partnersStressFilled++;
      }
    }
    if (e.aspectPartners.length === 0) delete e.aspectPartners;
  }

  // (b) linked flags + relation collapsing
  const keys = new Set(byKey.keys());
  const link = (word: string): boolean => {
    const ok = keys.has(searchKey(cleanTarget(word)));
    if (ok) stats.linkedRefs++;
    else stats.unlinkedRefs++;
    return ok;
  };
  const linkRelations = (rel: Relations | undefined) => {
    if (!rel) return;
    for (const list of Object.values(rel)) for (const t of list ?? []) t.linked = link(t.word);
  };
  for (const e of entries) {
    e.relations = sanitizeRelations(e.relations, e.key, stats);
    if (!e.relations) delete e.relations;
    linkRelations(e.relations);
    for (const p of e.aspectPartners ?? []) p.linked = link(p.word);
    walkSenses(e.senses, (s: Sense) => {
      if (s.relations) {
        s.relations = sanitizeRelations(s.relations, e.key, stats);
        if (!s.relations) delete s.relations;
        linkRelations(s.relations);
      }
      for (const r of s.formOf ?? []) r.linked = link(r.word);
      for (const r of s.altOf ?? []) r.linked = link(r.word);
    });
  }
  return stats;
}
