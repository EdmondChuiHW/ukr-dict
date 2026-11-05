import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { isKnownSlot } from '@ukdict/shared';
import type { LcorpEntry } from '../../contracts.ts';
import { fixture, FIXTURES_DIR } from './fake-server.ts';
import { cleanText, mapLcorpGram, parseLcorpArticle, parseLcorpPage, splitHomonym, splitVariants } from './parse.ts';

function entryOf(file: string): LcorpEntry {
  const page = parseLcorpPage(fixture(file));
  assert.ok(page.article, `${file}: article`);
  const e = parseLcorpArticle(page.article);
  assert.ok(e, `${file}: entry`);
  return e;
}

function forms(e: LcorpEntry, slot: string): string[] | undefined {
  return e.paradigm?.forms[slot]?.map((f) => f.form);
}

test('page: hidden fields, registry position, validity', () => {
  const p = parseLcorpPage(fixture('verb-spivaty.html'));
  assert.equal(p.valid, true);
  assert.ok(p.hidden.__VIEWSTATE.length > 100);
  assert.ok(p.hidden.__EVENTVALIDATION);
  assert.equal(p.hidden.__VIEWSTATEGENERATOR, '7AC6B68E');
  assert.equal(p.centerOrder, 216407);
  assert.equal(p.currentUid, 156970);
  assert.equal(p.article?.headword, 'співа́ти');
  assert.equal(p.article?.gram, 'дієслово недоконаного виду');
  assert.match(p.article!.tableHtml, /^<table[\s\S]*<\/table>$/);
  assert.doesNotMatch(p.articleHtml, /<style/);

  const err = parseLcorpPage(fixture('error-500-badviewstate.html'));
  assert.equal(err.valid, false);
  assert.equal(err.article, undefined);
});

test('page: empty article (personal pronouns) keeps registry position', () => {
  for (const f of ['pron-vony-empty.html', 'click-vony-24454.html', 'pron-vin-empty.html', 'pron-khto-empty.html']) {
    const p = parseLcorpPage(fixture(f));
    assert.equal(p.valid, true, f);
    assert.equal(p.emptyArticle, true, f);
    assert.equal(p.article, undefined, f);
    assert.ok(p.centerOrder! > 0 && p.currentUid! > 0, f);
  }
  assert.equal(parseLcorpPage(fixture('pron-vony-empty.html')).currentUid, 24454);
});

test('verb, imperfective: співати', () => {
  const e = entryOf('verb-spivaty.html');
  assert.equal(e.pos, 'verb');
  assert.equal(e.aspect, 'imperfective');
  assert.equal(e.paradigm?.kind, 'verb');
  assert.equal(e.paradigm?.source, 'lcorp');
  assert.deepEqual(forms(e, 'inf'), ['співа́ти']);
  assert.deepEqual(forms(e, 'pres.1sg'), ['співа́ю']);
  assert.deepEqual(forms(e, 'pres.1pl'), ['співа́ємо', 'співа́єм']);
  assert.deepEqual(forms(e, 'pres.3pl'), ['співа́ють']);
  assert.deepEqual(forms(e, 'fut.1sg'), ['співа́тиму']);
  assert.deepEqual(forms(e, 'fut.3pl'), ['співа́тимуть']);
  assert.deepEqual(forms(e, 'past.m'), ['співа́в']);
  assert.deepEqual(forms(e, 'past.f'), ['співа́ла']);
  assert.deepEqual(forms(e, 'past.n'), ['співа́ло']);
  assert.deepEqual(forms(e, 'past.pl'), ['співа́ли']);
  assert.deepEqual(forms(e, 'imp.1pl'), ['співа́ймо']);
  assert.deepEqual(forms(e, 'imp.2sg'), ['співа́й']);
  assert.deepEqual(forms(e, 'imp.2pl'), ['співа́йте']);
  assert.equal(forms(e, 'imp.1sg'), undefined);
  assert.deepEqual(forms(e, 'advp.pres'), ['співа́ючи']);
  assert.deepEqual(forms(e, 'advp.past'), ['співа́вши']);
  assert.deepEqual(forms(e, 'ptcp.pass.past'), ['спі́ваний']);
  assert.deepEqual(forms(e, 'impers'), ['спі́вано']);
  assert.equal(forms(e, 'ptcp.act.pres'), undefined);
  assert.equal(forms(e, 'ptcp.act.past'), undefined);
  assert.deepEqual(e.paradigm?.notes, ['дієслово недоконаного виду']);
});

