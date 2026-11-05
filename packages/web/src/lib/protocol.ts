/** Messages between the UI thread and the search worker. */
import type { Attribution, Entry, Manifest, SummaryRow } from '@ukdict/shared';

export type Script = 'cyrillic' | 'latin' | 'mixed' | 'other';

/** A compact (summary-row) hit for the prefix / infix / English tiers. */
export interface CompactHit {
  id: number;
  /** Undefined while summaries are still loading. */
  row?: SummaryRow;
  /** Number of entries sharing this headword key (>1 → link needs `&e=` to point at this one). */
  sameKey: number;
  /** English tier: score (sum of token weights). */
  score?: number;
}

export interface TierFull {
  ids: number[];
  /** Full entries (same order as ids, capped); filled when their shards are loaded. */
  entries: Entry[];
  pending: boolean;
}

export interface SearchResult {
  seq: number;
  query: string;
  key: string;
  script: Script;
  /** Tier 1+2: exact headword matches (stress-insensitive), stress-exact ones listed first. */
  exact: TierFull & { stressIds: number[] };
  /** Tier 3: entries having the query as an inflected form. */
  forms: TierFull & { enabled: boolean };
  /** Tier 4. */
  prefix: { hits: CompactHit[]; total: number };
  /** Tier 5. */
  infix: { hits: CompactHit[]; total: number };
  /** Tier 6. */
  english: { hits: CompactHit[]; total: number; pending: boolean; enabled: boolean; tokens: string[] };
  summariesPending: boolean;
  /** Some data file could not be loaded (offline and not cached yet) → results may be incomplete. */
  failed: boolean;
  /** True when nothing is pending any more. */
  done: boolean;
}

export type DataPhase = 'loading' | 'core' | 'ready' | 'error';

export interface DataInfo {
  buildId: string;
  builtAt: string;
  counts: Manifest['counts'];
  totalBytes: number;
  fileCount: number;
  shardSize: number;
  attributions: Attribution[];
  provenance: Record<string, string | number>;
  coreBytes: number;
  summariesBytes: number;
}

export interface OfflineProgress {
  state: 'idle' | 'running' | 'done' | 'error';
  loadedBytes: number;
  totalBytes: number;
  files: number;
  filesTotal: number;
  error?: string;
}

export type ToWorker =
  | { type: 'init'; dataUrl: string }
  | { type: 'query'; seq: number; q: string }
  | { type: 'prefetch' };

export type FromWorker =
  | { type: 'phase'; phase: DataPhase; info?: DataInfo; error?: string }
  | { type: 'offline'; progress: OfflineProgress }
  | { type: 'result'; result: SearchResult };
