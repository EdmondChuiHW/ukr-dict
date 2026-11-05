/** Path resolution and default configuration. */
import { existsSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PipelineConfig } from './contracts.ts';
import { KAIKKI_EN_URL, KAIKKI_UK_URL } from './sources/download.ts';

/** Repository root: the nearest ancestor of this file containing pnpm-workspace.yaml. */
export function findRootDir(start: string = dirname(fileURLToPath(import.meta.url))): string {
  let dir = start;
  while (true) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`cannot find repository root (pnpm-workspace.yaml) above ${start}`);
    dir = parent;
  }
}

export interface CliOverrides {
  workers?: number;
  outDir?: string;
  sync?: boolean;
  lcorp?: boolean;
  lcorpOffline?: boolean;
  lcorpBudget?: number;
  lcorpRate?: number;
  lcorpConcurrency?: number;
  created?: boolean;
  shardSize?: number;
  download?: boolean;
}

export function defaultWorkers(): number {
  return Math.max(1, availableParallelism() - 1);
}

export function resolveConfig(o: CliOverrides = {}, rootDir: string = findRootDir()): PipelineConfig {
  return {
    rootDir,
    kaikkiUkFile: join(rootDir, 'data/kaikki-uk/kaikki.org-dictionary-Ukrainian.jsonl'),
    kaikkiEnFile: join(rootDir, 'data/kaikki-en/kaikki.org-dictionary-English.jsonl'),
    kaikkiUkUrl: KAIKKI_UK_URL,
    kaikkiEnUrl: KAIKKI_EN_URL,
    download: o.download !== false,
    frequencyFile: join(rootDir, 'raw_sources/publicist_84k_lex_dict_orig.csv'),
    aspectPairsFile: join(rootDir, 'raw_sources/verb_aspect_known_pairs.json'),
    cacheDir: join(rootDir, 'data/cache'),
    outDir: o.outDir ? resolve(o.outDir) : join(rootDir, 'artifacts'),
    webPublicDataDir: o.sync === false ? undefined : join(rootDir, 'packages/web/public/data'),
    workers: o.workers && o.workers > 0 ? Math.floor(o.workers) : defaultWorkers(),
    shardSize: o.shardSize && o.shardSize > 0 ? Math.floor(o.shardSize) : 200,
    lcorp: {
      enabled: o.lcorp !== false,
      offline: !!o.lcorpOffline,
      budget: o.lcorpBudget ?? 3000,
      ratePerSec: o.lcorpRate ?? 1,
      concurrency: o.lcorpConcurrency ?? 1,
    },
    createFromTranslations: o.created !== false,
  };
}

/** Optional input for the example-sentences plugin. */
export function exampleSentencesFile(rootDir: string): string {
  return join(rootDir, 'raw_sources/example_sentences.tsv');
}
