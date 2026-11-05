/**
 * One kaikki Ukrainian JSONL entry → `DraftEntry` or `IgnoredEntry` (pure; runs inside the workers).
 */
import type {
  Animacy,
  Aspect,
  AspectPartner,
  ExtraForm,
  Gender,
  NumberRestriction,
  PartOfSpeech,
  RelatedTerm,
  RelationType,
  Relations,
  Sense,
  SourceRef,
} from '@ukdict/shared';
import { hasCyrillic, hasLatin, kaikkiUrl, searchKey, sortTags, stressedKey, wiktionaryUrl } from '@ukdict/shared';
import type { DraftEntry, IgnoredEntry } from '../../contracts.ts';
import { mapKaikkiPos } from '../../util/pos.ts';
import { addToParadigm, buildParadigm, paradigmFormSet, type RawForm } from './paradigm.ts';
import { buildPronunciation } from './pronunciation.ts';
import { RELATION_ORDER, addRelation, collapseRelations, collectRelations, mergeRelationsInto, removeSenseDuplicates } from './relations.ts';
import { buildSenses, cleanWordRef, formOfTags, inferFormOf, isInflectedFormOnly, senseGlosses, walkSenses, wordRefs } from './senses.ts';
import { CASE_TAG, ENTRY_LEVEL_TAGS, GENDER_TAG, isJunkTag } from './tags.ts';

export type TransformResult = { kind: 'entry'; draft: DraftEntry } | { kind: 'ignored'; ignored: IgnoredEntry };

/** Optional per-worker statistics collector. */
export interface TransformStats {
  /** "<source>:<sorted,tags>" → count of table forms that did not map to a slot. */
  unmapped: Map<string, number>;
  tableForms: number;
  unmappedForms: number;
}

export function newTransformStats(): TransformStats {
  return { unmapped: new Map(), tableForms: 0, unmappedForms: 0 };
}

// ───────────────────────────── head information ─────────────────────────────

const EXPANSION_TOKENS: Record<string, string> = {
  m: 'masculine',
  f: 'feminine',
  n: 'neuter',
  inan: 'inanimate',
  anim: 'animate',
  animal: 'animal-not-person',
  pers: 'person',
  pl: 'plural',
  sg: 'singular',
  impf: 'imperfective',
  pf: 'perfective',
};

export interface HeadInfo {
  /** Head-line expansion, e.g. "соба́ка • (sobáka) m animal or f animal (genitive …)". */
  expansion?: string;
  /** Grammatical tokens of the head line in order (masculine, inanimate, …). */
  tokens: string[];
  /** Tags of the canonical form(s), if any. */
  canonicalTags?: string[];
  heads: string[];
}

/** Parse the head line: tokens between the romanization and the first "(" (e.g. "m inan or m pers"). */
export function parseHeadExpansion(expansion: string | undefined): string[] {
  if (!expansion) return [];
  const bullet = expansion.indexOf('•');
  let rest = bullet >= 0 ? expansion.slice(bullet + 1) : '';
  rest = rest.replace(/^\s*\([^)]*\)/, ''); // romanization
  const paren = rest.indexOf('(');
  if (paren >= 0) rest = rest.slice(0, paren);
  const out: string[] = [];
  for (const tok of rest.split(/[\s,]+/)) {
    const t = EXPANSION_TOKENS[tok];
    if (t) out.push(t);
  }
  return out;
}

export function headInfo(raw: any, word: string): HeadInfo {
  const forms: RawForm[] = Array.isArray(raw.forms) ? raw.forms : [];
  const canon = forms.filter((f) => !f.source && Array.isArray(f.tags) && f.tags.includes('canonical') && typeof f.form === 'string');
  const heads: string[] = [];
  for (const f of canon) {
    for (const h of f.form.split(/,\s*/)) {
      const t = h.replace(/\s+/g, ' ').trim();
      if (t && !heads.includes(t)) heads.push(t);
    }
  }
  if (!heads.length) heads.push(word);
  const templates: any[] = Array.isArray(raw.head_templates) ? raw.head_templates : [];
  const expansion = templates.map((t) => t?.expansion).find((e) => typeof e === 'string' && e.includes('•'));
  return {
    expansion,
    tokens: parseHeadExpansion(expansion),
    canonicalTags: canon.length ? [...new Set(canon.flatMap((f) => f.tags ?? []))] : undefined,
    heads,
  };
}

