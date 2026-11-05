import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { EnTranslation, FrequencyIndex, IgnoredEntry, LcorpClient, LcorpLookupResult } from '../contracts.ts';
import { buildCreatedEntries, mapEnglishPos } from './created.ts';
import { mergeEntries, glossSignature } from './merge.ts';
import { enrichWithLcorp, isLcorpCandidate, orderLcorpCandidates } from './lcorp-enrich.ts';
import { resolveEntries, cleanTarget } from './resolve.ts';
import { rankEntries } from './rank.ts';
import { validateEntries } from './validate.ts';
import { draft } from './_fixtures.ts';

const freq = (ranks: Record<string, number>): FrequencyIndex => ({
  rank: (w) => ranks[w.toLowerCase()],
  size: Object.keys(ranks).length,
});

// ───────── created ─────────

test('mapEnglishPos', () => {
  assert.equal(mapEnglishPos('noun', false), 'noun');
  assert.equal(mapEnglishPos('name', false), 'proper-noun');
  assert.equal(mapEnglishPos('adj', false), 'adjective');
  assert.equal(mapEnglishPos('contraction', true), 'phrase');
  assert.equal(mapEnglishPos('contraction', false), 'other');
});

test('buildCreatedEntries groups by key+POS and filters', () => {
  const tr: EnTranslation[] = [
    { ukWord: 'ку́цик', enWord: 'doggy', enPos: 'noun', sense: 'small dog', tags: ['masculine', 'animate'] },
    { ukWord: 'куци́к', enWord: 'doggy', enPos: 'noun', sense: 'small dog', tags: ['masculine'] }, // other stress, same key
    { ukWord: 'ку́цик', enWord: 'doggy', enPos: 'noun', sense: 'small dog', tags: ['masculine'] }, // duplicate pair
    { ukWord: 'ку́цик', enWord: 'pup', enPos: 'noun', tags: ['masculine'] },
    { ukWord: 'ку́цик', enWord: 'doggy', enPos: 'adj', sense: 'doglike' }, // different POS → separate entry
    { ukWord: 'соба́ка', enWord: 'dog', enPos: 'noun' }, // existing headword
    { ukWord: 'соба́ки', enWord: 'dogs', enPos: 'noun' }, // ignored form
    { ukWord: 'TV-шоу', enWord: 'TV show', enPos: 'noun' }, // latin
    { ukWord: 'один два три чотири п’ять', enWord: 'x', enPos: 'phrase' }, // too long
    { ukWord: 'вогнепа́льна збро́я', enWord: 'firearm', enPos: 'noun', tags: ['feminine'] },
    { ukWord: 'ви́кидати', enWord: 'throw out', enPos: 'verb', tags: ['imperfective'] },
    { ukWord: 'ви́кидати', enWord: 'discard', enPos: 'verb', tags: ['perfective'] },
  ];
  const { entries, stats } = buildCreatedEntries(tr, { headwordKeys: new Set(['собака']), ignoredFormKeys: new Set(['собаки']) });
  assert.equal(stats.existingHeadword, 1);
  assert.equal(stats.existingForm, 1);
  assert.equal(stats.skippedLatinOrDigits, 1);
  assert.equal(stats.skippedTooLong, 1);
  const noun = entries.find((e) => e.key === 'куцик' && e.pos === 'noun')!;
  assert.ok(noun);
  assert.deepEqual(
    noun.senses.map((s) => [s.gloss, s.qualifier]),
    [
      ['doggy', 'small dog'],
      ['pup', undefined],
    ],
  );
  assert.deepEqual(noun.heads, ['ку́цик', 'куци́к']);
  assert.deepEqual(noun.genders, ['m']);
  assert.equal(noun.animacy, 'animate');
  assert.equal(noun.created?.method, 'english-translation');
  assert.equal(noun.created?.from.length, 2);
  assert.equal(noun.origin.source, 'english-translation');
  assert.deepEqual(
    noun.sources.map((s) => s.label),
    ['Wiktionary: doggy', 'Wiktionary: pup'],
  );
  assert.ok(entries.find((e) => e.key === 'куцик' && e.pos === 'adjective'));
  const phrase = entries.find((e) => e.key === 'вогнепальна зброя')!;
  assert.equal(phrase.pos, 'noun');
  assert.deepEqual(phrase.heads, ['вогнепа́льна збро́я']);
  const verb = entries.find((e) => e.key === 'викидати')!;
  assert.equal(verb.aspect, 'biaspectual');
});

// ───────── merge ─────────

