import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CASE_ORDER_GROUPED, CASE_ORDER_TRADITIONAL } from '@ukdict/shared';
import type { Paradigm } from '@ukdict/shared';
import { layoutParadigm, mergeGrid } from './table.ts';
import type { CellData } from './table.ts';

const c = (form: string, slot = form): CellData => ({ slots: [slot], forms: [{ form }] });

/** Compact rendering of a merged grid: "text:colspan×rowspan" per rendered cell. */
const show = (rows: ReturnType<typeof mergeGrid>) =>
  rows.map((r) => r.map((x) => `${x.data?.forms[0]?.form ?? '∅'}:${x.colSpan}x${x.rowSpan}`).join(' '));

test('horizontal merge of identical neighbours', () => {
  assert.deepEqual(show(mergeGrid([[c('a'), c('a'), c('b'), c('a')]])), ['a:2x1 b:1x1 a:1x1']);
});

test('vertical merge requires same start column and span', () => {
  const rows = [
    [c('x'), c('n')],
    [c('x'), c('m')],
    [c('y'), c('m')],
  ];
  assert.deepEqual(show(mergeGrid(rows)), ['x:1x2 n:1x1', 'm:1x2', 'y:1x1']);
});

test('horizontal first, then vertical with equal colspan', () => {
  const rows = [
    [c('g'), c('g'), c('f')],
    [c('g'), c('g'), c('f2')],
    [c('g'), c('h'), c('f2')],
  ];
  // Row 3's "g" has span 1, row 2's merged "g" span 2 → no vertical merge for it.
  assert.deepEqual(show(mergeGrid(rows)), ['g:2x2 f:1x1', 'f2:1x2', 'g:1x1 h:1x1']);
});

test('empty cells never merge', () => {
  assert.deepEqual(show(mergeGrid([[null, null], [null, null]])), ['∅:1x1 ∅:1x1', '∅:1x1 ∅:1x1']);
});

test('merged cells accumulate slot keys', () => {
  const rows = mergeGrid([[c('стіл', 'nom.sg')], [c('стіл', 'acc.sg')]]);
  assert.deepEqual(rows[0][0].data?.slots, ['nom.sg', 'acc.sg']);
  assert.equal(rows[1].length, 0);
});

const stil: Paradigm = {
  kind: 'noun',
  source: 'wiktionary',
  forms: {
    'nom.sg': [{ form: 'стіл' }],
    'acc.sg': [{ form: 'стіл' }],
    'gen.sg': [{ form: 'стола́' }],
    'dat.sg': [{ form: 'столу́' }],
    'nom.pl': [{ form: 'столи́' }],
    'acc.pl': [{ form: 'столи́' }],
    'gen.pl': [{ form: 'столі́в' }],
    'dat.pl': [{ form: 'стола́м' }],
  },
};

test('noun: inanimate nom = acc merge in grouped order, not in traditional order', () => {
  const g = layoutParadigm(stil, { caseOrder: CASE_ORDER_GROUPED });
  const rowsG = g.sections[0].rows;
  assert.deepEqual(
    rowsG.map((r) => r.key),
    ['nom', 'acc', 'gen', 'dat'],
    'empty ins/loc/voc rows hidden',
  );
  assert.equal(rowsG[0].cells[0].rowSpan, 2);
  assert.equal(rowsG[1].cells.length, 0);
  const t = layoutParadigm(stil, { caseOrder: CASE_ORDER_TRADITIONAL });
  assert.ok(t.sections[0].rows.every((r) => r.cells.every((x) => x.rowSpan === 1)));
});

test('noun: empty plural column hidden', () => {
  const p: Paradigm = { kind: 'noun', source: 'x', forms: { 'nom.sg': [{ form: 'я' }], 'gen.sg': [{ form: 'мене́' }] } };
  const l = layoutParadigm(p, { caseOrder: CASE_ORDER_GROUPED });
  assert.deepEqual(
    l.sections[0].columns.map((x) => x.key),
    ['sg'],
  );
});

