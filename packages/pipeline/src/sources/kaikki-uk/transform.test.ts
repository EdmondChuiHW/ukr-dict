import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ALL_SLOTS, type Sense } from '@ukdict/shared';
import type { DraftEntry, IgnoredEntry } from '../../contracts.ts';
import { buildParadigm, cleanFormText } from './paradigm.ts';
import { cleanRelatedWord, collapseList, looksConcatenated } from './relations.ts';
import { cleanWordRef, inferFormOf, locateLinks } from './senses.ts';
import { newTransformStats, parseHeadExpansion, transformKaikkiEntry, type TransformResult } from './transform.ts';

const FIXTURE = fileURLToPath(new URL('../../../test-fixtures/kaikki-uk-sample.jsonl', import.meta.url));
const raws = fs
  .readFileSync(FIXTURE, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l, i) => ({ raw: JSON.parse(l), line: i + 1 }));
const stats = newTransformStats();
const results: TransformResult[] = raws.map(({ raw, line }) => transformKaikkiEntry(raw, line, stats));

function entries(word: string, pos?: string): DraftEntry[] {
  return results.flatMap((r) => (r.kind === 'entry' && r.draft.word === word && (!pos || r.draft.pos === pos) ? [r.draft] : []));
}
function entry(word: string, pos?: string): DraftEntry {
  const e = entries(word, pos);
  assert.ok(e.length > 0, `no entry ${word} ${pos ?? ''}`);
  return e[0];
}
function ignored(word: string, pos?: string): IgnoredEntry | undefined {
  for (const r of results) if (r.kind === 'ignored' && r.ignored.word === word && (!pos || r.ignored.pos === pos)) return r.ignored;
  return undefined;
}
const forms = (e: DraftEntry, slot: string) => e.paradigm?.forms[slot]?.map((f) => f.form);
const words = (list: { word: string }[] | undefined) => (list ?? []).map((t) => t.word);