const GENDER_ORDER: Gender[] = ['m', 'f', 'n'];

export interface Grammar {
  genders?: Gender[];
  animacy?: Animacy;
  number?: NumberRestriction;
  aspect?: Aspect;
  tags: string[];
}

/** genders / animacy / number / aspect (DECISIONS item 8). */
export function entryGrammar(raw: any, pos: PartOfSpeech, info: HeadInfo, hasSingularCells: boolean | undefined): Grammar {
  const canon = info.canonicalTags ?? [];
  const tok = info.tokens;
  const g: Grammar = { tags: [] };
  const glossed = (Array.isArray(raw.senses) ? raw.senses : []).filter((s: any) => senseGlosses(s).length && !s.form_of);

  // gender: canonical form tags, else head-line tokens, else (nouns/pronouns) tags shared by all senses
  const gendersOf = (tags: readonly string[]) => GENDER_ORDER.filter((x) => tags.some((t) => GENDER_TAG[t] === x));
  let genders = gendersOf(canon);
  if (!genders.length) genders = gendersOf(tok);
  if (!genders.length && (pos === 'noun' || pos === 'proper-noun' || pos === 'pronoun') && glossed.length) {
    genders = GENDER_ORDER.filter((x) => glossed.every((s: any) => Array.isArray(s.tags) && s.tags.some((t: string) => GENDER_TAG[t] === x)));
  }
  if (genders.length) g.genders = genders;

  // animacy
  const anim = (t: string) => t === 'person' || t === 'animal-not-person' || t === 'animate' || t === 'personal';
  const animTags = [...canon, ...tok];
  const hasAnim = animTags.some(anim);
  const hasInan = animTags.includes('inanimate');
  if (hasAnim && hasInan) {
    const first = tok.find((t) => anim(t) || t === 'inanimate');
    g.animacy = first === 'inanimate' ? 'inanimate' : 'animate';
  } else if (hasAnim) g.animacy = 'animate';
  else if (hasInan) g.animacy = 'inanimate';

  // number
  const exp = info.expansion ?? '';
  const numTags = [...canon, ...tok];
  const allSenses = (tag: string) => glossed.length > 0 && glossed.every((s: any) => Array.isArray(s.tags) && s.tags.includes(tag));
  if (
    allSenses('plural-only') ||
    /plural only/.test(exp) ||
    (numTags.includes('plural') && !numTags.includes('singular') && hasSingularCells === false)
  ) {
    g.number = 'plural-only';
  } else if (allSenses('singular-only') || /singular only/.test(exp)) g.number = 'singular-only';

  // aspect
  if (pos === 'verb') {
    const asp = canon.includes('imperfective') || canon.includes('perfective') ? canon : tok;
    const impf = asp.includes('imperfective');
    const pf = asp.includes('perfective');
    if (impf && pf) g.aspect = 'biaspectual';
    else if (impf) g.aspect = 'imperfective';
    else if (pf) g.aspect = 'perfective';
  }

  if (/\bindeclinable\b/.test(exp)) g.tags.push('indeclinable');
  return g;
}

// ───────────────────────────── head forms ─────────────────────────────

const HEAD_GENDER_RELATION_POS = new Set<PartOfSpeech>(['noun', 'proper-noun', 'suffix', 'prefix', 'combining-form']);
const INFLECTIONAL_HEAD = new Set([...Object.keys(CASE_TAG), 'singular', 'plural']);

interface HeadForms {
  relations: Relations;
  aspectPartners: AspectPartner[];
  /** cmp/sup and inflectional head forms (placed into the paradigm or extraForms by the caller). */
  inflected: { form: string; tags: string[]; degree?: 'cmp' | 'sup' }[];
}

