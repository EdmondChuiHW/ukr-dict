import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeSlots } from './labels.ts';

test('describeSlots merges genders/numbers that share the same cases', () => {
  assert.equal(describeSlots(['dat.m', 'loc.m', 'dat.n', 'loc.n']), 'dative and locative masculine and neuter');
  assert.equal(describeSlots(['gen.pl', 'acc.pl']), 'genitive and accusative plural');
  assert.equal(describeSlots(['dat.sg', 'gen.pl']), 'dative singular; genitive plural');
});