describe('kaikki-uk transform', () => {
  it('maps every table form of the fixture to known slots', () => {
    assert.equal(stats.unmappedForms, 0, JSON.stringify([...stats.unmapped]));
    for (const r of results) {
      if (r.kind !== 'entry' || !r.draft.paradigm) continue;
      for (const slot of Object.keys(r.draft.paradigm.forms)) assert.ok(ALL_SLOTS.has(slot), `${r.draft.word}: unknown slot ${slot}`);
    }
  });

  it('собака: m+f animate noun, noun paradigm, relations, pronunciation, sources, origin', () => {
    const [e1, e2] = entries('собака');
    assert.ok(e1 && e2, 'two etymology/sense entries are kept separately');
    assert.equal(e1.pos, 'noun');
    assert.deepEqual(e1.heads, ['соба́ка']);
    assert.deepEqual(e1.genders, ['m', 'f']);
    assert.equal(e1.animacy, 'animate');
    assert.equal(e1.paradigm?.kind, 'noun');
    assert.equal(e1.paradigm?.source, 'wiktionary');
    assert.deepEqual(e1.paradigm?.notes, ['accent-a', 'uk-ndecl']);
    assert.deepEqual(forms(e1, 'nom.sg'), ['соба́ка']);
    assert.deepEqual(forms(e1, 'acc.pl'), ['соба́ки', 'соба́к']);
    assert.deepEqual(forms(e1, 'voc.sg'), ['соба́ко']);
    assert.deepEqual(words(e1.relations?.diminutive), ['соба́чка']);
    const syn = e1.senses[0].relations?.synonym ?? [];
    assert.deepEqual(words(syn), ['пес', 'су́ка']);
    assert.deepEqual(syn[1].tags, ['vulgar']);
    assert.equal(syn[1].english, 'female dog');
    assert.equal(e1.pronunciation?.ipa?.[0].value, '[sɔˈbakɐ]');
    assert.ok(e1.pronunciation?.audio?.[0].mp3?.endsWith('.mp3'));
    assert.deepEqual(
      e1.sources.map((s) => s.source),
      ['wiktionary', 'kaikki'],
    );
    assert.equal(e1.sources[0].url, 'https://en.wiktionary.org/wiki/%D1%81%D0%BE%D0%B1%D0%B0%D0%BA%D0%B0#Ukrainian');
    assert.deepEqual(e1.origin, { source: 'kaikki-uk', line: raws.find((r) => r.raw.word === 'собака')!.line, kaikkiPos: 'noun' });
    assert.deepEqual(e2.senses[0].tags, ['figuratively', 'derogatory']);
  });

  it('стіл: gender/animacy from the head line when there is no canonical form; redundant sense tags dropped', () => {
    const e = entry('стіл');
    assert.deepEqual(e.heads, ['стіл']);
    assert.deepEqual(e.genders, ['m']);
    assert.equal(e.animacy, 'inanimate');
    assert.equal(e.senses[0].tags, undefined, 'masculine/inanimate restate the header');
    assert.deepEqual(forms(e, 'gen.sg'), ['стола́', 'сто́лу']);
    assert.deepEqual(words(e.relations?.diminutive), ['сто́лик']);
  });

  it('співати: imperfective verb, kaikki aspect partner, verb slots', () => {
    const e = entry('співати');
    assert.equal(e.aspect, 'imperfective');
    assert.deepEqual(e.aspectPartners, [{ word: 'поспіва́ти', aspect: 'perfective', source: 'kaikki' }]);
    assert.equal(e.paradigm?.kind, 'verb');
    assert.deepEqual(forms(e, 'inf'), ['співа́ти', 'співа́ть']);
    assert.deepEqual(forms(e, 'pres.1sg'), ['співа́ю']);
    assert.deepEqual(forms(e, 'fut.1sg'), ['співа́тиму']);
    assert.deepEqual(forms(e, 'pres.1pl'), ['співа́ємо', 'співа́єм']);
    assert.deepEqual(forms(e, 'past.m'), ['співа́в']);
    assert.deepEqual(forms(e, 'past.pl'), ['співа́ли']);
    assert.deepEqual(forms(e, 'imp.2sg'), ['співа́й']);
    assert.equal(forms(e, 'imp.1sg'), undefined, 'placeholder "-" is not a form');
    assert.deepEqual(forms(e, 'ptcp.pass.past'), ['спі́ваний']);
    assert.deepEqual(forms(e, 'impers'), ['спі́вано']);
    assert.deepEqual(forms(e, 'advp.pres'), ['співа́ючи']);
    assert.deepEqual(forms(e, 'advp.past'), ['співа́вши']);
    assert.ok(!Object.values(e.paradigm!.forms).flat().some((f) => f!.form.includes('бу́де')), 'analytic forms dropped');
    assert.deepEqual(e.senses[0].tags, ['intransitive']);
    assert.deepEqual(words(e.relations?.derived), ['відспіва́ти', 'спів', 'співак', 'співачка']);
  });

  it('зловити (pf): simple future in fut.*, no present', () => {
    const e = entry('зловити');
    assert.equal(e.aspect, 'perfective');
    assert.deepEqual(e.aspectPartners?.map((p) => [p.word, p.aspect]), [['лови́ти', 'imperfective']]);
    assert.deepEqual(forms(e, 'fut.1sg'), ['зловлю́']);
    assert.equal(forms(e, 'pres.1sg'), undefined);
  });

  it('родити (biaspectual): present/future column → pres.*, synthetic future → fut.*', () => {
    const e = entry('родити');
    assert.equal(e.aspect, 'biaspectual');
    assert.deepEqual(forms(e, 'pres.1sg'), ['роджу́']);
    assert.deepEqual(forms(e, 'fut.1sg'), ['роди́тиму']);
    assert.deepEqual(
      e.aspectPartners?.map((p) => p.word),
      ['народи́ти', 'вроди́ти'],
    );
  });

  it('зелений: adjectival paradigm with animacy-split accusative, short form, cmp/sup from head, qualified variants last', () => {
    const e = entry('зелений');
    assert.equal(e.paradigm?.kind, 'adjectival');
    assert.deepEqual(forms(e, 'nom.m'), ['зеле́ний']);
    assert.deepEqual(forms(e, 'gen.n'), ['зеле́ного']);
    assert.deepEqual(forms(e, 'acc.m.anim'), ['зеле́ного']);
    assert.deepEqual(forms(e, 'acc.m.inan'), ['зеле́ний']);
    assert.deepEqual(forms(e, 'acc.f'), ['зеле́ну', 'зеле́ную']);
    assert.deepEqual(e.paradigm?.forms['nom.f']?.[1], { form: 'зеле́ная', tags: ['dated', 'dialectal'] });
    assert.deepEqual(forms(e, 'short.m'), ['зе́лен']);
    assert.deepEqual(forms(e, 'cmp'), ['зелені́ший']);
    assert.deepEqual(forms(e, 'sup'), ['найзелені́ший']);
    assert.equal(e.extraForms, undefined);
  });

  it('мій: possessive pronoun with adjectival table and dated/dialectal variants', () => {
    const e = entry('мій');
    assert.equal(e.pos, 'pronoun');
    assert.equal(e.paradigm?.kind, 'adjectival');
    assert.deepEqual(forms(e, 'gen.m'), ['мого́', 'мойо́го', 'моє́го']);
    assert.deepEqual(e.paradigm?.forms['gen.m']?.[1].tags, ['dated', 'dialectal']);
    assert.deepEqual(forms(e, 'nom.pl'), ['мої́']);
  });

  it('два: plural not distinctive → gendered columns, ungendered forms in m/n/f', () => {
    const e = entry('два');
    assert.equal(e.pos, 'numeral');
    assert.deepEqual(e.genders, ['m', 'n']);
    assert.equal(e.paradigm?.kind, 'adjectival');
    assert.deepEqual(forms(e, 'nom.m'), ['два']);
    assert.deepEqual(forms(e, 'nom.n'), ['два']);
    assert.deepEqual(forms(e, 'nom.f'), ['дві']);
    for (const g of ['m', 'n', 'f']) assert.deepEqual(forms(e, `gen.${g}`), ['двох']);
    assert.deepEqual(forms(e, 'acc.f.inan'), ['дві']);
    assert.deepEqual(forms(e, 'acc.m.anim'), ['двох']);
    assert.equal(forms(e, 'nom.pl'), undefined);
  });

  it("п'ять: plural-only numeral → adjectival pl column", () => {
    const e = entry("п'ять");
    assert.equal(e.paradigm?.kind, 'adjectival');
    assert.deepEqual(forms(e, 'gen.pl'), ["п'яти́", "п'ятьо́х"]);
    assert.deepEqual(forms(e, 'acc.pl.anim'), ["п'ять", "п'ятьо́х"]);
    assert.deepEqual(forms(e, 'acc.pl.inan'), ["п'ять"]);
  });

  it('я / він: personal pronoun pages keep only the own column, as noun slots', () => {
    const ya = entry('я', 'pronoun');
    assert.equal(ya.paradigm?.kind, 'noun');
    assert.deepEqual(forms(ya, 'nom.sg'), ['я']);
    assert.deepEqual(forms(ya, 'gen.sg'), ['мене́', 'ме́не']);
    assert.deepEqual(forms(ya, 'ins.sg'), ['мно́ю']);
    assert.equal(forms(ya, 'nom.pl'), undefined);
    const all = Object.values(ya.paradigm!.forms).flat().map((f) => f!.form);
    assert.ok(!all.includes('тебе́') && !all.includes('ми') && !all.includes('себе́'));
    const vin = entry('він');
    assert.deepEqual(forms(vin, 'gen.sg'), ['його́', 'ньо́го']);
    assert.deepEqual(forms(vin, 'loc.sg'), ['ньо́му', 'нім']);
    assert.ok(!Object.values(vin.paradigm!.forms).flat().some((f) => f!.form === 'воно́'));
    assert.equal(entry('я', 'letter').pos, 'letter');
  });

  it('по: gloss hierarchy → headerOnly parents with subsenses', () => {
    const e = entry('по');
    assert.equal(e.pos, 'preposition');
    assert.equal(e.senses.length, 2);
    const [loc, acc] = e.senses;
    assert.equal(loc.gloss, '[with locative]');
    assert.equal(loc.headerOnly, true);
    assert.ok((loc.subsenses?.length ?? 0) > 10);
    assert.equal(loc.subsenses?.[1].gloss, 'in the direction of');
    assert.equal(acc.gloss, '[with accusative]');
    assert.ok(acc.subsenses!.some((s) => s.gloss === 'until'));
    const mourn = loc.subsenses!.find((s) => s.gloss.startsWith('used to indicate someone or something that is being mourned'))!;
    assert.deepEqual(mourn.tags, ['colloquial']);
    assert.ok(loc.subsenses![0].examples!.length >= 2);
    assert.equal(loc.subsenses![0].examples![0].source, 'wiktionary');
    assert.equal(loc.subsenses![0].examples![0].translation, 'Pens are strewn across the table.');
  });

  it('ручка / є / колонка: mixed entries are kept, form-of senses carry formOf + links', () => {
    const r = entry('ручка');
    const dim = r.senses.find((s) => s.formOf)!;
    assert.deepEqual(dim.formOf, [{ word: 'рука́', tags: ['diminutive'] }]);
    assert.deepEqual(dim.links?.map((l) => [dim.gloss.slice(l.start, l.end), l.target]), [['рука́', 'рука']]);
    const ye = entry('є', 'verb');
    assert.deepEqual(ye.senses[0].formOf, [{ word: 'бу́ти', tags: ['indicative', 'present'] }]);
    assert.equal(ye.senses[0].tags, undefined, 'inflectional tags move to formOf');
    assert.equal(ye.senses.length, 4);
    const kol = entries('колонка');
    assert.equal(kol.length, 1);
    assert.deepEqual(kol[0].senses[0].formOf, [{ word: 'коло́на', tags: ['diminutive'] }], 'trailing " f" stripped');
    assert.equal(ignored('колонка')?.formOf[0].word, 'колоно́к');
  });

  it('inflected-form-only entries are ignored with base forms and tags (лиса, май verb, кращий, лить)', () => {
    const lysaAdj = ignored('лиса', 'adjective')!;
    assert.equal(lysaAdj.reason, 'inflected-form-only');
    assert.deepEqual(lysaAdj.formOf, [{ word: 'ли́сий', tags: ['feminine', 'nominative', 'singular'] }]);
    assert.equal(lysaAdj.kaikkiPos, 'adj');
    assert.ok(lysaAdj.url.startsWith('https://en.wiktionary.org/wiki/'));
    assert.deepEqual(ignored('лиса', 'noun')!.formOf, [{ word: 'лис', tags: ['accusative', 'genitive', 'singular'] }]);
    const maj = ignored('май', 'verb')!;
    assert.deepEqual(maj.formOf, [{ word: 'ма́ти', tags: ['imperative', 'imperfective', 'second-person', 'singular'] }]);
    assert.equal(entry('май', 'noun').genders?.[0], 'm');
    const krashchyi = ignored('кращий')!;
    assert.deepEqual(
      krashchyi.formOf.map((f) => f.word),
      ['краси́вий', 'га́рний', 'до́брий', 'хоро́ший'],
    );
    // form-of not marked up by kaikki, recognized from the gloss
    assert.deepEqual(ignored('лить')!.formOf, [{ word: 'ли́ти', tags: ['infinitive', 'short-form'] }]);
  });

  it('ножиці: plural-only noun', () => {
    const e = entry('ножиці');
    assert.equal(e.number, 'plural-only');
    assert.deepEqual(e.genders, ['f']);
    assert.equal(e.senses[0].tags, undefined, '"plural, plural-only" restate the header');
    assert.deepEqual(forms(e, 'nom.pl'), ['но́жиці']);
    assert.deepEqual(words(e.relations?.['relational-adjective']), ['но́жичний']);
  });

  it('Україна: proper noun with head relations; Thesaurus pseudo-entry kept with relations only', () => {
    const e = entry('Україна', 'proper-noun');
    assert.deepEqual(e.genders, ['f']);
    assert.equal(e.animacy, 'inanimate');
    assert.deepEqual(words(e.relations?.['relational-adjective']), ['украї́нський']);
    assert.deepEqual(words(e.relations?.alternative), ['Вкраї́на', 'Укра́йна']);
    assert.deepEqual(e.relations?.related?.find((t) => t.word === 'украї́нка')?.tags, ['demonym', 'feminine']);
    assert.ok((e.senses[0].relations?.meronym?.length ?? 0) > 20);
    const t = entry('Україна', 'noun');
    assert.deepEqual(t.senses, []);
    const syn = t.relations?.synonym ?? [];
    assert.ok(syn.some((s) => s.word === 'Батьківщина'), 'romanization in parentheses stripped');
    assert.ok(!syn.some((s) => s.word === 'Україна'), 'headword itself dropped');
  });

  it('замок: homonyms with different stress stay separate, etymology numbers recorded', () => {
    const z = entries('замок');
    assert.deepEqual(
      z.map((e) => [e.heads[0], e.origin.etymologyNumber]),
      [
        ['за́мок', 1],
        ['замо́к', 2],
      ],
    );
  });

  it('що: conj and pronoun entries; glued navbox artefacts removed from relations', () => {
    assert.equal(entry('що', 'conjunction').senses[0].gloss, 'that');
    const p = entry('що', 'pronoun');
    assert.deepEqual(forms(p, 'gen.sg'), ['чого́', 'чо́го']);
    const coord = words(p.relations?.coordinate);
    assert.ok(coord.includes('хто'));
    assert.ok(!coord.includes('цесе'));
  });

  it('фактор: animacy-dependent table cells keep their animacy as qualifier', () => {
    const e = entry('фактор');
    assert.equal(e.animacy, 'inanimate', 'first animacy of "m inan or m pers"');
    assert.deepEqual(e.paradigm?.forms['gen.sg'], [
      { form: 'фа́ктору', tags: ['inanimate'] },
      { form: 'фа́ктора', tags: ['personal'] },
    ]);
  });

  it('gloss-less entries with useful content are kept with empty senses', () => {
    const [a, b] = entries('поводитися');
    assert.ok(a.senses.length > 0);
    assert.ok(b.paradigm && b.senses.length === 0);
  });
});

