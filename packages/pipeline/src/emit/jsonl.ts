import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { once } from 'node:events';

/** Streams one JSON value per line to `path` (written in ~1 MB chunks). Returns the byte count. */
export async function writeJsonl(path: string, items: Iterable<unknown>): Promise<number> {
  await mkdir(dirname(path), { recursive: true });
  const out = createWriteStream(path);
  let buf = '';
  let bytes = 0;
  const flush = async () => {
    if (!buf) return;
    bytes += Buffer.byteLength(buf, 'utf8');
    if (!out.write(buf)) await once(out, 'drain');
    buf = '';
  };
  for (const it of items) {
    buf += JSON.stringify(it) + '\n';
    if (buf.length > 1_000_000) await flush();
  }
  await flush();
  out.end();
  await once(out, 'finish');
  return bytes;
}
