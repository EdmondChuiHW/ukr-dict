/**
 * Canonical dictionary data model shared by the pipeline and the web app.
 *
 * The pipeline produces `Entry` objects; the web app consumes them unchanged
 * (inside gzip'd JSON shards). Keep this file free of runtime dependencies.
 */

/** Dense numeric id. Equals the entry's position in the final (frequency) sort order. Stable only within one build. */
export type EntryId = number;

/** Normalized part of speech. Mapping from raw kaikki / lcorp / frequency-list POS lives in the pipeline. */
export type PartOfSpeech =
  | 'noun'
  | 'proper-noun'
  | 'verb'
  | 'adjective'
  | 'adverb'
  | 'pronoun'
  | 'determiner'
  | 'numeral'
  | 'preposition'
  | 'postposition'
  | 'conjunction'
  | 'particle'
  | 'interjection'
  | 'predicative'
  | 'prefix'
  | 'suffix'
  | 'interfix'
  | 'combining-form'
  | 'phrase'
  | 'prepositional-phrase'
  | 'proverb'
  | 'letter'
  | 'symbol'
  | 'punctuation'
  | 'other';

export type Gender = 'm' | 'f' | 'n';
export type Animacy = 'animate' | 'inanimate';
/** Pluralia tantum / singularia tantum. */
export type NumberRestriction = 'plural-only' | 'singular-only';
export type Aspect = 'imperfective' | 'perfective' | 'biaspectual';

/** Identifier of a data source. Attribution metadata for each lives in the manifest (`Attribution`). */
export type SourceId =
  | 'wiktionary' // English Wiktionary (Ukrainian section), via kaikki.org
  | 'wiktionary-translations' // English Wiktionary translation tables (for "created" entries), via kaikki.org
  | 'kaikki' // kaikki.org machine-readable extraction (wiktextract)
  | 'lcorp' // Словники України online (lcorp.ulif.org.ua) inflection tables
  | 'frequency' // Frequency dictionary of modern Ukrainian publicistic texts
  | 'known-aspect-pairs' // curated verb aspect pair list (verb_aspect_known_pairs.json)
  | (string & {}); // extension sources (e.g. example-sentence corpora)

export interface SourceRef {
  source: SourceId;
  /** Deep link to the source page for this entry, if the source has one. */
  url?: string;
  /** Short human label, e.g. "Wiktionary: собака" or "lcorp: search собака". */
  label?: string;
  /** Free text, e.g. "inflection table" or "translation of English 'dog' (noun)". */
  note?: string;
}

/** A single dictionary entry: one headword + one part of speech (+ one etymology / homonym). */
export interface Entry {
  id: EntryId;
  /** Human-readable identifier, stable across builds as long as the source data is stable: `${word}~${pos}` or `${word}~${pos}~${n}` for homonyms (n ≥ 2). */
  slug: string;
  /** Headword without stress marks, as titled in the source (may contain capitals, spaces, hyphens, apostrophes). */
  word: string;
  /** `searchKey(word)` – see normalize.ts. */
  key: string;
  /** Stressed headword(s) (combining U+0301 marks), at least one; first is primary. */
  heads: string[];
  pos: PartOfSpeech;
  /** Entry-level grammatical/usage tags (normalized kaikki tags), e.g. "indeclinable", "abbreviation", "transitive". */
  tags?: string[];
  genders?: Gender[];
  animacy?: Animacy;
  number?: NumberRestriction;
  aspect?: Aspect;
  /** Aspect partners of a verb (imperfective ↔ perfective). */
  aspectPartners?: AspectPartner[];
  senses: Sense[];
  /** Inflection table (declension / conjugation). */
  paradigm?: Paradigm;
  /** Additional inflected forms that are not part of `paradigm` but should be searchable (e.g. from ignored form-of entries, comparative from head line). */
  extraForms?: ExtraForm[];
  pronunciation?: Pronunciation;
  relations?: Relations;
  /** 1-based rank in the frequency list (lower = more frequent); undefined when not in the list. */
  freqRank?: number;
  /** Present iff the entry was synthesized from English→Ukrainian translation tables (no Ukrainian source entry exists). */
  created?: CreatedInfo;
  sources: SourceRef[];
  /** Extension point: data attached by pipeline plugins, keyed by plugin id. */
  ext?: Record<string, unknown>;
}