test('mergeEntries merges identical definitions but not different stress', () => {
  const a = draft('за́мок', 'noun', ['castle'], { genders: ['m'], paradigm: { kind: 'noun', source: 'wiktionary', forms: { 'nom.sg': [{ form: 'за́мок' }] } } });
  const b = draft('за́мок', 'noun', ['Castle.'], {
    pronunciation: { ipa: [{ value: '[ˈzamok]' }] },
    paradigm: { kind: 'noun', source: 'wiktionary', forms: { 'nom.sg': [{ form: 'за́мок' }], 'gen.sg': [{ form: 'за́мку' }] } },
  });
  const c = draft('замо́к', 'noun', ['castle']);
  const d = draft('за́мок', 'noun', ['lock']);
  const r = mergeEntries([a, b, c, d]);
  assert.equal(r.entries.length, 3);
  assert.equal(r.merges.length, 1);
  assert.equal(r.merges[0].merged.length, 1);
  const kept = r.entries[0];
  assert.equal(kept, a);
  assert.deepEqual(Object.keys(kept.paradigm!.forms).sort(), ['gen.sg', 'nom.sg']);
  assert.equal(kept.pronunciation?.ipa?.[0].value, '[ˈzamok]');
  assert.equal(glossSignature(a), 'castle');
});

// ───────── lcorp ─────────

test('lcorp candidates and enrichment', async () => {
  const noTable = draft('ку́рка', 'noun', ['hen']);
  const created = { ...draft('ку́цик', 'noun', ['doggy']), created: { method: 'english-translation' as const, from: [] } };
  const indecl = draft('кафе́', 'noun', ['cafe'], { tags: ['indeclinable'] });
  const withTable = draft('стіл', 'noun', ['table'], { paradigm: { kind: 'noun', source: 'wiktionary', forms: { 'nom.sg': [{ form: 'стіл' }] } } });
  const adv = draft('ду́же', 'adverb', ['very']);
  const rare = draft('ря́ска', 'noun', ['duckweed']);
  assert.equal(isLcorpCandidate(indecl), false);
  assert.equal(isLcorpCandidate(withTable), false);
  assert.equal(isLcorpCandidate(adv), false);
  assert.equal(isLcorpCandidate(draft('мо́жна', 'adjective', [{ gloss: 'one can', tags: ['impersonal', 'predicative'] }])), false);
  assert.equal(isLcorpCandidate(draft('його́', 'pronoun', ['his'], { tags: ['invariable', 'possessive'] })), false);
  assert.equal(isLcorpCandidate(draft('ду́же', 'adjective', ['neuter nominative singular of дужий'])), false);
  assert.equal(isLcorpCandidate(draft('нема́є', 'verb', [{ gloss: 'alternative form of нема', altOf: [{ word: 'нема' }] }])), false);
  const order = orderLcorpCandidates([created, rare, noTable], freq({ курка: 10, куцик: 1 }));
  assert.deepEqual(
    order.map((x) => x.entry.word),
    ['курка', 'ряска', 'куцик'],
  );
  const calls: string[] = [];
  const client: LcorpClient = {
    async lookup(req): Promise<LcorpLookupResult> {
      calls.push(req.word);
      if (req.word === 'курка')
        return {
          status: 'found',
          fromCache: true,
          entry: {
            headword: 'ку́рка',
            gram: 'іменник жіночого роду, істота',
            genders: ['f'],
            animacy: 'animate',
            paradigm: { kind: 'noun', source: 'lcorp', forms: { 'nom.sg': [{ form: 'ку́рка' }], 'gen.sg': [{ form: 'ку́рки' }] } },
          },
        };
      if (req.word === 'ряска') return { status: 'skipped', reason: 'budget' };
      return { status: 'not-found', fromCache: false, nearest: 'кущ' };
    },
    stats: () => ({ network: 0, cacheHits: 1, found: 1, notFound: 1, errors: 0, skipped: 1 }),
    close: async () => {},
  };
  const { stats, records } = await enrichWithLcorp([created, rare, noTable, withTable], client, { frequency: freq({ курка: 10 }), parallel: 1 });
  assert.deepEqual(calls, ['курка', 'ряска', 'куцик']);
  assert.equal(stats.found, 1);
  assert.equal(stats.paradigmsAdded, 1);
  assert.equal(noTable.paradigm?.source, 'lcorp');
  assert.deepEqual(noTable.genders, ['f']);
  assert.equal(noTable.animacy, 'animate');
  assert.ok(noTable.sources.some((s) => s.source === 'lcorp' && s.label === 'lcorp: курка'));
  assert.equal(records.length, 3);
  assert.equal(records[2].nearest, 'кущ');
});

