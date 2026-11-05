/**
 * kaikki table forms (`forms[]` with a `source`) → `Paradigm` with the shared slot vocabulary (paradigm.ts).
 *
 * The `source` label ("declension"/"conjugation"/"inflection") is not reliable (verbs with source "declension"
 * exist), so the table kind is decided from the tags themselves.
 */
import type { Form, Paradigm, ParadigmKind, SlotKey } from '@ukdict/shared';
import { ADJ_SLOTS, DEGREE_SLOTS, NOUN_SLOTS, VERB_SLOTS, hasCyrillic, hasLatin, stripStress } from '@ukdict/shared';
import {
  CASE_TAG,
  DROP_FORM_TAGS,
  GENDER_TAG,
  IGNORED_DIMENSION_TAGS,
  META_FORM_TAGS,
  PERSON_TAG,
  VERB_FORM_TAGS,
  hasAny,
  isJunkTag,
} from './tags.ts';

export interface RawForm {
  form: string;
  tags?: string[];
  source?: string;
}

export interface ParadigmBuild {
  paradigm?: Paradigm;
  /** "<source>:<sorted,tags>" of table forms that could not be mapped to a slot. */
  unmapped: string[];
  /** Number of real (non-meta, non-placeholder) table forms seen. */
  tableForms: number;
}

const SLOT_ORDER: readonly SlotKey[] = [...NOUN_SLOTS, ...ADJ_SLOTS, ...DEGREE_SLOTS, ...VERB_SLOTS];
const SLOT_RANK = new Map<SlotKey, number>(SLOT_ORDER.map((s, i) => [s, i]));

const PLACEHOLDERS = new Set(['-', '—', '–', '―', '']);
const IMPERSONAL_PREFIX = /^impersonal:\s*/;
const CASE_SET = new Set(Object.keys(CASE_TAG));
const GENDER_SET = new Set(Object.keys(GENDER_TAG));
const PERSON_SET = new Set(Object.keys(PERSON_TAG));
const PRONOUN_SIG_TAGS = new Set([
  'first-person',
  'second-person',
  'third-person',
  'singular',
  'plural',
  'masculine',
  'feminine',
  'neuter',
  'formal',
  'informal',
  'reflexive',
]);
/** Consumed silently in personal-pronoun tables. */
const PRONOUN_TABLE_TAGS = new Set([...PRONOUN_SIG_TAGS, 'personal', 'pronoun']);

/** Clean a form string; returns undefined for placeholders / romanizations / garbage. */
export function cleanFormText(form: string, allowLatin = false): { text: string; impersonal: boolean } | undefined {
  let text = (form ?? '').trim();
  let impersonal = false;
  if (IMPERSONAL_PREFIX.test(text)) {
    impersonal = true;
    text = text.replace(IMPERSONAL_PREFIX, '');
  }
  text = text.replace(/\s+/g, ' ').trim();
  if (PLACEHOLDERS.has(text) || !hasCyrillic(text) || (!allowLatin && hasLatin(text))) return undefined;
  return { text, impersonal };
}

interface Cell {
  text: string;
  impersonal: boolean;
  tags: string[];
  source: string;
}

interface Ctx {
  kind: ParadigmKind;
  /** Adjectival table whose plural is not distinctive (cardinal numerals два/оба: gendered plural forms). */
  pluralNonDistinctive: boolean;
  /** Biaspectual verb table: person forms tagged "future" are the present/simple-future column, untagged ones the synthetic future. */
  biaspectualLayout: boolean;
  /** Personal-pronoun table: number of the kept column. */
  pronounNumber?: 'sg' | 'pl';
}

interface SlotMapping {
  slots: SlotKey[];
  /** Remaining (qualifier) tags. */
  rest: string[];
}

function restTags(tags: readonly string[], consumed: ReadonlySet<string>, extraConsumed?: ReadonlySet<string>): string[] {
  return tags.filter((t) => !consumed.has(t) && !extraConsumed?.has(t) && !IGNORED_DIMENSION_TAGS.has(t) && !isJunkTag(t));
}

