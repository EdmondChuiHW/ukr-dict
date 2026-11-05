/**
 * Builds a small fixture dataset in packages/web/public/data-fixture/ using the pipeline's web emitter.
 *   node scripts/make-fixture.ts
 * Use it with:  VITE_DATA_DIR=data-fixture pnpm --filter @ukdict/web dev   (or ?data=data-fixture)
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { BUILTIN_ATTRIBUTIONS } from '@ukdict/shared';
import { emitWebArtifacts } from '../../pipeline/src/emit/web.ts';
import { fixtureEntries } from './fixture-entries.ts';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'public', 'data-fixture');

const entries = fixtureEntries();
const manifest = await emitWebArtifacts(entries, {
  outDir,
  shardSize: 8,
  attributions: BUILTIN_ATTRIBUTIONS,
  provenance: { dataset: 'web fixture (hand-written)', entries: entries.length },
  ignoredCount: 0,
  // Tiny limits so the fixture exercises multi-level bucket routing.
  bucketLimits: { maxKeys: 12, maxBytes: 2000 },
});
// Pretty copy of the entries for humans.
await writeFile(join(outDir, 'entries.debug.json'), JSON.stringify(entries, null, 1));
console.log(
  `fixture: ${manifest.counts.entries} entries, ${manifest.files.shards.length} shards, ` +
    `${Object.keys(manifest.files.forms).length} form buckets, ${Object.keys(manifest.files.english).length} english buckets, ` +
    `${manifest.totalBytes} bytes → ${outDir}`,
);