test('verb, perfective: заспівати (simple future, past adverbial participle only)', () => {
  const e = entryOf('verb-zaspivaty.html');
  assert.equal(e.aspect, 'perfective');
  assert.deepEqual(forms(e, 'fut.1sg'), ['заспіва́ю']);
  assert.deepEqual(forms(e, 'fut.1pl'), ['заспіва́ємо', 'заспіва́єм']);
  assert.equal(Object.keys(e.paradigm!.forms).filter((k) => k.startsWith('pres.')).length, 0);
  assert.equal(forms(e, 'advp.pres'), undefined);
  assert.deepEqual(forms(e, 'advp.past'), ['заспіва́вши']);
  assert.deepEqual(forms(e, 'ptcp.pass.past'), ['заспі́ваний']);
  assert.deepEqual(forms(e, 'past.pl'), ['заспіва́ли']);
});

test('verb, reflexive with variants: сміятися', () => {
  const e = entryOf('verb-smiiatysia.html');
  assert.deepEqual(forms(e, 'inf'), ['смія́тися', 'смія́тись']);
  assert.deepEqual(forms(e, 'pres.1pl'), ['сміємо́ся', 'сміємо́сь', 'сміє́мся']);
  assert.deepEqual(forms(e, 'advp.pres'), ['сміючи́сь']);
  assert.deepEqual(forms(e, 'advp.past'), ['смія́вшись']);
  assert.deepEqual(forms(e, 'past.pl'), ['смія́лися', 'смія́лись']);
  assert.equal(forms(e, 'impers'), undefined);
});

test('verb homonym number: організувати 1 (perfective)', () => {
  const p = parseLcorpPage(fixture('verb-orhanizuvaty1.html'));
  assert.equal(p.article?.headword, 'організува́ти');
  assert.equal(p.article?.homonym, 1);
  const e = parseLcorpArticle(p.article!)!;
  assert.equal(e.aspect, 'perfective');
  assert.deepEqual(forms(e, 'fut.3sg'), ['організу́є']);
});

test('noun: стіл 2 (homonym number, locative prepositions, vocative asterisk, variants)', () => {
  const p = parseLcorpPage(fixture('noun-stil2.html'));
  assert.equal(p.article?.headword, 'стіл');
  assert.equal(p.article?.homonym, 2);
  assert.equal(p.article?.comment, '(престол)');
  const e = parseLcorpArticle(p.article!)!;
  assert.equal(e.pos, 'noun');
  assert.deepEqual(e.genders, ['m']);
  assert.equal(e.animacy, 'inanimate');
  assert.equal(e.paradigm?.kind, 'noun');
  assert.deepEqual(forms(e, 'nom.sg'), ['стіл']);
  assert.deepEqual(forms(e, 'gen.sg'), ['стола́']);
  assert.deepEqual(forms(e, 'dat.sg'), ['столу́', 'столо́ві']);
  assert.deepEqual(forms(e, 'loc.sg'), ['столі́']);
  assert.deepEqual(forms(e, 'loc.pl'), ['стола́х']);
  assert.deepEqual(forms(e, 'voc.sg'), ['сто́ле']);
  assert.deepEqual(forms(e, 'voc.pl'), ['столи́']);
  assert.deepEqual(forms(e, 'gen.pl'), ['столі́в']);
  assert.deepEqual(e.paradigm?.notes, ['іменник чоловічого роду', '(престол)']);
});

test('noun: animate, two genders, end note: собака 1', () => {
  const e = entryOf('noun-sobaka1.html');
  assert.deepEqual(e.genders, ['m', 'f']);
  assert.equal(e.animacy, 'animate');
  assert.deepEqual(forms(e, 'acc.pl'), ['соба́ки', 'соба́к']);
  assert.deepEqual(forms(e, 'voc.sg'), ['соба́ко']);
  assert.ok(e.paradigm?.notes?.includes('[у жіночому роді вживається рідше]'));
});

test('noun: plural-only, proper nouns, surnames', () => {
  const n = entryOf('noun-nozhytsi.html');
  assert.equal(n.number, 'plural-only');
  assert.deepEqual(forms(n, 'nom.pl'), ['но́жиці']);
  assert.equal(forms(n, 'nom.sg'), undefined);

  const d = entryOf('noun-dveri.html');
  assert.deepEqual(forms(d, 'ins.pl'), ['дверми́', 'двери́ма']);

  const k = entryOf('noun-kyiv.html');
  assert.equal(k.pos, 'proper-noun');
  assert.deepEqual(forms(k, 'loc.sg'), ['Ки́єві', 'Ки́єву']);
  assert.deepEqual(forms(k, 'voc.sg'), ['Ки́єве']);
  assert.equal(forms(k, 'nom.pl'), undefined);

  const z = entryOf('homonym-zamok-place.html');
  assert.equal(z.headword, 'За́мок');
  assert.equal(z.pos, 'proper-noun');

  const s = entryOf('form-sobaky.html');
  assert.equal(s.headword, 'Собаке́вич');
  assert.equal(s.pos, 'proper-noun');
  assert.equal(s.animacy, 'animate');
  assert.equal(s.paradigm?.kind, 'noun');
  assert.deepEqual(forms(s, 'loc.sg'), ['Собаке́вичеві', 'Собаке́вичі', 'Собаке́вичу']);
  assert.deepEqual(forms(s, 'nom.pl'), ['Собаке́вичі']);
});

