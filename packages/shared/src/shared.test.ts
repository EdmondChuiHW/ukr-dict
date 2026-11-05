import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseStress, searchKey, stressedKey, stripStress } from './normalize.ts';
import { englishIndexTokens, englishQueryTokens } from './english.ts';
import { bucketsForPrefix, findBucket } from './artifacts.ts';
import { groupByTags, remainingTags } from './tags.ts';
import { describeSlot, isKnownSlot } from './paradigm.ts';

describe('normalize', () => {
  it('strips stress but keeps й and ї', () => {
    assert.equal(stripStress('співа́ти'), 'співати');
    assert.equal(stripStress('ї́жак'), 'їжак');
    assert.equal(stripStress('мо̀й'), 'мой');
    assert.equal(stripStress('ѝ'), 'и');
  });
  it('search key is case/stress/apostrophe insensitive', () => {
    assert.equal(searchKey('П’я́ть'), "п'ять");
    assert.equal(searchKey('  Зеле́ний   борщ '), 'зелений борщ');
    assert.notEqual(stressedKey('за́мок'), stressedKey('замо́к'));
    assert.equal(stressedKey('За́мок'), stressedKey('за́мок'));
  });
  it('parses stress positions', () => {
    assert.deepEqual(parseStress('за́мо̀к'), { text: 'замок', marks: [1, 3] });
    assert.deepEqual(parseStress('стіл'), { text: 'стіл', marks: [] });
  });
});

describe('english tokens', () => {
  it('stems, drops stopwords, keeps the last prefix while typing', () => {
    assert.deepEqual(englishIndexTokens('to sing (a song); singing, dogs'), ['sing', 'song', 'dog']);
    assert.deepEqual(englishQueryTokens('to sing'), { tokens: ['sing'], lastPrefix: 'sing' });
    assert.equal(englishQueryTokens('dog ').lastPrefix, undefined);
  });
});

describe('buckets', () => {
  const buckets = { с: 1, сп: 1, спі: 1, з: 1 };
  it('routes keys to the longest existing prefix', () => {
    assert.equal(findBucket(buckets, 'співати'), 'спі');
    assert.equal(findBucket(buckets, 'сад'), 'с');
    assert.equal(findBucket(buckets, 'с'), 'с');
    assert.equal(findBucket(buckets, 'мама'), undefined);
  });
  it('lists every bucket that may hold a prefix', () => {
    assert.deepEqual(bucketsForPrefix(buckets, 'сп').sort(), ['сп', 'спі']);
  });
});

describe('tag grouping', () => {
  it('nests consecutive shared tags and reports remaining ones', () => {
    const items = [
      { g: 'a', t: ['transitive', 'colloquial'] },
      { g: 'b', t: ['transitive', 'colloquial'] },
      { g: 'c', t: ['transitive'] },
      { g: 'd', t: [] as string[] },
    ];
    const groups = groupByTags(items, (x) => x.t);
    assert.equal(groups.length, 2);
    const first = groups[0] as { tag: string; children: unknown[] };
    assert.equal(first.tag, 'transitive');
    assert.equal((first.children[0] as { tag: string }).tag, 'colloquial');
    assert.deepEqual(remainingTags(['colloquial', 'transitive'], new Set(['transitive'])), ['colloquial']);
  });
});

describe('paradigm slots', () => {
  it('knows and describes slots', () => {
    assert.ok(isKnownSlot('acc.m.anim'));
    assert.ok(isKnownSlot('pres.1sg'));
    assert.ok(!isKnownSlot('pres.4sg'));
    assert.equal(describeSlot('gen.pl'), 'genitive plural');
    assert.equal(describeSlot('advp.past'), 'past adverbial participle');
  });
});
