/** Test worker for parallel-jsonl.test.ts: echoes (line number, text) of every (prefiltered) line. */
import { serveJsonlWorker } from '../parallel-jsonl.ts';

const init = (await import('node:worker_threads')).workerData?.init ?? {};

serveJsonlWorker<{ n: number; text: string }>(
  (opts: { prefilter?: string; failOn?: string } | null) => {
    let seen = 0;
    return {
      prefilter: opts?.prefilter,
      transform(text, n) {
        seen++;
        if (opts?.failOn && text.includes(opts.failOn)) throw new Error(`boom at ${n}`);
        return { n, text };
      },
      finish: () => ({ seen }),
    };
  },
  { chunkSize: typeof init.chunkSize === 'number' ? init.chunkSize : undefined, batchSize: 3 },
);
