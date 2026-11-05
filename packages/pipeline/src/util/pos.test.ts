import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { INFLECTABLE_POS, mapKaikkiPos, posCompatible } from './pos.ts';

describe('pos', () => {
  it('maps kaikki POS values', () => {
    assert.equal(mapKaikkiPos('name'), 'proper-noun');
    assert.equal(mapKaikkiPos('det'), 'determiner');
    assert.equal(mapKaikkiPos('character'), 'letter');
    assert.equal(mapKaikkiPos('prep_phrase'), 'prepositional-phrase');
    assert.equal(mapKaikkiPos('combining_form'), 'combining-form');
    assert.equal(mapKaikkiPos('punct'), 'punctuation');
    assert.equal(mapKaikkiPos('postp'), 'postposition');
    assert.equal(mapKaikkiPos('whatever'), 'other');
  });
  it('compatibility is symmetric and loose within families', () => {
    assert.ok(posCompatible('noun', 'proper-noun') && posCompatible('proper-noun', 'noun'));
    assert.ok(posCompatible('adjective', 'determiner') && posCompatible('pronoun', 'determiner'));
    assert.ok(posCompatible('adverb', 'predicative'));
    assert.ok(posCompatible('other', 'verb'));
    assert.ok(!posCompatible('noun', 'verb'));
    assert.ok(!posCompatible('conjunction', 'pronoun'));
  });
  it('inflectable POS', () => {
    assert.ok(INFLECTABLE_POS.has('verb') && INFLECTABLE_POS.has('proper-noun'));
    assert.ok(!INFLECTABLE_POS.has('adverb'));
  });
});
