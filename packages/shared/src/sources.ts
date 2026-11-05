import type { Attribution, SourceId } from './types.ts';
import { stripStress } from './normalize.ts';

/** Built-in source attributions. Pipeline plugins may add more (they end up in manifest.attributions). */
export const BUILTIN_ATTRIBUTIONS: Attribution[] = [
  {
    id: 'wiktionary',
    name: 'Wiktionary (English edition)',
    url: 'https://en.wiktionary.org/',
    license: 'CC BY-SA 4.0 / GFDL',
    licenseUrl: 'https://en.wiktionary.org/wiki/Wiktionary:Copyrights',
    description:
      'Definitions, inflection tables, pronunciations, synonyms and related terms of Ukrainian entries, written by Wiktionary contributors.',
  },
  {
    id: 'wiktionary-translations',
    name: 'Wiktionary translation tables',
    url: 'https://en.wiktionary.org/',
    license: 'CC BY-SA 4.0 / GFDL',
    licenseUrl: 'https://en.wiktionary.org/wiki/Wiktionary:Copyrights',
    description:
      'Ukrainian translations listed on English Wiktionary entries. Used to create entries for Ukrainian words that have no Ukrainian Wiktionary entry ("created" entries).',
  },
  {
    id: 'kaikki',
    name: 'kaikki.org / Wiktextract',
    url: 'https://kaikki.org/dictionary/',
    license: 'CC BY-SA 4.0 / GFDL (same as Wiktionary)',
    licenseUrl: 'https://kaikki.org/dictionary/rawdata.html',
    description:
      'Machine-readable Wiktionary extraction by Tatu Ylonen (Wiktextract: Wiktionary as Machine-Readable Structured Data, LREC 2022). Source files: kaikki.org-dictionary-Ukrainian.jsonl and kaikki.org-dictionary-English.jsonl.',
  },
  {
    id: 'lcorp',
    name: 'Словники України online (lcorp.ulif.org.ua)',
    url: 'https://lcorp.ulif.org.ua/dictua/',
    license: '© Український мовно-інформаційний фонд НАН України (ULIF), 2001–2026',
    description:
      'Inflection tables (словозміна) for words whose Wiktionary entry has no declension/conjugation table. “Dictionaries of Ukraine online”, Ukrainian Lingua-Information Fund of the NAS of Ukraine.',
  },
  {
    id: 'frequency',
    name: 'Частотний словник сучасної української публіцистики',
    url: 'http://www.mova.info/page2.aspx?l1=91',
    description:
      'Frequency dictionary of modern Ukrainian publicistic texts (laboratory of computational linguistics, mova.info). Used to order entries and search results by frequency.',
  },
  {
    id: 'known-aspect-pairs',
    name: 'Curated verb aspect pairs',
    url: '',
    description: 'Project-maintained list of imperfective/perfective verb pairs (verb_aspect_known_pairs.json).',
  },
];

/** English Wiktionary page for a Ukrainian word (Ukrainian section). */
export function wiktionaryUrl(word: string): string {
  return `https://en.wiktionary.org/wiki/${encodeURIComponent(stripStress(word).replace(/ /g, '_'))}#Ukrainian`;
}

/** English Wiktionary page of an English word, anchored at its translations. */
export function wiktionaryEnglishUrl(enWord: string): string {
  return `https://en.wiktionary.org/wiki/${encodeURIComponent(enWord.replace(/ /g, '_'))}#English`;
}

/** kaikki.org HTML page for a Ukrainian word. */
export function kaikkiUrl(word: string): string {
  const w = stripStress(word);
  const chars = Array.from(w);
  const p1 = chars.slice(0, 1).join('');
  const p2 = chars.slice(0, 2).join('');
  const enc = (s: string) => encodeURIComponent(s);
  return `https://kaikki.org/dictionary/Ukrainian/meaning/${enc(p1)}/${enc(p2)}/${enc(w)}.html`;
}

/** lcorp has no per-word URLs (ASP.NET postback form); link to the dictionary front page. */
export const LCORP_URL = 'https://lcorp.ulif.org.ua/dictua/dictua.aspx';

export function sourceLabel(id: SourceId): string {
  return BUILTIN_ATTRIBUTIONS.find((a) => a.id === id)?.name ?? id;
}
