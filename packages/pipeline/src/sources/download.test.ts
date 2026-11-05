import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { IncomingMessage, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downloadFile } from './download.ts';

/** Minimal static server with Range / If-Range (ETag) support, like kaikki.org's nginx. */
async function serve(state: { body: Buffer; etag: string; requests: IncomingMessage[]; status?: number }): Promise<{ url: string; server: Server }> {
  const server = createServer((req, res) => {
    state.requests.push(req);
    if (state.status) {
      res.writeHead(state.status).end();
      return;
    }
    const { body, etag } = state;
    const m = /^bytes=(\d+)-$/.exec(req.headers.range ?? '');
    const ifRange = req.headers['if-range'];
    if (m && (!ifRange || ifRange === etag)) {
      const start = Number(m[1]);
      if (start >= body.length) {
        res.writeHead(416, { 'content-range': `bytes */${body.length}` }).end();
        return;
      }
      res.writeHead(206, { etag, 'content-range': `bytes ${start}-${body.length - 1}/${body.length}`, 'content-length': body.length - start });
      res.end(body.subarray(start));
      return;
    }
    res.writeHead(200, { etag, 'content-length': body.length });
    res.end(body);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/dump.jsonl`, server };
}

async function withEnv(fn: (env: { dir: string; dest: string; state: Parameters<typeof serve>[0]; url: string }) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'ukdict-dl-'));
  const state = { body: Buffer.from('{"word":"собака"}\n'.repeat(5000)), etag: '"v1"', requests: [] as IncomingMessage[] };
  const { url, server } = await serve(state);
  try {
    await fn({ dir, dest: join(dir, 'sub/dump.jsonl'), state, url });
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
}

test('downloadFile: fresh download reports progress and leaves no temp files', () =>
  withEnv(async ({ dest, state, url }) => {
    const seen: [number, number | undefined][] = [];
    const r = await downloadFile(url, dest, { onProgress: (g, t) => seen.push([g, t]) });
    assert.equal(r.bytes, state.body.length);
    assert.equal(r.resumedFrom, 0);
    assert.deepEqual(await readFile(dest), state.body);
    assert.deepEqual(seen.at(-1), [state.body.length, state.body.length]);
    assert.ok(!existsSync(`${dest}.part`) && !existsSync(`${dest}.part.json`));
  }));

test('downloadFile: resumes a partial download when the ETag still matches', () =>
  withEnv(async ({ dest, state, url }) => {
    await downloadFile(url, dest); // creates the directory
    await rm(dest);
    await writeFile(`${dest}.part`, state.body.subarray(0, 1000));
    await writeFile(`${dest}.part.json`, JSON.stringify({ url, etag: '"v1"' }));
    state.requests.length = 0;
    const r = await downloadFile(url, dest);
    assert.equal(r.resumedFrom, 1000);
    assert.equal(state.requests[0].headers.range, 'bytes=1000-');
    assert.deepEqual(await readFile(dest), state.body);
  }));

test('downloadFile: restarts when the dump changed on the server', () =>
  withEnv(async ({ dest, state, url }) => {
    await downloadFile(url, dest);
    await rm(dest);
    await writeFile(`${dest}.part`, Buffer.alloc(1000, 'x'));
    await writeFile(`${dest}.part.json`, JSON.stringify({ url, etag: '"v1"' }));
    state.etag = '"v2"';
    state.body = Buffer.from('{"word":"кіт"}\n'.repeat(3000));
    const r = await downloadFile(url, dest);
    assert.equal(r.resumedFrom, 0);
    assert.deepEqual(await readFile(dest), state.body);
  }));

test('downloadFile: partial file without metadata is not trusted', () =>
  withEnv(async ({ dest, state, url }) => {
    await downloadFile(url, dest);
    await rm(dest);
    await writeFile(`${dest}.part`, Buffer.alloc(1000, 'x'));
    state.requests.length = 0;
    await downloadFile(url, dest);
    assert.equal(state.requests[0].headers.range, undefined);
    assert.deepEqual(await readFile(dest), state.body);
  }));

test('downloadFile: a complete .part (crash before rename) is finished via 416', () =>
  withEnv(async ({ dest, state, url }) => {
    await downloadFile(url, dest);
    await rm(dest);
    await writeFile(`${dest}.part`, state.body);
    await writeFile(`${dest}.part.json`, JSON.stringify({ url, etag: '"v1"' }));
    const r = await downloadFile(url, dest);
    assert.equal(r.resumedFrom, state.body.length);
    assert.deepEqual(await readFile(dest), state.body);
  }));

test('downloadFile: HTTP errors are reported and nothing is written to dest', () =>
  withEnv(async ({ dest, state, url }) => {
    state.status = 404;
    await assert.rejects(downloadFile(url, dest), /HTTP 404/);
    assert.ok(!existsSync(dest));
  }));
