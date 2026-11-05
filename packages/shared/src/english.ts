/**
 * English tokenization for the full-text index over definitions. The pipeline indexes glosses with
 * `englishIndexTokens`; the web app tokenizes queries with `englishQueryTokens`. Both must stay in sync.
 */
import { stemmer } from 'stemmer';

const STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'from', 'as', 'or', 'and', 'be', 'is',
  'are', 'was', 'its', 'it', 'that', 'this', 'which', 'who', 'one', 'someone', 'something', 'sth', 'smb', 'etc',
  'e', 'g', 'i', 'eg', 'ie', 'used', 'into', 'than', 'not',
]);

/** Lowercase, strip diacritics, split into alphanumeric words (apostrophes inside words are dropped: "don't" → "dont"). */
export function englishWords(text: string): string[] {
  const s = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '');
  return s.split(/[^a-z0-9]+/).filter((w) => w.length > 0);
}

export function englishStem(word: string): string {
  return word.length <= 2 ? word : stemmer(word);
}

/** Tokens to index for a gloss: stems of non-stopword words, deduplicated, in order of first occurrence. */
export function englishIndexTokens(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const w of englishWords(text)) {
    if (STOPWORDS.has(w)) continue;
    const t = englishStem(w);
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

export interface EnglishQuery {
  /** Stemmed tokens that must all match (AND). */
  tokens: string[];
  /** The raw (unstemmed, lowercased) last word, for prefix matching while the user is still typing. Undefined if the query ends with whitespace. */
  lastPrefix?: string;
}

export function englishQueryTokens(query: string): EnglishQuery {
  const words = englishWords(query);
  const meaningful = words.filter((w) => !STOPWORDS.has(w));
  const tokens = (meaningful.length > 0 ? meaningful : words).map(englishStem);
  const endsWithSpace = /\s$/.test(query);
  const last = words[words.length - 1];
  return { tokens: [...new Set(tokens)], lastPrefix: !endsWithSpace && last && last.length >= 2 ? last : undefined };
}
