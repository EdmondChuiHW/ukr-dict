/** Worker module for the kaikki-uk ingestion (see util/parallel-jsonl.ts). */
import { serveJsonlWorker } from '../../util/parallel-jsonl.ts';
import { newTransformStats, transformKaikkiLine, type TransformResult } from './transform.ts';

serveJsonlWorker<TransformResult>(() => {
  const stats = newTransformStats();
  return {
    transform: (line, lineNo) => transformKaikkiLine(line, lineNo, stats),
    finish: () => ({ unmapped: [...stats.unmapped], tableForms: stats.tableForms, unmappedForms: stats.unmappedForms }),
  };
});
