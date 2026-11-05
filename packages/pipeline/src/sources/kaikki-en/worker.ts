/** Worker module for the kaikki-en translation extraction (see util/parallel-jsonl.ts). */
import type { EnTranslation } from '../../contracts.ts';
import { serveJsonlWorker } from '../../util/parallel-jsonl.ts';
import { UK_TRANSLATION_PREFILTER, extractUkTranslations } from './extract.ts';

serveJsonlWorker<EnTranslation[]>(
  () => ({
    prefilter: UK_TRANSLATION_PREFILTER,
    // One result per matched line (possibly empty) so the main thread can count matched lines with translations.
    transform: (line) => [extractUkTranslations(JSON.parse(line))],
  }),
  { batchSize: 64, chunkSize: 8 << 20 },
);
