import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTui } from './index.ts';
import { humanBytes, humanDuration, formatRate, truncateAnsi, visibleWidth } from './format.ts';

function fakeStream(isTTY: boolean) {
  const chunks: string[] = [];
  const s = { isTTY, columns: 100, write: (x: string) => (chunks.push(x), true) };
  return { stream: s as unknown as NodeJS.WriteStream, text: () => chunks.join('') };
}

test('format helpers', () => {
  assert.equal(humanBytes(512), '512 B');
  assert.equal(humanBytes(1536), '1.5 KB');
  assert.equal(humanBytes(300 * 1024 * 1024), '300 MB');
  assert.equal(humanDuration(1500), '1.5s');
  assert.equal(humanDuration(83_000), '1m 23s');
  assert.equal(formatRate(2.5, 'requests'), '2.5 req/s');
  const t = truncateAnsi('\x1b[32mhello world\x1b[0m', 6);
  assert.equal(visibleWidth(t), 6);
});

test('plain mode logs stage start/end', () => {
  const { stream, text } = fakeStream(false);
  const tui = createTui({ stream });
  assert.equal(tui.plain, true);
  tui.plan([{ id: 'a', label: 'Stage A' }, { id: 'b', label: 'Stage B' }]);
  const a = tui.stage('a', 'Stage A');
  a.setTotal(100, 'items');
  a.tick(50);
  tui.log('hello');
  a.done('50 things');
  const sub = tui.scoped('b');
  const b1 = sub.stage('kaikki', 'ignored label');
  const b2 = sub.stage('workers', 'Workers');
  b2.done();
  b1.fail(new Error('boom'));
  tui.close();
  const out = text();
  assert.match(out, /▶ Stage A/);
  assert.match(out, /✓ Stage A \(.*\) — 50 things/);
  assert.match(out, /hello/);
  assert.match(out, /✗ Stage B: boom/);
  const infos = tui.stages();
  assert.deepEqual(
    infos.map((s) => [s.id, s.state]),
    [
      ['a', 'done'],
      ['b', 'failed'],
      ['b/workers', 'done'],
    ],
  );
});

test('tty mode renders live block with cursor movement', () => {
  const { stream, text } = fakeStream(true);
  const prevCI = process.env.CI;
  delete process.env.CI;
  try {
    const tui = createTui({ stream });
    assert.equal(tui.plain, false);
    tui.plan([{ id: 'x', label: 'Read file' }]);
    const x = tui.stage('x', 'Read file');
    x.setTotal(2048, 'bytes');
    x.set(1024);
    tui.log('a log line');
    x.done('ok');
    tui.close();
    const out = text();
    assert.match(out, /\x1b\[\?25l/);
    assert.match(out, /\x1b\[\?25h/);
    assert.match(out, /a log line/);
    assert.match(out, /✓/);
    assert.match(out, /\x1b\[\d+A/);
  } finally {
    if (prevCI !== undefined) process.env.CI = prevCI;
  }
});
