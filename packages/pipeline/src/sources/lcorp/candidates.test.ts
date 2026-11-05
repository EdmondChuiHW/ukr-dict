import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { kaikkiHeads, lcorpCandidateVerdict, scanLcorpCandidates, type KaikkiLikeEntry } from './candidates.ts';

const base = (over: Partial<KaikkiLikeEntry>): KaikkiLikeEntry => ({
  word: 'гостити',
  pos: 'verb',
  forms: [{ form: 'гости́ти', tags: ['canonical'] }, { form: 'hostýty', tags: ['romanization'] }],
  head_templates: [{ name: 'uk-verb', args: { '1': 'гости́ти', '2': 'impf' }, expansion: 'гости́ти • (hostýty) impf' }],
  senses: [{ glosses: ['to stay (with)'] }],
  ...over,
});

test('candidate verdicts', () => {
  assert.deepEqual(lcorpCandidateVerdict(base({})), { ok: true, request: { word: 'гостити', heads: ['гости́ти'], pos: 'verb' } });
  assert.deepEqual(lcorpCandidateVerdict(base({ pos: 'adv' })), { ok: false, reason: 'pos' });
  assert.deepEqual(lcorpCandidateVerdict(base({ forms: [{ form: 'x', source: 'conjugation' }] })), { ok: false, reason: 'has-table' });
  assert.deepEqual(lcorpCandidateVerdict(base({ senses: [{ glosses: ['genitive of X'], form_of: [{ word: 'X' }] }] })), { ok: false, reason: 'form-of' });
  assert.deepEqual(
    lcorpCandidateVerdict(base({ head_templates: [{ name: 'head', args: { '1': 'uk', '2': 'verb form' } }] })),
    { ok: false, reason: 'non-lemma-head' },
  );
  assert.deepEqual(lcorpCandidateVerdict(base({ word: 'сорок два' })), { ok: false, reason: 'multi-word' });
  assert.deepEqual(lcorpCandidateVerdict(base({ word: 'ст.' })), { ok: false, reason: 'not-a-word' });
  assert.deepEqual(lcorpCandidateVerdict(base({ pos: 'noun', word: 'ДП' })), { ok: false, reason: 'abbreviation' });
  assert.deepEqual(lcorpCandidateVerdict(base({ pos: 'noun', word: 'тел', senses: [{ glosses: ['phone'], tags: ['abbreviation'] }] })), {
    ok: false,
    reason: 'abbreviation',
  });
  assert.deepEqual(
    lcorpCandidateVerdict(base({ pos: 'noun', word: 'о', head_templates: [{ name: 'uk-noun', expansion: 'о • (o) n inan (indeclinable)' }] })),
    { ok: false, reason: 'indeclinable' },
  );
  assert.deepEqual(lcorpCandidateVerdict(base({ pos: 'name', word: 'Київ', forms: [], head_templates: [] })), {
    ok: true,
    request: { word: 'Київ', heads: ['Київ'], pos: 'proper-noun' },
  });
});

test('heads: canonical form first token, must spell the word', () => {
  assert.deepEqual(kaikkiHeads({ word: 'мавпа', forms: [{ form: 'ма́впа f inan ]', tags: ['canonical'] }] }), ['ма́впа']);
  assert.deepEqual(kaikkiHeads({ word: 'кохаті', forms: [{ form: 'kocháti', tags: ['canonical'] }] }), ['кохаті']);
  assert.deepEqual(kaikkiHeads({ word: 'о', head_templates: [{ name: 'uk-noun', args: { '1': 'о́' } }] }), ['о́']);
});

test('scan: frequency order, unranked last, duplicates dropped', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lcorp-cand-'));
  try {
    const lines = [
      base({ word: 'рідкісне', pos: 'adj', forms: [], senses: [{ glosses: ['rare'] }] }),
      base({ word: 'стіл', pos: 'noun', forms: [], senses: [{ glosses: ['table'] }] }),
      base({ word: 'стіл', pos: 'noun', forms: [], senses: [{ glosses: ['table'] }] }),
      base({ word: 'кіт', pos: 'noun', forms: [{ form: 'кота́', source: 'declension' }] }),
      base({ word: 'бути', pos: 'verb', forms: [], senses: [{ glosses: ['be'] }] }),
    ];
    writeFileSync(join(dir, 'k.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    writeFileSync(join(dir, 'f.csv'), 'rowid;name;part_sp;rate_abs;page_resp\n1;бути;дієсл.;900;1\n2;стіл;ім. ч. р.;50;1\n3;Стіл;ім. ч. р.;10;1\n');
    const r = await scanLcorpCandidates({ kaikkiFile: join(dir, 'k.jsonl'), frequencyFile: join(dir, 'f.csv') });
    assert.deepEqual(r.candidates.map((c) => [c.word, c.rank]), [
      ['бути', 1],
      ['стіл', 2],
      ['рідкісне', undefined],
    ]);
    assert.equal(r.stats.duplicate, 1);
    assert.equal(r.stats['has-table'], 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
