import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { countLinesPerRange, runParallelJsonl, splitRanges } from './parallel-jsonl.ts';

const workerUrl = new URL('./test-workers/echo-worker.ts', import.meta.url);

describe('parallel-jsonl', () => {
  let dir: string;
  let file: string;
  let lines: string[];

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pjsonl-'));
    file = path.join(dir, 'data.jsonl');
    lines = [];
    for (let i = 1; i <= 400; i++) {
      if (i % 37 === 0) lines.push(''); // empty lines are counted but not transformed
      else if (i % 50 === 0) lines.push(JSON.stringify({ i, big: 'ж'.repeat(5000), key: 'MATCH' })); // > chunk size
      else lines.push(JSON.stringify({ i, w: `слово${i}`, key: i % 7 === 0 ? 'MATCH' : 'x' }));
    }
    // no trailing newline: the last line is unterminated
    fs.writeFileSync(file, lines.join('\n'));
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('splits into newline-aligned ranges covering the file', () => {
    const size = fs.statSync(file).size;
    const ranges = splitRanges(file, 7);
    assert.equal(ranges[0].start, 0);
    assert.equal(ranges[ranges.length - 1].end, size);
    const buf = fs.readFileSync(file);
    for (let i = 1; i < ranges.length; i++) {
      assert.equal(ranges[i].start, ranges[i - 1].end);
      assert.equal(buf[ranges[i].start - 1], 10, 'range starts right after a newline');
    }
    const counts = countLinesPerRange(file, ranges);
    assert.equal(counts.reduce((a, b) => a + b, 0), lines.length);
  });

  it('streams every non-empty line with its exact global line number, in file order', async () => {
    const res = await runParallelJsonl<{ n: number; text: string }>({
      file,
      workerUrl,
      workers: 3,
      rangesPerWorker: 3,
      lineNumbers: true,
      init: { chunkSize: 1024 },
    });
    const expected = lines.map((text, i) => ({ n: i + 1, text })).filter((x) => x.text !== '');
    assert.deepEqual(res.results, expected);
    assert.equal(res.lines, lines.length);
    assert.equal(res.extras.length, 3);
    assert.equal(
      (res.extras as { seen: number }[]).reduce((a, x) => a + x.seen, 0),
      expected.length,
    );
  });

  it('applies the byte prefilter (including matches in lines longer than a chunk)', async () => {
    let progressed = 0;
    const stage = { setTotal() {}, set: (n: number) => (progressed = n), tick() {}, status() {}, done() {}, fail() {} };
    const res = await runParallelJsonl<{ n: number; text: string }>({
      file,
      workerUrl,
      workers: 2,
      lineNumbers: true,
      stage,
      init: { prefilter: '"key":"MATCH"', chunkSize: 2048 },
    });
    const expected = lines.map((text, i) => ({ n: i + 1, text })).filter((x) => x.text.includes('"key":"MATCH"'));
    assert.deepEqual(res.results, expected);
    assert.equal(res.matchedLines, expected.length);
    assert.equal(res.lines, lines.length);
    assert.equal(progressed, fs.statSync(file).size);
  });

  it('reports transform exceptions per line without failing the run', async () => {
    const res = await runParallelJsonl<{ n: number }>({
      file,
      workerUrl,
      workers: 2,
      lineNumbers: true,
      init: { failOn: 'слово13"' },
    });
    assert.equal(res.lineErrorCount, 1);
    assert.equal(res.lineErrors[0].line, 13);
    assert.ok(!res.results.some((r) => r.n === 13));
  });
});
