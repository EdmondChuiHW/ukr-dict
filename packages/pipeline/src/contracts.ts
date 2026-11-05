/**
 * Internal contracts between pipeline modules (sources → stages → emitters).
 * Shared, UI-facing types live in @ukdict/shared.
 */
import type {
  Animacy,
  Aspect,
  Attribution,
  Entry,
  Gender,
  PartOfSpeech,
  Paradigm,
} from '@ukdict/shared';

// ───────────────────────────── Progress / TUI ─────────────────────────────

export type ProgressUnit = 'bytes' | 'items' | 'requests' | 'lines';

export interface StageHandle {
  setTotal(total: number, unit?: ProgressUnit): void;
  set(current: number): void;
  tick(delta?: number): void;
  /** Short status text shown next to the bar (e.g. "12 workers", "1.9 req/s"). */
  status(text: string): void;
  done(summary?: string): void;
  fail(error: unknown): void;
}

export interface Progress {
  /** Create (or fetch) a stage line in the TUI. */
  stage(id: string, label: string): StageHandle;
  /** Print a log line above the live progress area. */
  log(message: string): void;
  /** Stop rendering (restore terminal). */
  close(): void;
}

const noopStage: StageHandle = {
  setTotal() {},
  set() {},
  tick() {},
  status() {},
  done() {},
  fail() {},
};

/** No-op implementation for tests and library use. */
export const silentProgress: Progress = {
  stage: () => noopStage,
  log() {},
  close() {},
};

// ───────────────────────────── Drafts ─────────────────────────────

/** An entry before ids, slugs and frequency ranks are assigned. */
export type DraftEntry = Omit<Entry, 'id' | 'slug' | 'freqRank'> & {
  origin: {
    source: 'kaikki-uk' | 'english-translation';
    /** 1-based line number in the source JSONL (kaikki-uk). */
    line?: number;
    /** Raw kaikki POS. */
    kaikkiPos?: string;
    etymologyNumber?: number;
  };
};

export type IgnoreReason =
  /** Every sense is an inflected form (case/number/person/tense/participle/comparative…) of another word. */
  | 'inflected-form-only'
  /** No usable gloss at all. */
  | 'no-senses';

export interface IgnoredEntry {
  word: string;
  kaikkiPos: string;
  pos: PartOfSpeech;
  reason: IgnoreReason;
  /** Base forms this entry is an inflection of, with the grammatical tags of the inflection. */
  formOf: { word: string; tags: string[] }[];
  glosses: string[];
  /** 1-based line in kaikki-uk JSONL. */
  line: number;
  url: string;
  /** Filled in by the assemble stage. */
  resolution?: 'in-paradigm' | 'added-as-extra-form' | 'lemma-missing';
}

// ───────────────────────────── kaikki Ukrainian ─────────────────────────────

export interface UkIngestResult {
  entries: DraftEntry[];
  ignored: IgnoredEntry[];
  /** Form tag-sets that could not be mapped to a paradigm slot: "<source>:<sorted,tags>" → count. */
  unmappedForms: Record<string, number>;
  stats: { lines: number; entries: number; ignored: number; withParadigm: number; durationMs: number };
}

// ───────────────────────────── kaikki English (translations) ─────────────────────────────

export interface EnTranslation {
  /** Ukrainian word as given in the translation table (may contain stress marks). */
  ukWord: string;
  enWord: string;
  /** Raw kaikki POS of the English entry ("noun", "verb", …). */
  enPos: string;
  /** Translation-table sense label, e.g. "domesticated animal". */
  sense?: string;
  /** e.g. ["masculine"], ["imperfective"]. */
  tags?: string[];
  roman?: string;
}

export interface EnIngestResult {
  translations: EnTranslation[];
  stats: { lines: number; matchedLines: number; translations: number; durationMs: number; fromCache: boolean };
}

// ───────────────────────────── Frequency / aspect pairs ─────────────────────────────

export interface FrequencyIndex {
  /** 1-based rank (by absolute frequency, descending) for a word; prefers a POS-compatible row. */
  rank(word: string, pos?: PartOfSpeech): number | undefined;
  readonly size: number;
}

export interface KnownAspectPair {
  imperfective: string;
  perfective: string;
}

// ───────────────────────────── lcorp ─────────────────────────────

export interface LcorpLookupRequest {
  /** Unstressed headword (case-sensitive: proper nouns are capitalized). */
  word: string;
  /** Stressed heads of the dictionary entry, used to pick the right homonym. */
  heads?: string[];
  pos: PartOfSpeech;
}

export interface LcorpEntry {
  /** Stressed headword as shown by lcorp (homonym index removed). */
  headword: string;
  /** Raw grammatical label, e.g. "іменник чоловічого роду, істота". */
  gram: string;
  pos?: PartOfSpeech;
  genders?: Gender[];
  animacy?: Animacy;
  aspect?: Aspect;
  number?: 'plural-only';
  paradigm?: Paradigm;
}

export type LcorpLookupResult =
  | { status: 'found'; entry: LcorpEntry; fromCache: boolean }
  | {
      status: 'not-found';
      nearest?: string;
      fromCache: boolean;
      /** Why the lookup was rejected, e.g. "POS mismatch: …" or "no inflection table in lcorp". */
      note?: string;
    }
  | { status: 'skipped'; reason: 'budget' | 'offline' }
  | { status: 'error'; message: string };

export interface LcorpStats {
  network: number;
  cacheHits: number;
  found: number;
  notFound: number;
  errors: number;
  skipped: number;
}

export interface LcorpClient {
  lookup(req: LcorpLookupRequest): Promise<LcorpLookupResult>;
  stats(): LcorpStats;
  close(): Promise<void>;
}

export interface LcorpOptions {
  cacheDir: string;
  /** Max network requests per second (token bucket, shared by all sessions). */
  ratePerSec: number;
  /** Parallel ASP.NET sessions. */
  concurrency: number;
  /** Max number of lookups that may hit the network in this run (cache hits are free). */
  budget: number;
  /** Cache-only mode. */
  offline: boolean;
  progress?: StageHandle;
}

// ───────────────────────────── Config / plugins ─────────────────────────────

export interface PipelineConfig {
  rootDir: string;
  kaikkiUkFile: string;
  kaikkiEnFile: string;
  /** Where missing kaikki dumps are downloaded from. */
  kaikkiUkUrl: string;
  kaikkiEnUrl: string;
  /** Download missing kaikki dumps before the build (otherwise a missing dump is an error). */
  download: boolean;
  frequencyFile: string;
  aspectPairsFile: string;
  cacheDir: string;
  /** artifacts/ root (web/, machine/, debug/, reports/ below it). */
  outDir: string;
  /** If set, artifacts/web is mirrored here (the web app's public/data). */
  webPublicDataDir?: string;
  workers: number;
  shardSize: number;
  lcorp: Omit<LcorpOptions, 'progress' | 'cacheDir'> & { enabled: boolean };
  /** Optional: create entries from English translations. */
  createFromTranslations: boolean;
}

/** Context handed to plugins after entries are assembled, ranked and given ids (before emission). */
export interface PipelineContext {
  config: PipelineConfig;
  entries: Entry[];
  /** searchKey(word) → entries. */
  byKey: Map<string, Entry[]>;
  progress: Progress;
  addAttribution(a: Attribution): void;
  log(message: string): void;
}

/** Extension point: e.g. attach example sentences from another corpus. */
export interface PipelinePlugin {
  id: string;
  attribution?: Attribution;
  enrich(ctx: PipelineContext): Promise<void> | void;
}
