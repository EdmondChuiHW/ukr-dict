/**
 * `pnpm sync-data`: mirror artifacts/web → packages/web/public/data (copies changed files, deletes stale ones).
 * Usage: node scripts/sync-data.ts [srcDir] [dstDir]
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncDir } from '../packages/pipeline/src/emit/sync.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(process.argv[2] ?? join(root, 'artifacts/web'));
const dst = resolve(process.argv[3] ?? join(root, 'packages/web/public/data'));

try {
  const r = await syncDir(src, dst);
  console.log(`sync-data: ${src} → ${dst}: ${r.copied} copied (${(r.bytesCopied / 1048576).toFixed(1)} MB), ${r.unchanged} unchanged, ${r.deleted} deleted`);
} catch (e) {
  console.error(`sync-data failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