/** Classify head-line forms (no `source`): related words, aspect partners, inflected forms. */
export function classifyHeadForms(raw: any, pos: PartOfSpeech, headKey: string): HeadForms {
  const headWord = typeof raw?.word === 'string' ? raw.word : '';
  const out: HeadForms = { relations: {}, aspectPartners: [], inflected: [] };
  const forms: RawForm[] = Array.isArray(raw.forms) ? raw.forms : [];
  const seenPartner = new Set<string>();
  for (const f of forms) {
    if (!f || f.source || typeof f.form !== 'string') continue;
    const tags = (Array.isArray(f.tags) ? f.tags : []).filter((t) => !isJunkTag(t));
    if (!f.tags?.length || f.tags.includes('canonical') || f.tags.includes('romanization')) continue;
    const text = f.form.replace(/\s+/g, ' ').trim();
    if (!text || !hasCyrillic(text) || (hasLatin(text) && !hasLatin(headWord))) continue;
    const key = searchKey(text);
    const has = (t: string) => tags.includes(t);
    const rel = (type: RelationType, consumed: string[]) => {
      if (key === headKey) return;
      const extra = tags.filter((t) => !consumed.includes(t));
      const term: RelatedTerm = { word: text };
      if (extra.length) term.tags = sortTags(extra);
      addRelation(out.relations, type, term);
    };

    if (pos === 'verb' && (has('perfective') || has('imperfective'))) {
      if (key === headKey) continue;
      const aspect: Aspect = has('perfective') && has('imperfective') ? 'biaspectual' : has('perfective') ? 'perfective' : 'imperfective';
      const k = stressedKey(text);
      if (seenPartner.has(k)) continue;
      seenPartner.add(k);
      out.aspectPartners.push({ word: text, aspect, source: 'kaikki' });
      continue;
    }
    if (has('comparative') || has('superlative')) {
      out.inflected.push({ form: text, tags, degree: has('comparative') ? 'cmp' : 'sup' });
      continue;
    }
    if (has('diminutive')) rel('diminutive', ['diminutive']);
    else if (has('augmentative')) rel('augmentative', ['augmentative']);
    else if (has('abstract-noun')) rel('abstract-noun', ['abstract-noun']);
    else if (has('relational')) rel('relational-adjective', ['relational', 'adjective']);
    else if (has('adverb') || (has('adverbial') && pos === 'suffix')) rel('adverb', ['adverb', 'adverbial']);
    else if (has('abbreviation') || has('initialism') || has('acronym')) rel('abbreviation', ['abbreviation', 'alternative']);
    else if (has('alternative') || has('variant') || has('lowercase') || has('uppercase')) rel('alternative', ['alternative', 'variant']);
    else if (has('demonym')) rel('related', []);
    else if (has('pejorative')) rel('related', []);
    else if (has('adjective')) rel('related', []);
    else if (tags.some((t) => INFLECTIONAL_HEAD.has(t))) out.inflected.push({ form: text, tags });
    else if (has('feminine') || has('masculine') || has('neuter')) {
      if (HEAD_GENDER_RELATION_POS.has(pos)) {
        if (has('feminine')) rel('feminine', ['feminine']);
        else if (has('masculine')) rel('masculine', ['masculine']);
        else rel('related', []);
      } else out.inflected.push({ form: text, tags });
    }
  }
  return out;
}

// ───────────────────────────── main ─────────────────────────────

function entrySources(word: string): SourceRef[] {
  return [
    { source: 'wiktionary', url: wiktionaryUrl(word), label: 'Wiktionary' },
    { source: 'kaikki', url: kaikkiUrl(word), label: 'kaikki.org' },
  ];
}

function ignoredEntry(raw: any, word: string, kaikkiPos: string, pos: PartOfSpeech, line: number): IgnoredEntry {
  const formOf: { word: string; tags: string[] }[] = [];
  const seen = new Set<string>();
  const glosses: string[] = [];
  for (const s of raw.senses ?? []) {
    const tags = formOfTags(s);
    for (const r of wordRefs(s.form_of, tags)) {
      const k = `${searchKey(r.word)}|${tags.join(',')}`;
      if (seen.has(k)) continue;
      seen.add(k);
      formOf.push({ word: r.word, tags: [...tags] });
    }
    const g = senseGlosses(s);
    if (g.length && !glosses.includes(g[g.length - 1])) glosses.push(g[g.length - 1]);
  }
  return { word, kaikkiPos, pos, reason: 'inflected-form-only', formOf, glosses, line, url: wiktionaryUrl(word) };
}