test('adjective: зелений (accusative split by animacy, locative variants)', () => {
  const e = entryOf('adj-zelenyi.html');
  assert.equal(e.pos, 'adjective');
  assert.equal(e.paradigm?.kind, 'adjectival');
  assert.deepEqual(forms(e, 'nom.m'), ['зеле́ний']);
  assert.deepEqual(forms(e, 'nom.f'), ['зеле́на']);
  assert.deepEqual(forms(e, 'nom.n'), ['зеле́не']);
  assert.deepEqual(forms(e, 'nom.pl'), ['зеле́ні']);
  assert.deepEqual(forms(e, 'acc.m.inan'), ['зеле́ний']);
  assert.deepEqual(forms(e, 'acc.m.anim'), ['зеле́ного']);
  assert.deepEqual(forms(e, 'acc.pl.inan'), ['зеле́ні']);
  assert.deepEqual(forms(e, 'acc.pl.anim'), ['зеле́них']);
  assert.equal(forms(e, 'acc.m'), undefined);
  assert.deepEqual(forms(e, 'acc.f'), ['зеле́ну']);
  assert.deepEqual(forms(e, 'acc.n'), ['зеле́не']);
  assert.deepEqual(forms(e, 'loc.m'), ['зеле́ному', 'зеле́нім']);
  assert.deepEqual(forms(e, 'ins.f'), ['зеле́ною']);
});

test('participle → adjective; pronouns with adjectival and noun tables', () => {
  const p = entryOf('ptcp-napysanyi.html');
  assert.equal(p.pos, 'adjective');
  assert.deepEqual(forms(p, 'acc.m'), ['напи́саний']);
  assert.equal(mapLcorpGram('дієприкметник').participle, true);

  const m = entryOf('pron-mii.html');
  assert.equal(m.pos, 'pronoun');
  assert.equal(m.paradigm?.kind, 'adjectival');
  assert.deepEqual(forms(m, 'acc.m.anim'), ['мого́']);
  assert.deepEqual(forms(m, 'gen.f'), ['моє́ї']);

  const y = entryOf('pron-yakyi.html');
  assert.ok(y.paradigm?.notes?.includes('[вживається також як сполучне слово]'));

  const s = entryOf('pron-sebe.html');
  assert.equal(s.paradigm?.kind, 'noun');
  assert.equal(forms(s, 'nom.sg'), undefined);
  assert.deepEqual(forms(s, 'gen.sg'), ['себе́']); // "до́ себе" (prepositional phrase) dropped
  assert.deepEqual(forms(s, 'acc.sg'), ['себе́']);
  assert.deepEqual(forms(s, 'loc.sg'), ['собі́']);
});

test('numerals: single column → noun plural slots; "два" type → adjectival m/f', () => {
  const p = entryOf('num-piat.html');
  assert.equal(p.pos, 'numeral');
  assert.equal(p.headword, "п'ять");
  assert.equal(p.paradigm?.kind, 'noun');
  assert.deepEqual(forms(p, 'nom.pl'), ["п'ять"]);
  assert.deepEqual(forms(p, 'gen.pl'), ["п'яти́", "п'ятьо́х"]);
  assert.deepEqual(forms(p, 'acc.pl'), ["п'ять", "п'ятьо́х"]);
  assert.deepEqual(forms(p, 'loc.pl'), ["п'яти́", "п'ятьо́х"]);

  const s = entryOf('num-sto.html');
  assert.deepEqual(forms(s, 'acc.pl'), ['сто']); // stray </span> in the cell

  const d = entryOf('num-dva.html');
  assert.equal(d.paradigm?.kind, 'adjectival');
  assert.deepEqual(forms(d, 'nom.m'), ['два']);
  assert.deepEqual(forms(d, 'nom.f'), ['дві']);
  assert.deepEqual(forms(d, 'acc.m.inan'), ['два']);
  assert.deepEqual(forms(d, 'acc.m.anim'), ['двох']);
  assert.deepEqual(forms(d, 'ins.f'), ['двома́']);
  assert.equal(forms(d, 'nom.n'), undefined);

  const o = entryOf('num-odyn.html');
  assert.deepEqual(forms(o, 'nom.n'), ['одне́', 'одно́']);
  assert.deepEqual(forms(o, 'loc.m'), ['одному́', 'одні́м']); // "на/в" stripped
});