function caseOf(tags: readonly string[]): string | undefined {
  for (const t of tags) if (CASE_TAG[t]) return CASE_TAG[t];
  return undefined;
}

function mapNoun(tags: readonly string[], ctx: Ctx): SlotMapping | undefined {
  const c = caseOf(tags);
  if (!c) return undefined;
  let num: 'sg' | 'pl' | undefined = tags.includes('plural') ? 'pl' : tags.includes('singular') ? 'sg' : undefined;
  if (ctx.pronounNumber) {
    num = ctx.pronounNumber;
    return { slots: [`${c}.${num}`], rest: restTags(tags, CASE_SET, PRONOUN_TABLE_TAGS) };
  }
  if (!num) return undefined;
  const consumed = new Set([...CASE_SET, 'singular', 'plural']);
  return { slots: [`${c}.${num}`], rest: restTags(tags, consumed) };
}

function mapAdjectival(tags: readonly string[], ctx: Ctx): SlotMapping | undefined {
  const genders = tags.filter((t) => GENDER_SET.has(t)).map((t) => GENDER_TAG[t]);
  const consumed = new Set<string>([...CASE_SET, ...GENDER_SET, 'singular', 'plural']);
  if (tags.includes('short-form')) {
    consumed.add('short-form');
    if (genders.length === 0 || (genders.length === 1 && genders[0] === 'm')) return { slots: ['short.m'], rest: restTags(tags, consumed) };
    return undefined;
  }
  const c = caseOf(tags);
  if (!c) return undefined;
  const plural = tags.includes('plural');
  let cols: string[];
  if (ctx.pluralNonDistinctive) cols = genders.length ? genders : ['m', 'n', 'f'];
  else if (plural) cols = ['pl'];
  else if (genders.length) cols = genders;
  else return undefined;
  let anim = '';
  if (c === 'acc') {
    if (tags.includes('animate')) anim = '.anim';
    else if (tags.includes('inanimate')) anim = '.inan';
    consumed.add('animate');
    consumed.add('inanimate');
  }
  return { slots: cols.map((col) => `${c}.${col}${anim}`), rest: restTags(tags, consumed) };
}

function personNumber(tags: readonly string[]): string | undefined {
  let p: string | undefined;
  for (const t of tags) if (PERSON_TAG[t]) p = PERSON_TAG[t];
  const n = tags.includes('plural') ? 'pl' : tags.includes('singular') ? 'sg' : undefined;
  if (!p || !n) return undefined;
  return `${p}${n}`;
}

function mapVerb(tags: readonly string[], impersonal: boolean, ctx: Ctx): SlotMapping | undefined {
  const consumed = new Set<string>([...VERB_FORM_TAGS, ...GENDER_SET, 'singular', 'plural', 'impersonal']);
  const rest = () => restTags(tags, consumed);
  if (impersonal) return { slots: ['impers'], rest: rest() };
  if (tags.includes('infinitive')) return { slots: ['inf'], rest: rest() };
  const tense = tags.includes('present') ? 'pres' : tags.includes('past') ? 'past' : tags.includes('future') ? 'fut' : undefined;
  if (tags.includes('adverbial')) {
    if (tense === 'pres' || tense === 'past') return { slots: [`advp.${tense}`], rest: rest() };
    return undefined;
  }
  if (tags.includes('active') || tags.includes('passive')) {
    const voice = tags.includes('active') ? 'act' : 'pass';
    if (tense === 'pres' || tense === 'past') return { slots: [`ptcp.${voice}.${tense}`], rest: rest() };
    return undefined;
  }
  if (tags.includes('imperative')) {
    let p = '2';
    for (const t of tags) if (PERSON_TAG[t]) p = PERSON_TAG[t];
    const n = tags.includes('plural') ? 'pl' : 'sg';
    const slot = `imp.${p}${n}`;
    if (!VERB_SLOTS.includes(slot)) return undefined;
    return { slots: [slot], rest: rest() };
  }
  if (hasAny(tags, PERSON_SET)) {
    const pn = personNumber(tags);
    if (!pn) return undefined;
    let t: 'pres' | 'fut' | undefined;
    if (tense === 'pres') t = 'pres';
    else if (tense === 'fut') t = ctx.biaspectualLayout ? 'pres' : 'fut';
    else if (!tense && ctx.biaspectualLayout) t = 'fut';
    if (!t) return undefined;
    return { slots: [`${t}.${pn}`], rest: rest() };
  }
  if (tense === 'past') {
    if (tags.includes('plural')) return { slots: ['past.pl'], rest: rest() };
    const g = tags.find((x) => GENDER_SET.has(x));
    if (g) return { slots: [`past.${GENDER_TAG[g]}`], rest: rest() };
    return undefined;
  }
  return undefined;
}