/** Header tag groups for sense-tag de-duplication. */
function headerGroups(g: Grammar): { group: ReadonlySet<string>; value: ReadonlySet<string> }[] {
  const out: { group: ReadonlySet<string>; value: ReadonlySet<string> }[] = [];
  if (g.genders?.length) {
    const names = { m: 'masculine', f: 'feminine', n: 'neuter' } as const;
    out.push({ group: new Set(['masculine', 'feminine', 'neuter']), value: new Set(g.genders.map((x) => names[x])) });
  }
  if (g.animacy) {
    const group = new Set(['animate', 'inanimate', 'person', 'animal-not-person', 'personal']);
    // Any single animacy tag consistent with the entry animacy is redundant.
    const vals = g.animacy === 'inanimate' ? ['inanimate'] : ['animate', 'person', 'animal-not-person', 'personal'];
    for (const v of vals) out.push({ group, value: new Set([v]) });
  }
  if (g.aspect === 'imperfective' || g.aspect === 'perfective') {
    out.push({ group: new Set(['imperfective', 'perfective']), value: new Set([g.aspect]) });
  }
  if (g.aspect === 'biaspectual') out.push({ group: new Set(['imperfective', 'perfective']), value: new Set(['imperfective', 'perfective']) });
  return out;
}

function liftEntryTags(senses: Sense[], into: string[]): void {
  const nodes: Sense[] = [];
  walkSenses(senses, (s) => {
    if (!s.headerOnly && !s.formOf) nodes.push(s);
  });
  if (!nodes.length) return;
  for (const tag of ENTRY_LEVEL_TAGS) {
    if (!nodes.every((s) => s.tags?.includes(tag))) continue;
    if (!into.includes(tag)) into.push(tag);
    walkSenses(senses, (s) => {
      if (!s.tags) return;
      s.tags = s.tags.filter((t) => t !== tag);
      if (!s.tags.length) delete s.tags;
    });
  }
}

function senseRelationKeys(senses: Sense[]): Map<RelationType, Set<string>> {
  const m = new Map<RelationType, Set<string>>();
  walkSenses(senses, (s) => {
    if (!s.relations) return;
    for (const [type, list] of Object.entries(s.relations) as [RelationType, RelatedTerm[]][]) {
      let set = m.get(type);
      if (!set) m.set(type, (set = new Set()));
      for (const t of list ?? []) set.add(searchKey(t.word));
    }
  });
  return m;
}

/**
 * Transform one parsed kaikki line. `line` is the 1-based line number in the JSONL file.
 * Pure function (apart from optional statistics collection).
 */
