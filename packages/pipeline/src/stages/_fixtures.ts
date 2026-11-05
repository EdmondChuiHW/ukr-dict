/** Small synthetic entries for unit tests (not used by the pipeline itself). */
import { searchKey, stripStress } from '@ukdict/shared';
import type { Entry, PartOfSpeech, Sense } from '@ukdict/shared';
import type { DraftEntry } from '../contracts.ts';

let line = 0;

export function draft(head: string, pos: PartOfSpeech, glosses: (string | Sense)[], extra: Partial<DraftEntry> = {}): DraftEntry {
  const word = stripStress(head);
  line += 1;
  return {
    word,
    key: searchKey(word),
    heads: [head],
    pos,
    senses: glosses.map((g) => (typeof g === 'string' ? { gloss: g } : g)),
    sources: [{ source: 'wiktionary', url: `https://en.wiktionary.org/wiki/${word}#Ukrainian`, label: `Wiktionary: ${word}` }],
    origin: { source: 'kaikki-uk', line, kaikkiPos: pos },
    ...extra,
  };
}

export function toEntry(d: DraftEntry, id: number): Entry {
  const { origin: _o, ...rest } = d;
  return { id, slug: `${d.word}~${d.pos}`, ...rest };
}

/** A tiny dictionary used by several tests (already in id order). */
export function sampleEntries(): Entry[] {
  const drafts: DraftEntry[] = [
    draft('соба́ка', 'noun', ['dog', 'cur (contemptible person)'], {
      genders: ['m', 'f'],
      animacy: 'animate',
      paradigm: {
        kind: 'noun',
        source: 'wiktionary',
        forms: {
          'nom.sg': [{ form: 'соба́ка' }],
          'gen.sg': [{ form: 'соба́ки' }],
          'nom.pl': [{ form: 'соба́ки' }],
          'ins.pl': [{ form: 'соба́ками' }],
        },
      },
      pronunciation: { ipa: [{ value: '[soˈbakɐ]' }], audio: [{ mp3: 'https://example.org/a.mp3' }] },
    }),
    draft('співа́ти', 'verb', [{ gloss: 'to sing', examples: [{ text: 'Я співа́ю.', translation: 'I sing.', source: 'wiktionary' }] }], {
      aspect: 'imperfective',
      paradigm: {
        kind: 'verb',
        source: 'wiktionary',
        forms: { inf: [{ form: 'співа́ти' }], 'pres.1sg': [{ form: 'співа́ю' }], 'pres.3pl': [{ form: 'співа́ють' }] },
      },
    }),
    draft('стіл', 'noun', ['table', 'board (food)'], {
      genders: ['m'],
      animacy: 'inanimate',
      paradigm: { kind: 'noun', source: 'wiktionary', forms: { 'nom.sg': [{ form: 'стіл' }], 'gen.sg': [{ form: 'стола́' }] } },
    }),
    draft('по', 'preposition', [
      { gloss: '[with locative]', headerOnly: true, subsenses: [{ gloss: 'on, along, over' }, { gloss: 'after' }] },
      { gloss: '[with accusative]', headerOnly: true, subsenses: [{ gloss: 'for (to fetch)' }] },
    ]),
    draft('пес', 'noun', ['dog, hound'], { genders: ['m'], extraForms: [{ form: 'пса', tags: ['genitive', 'singular'], origin: 'form-of-entry' }] }),
  ];
  return drafts.map(toEntry);
}
