import { test } from 'node:test';
import assert from 'node:assert/strict';
import { englishQueryTokens } from '@ukdict/shared';
import type { CoreFile } from '@ukdict/shared';
import { detectScript, englishSearch, exactIds, infixIds, lowerBound, prefixIds, prefixPostings } from './search.ts';

const keys = ['заспівати', 'пісня', 'співак', 'співати', 'співаючий', 'спів', 'стіл'].sort();
const idsFor: Record<string, number[]> = { заспівати: [25], пісня: [16], співак: [23], співати: [15], співаючий: [40], спів: [30], стіл: [13] };
const core: CoreFile = { keys, ids: keys.map((k) => idsFor[k]) };

test('lowerBound / exact', () => {
  assert.equal(keys[lowerBound(keys, 'співа')], 'співак');
  assert.deepEqual(exactIds(core, 'співати'), [15]);
  assert.deepEqual(exactIds(core, 'співат'), []);
});

test('prefix tier excludes the exact key and orders by id (frequency)', () => {
  assert.deepEqual(prefixIds(core, 'співа', new Set()).ids, [15, 23, 40]);
  assert.deepEqual(prefixIds(core, 'спів', new Set()).ids, [15, 23, 40], 'exact key "спів" itself excluded');
  assert.deepEqual(prefixIds(core, 'співа', new Set([15])).ids, [23, 40]);
  const capped = prefixIds(core, 'с', new Set(), 2);
  assert.deepEqual(capped, { ids: [13, 15], total: 5 });
});

test('infix tier: contains but does not start with; needs ≥ 2 chars', () => {
  assert.deepEqual(infixIds(core, 'співа', new Set()).ids, [25]);
  assert.deepEqual(infixIds(core, 'с', new Set()).ids, []);
});

test('script detection', () => {
  assert.equal(detectScript('собака'), 'cyrillic');
  assert.equal(detectScript('dog'), 'latin');
  assert.equal(detectScript('dog собака'), 'mixed');
  assert.equal(detectScript('123'), 'other');
});

test('english: AND across tokens, weights summed, score desc then id asc', () => {
  const index: Record<string, number[]> = {
    dog: [17, 3, 24, 3, 27, 2, 29, 1],
    hot: [29, 2, 50, 1],
    hound: [24, 2],
    house: [11, 3],
  };
  const lookup = (t: string) => index[t];
  const pre = (p: string) => prefixPostings(index, p);
  assert.deepEqual(englishSearch(englishQueryTokens('dog'), lookup, pre), [
    [17, 3],
    [24, 3],
    [27, 2],
    [29, 1],
  ]);
  assert.deepEqual(englishSearch(englishQueryTokens('hot dog'), lookup, pre), [[29, 3]]);
  assert.deepEqual(englishSearch(englishQueryTokens('the cat'), lookup, pre), []);
  // last-token prefix match while typing: "hou" → hound (weight 2 * 0.5) and house (3 * 0.5)
  assert.deepEqual(englishSearch(englishQueryTokens('hou'), lookup, pre), [
    [11, 1.5],
    [24, 1],
  ]);
  // trailing space = word finished → no prefix expansion
  assert.deepEqual(englishSearch(englishQueryTokens('hou '), lookup, pre), []);
});