export function transformKaikkiEntry(raw: any, line: number, stats?: TransformStats): TransformResult {
  const word = String(raw?.word ?? '').trim();
  const kaikkiPos = String(raw?.pos ?? '');
  const pos = mapKaikkiPos(kaikkiPos);
  const rawSenses: any[] = (Array.isArray(raw?.senses) ? raw.senses : []).map(inferFormOf);
  if (raw && Array.isArray(raw.senses)) raw = { ...raw, senses: rawSenses };

  if (isInflectedFormOnly(rawSenses)) {
    return { kind: 'ignored', ignored: ignoredEntry(raw, word, kaikkiPos, pos, line) };
  }

  const key = searchKey(word);
  const info = headInfo(raw, word);

  // paradigm
  const pb = buildParadigm(Array.isArray(raw.forms) ? raw.forms : [], word);
  if (stats) {
    stats.tableForms += pb.tableForms;
    stats.unmappedForms += pb.unmapped.length;
    for (const k of pb.unmapped) stats.unmapped.set(k, (stats.unmapped.get(k) ?? 0) + 1);
  }
  const paradigm = pb.paradigm;
  const hasSingularCells = paradigm
    ? Object.keys(paradigm.forms).some((s) => s.endsWith('.sg') || /\.(m|n|f)(\.|$)/.test(s))
    : undefined;

  const grammar = entryGrammar(raw, pos, info, hasSingularCells);

  // head forms
  const hf = classifyHeadForms(raw, pos, key);
  const extraForms: ExtraForm[] = [];
  const inTable = paradigmFormSet(paradigm);
  const seenExtra = new Set<string>();
  for (const it of hf.inflected) {
    if (it.degree && paradigm?.kind === 'adjectival') {
      addToParadigm(paradigm, it.degree, it.form, it.tags.filter((t) => t !== 'comparative' && t !== 'superlative'));
      continue;
    }
    if (!it.degree && inTable.has(searchKey(it.form))) continue;
    const k = `${stressedKey(it.form)}|${it.tags.join(',')}`;
    if (seenExtra.has(k)) continue;
    seenExtra.add(k);
    extraForms.push({ form: it.form, tags: [...it.tags], origin: 'head' });
  }

  // senses
  const dropTags = new Set<string>();
  if (grammar.number === 'plural-only') {
    dropTags.add('plural-only');
    dropTags.add('plural');
  }
  if (grammar.number === 'singular-only') dropTags.add('singular-only');
  const sb = buildSenses(rawSenses, { pos, headKey: key, headerGroups: headerGroups(grammar), dropTags });
  const senses = sb.senses;

  // entry tags
  const tags = [...grammar.tags];
  liftEntryTags(senses, tags);

  // relations
  const rel: Relations = collectRelations(raw);
  mergeRelationsInto(rel, hf.relations);
  mergeRelationsInto(rel, sb.lifted);
  const relations = removeSenseDuplicates(collapseRelations(rel, key), senseRelationKeys(senses));

  const pronunciation = buildPronunciation(raw.sounds);

  if (!senses.length && !paradigm && !relations && !pronunciation) {
    return {
      kind: 'ignored',
      ignored: {
        word,
        kaikkiPos,
        pos,
        reason: 'no-senses',
        formOf: [],
        glosses: [],
        line,
        url: wiktionaryUrl(word),
      },
    };
  }

  const draft: DraftEntry = {
    word,
    key,
    heads: info.heads,
    pos,
    senses,
    sources: entrySources(word),
    origin: { source: 'kaikki-uk', line, kaikkiPos },
  };
  if (tags.length) draft.tags = sortTags(tags);
  if (grammar.genders) draft.genders = grammar.genders;
  if (grammar.animacy) draft.animacy = grammar.animacy;
  if (grammar.number) draft.number = grammar.number;
  if (grammar.aspect) draft.aspect = grammar.aspect;
  if (hf.aspectPartners.length) draft.aspectPartners = hf.aspectPartners;
  if (paradigm) draft.paradigm = paradigm;
  if (extraForms.length) draft.extraForms = extraForms;
  if (pronunciation) draft.pronunciation = pronunciation;
  if (relations) draft.relations = relations;
  const etym = Number(raw.etymology_number); // a string ("2") in the kaikki data
  if (raw.etymology_number != null && Number.isFinite(etym) && etym > 0) draft.origin.etymologyNumber = etym;
  // Stable key order for readability of debug output.
  return { kind: 'entry', draft: orderDraft(draft) };
}

const DRAFT_KEY_ORDER = [
  'word',
  'key',
  'heads',
  'pos',
  'tags',
  'genders',
  'animacy',
  'number',
  'aspect',
  'aspectPartners',
  'senses',
  'paradigm',
  'extraForms',
  'pronunciation',
  'relations',
  'sources',
  'origin',
];

function orderDraft(d: DraftEntry): DraftEntry {
  const out: Record<string, unknown> = {};
  for (const k of DRAFT_KEY_ORDER) if ((d as any)[k] !== undefined) out[k] = (d as any)[k];
  for (const k of Object.keys(d)) if (!(k in out)) out[k] = (d as any)[k];
  return out as DraftEntry;
}

/** Parse + transform one JSONL line. */
export function transformKaikkiLine(line: string, lineNo: number, stats?: TransformStats): TransformResult {
  return transformKaikkiEntry(JSON.parse(line), lineNo, stats);
}

export { cleanWordRef, RELATION_ORDER };
