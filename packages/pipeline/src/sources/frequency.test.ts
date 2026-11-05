import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseKnownAspectPairs } from './aspect-pairs.ts';
import { buildFrequencyIndex, parseFrequencyCsv } from './frequency.ts';

const CSV = [
  'rowid;name;part_sp;rate_abs;page_resp',
  '1;і;сполучн.;90902;1',
  '9;що;сполучн.;36898;1',
  '12;Україна;ім. ж. р.;27316;1',
  '20;що;займ.-ім.;20000;1',
  "391;зв'язок;ім. ч. р.;1575;8",
  '500;ООН;абревіатура;1575;9',
  '600;мати;;1000;10',
  '700;мати;ім. ж. р.;900;10',
  '57656;ґустав;;1;1154',
  '',
].join('\r\n');

describe('frequency list', () => {
  const { rows } = parseFrequencyCsv(CSV);
  const idx = buildFrequencyIndex(rows);

  it('ranks by rate_abs desc, ties by rowid', () => {
    assert.equal(idx.size, 9);
    assert.deepEqual(
      rows.map((r) => [r.name, r.rank]),
      [
        ['і', 1],
        ['що', 2],
        ['Україна', 3],
        ['що', 4],
        ["зв'язок", 5],
        ['ООН', 6],
        ['мати', 7],
        ['мати', 8],
        ['ґустав', 9],
      ],
    );
  });

  it('looks up by search key (case, stress, apostrophe insensitive) and only uses POS-compatible rows', () => {
    assert.equal(idx.rank('що', 'conjunction'), 2);
    assert.equal(idx.rank('що', 'pronoun'), 4);
    assert.equal(idx.rank('що', 'verb'), undefined, 'no compatible row → unranked');
    assert.equal(idx.rank('що'), 2);
    assert.equal(idx.rank('Україна', 'proper-noun'), 3);
    assert.equal(idx.rank('украї́на', 'noun'), undefined, 'tagged capitalized row does not rank a common noun');
    assert.equal(idx.rank('зв’язок', 'noun'), 5);
    assert.equal(idx.rank('ООН', 'proper-noun'), 6, 'abbreviation rows match any POS');
    assert.equal(idx.rank('мати', 'noun'), 7, 'empty POS is compatible with anything');
    assert.equal(idx.rank('Ґустав', 'proper-noun'), 9);
    assert.equal(idx.rank('нема-такого'), undefined);
  });
});

describe('known aspect pairs', () => {
  it('parses [impf, pf] pairs, skips invalid items and duplicates', () => {
    assert.deepEqual(parseKnownAspectPairs([['співати', 'заспівати'], [' писати ', 'написати'], ['співати', 'заспіва́ти'], ['x'], 5, null]), [
      { imperfective: 'співати', perfective: 'заспівати' },
      { imperfective: 'писати', perfective: 'написати' },
    ]);
    assert.throws(() => parseKnownAspectPairs({}));
  });
});
