/**
 * Closed vocabulary of paradigm slot keys, shared by pipeline (producers: kaikki + lcorp parsers)
 * and web app (table layouts, "matched form" labels).
 *
 * Slot key grammar
 * ----------------
 * noun (kind 'noun'):            `${case}.${'sg'|'pl'}`                       e.g. "gen.pl"
 * adjectival (kind 'adjectival'): `${case}.${'m'|'n'|'f'|'pl'}`               e.g. "dat.f"
 *                                accusative split by animacy (when the source distinguishes):
 *                                `acc.${'m'|'n'|'f'|'pl'}.${'anim'|'inan'}` e.g. "acc.m.anim"
 *                                short form: "short.m"
 * degree (noun/adjectival/adverb): "cmp" (comparative), "sup" (superlative)
 * verb (kind 'verb'):            see VERB_SLOTS
 *
 * Personal pronouns and cardinal numerals are expressed with the noun or adjectival grammar
 * (e.g. "я" → noun slots "nom.sg"…; "два" → adjectival slots "nom.m","nom.n","nom.f").
 */
import type { SlotKey } from './types.ts';

export const CASES = ['nom', 'gen', 'dat', 'acc', 'ins', 'loc', 'voc'] as const;
export type CaseKey = (typeof CASES)[number];

/** Traditional Ukrainian case order (називний, родовий, давальний, знахідний, орудний, місцевий, кличний). */
export const CASE_ORDER_TRADITIONAL: readonly CaseKey[] = ['nom', 'gen', 'dat', 'acc', 'ins', 'loc', 'voc'];
/**
 * "Syncretism-friendly" order (as used in many pedagogical grammars): accusative sits between nominative and
 * genitive, so acc=nom (inanimate) and acc=gen (animate) become adjacent rows and can be shown as merged cells.
 * Default in the UI; user can switch to the traditional order.
 */
export const CASE_ORDER_GROUPED: readonly CaseKey[] = ['nom', 'acc', 'gen', 'dat', 'ins', 'loc', 'voc'];

export const CASE_LABELS: Record<CaseKey, { en: string; abbr: string; uk: string }> = {
  nom: { en: 'nominative', abbr: 'nom.', uk: 'називний' },
  gen: { en: 'genitive', abbr: 'gen.', uk: 'родовий' },
  dat: { en: 'dative', abbr: 'dat.', uk: 'давальний' },
  acc: { en: 'accusative', abbr: 'acc.', uk: 'знахідний' },
  ins: { en: 'instrumental', abbr: 'ins.', uk: 'орудний' },
  loc: { en: 'locative', abbr: 'loc.', uk: 'місцевий' },
  voc: { en: 'vocative', abbr: 'voc.', uk: 'кличний' },
};

export const NOUN_NUMBERS = ['sg', 'pl'] as const;
export const ADJ_COLUMNS = ['m', 'n', 'f', 'pl'] as const;
export type AdjColumn = (typeof ADJ_COLUMNS)[number];

export const NOUN_SLOTS: readonly SlotKey[] = CASES.flatMap((c) => NOUN_NUMBERS.map((n) => `${c}.${n}`));

export const ADJ_SLOTS: readonly SlotKey[] = [
  ...CASES.flatMap((c) => ADJ_COLUMNS.map((g) => `${c}.${g}`)),
  ...ADJ_COLUMNS.flatMap((g) => [`acc.${g}.anim`, `acc.${g}.inan`]),
  'short.m',
];

export const DEGREE_SLOTS: readonly SlotKey[] = ['cmp', 'sup'];

export const PERSONS = ['1sg', '2sg', '3sg', '1pl', '2pl', '3pl'] as const;

export const VERB_SLOTS: readonly SlotKey[] = [
  'inf',
  ...PERSONS.map((p) => `pres.${p}`),
  ...PERSONS.map((p) => `fut.${p}`), // synthetic future (impf "співатиму") or simple future (pf "заспіваю")
  'past.m',
  'past.f',
  'past.n',
  'past.pl',
  'imp.1sg',
  'imp.1pl',
  'imp.2sg',
  'imp.2pl',
  'ptcp.act.pres',
  'ptcp.act.past',
  'ptcp.pass.pres',
  'ptcp.pass.past',
  'impers', // impersonal -но/-то form, e.g. "співано"
  'advp.pres', // adverbial participle (дієприслівник), present, e.g. "співаючи"
  'advp.past', // adverbial participle, past, e.g. "співавши"
];

export const ALL_SLOTS: ReadonlySet<SlotKey> = new Set([...NOUN_SLOTS, ...ADJ_SLOTS, ...DEGREE_SLOTS, ...VERB_SLOTS]);

export function isKnownSlot(slot: string): boolean {
  return ALL_SLOTS.has(slot);
}

const GENDER_LABEL: Record<string, string> = { m: 'masculine', n: 'neuter', f: 'feminine', pl: 'plural', sg: 'singular' };
const PERSON_LABEL: Record<string, string> = {
  '1sg': '1st person singular',
  '2sg': '2nd person singular',
  '3sg': '3rd person singular',
  '1pl': '1st person plural',
  '2pl': '2nd person plural',
  '3pl': '3rd person plural',
};

/** Human-readable English description of a slot, e.g. "genitive plural", "1st person singular present". */
export function describeSlot(slot: SlotKey): string {
  const parts = slot.split('.');
  const head = parts[0];
  if ((CASES as readonly string[]).includes(head)) {
    const c = CASE_LABELS[head as CaseKey].en;
    const g = GENDER_LABEL[parts[1]] ?? parts[1];
    const anim = parts[2] === 'anim' ? ' (animate)' : parts[2] === 'inan' ? ' (inanimate)' : '';
    return `${c} ${g}${anim}`;
  }
  switch (head) {
    case 'short':
      return 'short form (masculine)';
    case 'cmp':
      return 'comparative';
    case 'sup':
      return 'superlative';
    case 'inf':
      return 'infinitive';
    case 'pres':
      return `${PERSON_LABEL[parts[1]]} present`;
    case 'fut':
      return `${PERSON_LABEL[parts[1]]} future`;
    case 'past':
      return `past ${GENDER_LABEL[parts[1]]}`;
    case 'imp':
      return `${PERSON_LABEL[parts[1]]} imperative`;
    case 'ptcp':
      return `${parts[1] === 'act' ? 'active' : 'passive'} ${parts[2]} participle`;
    case 'impers':
      return 'impersonal form';
    case 'advp':
      return `${parts[1]} adverbial participle`;
    default:
      return slot;
  }
}