test('every fixture: only known slot keys, stress marks preserved, no empty forms', () => {
  const files = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.html'));
  let withTables = 0;
  for (const f of files) {
    const p = parseLcorpPage(fixture(f));
    if (!p.article) continue;
    const e = parseLcorpArticle(p.article);
    assert.ok(e, f);
    if (!e.paradigm) continue;
    withTables++;
    for (const [slot, list] of Object.entries(e.paradigm.forms)) {
      assert.ok(isKnownSlot(slot), `${f}: unknown slot ${slot}`);
      assert.ok(list!.length > 0, `${f}: ${slot} empty`);
      for (const { form } of list!) {
        assert.ok(form && !/[\s*,<>&]/.test(form), `${f}: ${slot} bad form ${JSON.stringify(form)}`);
        assert.equal(form, form.normalize('NFC'));
      }
    }
  }
  assert.ok(withTables >= 25, `tables parsed: ${withTables}`);
  assert.ok(forms(entryOf('verb-spivaty.html'), 'pres.1sg')![0].includes('́'));
});

test('mapLcorpGram', () => {
  assert.deepEqual(mapLcorpGram('іменник чоловічого роду, істота', 'Абра́м'), { pos: 'proper-noun', genders: ['m'], animacy: 'animate' });
  assert.deepEqual(mapLcorpGram('іменник жіночого роду', 'ли́па'), { pos: 'noun', genders: ['f'], animacy: 'inanimate' });
  assert.deepEqual(mapLcorpGram('множинний іменник', 'две́рі'), { pos: 'noun', number: 'plural-only', animacy: 'inanimate' });
  assert.deepEqual(mapLcorpGram('множинний іменник, істота', 'лю́ди'), { pos: 'noun', number: 'plural-only', animacy: 'animate' });
  assert.deepEqual(mapLcorpGram('іменник чоловічого або жіночого роду, істота'), { pos: 'noun', genders: ['m', 'f'], animacy: 'animate' });
  assert.deepEqual(mapLcorpGram('іменник спільного роду, істота'), { pos: 'noun', genders: ['m', 'f'], animacy: 'animate' });
  assert.deepEqual(mapLcorpGram('прізвище', 'Собаке́вич'), { pos: 'proper-noun', animacy: 'animate' });
  assert.equal(mapLcorpGram("власне ім'я", 'Оле́на').pos, 'proper-noun');
  assert.equal(mapLcorpGram('географічна назва', 'Ки́їв').pos, 'proper-noun');
  assert.deepEqual(mapLcorpGram('дієслово недоконаного виду'), { pos: 'verb', aspect: 'imperfective' });
  assert.deepEqual(mapLcorpGram('дієслово доконаного виду'), { pos: 'verb', aspect: 'perfective' });
  assert.deepEqual(mapLcorpGram('дієслово доконаного і недоконаного виду'), { pos: 'verb', aspect: 'biaspectual' });
  assert.deepEqual(mapLcorpGram('дієслово недоконаного і доконаного виду'), { pos: 'verb', aspect: 'biaspectual' });
  assert.deepEqual(mapLcorpGram('прикметник'), { pos: 'adjective' });
  assert.deepEqual(mapLcorpGram('дієприкметник'), { pos: 'adjective', participle: true });
  assert.deepEqual(mapLcorpGram('числівник типу "два"'), { pos: 'numeral' });
  assert.deepEqual(mapLcorpGram('числівник кількісний'), { pos: 'numeral' });
  assert.deepEqual(mapLcorpGram('займенник'), { pos: 'pronoun' });
  assert.deepEqual(mapLcorpGram('прислівник'), { pos: 'adverb' });
  assert.deepEqual(mapLcorpGram('дієприслівник'), { pos: 'adverb' });
  assert.deepEqual(mapLcorpGram(''), {});
});

test('text helpers', () => {
  assert.equal(cleanText(' &nbsp;співа́ємо,&#160;співа́єм </span>'), 'співа́ємо, співа́єм');
  assert.deepEqual(splitVariants('&nbsp;'), []);
  assert.deepEqual(splitVariants(' на/у зеле́ному, зеле́нім', { locative: true }), ['зеле́ному', 'зеле́нім']);
  assert.deepEqual(splitVariants('при Собаке́вичеві', { locative: true }), ['Собаке́вичеві']);
  assert.deepEqual(splitVariants('на/у столі́'), []); // not a locative cell → multi-word variant dropped
  assert.deepEqual(splitVariants('сто́ле*'), ['сто́ле']);
  assert.deepEqual(splitVariants('себе́, до́ себе'), ['себе́']);
  assert.deepEqual(splitHomonym('стіл 2 '), { headword: 'стіл', homonym: 2 });
  assert.deepEqual(splitHomonym('співа́ти '), { headword: 'співа́ти' });
});
