/**
 * Tag vocabulary of the kaikki (wiktextract) Ukrainian data, grouped by grammatical dimension.
 */
import type { CaseKey } from '@ukdict/shared';
import { STRUCTURAL_TAGS } from '@ukdict/shared';

export const CASE_TAG: Record<string, CaseKey> = {
  nominative: 'nom',
  genitive: 'gen',
  dative: 'dat',
  accusative: 'acc',
  instrumental: 'ins',
  locative: 'loc',
  vocative: 'voc',
};

export const GENDER_TAG: Record<string, 'm' | 'f' | 'n'> = { masculine: 'm', feminine: 'f', neuter: 'n' };

export const PERSON_TAG: Record<string, '1' | '2' | '3'> = { 'first-person': '1', 'second-person': '2', 'third-person': '3' };

export const NUMBER_TAGS = new Set(['singular', 'plural']);
export const TENSE_TAGS = new Set(['present', 'past', 'future']);
export const ASPECT_TAGS = new Set(['imperfective', 'perfective']);
export const ANIMACY_TAGS = new Set(['animate', 'inanimate', 'person', 'animal-not-person', 'personal']);

/** Tags marking a verb-table form (as opposed to a declension form). */
export const VERB_FORM_TAGS = new Set([
  'infinitive',
  'imperative',
  'present',
  'past',
  'future',
  'adverbial',
  'active',
  'passive',
  'first-person',
  'second-person',
  'third-person',
  'conditional',
  'participle',
]);

/** Analytic/periphrastic constructions or extraction errors in tables: dropped, not counted as unmapped. */
export const DROP_FORM_TAGS = new Set(['error-unrecognized-form', 'conditional']);

/** Pseudo-forms carrying table metadata. */
export const META_FORM_TAGS = new Set(['table-tags', 'inflection-template', 'class']);

/**
 * Tags that are dimensions of a table cell but irrelevant for our slot vocabulary (consumed silently):
 * aspect (a property of the whole verb), "possessive" (possessive adjectives), pronoun-table markers.
 */
export const IGNORED_DIMENSION_TAGS = new Set(['imperfective', 'perfective', 'possessive', 'pronoun', 'indicative', 'error-unknown-tag']);

/**
 * Usage / register qualifiers that may decorate a form or a related term (kept as `Form.tags`, `RelatedTerm.tags`).
 * Anything not in a dimension set is treated as a qualifier too; this list is used where we need to distinguish
 * qualifiers from grammatical tags (e.g. form-of tags).
 */
export const QUALIFIER_TAGS = new Set([
  'dated',
  'dialectal',
  'rare',
  'archaic',
  'obsolete',
  'colloquial',
  'proscribed',
  'poetic',
  'nonstandard',
  'uncommon',
  'informal',
  'formal',
  'literary',
  'slang',
  'Internet',
  'vulgar',
  'derogatory',
  'offensive',
  'humorous',
  'misspelling',
  'regional',
  'Western',
  'Southern',
  'Southwestern',
  'Northern',
  'Eastern',
  'standard',
  'common',
  'usually',
  'sometimes',
  'figuratively',
  'historical',
  'neologism',
  'euphemistic',
  'ironic',
  'bookish',
  'officialese',
  'familiar',
  'vernacular',
  'Canadian',
  'Standard',
  'also',
]);

/**
 * Inflectional categories (DECISIONS item 1): a form-of sense carrying any of these is an inflected form
 * (case, number, person, tense, mood, infinitive, participle, adverbial participle, degree, impersonal).
 */
export const INFLECTIONAL_TAGS = new Set([
  'nominative',
  'genitive',
  'dative',
  'accusative',
  'instrumental',
  'locative',
  'vocative',
  'singular',
  'plural',
  'first-person',
  'second-person',
  'third-person',
  'present',
  'past',
  'future',
  'indicative',
  'imperative',
  'conditional',
  'subjunctive',
  'infinitive',
  'participle',
  'adverbial',
  'adjectival',
  'comparative',
  'superlative',
  'impersonal',
  'short-form',
]);

/** Entry-level grammatical tags: moved from the senses to `Entry.tags` when every sense carries them. */
export const ENTRY_LEVEL_TAGS = new Set([
  'indeclinable',
  'invariable',
  'abbreviation',
  'initialism',
  'acronym',
  'clipping',
  'relational',
  'possessive',
]);

/** Tags that merely restate a POS (dropped from sense tags of entries with that POS). */
export const POS_RESTATING_TAGS: Record<string, readonly string[]> = {
  letter: ['letter', 'character'],
  numeral: ['numeral'],
  particle: ['particle'],
  pronoun: ['pronoun'],
  verb: ['verb'],
  adjective: ['adjective'],
  adverb: ['adverb'],
  noun: ['noun'],
  'proper-noun': ['name', 'proper-noun'],
  preposition: ['preposition'],
  postposition: ['postposition', 'postpositional'],
  conjunction: ['conjunction'],
  interjection: ['interjection'],
  phrase: ['phrase'],
  prefix: ['prefix', 'morpheme'],
  suffix: ['suffix', 'morpheme'],
  interfix: ['interfix', 'morpheme'],
  'combining-form': ['morpheme'],
  determiner: ['determiner'],
};

/** Tags never shown anywhere. */
export function isJunkTag(tag: string): boolean {
  return (
    STRUCTURAL_TAGS.has(tag) ||
    tag.startsWith('error-') ||
    tag.startsWith('-') ||
    tag === '' ||
    tag === 'synonym' ||
    tag === 'synonym-of' ||
    tag === 'empty-gloss' ||
    tag === 'no-gloss'
  );
}

export function hasAny(tags: readonly string[], set: ReadonlySet<string>): boolean {
  for (const t of tags) if (set.has(t)) return true;
  return false;
}
