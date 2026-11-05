import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HistoryPolicy, hrefForRoute, isPlainClick, parseRoute, routeToSearch } from './url.ts';

test('parseRoute', () => {
  assert.deepEqual(parseRoute('?q=%D1%81%D0%BE%D0%B1%D0%B0%D0%BA%D0%B0'), { q: 'собака' });
  assert.deepEqual(parseRoute('?q=замок&e=замок~noun~2'), { q: 'замок', e: 'замок~noun~2' });
  assert.deepEqual(parseRoute('?view=about'), { q: '', view: 'about' });
  assert.deepEqual(parseRoute(''), { q: '' });
});

test('routeToSearch round-trips and preserves the data param', () => {
  const s = routeToSearch({ q: 'hot dog', e: 'x~noun' });
  assert.deepEqual(parseRoute(s), { q: 'hot dog', e: 'x~noun' });
  assert.equal(routeToSearch({ q: 'пес' }, '?q=old&data=data-fixture'), `?q=${encodeURIComponent('пес')}&data=data-fixture`);
  assert.equal(routeToSearch({ q: '' }), '');
  assert.equal(hrefForRoute({ q: '' }), './');
  assert.equal(routeToSearch({ q: 'x', view: 'about' }), '?view=about');
});

test('history policy: first keystroke after a navigation pushes, then replaces', () => {
  const p = new HistoryPolicy();
  assert.equal(p.onType(), 'push'); // first keystroke after load
  assert.equal(p.onType(), 'replace');
  assert.equal(p.onType(), 'replace');
  p.onNavigate(); // link click / back / Enter
  assert.equal(p.onType(), 'push');
  assert.equal(p.onType(), 'replace');
});

test('isPlainClick', () => {
  const base = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };
  assert.equal(isPlainClick(base), true);
  assert.equal(isPlainClick({ ...base, button: 1 }), false);
  assert.equal(isPlainClick({ ...base, metaKey: true }), false);
});
