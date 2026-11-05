/**
 * kaikki senses → `Sense` tree (gloss hierarchy), with cleaned tags, gloss links, form-of/alt-of refs,
 * examples and sense-level relations.
 */
import type { Example, GlossLink, PartOfSpeech, RelationType, Relations, Sense, WordRef } from '@ukdict/shared';
import { hasCyrillic, searchKey, sortTags } from '@ukdict/shared';
import { collapseRelations, collectRelations } from './relations.ts';
import { INFLECTIONAL_TAGS, POS_RESTATING_TAGS, QUALIFIER_TAGS, isJunkTag } from './tags.ts';

export interface SenseContext {
  pos: PartOfSpeech;
  /** searchKey of the headword (relations equal to it are dropped). */
  headKey: string;
  /**
   * Tag groups shown in the entry header. A sense's tags of one group are dropped when they equal the group
   * exactly (e.g. entry m inan + sense "masculine, inanimate" → dropped; entry m/f + sense "feminine" → kept).
   */
  headerGroups: ReadonlyArray<{ group: ReadonlySet<string>; value: ReadonlySet<string> }>;
  /** Tags removed from every sense (e.g. "plural-only"/"plural" for pluralia tantum entries). */
  dropTags: ReadonlySet<string>;
}

export interface SenseBuild {
  senses: Sense[];
  /** Relations of gloss-less senses (e.g. Thesaurus pseudo-entries), to be lifted to entry level. */
  lifted: Relations;
}

const ARTIFACT_EXAMPLE =
  /^(Near-synonyms?|Synonyms?|Antonyms?|Coordinate terms?|Holonyms?|Meronyms?|Hypernyms?|Hyponyms?|For quotations[^:]*|Examples?|See also|Compare)\b/i;
const TRAILING_GRAMMAR = /\s+(pf|impf|m|f|n|pl|sg|anim|inan|pers)\.?$/;
const CYR_WORD = "[\\u0400-\\u04FF\\u0300\\u0301'ʼ’\\-]+";
const EXTRA_OF_RE = new RegExp(`\\bof\\s+(${CYR_WORD}(?:\\s+${CYR_WORD})*)`, 'gu');

/** Strip trailing grammar tokens ("ску́чити pf", "коло́на f") and anchors from a form-of/alt-of target. */
export function cleanWordRef(word: unknown): string {
  let w = typeof word === 'string' ? word.replace(/#.*$/, '').replace(/\s+/g, ' ').trim() : '';
  for (let i = 0; i < 3 && TRAILING_GRAMMAR.test(w); i++) w = w.replace(TRAILING_GRAMMAR, '').trim();
  return w;
}

function nonEmptyStrings(a: unknown): string[] {
  return Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()) : [];
}

const TAGLIKE_PART = /^[A-Za-z][A-Za-z -]*$/;
/** "(uncountable)", "(rare, vulgar)" – a raw gloss that only repeats labels. */
function isPureLabelGloss(text: string): boolean {
  const m = /^\(([^()]*)\)$/.exec(text.trim());
  if (!m) return false;
  return m[1].split(/,\s*/).every((p) => TAGLIKE_PART.test(p) && p.split(' ').length <= 3);
}

/** Glosses of a sense: `glosses`, else usable `raw_glosses`. */
export function senseGlosses(s: any): string[] {
  const g = nonEmptyStrings(s?.glosses);
  if (g.length) return g;
  const raw = nonEmptyStrings(s?.raw_glosses).filter((x) => !isPureLabelGloss(x));
  return raw.map((x) => (/^\(.*\)$/.test(x) && x.split(' ').length >= 4 && !isPureLabelGloss(x) ? x.slice(1, -1).trim() : x));
}