function isVerbCell(tags: readonly string[]): boolean {
  return hasAny(tags, VERB_FORM_TAGS) && !hasAny(tags, CASE_SET);
}

function addForm(forms: Map<SlotKey, Form[]>, slot: SlotKey, text: string, qualifiers: string[]): void {
  let list = forms.get(slot);
  if (!list) forms.set(slot, (list = []));
  const tags = qualifiers.length ? [...new Set(qualifiers)].sort() : undefined;
  const sameText = list.filter((f) => f.form === text);
  if (sameText.some((f) => !f.tags)) return; // plain variant already present
  if (!tags) {
    // plain variant supersedes qualified duplicates
    for (const f of sameText) list.splice(list.indexOf(f), 1);
    list.push({ form: text });
    return;
  }
  const key = tags.join(',');
  if (sameText.some((f) => (f.tags ?? []).join(',') === key)) return;
  list.push({ form: text, tags });
}

function finalizeForms(forms: Map<SlotKey, Form[]>): Partial<Record<SlotKey, Form[]>> {
  const out: Partial<Record<SlotKey, Form[]>> = {};
  const slots = [...forms.keys()].sort((a, b) => (SLOT_RANK.get(a) ?? 1e9) - (SLOT_RANK.get(b) ?? 1e9));
  for (const s of slots) {
    const list = forms.get(s)!;
    if (!list.length) continue;
    // plain variants first, stable otherwise
    out[s] = [...list.filter((f) => !f.tags), ...list.filter((f) => f.tags)];
  }
  return out;
}

const tagKey = (f: RawForm) => `${f.source ?? ''}:${[...(f.tags ?? [])].sort().join(',')}`;

