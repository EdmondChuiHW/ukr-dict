/**
 * Mirrors a directory (artifacts/web → packages/web/public/data): copies new/changed files, deletes files in
 * the destination that no longer exist in the source. No dependencies beyond node:fs (also used by
 * scripts/sync-data.ts at the repo root).
 */
import { copyFile, mkdir, readdir, rm, rmdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

async function listFiles(root: string): Promise<Map<string, { size: number; mtimeMs: number }>> {
  const out = new Map<string, { size: number; mtimeMs: number }>();
  const walk = async (dir: string) => {
    let names: import('node:fs').Dirent[];
    try {
      names = await readdir(dir, { withFileTypes: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw e;
    }
    for (const d of names) {
      const abs = join(dir, d.name);
      if (d.isDirectory()) await walk(abs);
      else if (d.isFile()) {
        const st = await stat(abs);
        out.set(relative(root, abs).split(sep).join('/'), { size: st.size, mtimeMs: st.mtimeMs });
      }
    }
  };
  await walk(root);
  return out;
}

async function removeEmptyDirs(dir: string, keepRoot: boolean): Promise<void> {
  let names: import('node:fs').Dirent[];
  try {
    names = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const d of names) if (d.isDirectory()) await removeEmptyDirs(join(dir, d.name), false);
  if (!keepRoot && (await readdir(dir)).length === 0) await rmdir(dir);
}

export interface SyncResult {
  copied: number;
  unchanged: number;
  deleted: number;
  bytesCopied: number;
}

export async function syncDir(src: string, dst: string): Promise<SyncResult> {
  const from = await listFiles(src);
  if (from.size === 0) throw new Error(`sync: source ${src} is empty or missing — run the pipeline first`);
  await mkdir(dst, { recursive: true });
  const to = await listFiles(dst);
  const res: SyncResult = { copied: 0, unchanged: 0, deleted: 0, bytesCopied: 0 };
  for (const [rel, info] of from) {
    const cur = to.get(rel);
    // Data files are content-hashed: same name + same size ⇒ same content. manifest.json is always copied.
    if (cur && cur.size === info.size && rel !== 'manifest.json' && cur.mtimeMs >= info.mtimeMs) {
      res.unchanged++;
      continue;
    }
    const target = join(dst, rel);
    await mkdir(join(target, '..'), { recursive: true });
    await copyFile(join(src, rel), target);
    res.copied++;
    res.bytesCopied += info.size;
  }
  for (const rel of to.keys()) {
    if (!from.has(rel)) {
      await rm(join(dst, rel), { force: true });
      res.deleted++;
    }
  }
  await removeEmptyDirs(dst, true);
  return res;
}
