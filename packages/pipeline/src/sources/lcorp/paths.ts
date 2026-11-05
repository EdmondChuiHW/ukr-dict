/** Default locations used by the standalone lcorp tools (warm.ts, dev.ts). */
import { resolve } from 'node:path';

/** Repository root (…/packages/pipeline/src/sources/lcorp → 5 levels up). */
export const REPO_ROOT = resolve(import.meta.dirname, '../../../../..');
export const DEFAULT_CACHE_DIR = resolve(REPO_ROOT, 'data/cache');
export const DEFAULT_KAIKKI_UK = resolve(REPO_ROOT, 'data/kaikki-uk/kaikki.org-dictionary-Ukrainian.jsonl');
export const DEFAULT_FREQUENCY_CSV = resolve(REPO_ROOT, 'raw_sources/publicist_84k_lex_dict_orig.csv');
export const DEFAULT_WARM_LOG = resolve(DEFAULT_CACHE_DIR, 'lcorp-warm-log.jsonl');