// ───────── resolve ─────────

test('resolveEntries: ignored forms, aspect pairs, links', () => {
  const spivaty = draft('співа́ти', 'verb', [{ gloss: 'to sing', relations: { synonym: [{ word: 'співа́ти' }, { word: 'наспі́вувати' }, { word: 'наспівувати' }] } }], {
    aspect: 'imperfective',
    aspectPartners: [{ word: 'поспіва́ти', aspect: 'perfective', source: 'wiktionary' }, { word: 'заспіва́ти', aspect: 'perfective', source: 'wiktionary' }],
    paradigm: { kind: 'verb', source: 'wiktionary', forms: { inf: [{ form: 'співа́ти' }], 'pres.1sg': [{ form: 'співа́ю' }] } },
  });
  const zaspivaty = draft('заспіва́ти', 'verb', ['to start singing'], { aspect: 'perfective' });
  const pospivaty = draft('поспіва́ти', 'verb', ['to sing for a while'], { aspect: 'perfective' });
  const ruchka = draft('ру́чка', 'noun', ['pen', { gloss: 'diminutive of рука́', formOf: [{ word: 'рука́' }, { word: 'нема' }] }]);
  const entries = [spivaty, zaspivaty, pospivaty, ruchka];
  const ign = (word: string, target: string, pos: 'verb' | 'noun' = 'verb'): IgnoredEntry => ({
    word,
    kaikkiPos: pos,
    pos,
    reason: 'inflected-form-only',
    formOf: [{ word: target, tags: ['first-person', 'singular', 'present'] }],
    glosses: [],
    line: 1,
    url: '',
  });
  const ignored = [ign('співаю', 'співа́ти'), ign('співав', 'співа́ти'), ign('бігаю', 'бі́гати'), ign('заспіваю', 'заспіва́ти pf')];
  const stats = resolveEntries(entries, ignored, [{ imperfective: 'співати', perfective: 'заспівати' }]);
  assert.deepEqual(
    ignored.map((i) => i.resolution),
    ['in-paradigm', 'added-as-extra-form', 'lemma-missing', 'added-as-extra-form'],
  );
  assert.deepEqual(spivaty.extraForms, [{ form: 'співав', tags: ['first-person', 'singular', 'present'], origin: 'form-of-entry' }]);
  assert.equal(zaspivaty.extraForms?.[0].form, 'заспіваю');
  // curated partner first, stressed spelling filled in, deduped
  assert.deepEqual(
    spivaty.aspectPartners!.map((p) => [p.word, p.source, p.linked]),
    [
      ['заспіва́ти', 'known-aspect-pairs', true],
      ['поспіва́ти', 'wiktionary', true],
    ],
  );
  // symmetric
  assert.deepEqual(
    zaspivaty.aspectPartners!.map((p) => [p.word, p.aspect, p.source]),
    [['співа́ти', 'imperfective', 'known-aspect-pairs']],
  );
  assert.deepEqual(
    pospivaty.aspectPartners!.map((p) => [p.word, p.aspect]),
    [['співа́ти', 'imperfective']],
  );
  // relation collapse: self dropped, duplicates merged, stressed kept
  assert.deepEqual(
    spivaty.senses[0].relations!.synonym!.map((t) => [t.word, t.linked]),
    [['наспі́вувати', false]],
  );
  assert.deepEqual(
    ruchka.senses[1].formOf!.map((r) => r.linked),
    [false, false],
  );
  assert.equal(stats.lemmaMissing, 1);
  assert.equal(cleanTarget('ску́чити pf'), 'ску́чити');
});

// ───────── rank + validate ─────────

test('rankEntries orders by frequency, then kaikki, then created; slugs', () => {
  const a = draft('за́мок', 'noun', ['castle']);
  const b = draft('замо́к', 'noun', ['lock']);
  const c = draft('і', 'conjunction', ['and']);
  const d = draft('ябеда', 'noun', ['sneak']);
  const e = draft('абетка', 'noun', ['alphabet']);
  const f = { ...draft('аааа', 'noun', ['created']), created: { method: 'english-translation' as const, from: [] }, origin: { source: 'english-translation' as const } };
  const r = rankEntries([f, d, e, b, a, c], freq({ і: 1, замок: 500 }));
  assert.deepEqual(
    r.entries.map((x) => x.slug),
    ['і~conjunction', 'замок~noun', 'замок~noun~2', 'абетка~noun', 'ябеда~noun', 'аааа~noun'],
  );
  assert.deepEqual(
    r.entries.map((x) => x.id),
    [0, 1, 2, 3, 4, 5],
  );
  assert.equal(r.entries[0].freqRank, 1);
  assert.equal((r.entries[0] as unknown as Record<string, unknown>).origin, undefined);
  // за́мок before замо́к (homonyms keep origin order)
  assert.equal(r.entries[1].heads[0], 'за́мок');
  const v = validateEntries(r.entries);
  assert.equal(v.ok, true, JSON.stringify(v.checks.filter((c) => c.violations)));
});

