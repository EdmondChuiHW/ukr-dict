/**
 * Hand-written fixture entries for developing/testing the web app without the real pipeline output.
 * Stress is written as "+" after the stressed vowel (converted to U+0301 by `st()`), e.g. "соба+ка".
 * Order = frequency order (id = index), as the pipeline would emit it.
 */
import type { Entry, Form, Paradigm, Sense, SourceRef } from '@ukdict/shared';
import { kaikkiUrl, searchKey, wiktionaryEnglishUrl, wiktionaryUrl, CASES, PERSONS } from '@ukdict/shared';

type Draft = Omit<Entry, 'id' | 'slug' | 'key' | 'sources'> & { sources?: SourceRef[] };

const ACUTE = '́';
/** "соба+ка" → "соба́ка" */
export const st = (s: string): string => s.replace(/\+/g, ACUTE);

/** "a, b" → [{form:a},{form:b}]; "x (dated)" → {form:x, tags:['dated']} */
function F(spec: string): Form[] {
  return spec.split(',').map((p) => {
    const m = p.trim().match(/^(.*?)\s*\(([^)]+)\)$/);
    if (m) return { form: st(m[1]), tags: m[2].split(' ') };
    return { form: st(p.trim()) };
  });
}

/** Noun paradigm from 14 strings: nom.sg … voc.sg (CASES order), then nom.pl … voc.pl. Empty string = missing. */
function nounParadigm(sg: string[], pl: string[], source = 'wiktionary', notes?: string[]): Paradigm {
  const forms: Paradigm['forms'] = {};
  CASES.forEach((c, i) => {
    if (sg[i]) forms[`${c}.sg`] = F(sg[i]);
    if (pl[i]) forms[`${c}.pl`] = F(pl[i]);
  });
  return { kind: 'noun', forms, source, notes };
}

function adjParadigm(rows: Record<string, string>, source = 'wiktionary'): Paradigm {
  const forms: Paradigm['forms'] = {};
  for (const [k, v] of Object.entries(rows)) forms[k] = F(v);
  return { kind: 'adjectival', forms, source };
}

function verbParadigm(rows: Record<string, string>, source = 'wiktionary'): Paradigm {
  const forms: Paradigm['forms'] = {};
  for (const [k, v] of Object.entries(rows)) if (v) forms[k] = F(v);
  return { kind: 'verb', forms, source };
}

/** Present/future person forms from 6 strings. */
function persons(tense: 'pres' | 'fut', list: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  PERSONS.forEach((p, i) => (out[`${tense}.${p}`] = list[i]));
  return out;
}

const S = (gloss: string, extra: Partial<Sense> = {}): Sense => ({ gloss, ...extra });

function linkSpan(gloss: string, text: string, target: string) {
  const start = gloss.indexOf(text);
  if (start < 0) throw new Error(`link text ${text} not in ${gloss}`);
  return { start, end: start + text.length, target: st(target) };
}

const AUDIO_SOBAKA = {
  ogg: 'https://upload.wikimedia.org/wikipedia/commons/5/5d/Uk-%D1%81%D0%BE%D0%B1%D0%B0%D0%BA%D0%B0.ogg',
  mp3: 'https://upload.wikimedia.org/wikipedia/commons/transcoded/5/5d/Uk-%D1%81%D0%BE%D0%B1%D0%B0%D0%BA%D0%B0.ogg/Uk-%D1%81%D0%BE%D0%B1%D0%B0%D0%BA%D0%B0.ogg.mp3',
  label: 'Uk-собака.ogg',
};
const AUDIO_SPIVATY = {
  mp3: 'https://upload.wikimedia.org/wikipedia/commons/transcoded/4/4c/Uk-%D1%81%D0%BF%D1%96%D0%B2%D0%B0%D1%82%D0%B8.ogg/Uk-%D1%81%D0%BF%D1%96%D0%B2%D0%B0%D1%82%D0%B8.ogg.mp3',
  label: 'Uk-співати.ogg',
};
const AUDIO_STIL = {
  mp3: 'https://upload.wikimedia.org/wikipedia/commons/transcoded/7/76/Uk-%D1%81%D1%82%D1%96%D0%BB.ogg/Uk-%D1%81%D1%82%D1%96%D0%BB.ogg.mp3',
  label: 'Uk-стіл.ogg',
};

