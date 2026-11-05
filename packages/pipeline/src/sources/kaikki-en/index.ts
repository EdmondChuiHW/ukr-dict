/**
 * kaikki.org English JSONL (3.3 GB) → Ukrainian translations (EnTranslation[]).
 *
 * Lines are prefiltered on the raw bytes (`"code": "uk"`) inside the workers, so only ~27k of ~1.5M lines are
 * decoded and parsed. The result is cached in `<cacheDir>/en-translations-<size>-<mtimeMs>.json.gz` and reused
 * while the source file is unchanged.
 */
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import zlib from 'node:zlib';
import type { EnIngestResult, EnTranslation, Progress } from '../../contracts.ts';
import { runParallelJsonl } from '../../util/parallel-jsonl.ts';

export { extractUkTranslations, UK_TRANSLATION_PREFILTER } from './extract.ts';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

/** Bump when the extraction logic changes (invalidates caches). */
export const EN_CACHE_VERSION = 1;

interface CacheFile {
  version: number;
  source: { file: string; size: number; mtimeMs: number };
  stats: { lines: number; matchedLines: number };
  translations: EnTranslation[];
}

export function enCachePath(cacheDir: string, file: string): string {
  const st = fs.statSync(file);
  return path.join(cacheDir, `en-translations-${st.size}-${Math.floor(st.mtimeMs)}.json.gz`);
}

async function readCache(cachePath: string): Promise<CacheFile | undefined> {
  try {
    const buf = await fs.promises.readFile(cachePath);
    const data = JSON.parse((await gunzip(buf)).toString('utf8')) as CacheFile;
    if (data?.version !== EN_CACHE_VERSION || !Array.isArray(data.translations)) return undefined;
    return data;
  } catch {
    return undefined;
  }
}

async function writeCache(cachePath: string, data: CacheFile): Promise<void> {
  await fs.promises.mkdir(path.dirname(cachePath), { recursive: true });
  const tmp = `${cachePath}.${process.pid}.tmp`;
  await fs.promises.writeFile(tmp, await gzip(Buffer.from(JSON.stringify(data)), { level: 6 }));
  await fs.promises.rename(tmp, cachePath);
}

export async function ingestKaikkiEn(
  file: string,
  opts: { workers: number; progress: Progress; cacheDir: string; noCache?: boolean },
): Promise<EnIngestResult> {
  const t0 = performance.now();
  const stage = opts.progress.stage('kaikki-en', 'kaikki English translations');
  try {
    const st = fs.statSync(file);
    const cachePath = enCachePath(opts.cacheDir, file);
    if (!opts.noCache) {
      const cached = await readCache(cachePath);
      if (cached) {
        stage.setTotal(st.size, 'bytes');
        stage.set(st.size);
        const durationMs = performance.now() - t0;
        stage.done(`${cached.translations.length} translations (cached)`);
        return {
          translations: cached.translations,
          stats: { ...cached.stats, translations: cached.translations.length, durationMs, fromCache: true },
        };
      }
    }
    const run = await runParallelJsonl<EnTranslation[]>({
      file,
      workerUrl: new URL('./worker.ts', import.meta.url),
      workers: opts.workers,
      stage,
      lineNumbers: false,
    });
    const translations: EnTranslation[] = [];
    for (const list of run.results) for (const t of list) translations.push(t);
    for (const e of run.lineErrors.slice(0, 5)) opts.progress.log(`kaikki-en: line error: ${e.message}`);
    const stats = { lines: run.lines, matchedLines: run.matchedLines };
    try {
      await writeCache(cachePath, {
        version: EN_CACHE_VERSION,
        source: { file: path.basename(file), size: st.size, mtimeMs: st.mtimeMs },
        stats,
        translations,
      });
    } catch (err) {
      opts.progress.log(`kaikki-en: could not write cache ${cachePath}: ${String((err as Error)?.message ?? err)}`);
    }
    const durationMs = performance.now() - t0;
    stage.done(`${translations.length} translations from ${run.matchedLines} lines`);
    return { translations, stats: { ...stats, translations: translations.length, durationMs, fromCache: false } };
  } catch (err) {
    stage.fail(err);
    throw err;
  }
}