export interface AspectPartner {
  /** Stressed form as given by the source (may lack stress marks). */
  word: string;
  /** Aspect of the partner verb. */
  aspect: Aspect;
  /** True if a dictionary entry exists whose key equals searchKey(word) (UI renders a link either way; this lets it style dead links). */
  linked?: boolean;
  source: SourceId;
}

export interface Sense {
  /** English gloss text. For `headerOnly` nodes this is the shared parent gloss (e.g. "[with locative]"). */
  gloss: string;
  /** True when this node exists only to group `subsenses` (it has no definition of its own). */
  headerOnly?: boolean;
  /** Display tags, normalized (see tags.ts). Structural tags such as "form-of", "alt-of", "morpheme" are removed. */
  tags?: string[];
  /** Raw qualifier text, e.g. "with genitive". */
  qualifier?: string;
  topics?: string[];
  /** Clickable Ukrainian words inside `gloss`. */
  links?: GlossLink[];
  /** For senses that are "inflection/derivation of X" (kept only in mixed entries; pure inflected-form entries are ignored). */
  formOf?: WordRef[];
  /** For senses that are "alternative form of X". */
  altOf?: WordRef[];
  examples?: Example[];
  /** Sense-level synonyms/antonyms/etc. */
  relations?: Relations;
  subsenses?: Sense[];
}

export interface GlossLink {
  /** UTF-16 offsets into `gloss` [start, end). */
  start: number;
  end: number;
  /** Ukrainian word to navigate to (may contain stress marks; UI searches for it). */
  target: string;
}

export interface WordRef {
  word: string;
  tags?: string[];
  linked?: boolean;
}

export interface Example {
  text: string;
  translation?: string;
  ref?: string;
  source: SourceId;
}

/** A single inflected form with optional qualifiers such as "dated", "dialectal", "rare". */
export interface Form {
  form: string;
  tags?: string[];
}

export type ParadigmKind = 'noun' | 'adjectival' | 'verb';

/**
 * Inflection table. `forms` maps slot keys (see paradigm.ts for the closed vocabulary and table layouts)
 * to one or more variant forms (stressed). Missing slots = not applicable / unknown.
 */
export interface Paradigm {
  kind: ParadigmKind;
  forms: Partial<Record<SlotKey, Form[]>>;
  source: SourceId;
  /** e.g. inflection class "accent-a", "1a", or lcorp grammatical label. */
  notes?: string[];
}

/** Slot key, e.g. "nom.sg", "acc.m.anim", "pres.1sg", "ptcp.pass.past". See paradigm.ts. */
export type SlotKey = string;

export interface ExtraForm {
  form: string;
  /** Grammatical description, e.g. ["comparative"], ["feminine","nominative","singular"]. */
  tags: string[];
  origin: 'form-of-entry' | 'head' | 'lcorp';
}

export interface Pronunciation {
  ipa?: { value: string; tags?: string[]; note?: string }[];
  audio?: Audio[];
}

export interface Audio {
  mp3?: string;
  ogg?: string;
  /** e.g. file name / speaker / region label. */
  label?: string;
  tags?: string[];
}

export type RelationType =
  | 'synonym'
  | 'antonym'
  | 'hypernym'
  | 'hyponym'
  | 'meronym'
  | 'holonym'
  | 'coordinate'
  | 'troponym'
  | 'related'
  | 'derived'
  | 'alternative'
  | 'diminutive'
  | 'augmentative'
  | 'feminine'
  | 'masculine'
  | 'relational-adjective'
  | 'abstract-noun'
  | 'adverb'
  | 'abbreviation';

export type Relations = Partial<Record<RelationType, RelatedTerm[]>>;

export interface RelatedTerm {
  /** Ukrainian word (may contain stress marks). Collapsed: at most one RelatedTerm per searchKey within a list. */
  word: string;
  tags?: string[];
  /** Which sense of the headword this applies to (free text from source). */
  sense?: string;
  /** English gloss of the related word, if the source gives one. */
  english?: string;
  /** True if an entry exists whose key equals searchKey(word). */
  linked?: boolean;
}

export interface CreatedInfo {
  method: 'english-translation';
  /** The English entries whose translation tables listed this Ukrainian word. */
  from: { enWord: string; enPos: string; sense?: string; url: string }[];
}

/** Site-wide attribution metadata for a source. */
export interface Attribution {
  id: SourceId;
  name: string;
  url: string;
  license?: string;
  licenseUrl?: string;
  description: string;
}