const drafts: Draft[] = [
  {
    word: 'і',
    heads: ['і'],
    pos: 'conjunction',
    senses: [S('and'), S('both … and', { qualifier: 'і … і' })],
    freqRank: 1,
    pronunciation: { ipa: [{ value: '[i]' }] },
  },
  {
    word: 'що',
    heads: ['що'],
    pos: 'pronoun',
    senses: [
      S('what', { tags: ['interrogative'], examples: [{ text: st('Що це?'), translation: 'What is this?', source: 'wiktionary' }] }),
      S('which, that', { tags: ['relative'] }),
      S('something', { tags: ['colloquial', 'indefinite'] }),
    ],
    paradigm: nounParadigm(['що', 'чо+го', 'чому+', 'що', 'чим', 'чо+му, чім', ''], ['', '', '', '', '', '', '']),
    freqRank: 2,
  },
  {
    word: 'що',
    heads: ['що'],
    pos: 'conjunction',
    senses: [
      S('that', { examples: [{ text: st('Я зна+ю, що ти пра+вий.'), translation: 'I know that you are right.', source: 'wiktionary' }] }),
      S('because, since', { tags: ['colloquial'] }),
    ],
    freqRank: 2,
  },
  {
    word: 'по',
    heads: ['по'],
    pos: 'preposition',
    senses: [
      S('[with locative]', {
        headerOnly: true,
        tags: ['with-locative'],
        subsenses: [
          S('used to indicate a physical object on which an action is taking place, or a space in which something is taking place', {
            tags: ['with-locative'],
            examples: [{ text: st('ходи+ти по ву+лиці'), translation: 'to walk along the street', source: 'wiktionary' }],
          }),
          S('in the direction of', { tags: ['with-locative'] }),
          S('used to indicate someone or something that is being mourned over', { tags: ['with-locative', 'colloquial'] }),
          S('used to indicate a time-frame during which an action occurs', { tags: ['with-locative', 'colloquial'] }),
          S('after', { tags: ['with-locative'], examples: [{ text: st('по оді+нні'), translation: 'after school', source: 'wiktionary' }] }),
        ],
      }),
      S('[with accusative]', {
        headerOnly: true,
        tags: ['with-accusative'],
        subsenses: [
          S('up to, as far as', { tags: ['with-accusative'] }),
          S('for, to fetch', { tags: ['with-accusative', 'colloquial'], examples: [{ text: st('піти+ по во+ду'), translation: 'to go for water', source: 'wiktionary' }] }),
        ],
      }),
      S('by means of (communication)', { tags: ['with-dative'], examples: [{ text: st('по телефо+ну'), translation: 'by telephone', source: 'wiktionary' }] }),
      S('each, apiece (distributive)', { tags: ['with-dative', 'distributive'] }),
    ],
    pronunciation: { ipa: [{ value: '[pɔ]' }] },
    freqRank: 3,
  },
  {
    word: 'я',
    heads: ['я'],
    pos: 'pronoun',
    tags: ['personal'],
    senses: [S('I (first-person singular nominative)'), S('self, ego', { tags: ['as-noun'] })],
    paradigm: nounParadigm(['я', 'мене+', 'мені+', 'мене+', 'мно+ю', 'мені+', ''], ['', '', '', '', '', '', '']),
    freqRank: 4,
  },
  {
    word: 'два',
    heads: ['два'],
    pos: 'numeral',
    tags: ['cardinal'],
    senses: [S('two')],
    paradigm: adjParadigm({
      'nom.m': 'два',
      'nom.n': 'два',
      'nom.f': 'дві',
      'gen.m': 'двох',
      'gen.n': 'двох',
      'gen.f': 'двох',
      'dat.m': 'двом',
      'dat.n': 'двом',
      'dat.f': 'двом',
      'acc.m.inan': 'два',
      'acc.m.anim': 'двох',
      'acc.n': 'два',
      'acc.f.inan': 'дві',
      'acc.f.anim': 'двох',
      'ins.m': 'двома+',
      'ins.n': 'двома+',
      'ins.f': 'двома+',
      'loc.m': 'двох',
      'loc.n': 'двох',
      'loc.f': 'двох',
    }),
    freqRank: 5,
  },
  {
    word: 'мій',
    heads: ['мій'],
    pos: 'determiner',
    tags: ['possessive'],
    senses: [S('my, mine')],
    paradigm: adjParadigm({
      'nom.m': 'мій',
      'nom.n': 'моє+',
      'nom.f': 'моя+',
      'nom.pl': 'мої+',
      'gen.m': 'мого+',
      'gen.n': 'мого+',
      'gen.f': 'моє+ї',
      'gen.pl': 'мої+х',
      'dat.m': 'моє+му',
      'dat.n': 'моє+му',
      'dat.f': 'мої+й',
      'dat.pl': 'мої+м',
      'acc.m.inan': 'мій',
      'acc.m.anim': 'мого+',
      'acc.n': 'моє+',
      'acc.f': 'мою+',
      'acc.pl.inan': 'мої+',
      'acc.pl.anim': 'мої+х',
      'ins.m': 'мої+м',
      'ins.n': 'мої+м',
      'ins.f': 'моє+ю',
      'ins.pl': 'мої+ми',
      'loc.m': 'моє+му, мої+м',
      'loc.n': 'моє+му, мої+м',
      'loc.f': 'мої+й',
      'loc.pl': 'мої+х',
    }),
    freqRank: 6,
  },
  {
    word: 'говорити',
    heads: [st('говори+ти')],
    pos: 'verb',
    aspect: 'imperfective',
    aspectPartners: [{ word: st('сказа+ти'), aspect: 'perfective', linked: false, source: 'known-aspect-pairs' }],
    senses: [S('to speak, to talk', { tags: ['intransitive'] }), S('to say, to tell', { tags: ['transitive'] })],
    paradigm: verbParadigm(
      {
        inf: 'говори+ти',
        ...persons('pres', ['говорю+', 'гово+риш', 'гово+рить', 'гово+римо, гово+рим (colloquial)', 'гово+рите', 'гово+рять']),
        'past.m': 'говори+в',
        'past.f': 'говори+ла',
        'past.n': 'говори+ло',
        'past.pl': 'говори+ли',
        'imp.2sg': 'говори+',
        'imp.1pl': 'говорі+мо',
        'imp.2pl': 'говорі+ть',
        'ptcp.pass.past': 'гово+рений',
        impers: 'гово+рено',
        'advp.pres': 'говорячи+',
        'advp.past': 'говори+вши',
      },
      'lcorp',
    ),
    freqRank: 7,
    sources: [{ source: 'lcorp', url: 'https://lcorp.ulif.org.ua/dictua/dictua.aspx', label: 'lcorp: search говорити', note: 'inflection table' }],
  },
  {
    word: 'великий',
    heads: [st('вели+кий')],
    pos: 'adjective',
    senses: [S('big, large, great'), S('grown-up, adult', { tags: ['colloquial'] })],
    paradigm: adjParadigm({
      'nom.m': 'вели+кий',
      'nom.n': 'вели+ке',
      'nom.f': 'вели+ка',
      'nom.pl': 'вели+кі',
      'gen.m': 'вели+кого',
      'gen.n': 'вели+кого',
      'gen.f': 'вели+кої',
      'gen.pl': 'вели+ких',
      'dat.m': 'вели+кому',
      'dat.n': 'вели+кому',
      'dat.f': 'вели+кій',
      'dat.pl': 'вели+ким',
      'acc.m.inan': 'вели+кий',
      'acc.m.anim': 'вели+кого',
      'acc.n': 'вели+ке',
      'acc.f': 'вели+ку',
      'acc.pl.inan': 'вели+кі',
      'acc.pl.anim': 'вели+ких',
      'ins.m': 'вели+ким',
      'ins.n': 'вели+ким',
      'ins.f': 'вели+кою',
      'ins.pl': 'вели+кими',
      'loc.m': 'вели+кому, вели+кім',
      'loc.n': 'вели+кому, вели+кім',
      'loc.f': 'вели+кій',
      'loc.pl': 'вели+ких',
    }),
    extraForms: [
      { form: st('бі+льший'), tags: ['comparative'], origin: 'head' },
      { form: st('найбі+льший'), tags: ['superlative'], origin: 'head' },
    ],
    relations: { antonym: [{ word: st('мали+й'), linked: false }] },
    freqRank: 8,
  },
  {
    word: 'рука',
    heads: [st('рука+')],
    pos: 'noun',
    genders: ['f'],
    animacy: 'inanimate',
    senses: [S('hand'), S('arm'), S('handwriting', { tags: ['figuratively'] })],
    paradigm: nounParadigm(
      ['рука+', 'руки+', 'руці+', 'ру+ку', 'руко+ю', 'руці+', 'ру+ко'],
      ['ру+ки', 'рук', 'рука+м', 'ру+ки', 'рука+ми', 'рука+х', 'ру+ки'],
    ),
    relations: { diminutive: [{ word: st('ру+чка'), linked: true }, { word: st('ру+чечка'), linked: false }] },
    freqRank: 9,
  },
  {
    word: 'вода',
    heads: [st('вода+')],
    pos: 'noun',
    genders: ['f'],
    animacy: 'inanimate',
    senses: [S('water')],
    paradigm: nounParadigm(
      ['вода+', 'води+', 'воді+', 'во+ду', 'водо+ю', 'воді+', 'во+до'],
      ['во+ди', 'вод', 'во+дам', 'во+ди', 'во+дами', 'во+дах', 'во+ди'],
    ),
    freqRank: 10,
  },
  {
    word: 'дім',
    heads: ['дім'],
    pos: 'noun',
    genders: ['m'],
    animacy: 'inanimate',
    senses: [S('house, building'), S('home'), S('household, family', { tags: ['figuratively'] })],
    paradigm: nounParadigm(
      ['дім', 'до+му', 'до+мові, до+му', 'дім', 'до+мом', 'до+мі', 'до+ме'],
      ['доми+', 'домі+в', 'дома+м', 'доми+', 'дома+ми', 'дома+х', 'доми+'],
    ),
    freqRank: 11,
  },
  {
    word: 'добрий',
    heads: [st('до+брий')],
    pos: 'adjective',
    senses: [S('good'), S('kind, good-natured')],
    paradigm: adjParadigm({
      'nom.m': 'до+брий',
      'nom.n': 'до+бре',
      'nom.f': 'до+бра',
      'nom.pl': 'до+брі',
      'gen.m': 'до+брого',
      'gen.n': 'до+брого',
      'gen.f': 'до+брої',
      'gen.pl': 'до+брих',
      'dat.m': 'до+брому',
      'dat.n': 'до+брому',
      'dat.f': 'до+брій',
      'dat.pl': 'до+брим',
      'acc.m.inan': 'до+брий',
      'acc.m.anim': 'до+брого',
      'acc.n': 'до+бре',
      'acc.f': 'до+бру',
      'acc.pl.inan': 'до+брі',
      'acc.pl.anim': 'до+брих',
      'ins.m': 'до+брим',
      'ins.n': 'до+брим',
      'ins.f': 'до+брою',
      'ins.pl': 'до+брими',
      'loc.m': 'до+брому, до+брім',
      'loc.n': 'до+брому, до+брім',
      'loc.f': 'до+брій',
      'loc.pl': 'до+брих',
      'short.m': 'добр',
      cmp: 'кра+щий',
      sup: 'найкра+щий',
    }),
    relations: { synonym: [{ word: st('хоро+ший'), linked: false }], antonym: [{ word: st('злий'), linked: false }] },
    freqRank: 12,
  },
  {
    word: 'стіл',
    heads: ['стіл'],
    pos: 'noun',
    genders: ['m'],
    animacy: 'inanimate',
    senses: [S('table (item of furniture)'), S('food, cuisine, board', { tags: ['figuratively'] }), S('princely throne', { tags: ['historical'] })],
    paradigm: nounParadigm(
      ['стіл', 'стола+, сто+лу', 'столу+, столо+ві', 'стіл', 'столо+м', 'столі+, столу+', 'сто+ле'],
      ['столи+', 'столі+в', 'стола+м', 'столи+', 'стола+ми', 'стола+х', 'столи+'],
      'wiktionary',
      ['accent pattern b'],
    ),
    pronunciation: { ipa: [{ value: '[sʲtʲiɫ]' }, { value: '[stiɫ]', tags: ['colloquial'] }], audio: [AUDIO_STIL] },
    relations: {
      diminutive: [{ word: st('сто+лик'), linked: false }],
      derived: [{ word: st('столо+вий'), linked: false }, { word: st('столі+ття'), linked: false }],
    },
    freqRank: 13,
  },
  {
    word: 'Київ',
    heads: [st('Ки+їв')],
    pos: 'proper-noun',
    genders: ['m'],
    animacy: 'inanimate',
    senses: [S('Kyiv, Kiev (the capital city of Ukraine)')],
    paradigm: nounParadigm(['Ки+їв', 'Ки+єва', 'Ки+єву', 'Ки+їв', 'Ки+євом', 'Ки+єві', 'Ки+єве'], ['', '', '', '', '', '', '']),
    freqRank: 14,
  },
  {
    word: 'співати',
    heads: [st('співа+ти')],
    pos: 'verb',
    aspect: 'imperfective',
    aspectPartners: [
      { word: st('заспіва+ти'), aspect: 'perfective', linked: true, source: 'known-aspect-pairs' },
      { word: st('поспіва+ти'), aspect: 'perfective', linked: true, source: 'wiktionary' },
    ],
    senses: [
      S('to sing', { tags: ['intransitive'], examples: [{ text: st('Пта+шки співа+ють.'), translation: 'The birds are singing.', source: 'wiktionary' }] }),
      S('to perform music', { tags: ['transitive'] }),
      S('to twitter, to whistle, to crow, etc.', { tags: ['intransitive'] }),
      S('to have a nice sound (about musical instrument, bell, toot, etc.)', { tags: ['figuratively', 'intransitive'] }),
      S('to be in a nice mood, to be excited', { tags: ['figuratively', 'intransitive'] }),
      S('to glorify (in poetry, songs) something or somebody', { tags: ['transitive'] }),
    ],
    paradigm: verbParadigm({
      inf: 'співа+ти',
      ...persons('pres', ['співа+ю', 'співа+єш', 'співа+є', 'співа+ємо, співа+єм (colloquial)', 'співа+єте', 'співа+ють']),
      ...persons('fut', ['співа+тиму', 'співа+тимеш', 'співа+тиме', 'співа+тимемо, співа+тимем (colloquial)', 'співа+тимете', 'співа+тимуть']),
      'past.m': 'співа+в',
      'past.f': 'співа+ла',
      'past.n': 'співа+ло',
      'past.pl': 'співа+ли',
      'imp.2sg': 'співа+й',
      'imp.1pl': 'співа+ймо',
      'imp.2pl': 'співа+йте',
      'ptcp.act.pres': 'співа+ючий (rare)',
      'ptcp.pass.past': 'спі+ваний',
      impers: 'спі+вано',
      'advp.pres': 'співа+ючи',
      'advp.past': 'співа+вши',
    }),
    pronunciation: { ipa: [{ value: '[sʲpʲiˈʋate]' }], audio: [AUDIO_SPIVATY] },
    relations: {
      related: [{ word: st('спів'), linked: false }, { word: st('співа+к'), linked: true }, { word: st('пі+сня'), linked: true }],
      derived: [{ word: st('проспіва+ти'), linked: false }, { word: st('доспіва+ти'), linked: false }, { word: st('переспіва+ти'), linked: false }],
    },
    freqRank: 15,
  },
  {
    word: 'пісня',
    heads: [st('пі+сня')],
    pos: 'noun',
    genders: ['f'],
    animacy: 'inanimate',
    senses: [S('song')],
    paradigm: nounParadigm(
      ['пі+сня', 'пі+сні', 'пі+сні', 'пі+сню', 'пі+снею', 'пі+сні', 'пі+сне'],
      ['пі+сні', 'пісе+нь', 'пі+сням', 'пі+сні', 'пі+снями', 'пі+снях', 'пі+сні'],
    ),
    freqRank: 16,
  },
  {
    word: 'собака',
    heads: [st('соба+ка')],
    pos: 'noun',
    genders: ['m', 'f'],
    animacy: 'animate',
    senses: [
      S('dog (animal)', { examples: [{ text: st('Соба+ка гавка+є.'), translation: 'The dog is barking.', source: 'wiktionary' }] }),
      S('scoundrel, detestable person', { tags: ['figuratively', 'derogatory'] }),
    ],
    paradigm: nounParadigm(
      ['соба+ка', 'соба+ки', 'соба+ці', 'соба+ку', 'соба+кою', 'соба+ці', 'соба+ко'],
      ['соба+ки', 'соба+к', 'соба+кам', 'соба+к', 'соба+ками', 'соба+ках', 'соба+ки'],
    ),
    pronunciation: { ipa: [{ value: '[sɔˈbakɐ]' }], audio: [AUDIO_SOBAKA] },
    relations: {
      synonym: [{ word: st('пес'), linked: true }, { word: st('псина'), linked: false, tags: ['colloquial'] }],
      diminutive: [{ word: st('соба+чка'), linked: true }, { word: st('соба+чечка'), linked: false }],
      derived: [
        'соба+чий',
        'соба+чник',
        'соба+чниця',
        'соба+чність',
        'собаківни+к',
        'соба+читися',
        'собацю+ра',
        'собачу+га',
        'собакозна+вець',
        'собакозна+вство',
        'собаколо+в',
        'собаче+нько',
        'соба+чий хвіст',
        'соба+ча будка+',
      ].map((w) => ({ word: st(w), linked: false })),
    },
    freqRank: 17,
  },
  {
    word: 'зелений',
    heads: [st('зеле+ний')],
    pos: 'adjective',
    senses: [S('green'), S('unripe', { tags: ['figuratively'] }), S('inexperienced, green', { tags: ['figuratively', 'colloquial'] })],
    paradigm: adjParadigm({
      'nom.m': 'зеле+ний',
      'nom.n': 'зеле+не',
      'nom.f': 'зеле+на',
      'nom.pl': 'зеле+ні',
      'gen.m': 'зеле+ного',
      'gen.n': 'зеле+ного',
      'gen.f': 'зеле+ної',
      'gen.pl': 'зеле+них',
      'dat.m': 'зеле+ному',
      'dat.n': 'зеле+ному',
      'dat.f': 'зеле+ній',
      'dat.pl': 'зеле+ним',
      'acc.m.inan': 'зеле+ний',
      'acc.m.anim': 'зеле+ного',
      'acc.n': 'зеле+не',
      'acc.f': 'зеле+ну',
      'acc.pl.inan': 'зеле+ні',
      'acc.pl.anim': 'зеле+них',
      'ins.m': 'зеле+ним',
      'ins.n': 'зеле+ним',
      'ins.f': 'зеле+ною',
      'ins.pl': 'зеле+ними',
      'loc.m': 'зеле+ному, зеле+нім',
      'loc.n': 'зеле+ному, зеле+нім',
      'loc.f': 'зеле+ній',
      'loc.pl': 'зеле+них',
      'short.m': 'зеле+н (poetic)',
      cmp: 'зелені+ший',
      sup: 'найзелені+ший',
    }),
    relations: { related: [{ word: st('зе+лень'), linked: false }, { word: st('зелені+ти'), linked: false }] },
    freqRank: 18,
  },
  {
    word: 'замок',
    heads: [st('за+мок')],
    pos: 'noun',
    genders: ['m'],
    animacy: 'inanimate',
    senses: [S('castle'), S('palace, manor', { tags: ['broadly'] })],
    paradigm: nounParadigm(
      ['за+мок', 'за+мку', 'за+мку, за+мкові', 'за+мок', 'за+мком', 'за+мку, за+мкові', 'за+мку'],
      ['за+мки', 'за+мків', 'за+мкам', 'за+мки', 'за+мками', 'за+мках', 'за+мки'],
    ),
    freqRank: 19,
  },
  {
    word: 'ручка',
    heads: [st('ру+чка')],
    pos: 'noun',
    genders: ['f'],
    animacy: 'inanimate',
    senses: [
      S('pen (writing implement)'),
      S('handle'),
      S('hilt (of a sword)'),
      (() => {
        const gloss = 'diminutive of рука́: small hand, arm';
        return S(gloss, {
          tags: ['diminutive'],
          links: [linkSpan(gloss, 'рука́', 'рука+')],
          formOf: [{ word: st('рука+'), tags: ['diminutive'], linked: true }],
        });
      })(),
      (() => {
        const gloss = 'armrest (of an armchair); cf. підлокітник';
        return S(gloss, { links: [linkSpan(gloss, 'підлокітник', 'підлокі+тник')] });
      })(),
    ],
    paradigm: nounParadigm(
      ['ру+чка', 'ру+чки', 'ру+чці', 'ру+чку', 'ру+чкою', 'ру+чці', 'ру+чко'],
      ['ру+чки', 'ру+чок', 'ру+чкам', 'ру+чки', 'ру+чками', 'ру+чках', 'ру+чки'],
    ),
    pronunciation: { ipa: [{ value: '[ˈrut͡ʃkɐ]' }] },
    freqRank: 20,
  },
  {
    word: 'замок',
    heads: [st('замо+к')],
    pos: 'noun',
    genders: ['m'],
    animacy: 'inanimate',
    senses: [S('lock (fastening device)'), S('keystone (of an arch)', { tags: ['architecture'], topics: ['architecture'] })],
    paradigm: nounParadigm(
      ['замо+к', 'замка+', 'замку+, замко+ві', 'замо+к', 'замко+м', 'замку+, замко+ві', 'замку+'],
      ['замки+', 'замкі+в', 'замка+м', 'замки+', 'замка+ми', 'замка+х', 'замки+'],
    ),
    relations: { diminutive: [{ word: st('замо+чок'), linked: false }] },
    freqRank: 21,
  },
  {
    word: "п'ять",
    heads: [st("п'ять")],
    pos: 'numeral',
    tags: ['cardinal'],
    senses: [S('five')],
    paradigm: nounParadigm(["п'ять", "п'ятьо+х, п'яти+", "п'ятьо+м, п'яти+", "п'ять, п'ятьо+х", "п'ятьма+, п'ятьо+ма", "п'ятьо+х, п'яти+", ''], ['', '', '', '', '', '', '']),
    freqRank: 22,
  },
  {
    word: 'співак',
    heads: [st('співа+к')],
    pos: 'noun',
    genders: ['m'],
    animacy: 'animate',
    senses: [S('singer')],
    paradigm: nounParadigm(
      ['співа+к', 'співака+', 'співаку+, співако+ві', 'співака+', 'співако+м', 'співаку+, співако+ві', 'співа+че'],
      ['співаки+', 'співакі+в', 'співака+м', 'співакі+в', 'співака+ми', 'співака+х', 'співаки+'],
    ),
    relations: { feminine: [{ word: st('співа+чка'), linked: false }] },
    freqRank: 23,
  },
  {
    word: 'пес',
    heads: ['пес'],
    pos: 'noun',
    genders: ['m'],
    animacy: 'animate',
    senses: [S('dog, hound'), S('cur (contemptible person)', { tags: ['figuratively', 'derogatory'] })],
    paradigm: nounParadigm(
      ['пес', 'пса', 'псу, псо+ві', 'пса', 'псом', 'псо+ві, псі', 'псе'],
      ['пси', 'псів', 'псам', 'псів', 'пса+ми', 'псах', 'пси'],
    ),
    relations: { synonym: [{ word: st('соба+ка'), linked: true }] },
    freqRank: 24,
  },
  {
    word: 'заспівати',
    heads: [st('заспіва+ти')],
    pos: 'verb',
    aspect: 'perfective',
    aspectPartners: [{ word: st('співа+ти'), aspect: 'imperfective', linked: true, source: 'known-aspect-pairs' }],
    senses: [S('to begin to sing, to start singing'), S('to sing (a song)', { tags: ['transitive'] })],
    paradigm: verbParadigm({
      inf: 'заспіва+ти',
      ...persons('fut', ['заспіва+ю', 'заспіва+єш', 'заспіва+є', 'заспіва+ємо', 'заспіва+єте', 'заспіва+ють']),
      'past.m': 'заспіва+в',
      'past.f': 'заспіва+ла',
      'past.n': 'заспіва+ло',
      'past.pl': 'заспіва+ли',
      'imp.2sg': 'заспіва+й',
      'imp.1pl': 'заспіва+ймо',
      'imp.2pl': 'заспіва+йте',
      'ptcp.pass.past': 'заспі+ваний',
      impers: 'заспі+вано',
      'advp.past': 'заспіва+вши',
    }),
    freqRank: 25,
  },
  {
    word: 'поспівати',
    heads: [st('поспіва+ти')],
    pos: 'verb',
    aspect: 'perfective',
    aspectPartners: [{ word: st('співа+ти'), aspect: 'imperfective', linked: true, source: 'wiktionary' }],
    senses: [S('to sing for a while')],
    freqRank: 26,
  },
  {
    word: 'собачка',
    heads: [st('соба+чка')],
    pos: 'noun',
    genders: ['f'],
    animacy: 'animate',
    senses: (() => {
      const gloss = 'diminutive of соба́ка: doggy, little dog';
      return [S(gloss, { tags: ['diminutive'], links: [linkSpan(gloss, 'соба́ка', 'соба+ка')], formOf: [{ word: st('соба+ка'), tags: ['diminutive'], linked: true }] }), S('trigger (of a gun)', { tags: ['colloquial'] })];
    })(),
    paradigm: nounParadigm(
      ['соба+чка', 'соба+чки', 'соба+чці', 'соба+чку', 'соба+чкою', 'соба+чці', 'соба+чко'],
      ['соба+чки', 'соба+чок', 'соба+чкам', 'соба+чок', 'соба+чками', 'соба+чках', 'соба+чки'],
    ),
  },
  {
    word: 'хот-дог',
    heads: [st('хот-до+г')],
    pos: 'noun',
    genders: ['m'],
    senses: [S('hot dog', { qualifier: 'sausage in a bun' })],
    created: {
      method: 'english-translation',
      from: [{ enWord: 'hot dog', enPos: 'noun', sense: 'sausage in a bun', url: wiktionaryEnglishUrl('hot dog') }],
    },
    sources: [{ source: 'wiktionary-translations', url: wiktionaryEnglishUrl('hot dog'), label: 'English Wiktionary: hot dog', note: "translation of English 'hot dog' (noun)" }],
  },
];

export function fixtureEntries(): Entry[] {
  const slugCount = new Map<string, number>();
  return drafts.map((d, id) => {
    const base = `${d.word}~${d.pos}`;
    const n = (slugCount.get(base) ?? 0) + 1;
    slugCount.set(base, n);
    const key = searchKey(d.word);
    const sources: SourceRef[] = d.sources ?? [];
    if (!d.created) {
      sources.unshift(
        { source: 'wiktionary', url: wiktionaryUrl(d.word), label: `Wiktionary: ${d.word}` },
        { source: 'kaikki', url: kaikkiUrl(d.word), label: `kaikki.org: ${d.word}` },
      );
    }
    return { ...d, id, slug: n > 1 ? `${base}~${n}` : base, key, sources } as Entry;
  });
}