/** Build the paradigm of an entry from its `forms[]` (only those with a `source`). */
export function buildParadigm(rawForms: readonly RawForm[] | undefined, word: string): ParadigmBuild {
  const unmapped: string[] = [];
  const templates: string[] = [];
  const classes: string[] = [];
  let cells: Cell[] = [];
  const allowLatin = hasLatin(word); // e.g. "QR-код"
  for (const f of rawForms ?? []) {
    if (!f || !f.source || typeof f.form !== 'string') continue;
    const tags = Array.isArray(f.tags) ? f.tags : [];
    if (tags.includes('inflection-template')) {
      if (f.form && !templates.includes(f.form)) templates.push(f.form);
      continue;
    }
    if (tags.includes('class')) {
      if (f.form && !classes.includes(f.form)) classes.push(f.form);
      continue;
    }
    if (hasAny(tags, META_FORM_TAGS) || hasAny(tags, DROP_FORM_TAGS)) continue;
    const cleaned = cleanFormText(f.form, allowLatin);
    if (!cleaned) continue;
    cells.push({ text: cleaned.text, impersonal: cleaned.impersonal, tags, source: f.source });
  }
  const tableForms = cells.length;
  if (!cells.length) return { unmapped, tableForms };

  let verbCells = 0;
  let caseCells = 0;
  for (const c of cells) {
    if (c.impersonal || isVerbCell(c.tags)) verbCells++;
    else if (hasAny(c.tags, CASE_SET) || c.tags.includes('short-form')) caseCells++;
  }

  const ctx: Ctx = { kind: 'noun', pluralNonDistinctive: false, biaspectualLayout: false };
  if (verbCells > caseCells) {
    ctx.kind = 'verb';
    ctx.biaspectualLayout = cells.some(
      (c) => isVerbCell(c.tags) && hasAny(c.tags, PERSON_SET) && !c.tags.includes('imperative') && !c.tags.some((t) => t === 'present' || t === 'past' || t === 'future'),
    );
  } else if (cells.some((c) => c.tags.includes('personal') && c.tags.includes('pronoun'))) {
    // Personal-pronoun page: keep only the column of the entry's own nominative.
    const own = cells.filter((c) => stripStress(c.text) === word);
    const ownCi = own.length ? own : cells.filter((c) => stripStress(c.text).toLowerCase() === word.toLowerCase());
    const pick = ownCi.find((c) => c.tags.includes('nominative')) ?? ownCi[0];
    if (!pick) {
      unmapped.push('declension:personal-pronoun-without-own-column');
      return { unmapped, tableForms };
    }
    const sig = (tags: readonly string[]) => tags.filter((t) => PRONOUN_SIG_TAGS.has(t)).sort().join(',');
    const want = sig(pick.tags);
    cells = cells.filter((c) => sig(c.tags) === want);
    ctx.kind = 'noun';
    ctx.pronounNumber = pick.tags.includes('plural') ? 'pl' : 'sg';
  } else {
    const caseCellsList = cells.filter((c) => hasAny(c.tags, CASE_SET) || c.tags.includes('short-form'));
    const gendered = caseCellsList.some((c) => hasAny(c.tags, GENDER_SET));
    // Adjectival templates (uk-adecl*) without gendered cells: plural-only numerals such as п'ять.
    if (gendered || templates.some((t) => t.includes('adecl'))) {
      ctx.kind = 'adjectival';
      ctx.pluralNonDistinctive =
        !caseCellsList.some((c) => c.tags.includes('singular')) &&
        caseCellsList.some((c) => c.tags.includes('plural') && hasAny(c.tags, GENDER_SET));
    } else ctx.kind = 'noun';
  }

  const forms = new Map<SlotKey, Form[]>();
  for (const c of cells) {
    let m: SlotMapping | undefined;
    if (ctx.kind === 'verb') m = c.impersonal || isVerbCell(c.tags) ? mapVerb(c.tags, c.impersonal, ctx) : undefined;
    else if (ctx.kind === 'adjectival') m = mapAdjectival(c.tags, ctx);
    else m = mapNoun(c.tags, ctx);
    if (!m || !m.slots.length) {
      unmapped.push(tagKey({ form: c.text, tags: c.tags, source: c.source }));
      continue;
    }
    for (const s of m.slots) addForm(forms, s, c.text, m.rest);
  }
  if (!forms.size) return { unmapped, tableForms };
  const notes = [...classes, ...templates];
  const paradigm: Paradigm = { kind: ctx.kind, forms: finalizeForms(forms), source: 'wiktionary' };
  if (notes.length) paradigm.notes = notes;
  return { paradigm, unmapped, tableForms };
}

/** Put a form into an existing paradigm slot (used for cmp/sup head forms). */
export function addToParadigm(p: Paradigm, slot: SlotKey, text: string, qualifiers: string[]): void {
  const m = new Map<SlotKey, Form[]>(Object.entries(p.forms).map(([k, v]) => [k, [...(v ?? [])]]));
  addForm(m, slot, text, qualifiers);
  p.forms = finalizeForms(m);
}

/** All forms of a paradigm (for "already in the table?" checks). */
export function paradigmFormSet(p: Paradigm | undefined): Set<string> {
  const s = new Set<string>();
  if (!p) return s;
  for (const list of Object.values(p.forms)) for (const f of list ?? []) s.add(stripStress(f.form).toLowerCase());
  return s;
}
