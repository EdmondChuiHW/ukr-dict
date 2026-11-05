/**
 * kaikki.org Ukrainian JSONL → DraftEntry[] + IgnoredEntry[] (parallel, worker_threads).
 */
import type { DraftEntry, IgnoredEntry, Progress, UkIngestResult } from '../../contracts.ts';
import { runParallelJsonl } from '../../util/parallel-jsonl.ts';
import type { TransformResult } from './transform.ts';

export { transformKaikkiEntry, transformKaikkiLine, newTransformStats } from './transform.ts';
export type { TransformResult, TransformStats } from './transform.ts';

interface WorkerExtra {
  unmapped: [string, number][];
  tableForms: number;
  unmappedForms: number;
}

/** Extra statistics (not part of the UkIngestResult contract) of the last run, for reports. */
export interface UkIngestDetails {
  tableForms: number;
  unmappedTableForms: number;
  lineErrors: { line: number; message: string }[];
  lineErrorCount: number;
}

export async function ingestKaikkiUk(
  file: string,
  opts: { workers: number; progress: Progress },
): Promise<UkIngestResult & { details: UkIngestDetails }> {
  const t0 = performance.now();
  const stage = opts.progress.stage('kaikki-uk', 'kaikki Ukrainian');
  try {
    const run = await runParallelJsonl<TransformResult>({
      file,
      workerUrl: new URL('./worker.ts', import.meta.url),
      workers: opts.workers,
      stage,
      lineNumbers: true,
    });
    const entries: DraftEntry[] = [];
    const ignored: IgnoredEntry[] = [];
    let withParadigm = 0;
    for (const r of run.results) {
      if (r.kind === 'entry') {
        entries.push(r.draft);
        if (r.draft.paradigm) withParadigm++;
      } else ignored.push(r.ignored);
    }
    const unmapped = new Map<string, number>();
    let tableForms = 0;
    let unmappedTableForms = 0;
    for (const x of run.extras as WorkerExtra[]) {
      if (!x) continue;
      tableForms += x.tableForms;
      unmappedTableForms += x.unmappedForms;
      for (const [k, n] of x.unmapped) unmapped.set(k, (unmapped.get(k) ?? 0) + n);
    }
    const unmappedForms = Object.fromEntries([...unmapped].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
    for (const e of run.lineErrors.slice(0, 5)) opts.progress.log(`kaikki-uk: line ${e.line}: ${e.message}`);
    const durationMs = performance.now() - t0;
    stage.done(`${entries.length} entries, ${ignored.length} ignored, ${withParadigm} with paradigm`);
    return {
      entries,
      ignored,
      unmappedForms,
      stats: { lines: run.lines, entries: entries.length, ignored: ignored.length, withParadigm, durationMs },
      details: { tableForms, unmappedTableForms, lineErrors: run.lineErrors, lineErrorCount: run.lineErrorCount },
    };
  } catch (err) {
    stage.fail(err);
    throw err;
  }
}