test('adjective: animacy-split accusative rows, m/n merge, extras below', () => {
  const p: Paradigm = {
    kind: 'adjectival',
    source: 'wiktionary',
    forms: {
      'nom.m': [{ form: 'зеле́ний' }],
      'nom.n': [{ form: 'зеле́не' }],
      'nom.f': [{ form: 'зеле́на' }],
      'nom.pl': [{ form: 'зеле́ні' }],
      'gen.m': [{ form: 'зеле́ного' }],
      'gen.n': [{ form: 'зеле́ного' }],
      'gen.f': [{ form: 'зеле́ної' }],
      'gen.pl': [{ form: 'зеле́них' }],
      'acc.m.inan': [{ form: 'зеле́ний' }],
      'acc.m.anim': [{ form: 'зеле́ного' }],
      'acc.n': [{ form: 'зеле́не' }],
      'acc.f': [{ form: 'зеле́ну' }],
      'acc.pl.inan': [{ form: 'зеле́ні' }],
      'acc.pl.anim': [{ form: 'зеле́них' }],
      cmp: [{ form: 'зелені́ший' }],
    },
  };
  const l = layoutParadigm(p, { caseOrder: CASE_ORDER_GROUPED });
  const rows = l.sections[0].rows;
  assert.deepEqual(
    rows.map((r) => r.key),
    ['nom', 'acc-inan', 'acc-anim', 'gen'],
  );
  // nom.m = acc.m.inan → rowspan 2; neuter nom = acc (both rows) → rowspan 3
  assert.equal(rows[0].cells[0].rowSpan, 2);
  assert.equal(rows[0].cells[1].rowSpan, 3);
  // feminine acc.f reused in both acc rows → merged
  assert.equal(rows[1].cells.find((x) => x.col === 2)?.rowSpan, 2);
  // gen m+n merged horizontally
  assert.equal(rows[3].cells[0].colSpan, 2);
  // plural: acc anim = gen → merged vertically
  assert.equal(rows[2].cells.find((x) => x.col === 3)?.rowSpan, 2);
  assert.deepEqual(
    l.extras.map((x) => x.label),
    ['comparative'],
  );
});

test('verb: past plural spans the m/f/n rows; analytic future note for imperfective', () => {
  const p: Paradigm = {
    kind: 'verb',
    source: 'wiktionary',
    forms: {
      inf: [{ form: 'говори́ти' }],
      'pres.1sg': [{ form: 'говорю́' }],
      'past.m': [{ form: 'говори́в' }],
      'past.f': [{ form: 'говори́ла' }],
      'past.n': [{ form: 'говори́ло' }],
      'past.pl': [{ form: 'говори́ли' }],
    },
  };
  const l = layoutParadigm(p, { caseOrder: CASE_ORDER_GROUPED, aspect: 'imperfective' });
  assert.deepEqual(
    l.sections.map((s) => s.key),
    ['inf', 'pres', 'fut', 'past'],
  );
  const past = l.sections.find((s) => s.key === 'past')!;
  assert.equal(past.rows[0].cells[1].rowSpan, 3);
  const fut = l.sections.find((s) => s.key === 'fut')!;
  assert.equal(fut.rows.length, 0);
  assert.match(fut.note!.text, /бу́ду/);
  // pres: empty plural column hidden
  assert.equal(l.sections.find((s) => s.key === 'pres')!.columns.length, 1);
});

test('verb: perfective gets no analytic-future note', () => {
  const p: Paradigm = { kind: 'verb', source: 'x', forms: { inf: [{ form: 'заспіва́ти' }] } };
  const l = layoutParadigm(p, { caseOrder: CASE_ORDER_GROUPED, aspect: 'perfective' });
  assert.deepEqual(
    l.sections.map((s) => s.key),
    ['inf'],
  );
});