describe('kaikki-uk helpers', () => {
  it('cleanWordRef strips trailing grammar tokens and anchors', () => {
    assert.equal(cleanWordRef('ску́чити pf'), 'ску́чити');
    assert.equal(cleanWordRef('коло́на f'), 'коло́на');
    assert.equal(cleanWordRef('собака#Ukrainian'), 'собака');
    assert.equal(cleanWordRef('ру́ки pl'), 'ру́ки');
  });

  it('cleanRelatedWord / looksConcatenated', () => {
    assert.equal(cleanRelatedWord('Ненька (Nenʹka)'), 'Ненька');
    assert.equal(cleanRelatedWord('Z#Russian'), undefined);
    assert.equal(cleanRelatedWord('дев\'яно́стоdialectal: дев\'ятдес́ят'), undefined);
    assert.equal(cleanRelatedWord('у [genitive of possessor] є'), 'у [genitive of possessor] є');
    assert.equal(looksConcatenated('цесе', 'ce'), true);
    assert.equal(looksConcatenated('і́нше', 'ínše'), false);
    assert.equal(looksConcatenated('Ві́нницька обл', 'Vínnycʹka obl.'), false);
  });

  it('collapseList merges duplicates by search key, prefers stressed spelling, drops the headword', () => {
    const out = collapseList(
      [
        { word: 'пес' },
        { word: 'собака' },
        { word: 'сука', tags: ['vulgar'] },
        { word: 'су́ка', english: 'female dog' },
        { word: 'Пес', sense: 'dog' },
      ],
      'собака',
    );
    assert.deepEqual(out, [
      { word: 'пес', sense: 'dog' },
      { word: 'су́ка', tags: ['vulgar'], english: 'female dog' },
    ]);
  });

  it('locateLinks finds Cyrillic link texts in the gloss (non-overlapping), skips missing ones', () => {
    const gloss = 'diminutive of рука́ (ruká): рука́ again';
    const links = locateLinks(gloss, [
      ['рука́', 'рука#Ukrainian'],
      ['hand', 'hand'],
      ['нема', 'нема'],
    ]);
    assert.deepEqual(links, [{ start: 14, end: 14 + 'рука́'.length, target: 'рука' }]); // 5 UTF-16 units incl. U+0301
  });

  it('inferFormOf recognizes unmarked inflection glosses only', () => {
    const s = inferFormOf({ glosses: ['genitive/vocative singular of фестива́ль (festyválʹ)'] });
    assert.deepEqual(s.form_of, [{ word: 'фестива́ль' }]);
    assert.deepEqual(s.tags, ['form-of', 'genitive', 'singular', 'vocative']);
    const keep = { glosses: ['lover of собака'] };
    assert.equal(inferFormOf(keep), keep);
  });

  it('parseHeadExpansion reads gender/animacy/aspect tokens of the head line', () => {
    assert.deepEqual(parseHeadExpansion('соба́ка • (sobáka) m animal or f animal (genitive соба́ки)'), [
      'masculine',
      'animal-not-person',
      'feminine',
      'animal-not-person',
    ]);
    assert.deepEqual(parseHeadExpansion('роди́ти • (rodýty) impf or pf (perfective народи́ти)'), ['imperfective', 'perfective']);
    assert.deepEqual(parseHeadExpansion(undefined), []);
  });

  it('cleanFormText drops placeholders and romanizations, strips the impersonal prefix', () => {
    assert.equal(cleanFormText('-'), undefined);
    assert.equal(cleanFormText('nádanyj'), undefined);
    assert.deepEqual(cleanFormText('impersonal: спі́вано'), { text: 'спі́вано', impersonal: true });
  });

  it('buildParadigm returns nothing for entries without tables', () => {
    assert.equal(buildParadigm([{ form: 'po', tags: ['romanization'] }], 'по').paradigm, undefined);
  });

  it('sense tree: a real sense with the parent gloss becomes the parent', () => {
    const r = transformKaikkiEntry(
      {
        word: 'тест',
        pos: 'noun',
        senses: [{ glosses: ['to sing'] }, { glosses: ['to sing', 'to sing a song'] }, { glosses: ['[x]', 'a'] }, { glosses: ['[x]', 'b'] }],
      },
      1,
    );
    assert.equal(r.kind, 'entry');
    const senses = (r as { draft: DraftEntry }).draft.senses as Sense[];
    assert.equal(senses.length, 2);
    assert.equal(senses[0].headerOnly, undefined);
    assert.deepEqual(senses[0].subsenses?.map((s) => s.gloss), ['to sing a song']);
    assert.equal(senses[1].headerOnly, true);
    assert.deepEqual(senses[1].subsenses?.map((s) => s.gloss), ['a', 'b']);
  });

  it("entries without any usable content are ignored as 'no-senses'", () => {
    const r = transformKaikkiEntry({ word: 'пусто', pos: 'noun', senses: [{ tags: ['no-gloss'] }] }, 7);
    assert.equal(r.kind, 'ignored');
    assert.equal((r as { ignored: IgnoredEntry }).ignored.reason, 'no-senses');
    assert.equal((r as { ignored: IgnoredEntry }).ignored.line, 7);
  });
});