/** Gloss words of an inflection description ("first-person singular synthetic future … of X") → tag (or null = no tag). */
const INFLECTION_GLOSS_WORDS: Record<string, string | null> = {
  'first-person': 'first-person',
  'second-person': 'second-person',
  'third-person': 'third-person',
  singular: 'singular',
  plural: 'plural',
  present: 'present',
  past: 'past',
  future: 'future',
  indicative: 'indicative',
  imperative: 'imperative',
  conditional: 'conditional',
  imperfective: 'imperfective',
  perfective: 'perfective',
  infinitive: 'infinitive',
  nominative: 'nominative',
  genitive: 'genitive',
  dative: 'dative',
  accusative: 'accusative',
  instrumental: 'instrumental',
  locative: 'locative',
  vocative: 'vocative',
  masculine: 'masculine',
  feminine: 'feminine',
  neuter: 'neuter',
  animate: 'animate',
  inanimate: 'inanimate',
  passive: 'passive',
  active: 'active',
  participle: 'participle',
  adverbial: 'adverbial',
  comparative: 'comparative',
  superlative: 'superlative',
  impersonal: 'impersonal',
  short: 'short-form',
  synthetic: null,
  degree: null,
  form: null,
  and: null,
};
const INFLECTION_GLOSS_RE = /^([a-z/ -]+?) of ([Ѐ-ӿ̀́'ʼ’-]+)(?=$|[\s,:;(])/u;

/**
 * Some inflected-form senses lack `form_of` in the kaikki data ("short infinitive of ли́ти (lýty)",
 * "genitive/vocative singular of фестива́ль"). Recognize them from the gloss and return a copy of the sense with
 * synthetic `form_of` + tags, so that DECISIONS item 1 applies uniformly. Other senses are returned unchanged.
 */
export function inferFormOf(s: any): any {
  if (!s || typeof s !== 'object' || isFormOfSense(s) || (Array.isArray(s.alt_of) && s.alt_of.length)) return s;
  const g = nonEmptyStrings(s.glosses);
  if (g.length !== 1) return s;
  const m = INFLECTION_GLOSS_RE.exec(g[0]);
  if (!m) return s;
  const tags: string[] = [];
  for (const w of m[1].split(/[ /]+/)) {
    if (!(w in INFLECTION_GLOSS_WORDS)) return s;
    const t = INFLECTION_GLOSS_WORDS[w];
    if (t && !tags.includes(t)) tags.push(t);
  }
  if (!tags.some((t) => INFLECTIONAL_TAGS.has(t))) return s;
  const word = cleanWordRef(m[2]);
  if (!hasCyrillic(word)) return s;
  const oldTags: string[] = Array.isArray(s.tags) ? s.tags : [];
  return { ...s, tags: [...new Set([...oldTags, 'form-of', ...tags])].sort(), form_of: [{ word }] };
}

export function isFormOfSense(s: any): boolean {
  return (Array.isArray(s?.form_of) && s.form_of.length > 0) || (Array.isArray(s?.tags) && s.tags.includes('form-of'));
}

/** DECISIONS item 1: every sense is a form-of sense with an inflectional category. */
export function isInflectedFormOnly(rawSenses: readonly any[]): boolean {
  return (
    rawSenses.length > 0 &&
    rawSenses.every((s) => isFormOfSense(s) && Array.isArray(s.tags) && s.tags.some((t: string) => INFLECTIONAL_TAGS.has(t)))
  );
}

/** Grammatical tags of a form-of sense (structural tags and usage qualifiers removed). */
export function formOfTags(s: any): string[] {
  return (Array.isArray(s?.tags) ? (s.tags as string[]) : []).filter((t) => !isJunkTag(t) && !QUALIFIER_TAGS.has(t));
}

/** WordRefs of form_of / alt_of items, including extra "of X" targets mentioned in `extra`. */
export function wordRefs(items: unknown, tags: readonly string[]): WordRef[] {
  if (!Array.isArray(items)) return [];
  const out: WordRef[] = [];
  const seen = new Set<string>();
  const push = (w: string) => {
    const k = searchKey(w);
    if (!w || !hasCyrillic(w) || seen.has(k)) return;
    seen.add(k);
    out.push(tags.length ? { word: w, tags: [...tags] } : { word: w });
  };
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    push(cleanWordRef((it as any).word));
    const extra = (it as any).extra;
    if (typeof extra === 'string') for (const m of extra.matchAll(EXTRA_OF_RE)) push(cleanWordRef(m[1]));
  }
  return out;
}

/** Locate Cyrillic link texts in the gloss → non-overlapping UTF-16 spans. */
export function locateLinks(gloss: string, links: unknown, extraTargets: readonly string[] = []): GlossLink[] {
  const out: GlossLink[] = [];
  const overlaps = (s: number, e: number) => out.some((l) => s < l.end && e > l.start);
  const place = (text: string, target: string) => {
    if (!text) return;
    let from = 0;
    while (from <= gloss.length) {
      const idx = gloss.indexOf(text, from);
      if (idx === -1) return;
      const end = idx + text.length;
      if (!overlaps(idx, end)) {
        out.push({ start: idx, end, target });
        return;
      }
      from = idx + 1;
    }
  };
  if (Array.isArray(links)) {
    for (const pair of links) {
      if (!Array.isArray(pair) || typeof pair[0] !== 'string') continue;
      const text = pair[0];
      if (!hasCyrillic(text)) continue;
      const target = (typeof pair[1] === 'string' ? pair[1] : '').replace(/#.*$/, '').trim() || text;
      if (!hasCyrillic(target)) continue;
      if (out.some((l) => gloss.slice(l.start, l.end) === text && l.target === target)) continue;
      place(text, target);
    }
  }
  for (const t of extraTargets) if (!out.some((l) => gloss.slice(l.start, l.end) === t)) place(t, t);
  return out.sort((a, b) => a.start - b.start);
}

export function convertExamples(items: unknown): Example[] {
  if (!Array.isArray(items)) return [];
  const out: Example[] = [];
  const seen = new Set<string>();
  for (const x of items) {
    if (!x || typeof x.text !== 'string') continue;
    const text = x.text.trim();
    if (!text || !hasCyrillic(text) || ARTIFACT_EXAMPLE.test(text) || seen.has(text)) continue;
    seen.add(text);
    const ex: Example = { text, source: 'wiktionary' };
    const tr = typeof x.english === 'string' ? x.english : typeof x.translation === 'string' ? x.translation : undefined;
    if (tr && tr.trim()) ex.translation = tr.trim();
    if (typeof x.ref === 'string' && x.ref.trim()) ex.ref = x.ref.trim();
    out.push(ex);
  }
  return out;
}

function cleanSenseTags(s: any, ctx: SenseContext, formOf: boolean, altOf: boolean): string[] {
  const restating = new Set(POS_RESTATING_TAGS[ctx.pos] ?? []);
  let tags = (Array.isArray(s?.tags) ? (s.tags as string[]) : []).filter(
    (t) => typeof t === 'string' && !isJunkTag(t) && !restating.has(t) && !ctx.dropTags.has(t),
  );
  for (const { group, value } of ctx.headerGroups) {
    const mine = tags.filter((t) => group.has(t));
    if (mine.length && mine.length === value.size && mine.every((t) => value.has(t))) tags = tags.filter((t) => !group.has(t));
  }
  if (tags.includes('plural-only')) tags = tags.filter((t) => t !== 'plural');
  if (formOf) tags = tags.filter((t) => !INFLECTIONAL_TAGS.has(t));
  if (altOf) tags = tags.filter((t) => t !== 'alternative');
  return sortTags([...new Set(tags)]);
}

interface Converted {
  path: string[];
  sense: Sense;
  links: unknown;
}

/** Convert one kaikki sense (no tree placement). Returns undefined (and fills `lifted`) for gloss-less senses. */
export function convertSense(s: any, ctx: SenseContext, lifted: Relations): Converted | undefined {
  const glosses = senseGlosses(s);
  const relations = collectRelations(s);
  if (!glosses.length) {
    for (const [type, list] of Object.entries(relations) as [RelationType, any[]][]) (lifted[type] ??= []).push(...list);
    return undefined;
  }
  const gloss = glosses[glosses.length - 1];
  const isFormOf = isFormOfSense(s);
  const isAltOf = Array.isArray(s.alt_of) && s.alt_of.length > 0;
  const sense: Sense = { gloss };
  const tags = cleanSenseTags(s, ctx, isFormOf, isAltOf);
  if (tags.length) sense.tags = tags;
  if (typeof s.qualifier === 'string' && s.qualifier.trim()) sense.qualifier = s.qualifier.trim();
  const topics = nonEmptyStrings(s.topics);
  if (topics.length) sense.topics = [...new Set(topics)];
  const refTags = formOfTags(s);
  const formOf = isFormOf ? wordRefs(s.form_of, refTags) : [];
  const altOf = isAltOf ? wordRefs(s.alt_of, refTags.filter((t) => t !== 'alternative')) : [];
  if (formOf.length) sense.formOf = formOf;
  if (altOf.length) sense.altOf = altOf;
  const links = locateLinks(gloss, s.links, [...formOf, ...altOf].map((r) => r.word));
  if (links.length) sense.links = links;
  const examples = convertExamples(s.examples);
  if (examples.length) sense.examples = examples;
  const rel = collapseRelations(relations, ctx.headKey);
  if (rel) sense.relations = rel;
  return { path: glosses.slice(0, -1), sense, links: s.links };
}

/**
 * Arrange converted senses into a tree following the gloss hierarchy. A shared parent gloss becomes a
 * `headerOnly` node, unless a real sense with exactly that gloss exists at that level (it becomes the parent).
 */
export function buildTree(items: readonly Converted[]): Sense[] {
  const roots: Sense[] = [];
  for (const { path, sense, links } of items) {
    let level = roots;
    for (const parent of path) {
      let node: Sense | undefined;
      for (let i = level.length - 1; i >= 0; i--) {
        if (level[i].gloss === parent) {
          node = level[i];
          break;
        }
      }
      if (!node) {
        node = { gloss: parent, headerOnly: true };
        const l = locateLinks(parent, links);
        if (l.length) node.links = l;
        level.push(node);
      }
      node.subsenses ??= [];
      level = node.subsenses;
    }
    const header = level.find((n) => n.headerOnly && n.gloss === sense.gloss);
    if (header) {
      const subs = header.subsenses;
      for (const k of Object.keys(header)) delete (header as any)[k];
      Object.assign(header, sense);
      if (subs?.length) header.subsenses = subs;
    } else level.push(sense);
  }
  return roots;
}

export function buildSenses(rawSenses: readonly any[], ctx: SenseContext): SenseBuild {
  const lifted: Relations = {};
  const items: Converted[] = [];
  for (const s of rawSenses) {
    const c = convertSense(s, ctx, lifted);
    if (c) items.push(c);
  }
  return { senses: buildTree(items), lifted };
}

/** Depth-first visit of every sense node. */
export function walkSenses(senses: readonly Sense[], fn: (s: Sense) => void): void {
  for (const s of senses) {
    fn(s);
    if (s.subsenses) walkSenses(s.subsenses, fn);
  }
}