test('validateEntries counts violations and throws on structural errors', () => {
  const r = rankEntries([draft('кіт', 'noun', [{ gloss: 'cat', links: [{ start: 0, end: 10, target: 'x' }] }], { paradigm: { kind: 'noun', source: 'wiktionary', forms: { 'nom.xx': [{ form: 'кіт' }] } }, relations: { synonym: [{ word: 'кот' }, { word: 'ко́т' }] } })]);
  const v = validateEntries(r.entries);
  const by = Object.fromEntries(v.checks.map((c) => [c.name, c.violations]));
  assert.equal(by['paradigm-slots'], 1);
  assert.equal(by['gloss-link-bounds'], 1);
  assert.equal(by['relation-duplicates'], 1);
  assert.equal(v.ok, false);
  const broken = [{ ...r.entries[0], id: 5 }];
  assert.throws(() => validateEntries(broken));
});

// ───────── sanitize + stub folding ─────────

test('cleanWord / sanitizeDrafts', async () => {
  const { cleanWord, sanitizeDrafts } = await import('./sanitize.ts');
  assert.equal(cleanWord('с (s)'), 'с');
  assert.equal(cleanWord('ма́впа f animal ]'), 'ма́впа');
  assert.equal(cleanWord('ти́снути impf [transitive'), 'ти́снути');
  assert.equal(cleanWord('прі́сний[unleavened]]>'), 'прі́сний');
  assert.equal(cleanWord('реформува́ти impf or'), 'реформува́ти');
  assert.equal(cleanWord('Батьківщина (Batʹkivščyna)'), 'Батьківщина');
  assert.equal(cleanWord('f animal'), '');
  assert.equal(cleanWord('вогнепа́льна збро́я'), 'вогнепа́льна збро́я');
  const e = draft('ладо', 'noun', ['darling'], { heads: ['n', 'ла́до'], relations: { synonym: [{ word: 'ми́лий (mýlyj)' }, { word: 'xyz' }] } });
  const st = sanitizeDrafts([e]);
  assert.deepEqual(e.heads, ['ла́до']);
  assert.deepEqual(e.relations?.synonym?.map((t) => t.word), ['ми́лий']);
  assert.equal(st.headsDropped, 1);
  assert.equal(st.relationWordsDropped, 1);
});

test('mergeEntries folds gloss-less stubs into same-key entries', () => {
  const stub = draft('Україна', 'noun', [], { relations: { synonym: [{ word: 'Ненька' }] } });
  const real = draft('Украї́на', 'proper-noun', ['Ukraine']);
  const orphan = draft('аварійність', 'noun', []);
  const r = mergeEntries([stub, real, orphan]);
  assert.equal(r.entries.length, 1);
  assert.equal(r.droppedStubs, 1);
  assert.deepEqual(real.relations?.synonym?.map((t) => t.word), ['Ненька']);
  assert.deepEqual(real.heads, ['Украї́на']);
});

test('rank ties: dated homonyms last, POS order before case', () => {
  const dated = draft('украї́на', 'noun', [{ gloss: 'land', tags: ['dated'] }]);
  const proper = draft('Украї́на', 'proper-noun', ['Ukraine']);
  const letter = draft('І', 'letter', ['letter I']);
  const conj = draft('і', 'conjunction', ['and']);
  const r = rankEntries([dated, letter, proper, conj], freq({ україна: 12, і: 1 }));
  assert.deepEqual(
    r.entries.map((e) => e.slug),
    ['і~conjunction', 'І~letter', 'Україна~proper-noun', 'україна~noun'],
  );
});

test('orderLcorpCandidates applies kaikkiFilter to kaikki entries only', () => {
  const a = draft('ку́рка', 'noun', ['hen']);
  const b = draft('ри́ба', 'noun', ['fish']);
  const c = { ...draft('ку́цик', 'noun', ['doggy']), created: { method: 'english-translation' as const, from: [] } };
  const order = orderLcorpCandidates([a, b, c], undefined, (e) => e.word === 'риба');
  assert.deepEqual(
    order.map((x) => x.entry.word),
    ['риба', 'куцик'],
  );
});
