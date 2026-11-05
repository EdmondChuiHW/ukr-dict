/**
 * Text normalization shared by the pipeline (index building) and the web app (query handling).
 * Any change here changes search keys → requires re-running the pipeline.
 */

/** Combining acute (primary stress) and grave (secondary stress). */
const STRESS_RE = /[̀́]/g;
/** Precomposed Cyrillic letters with grave that NFC produces from е/и + U+0300. */
const PRECOMPOSED_GRAVE: Record<string, string> = { 'ѐ': 'е', 'ѝ': 'и', 'Ѐ': 'Е', 'Ѝ': 'И' };
const PRECOMPOSED_GRAVE_RE = /[ѐѝЀЍ]/g;
/** Apostrophe look-alikes → ASCII apostrophe (Ukrainian uses the apostrophe as a letter-separator: "п'ять"). */
const APOSTROPHE_RE = /[’ʼ`´‘ʹ＇՚]/g;
const HYPHEN_RE = /[‐‑]/g;
const WS_RE = /\s+/g;

/** Remove stress marks, keeping every other character (NFC; й and ї are preserved). */
export function stripStress(s: string): string {
  return s.normalize('NFC').replace(PRECOMPOSED_GRAVE_RE, (c) => PRECOMPOSED_GRAVE[c]).replace(STRESS_RE, '');
}

export function normalizeApostrophes(s: string): string {
  return s.replace(APOSTROPHE_RE, "'");
}

/**
 * Search key: stress-insensitive, case-insensitive, apostrophe-normalized, whitespace-collapsed.
 * Used for headword keys, form keys and queries.
 */
export function searchKey(s: string): string {
  return normalizeApostrophes(stripStress(s)).toLowerCase().replace(HYPHEN_RE, '-').replace(WS_RE, ' ').trim();
}

/** Normalizes a stressed string for stress-sensitive comparison (keeps U+0301, unifies case/apostrophes). */
export function stressedKey(s: string): string {
  return normalizeApostrophes(s.normalize('NFC').replace(PRECOMPOSED_GRAVE_RE, (c) => PRECOMPOSED_GRAVE[c] + '̀'))
    .toLowerCase()
    .replace(WS_RE, ' ')
    .trim();
}

export function hasStressMark(s: string): boolean {
  return /[̀́ѐѝЀЍ]/.test(s.normalize('NFC'));
}

export interface StressParse {
  /** Text without stress marks. */
  text: string;
  /** UTF-16 indices (into `text`) of characters that carry a stress mark. */
  marks: number[];
}

/** Split a stressed string into plain text + positions of stressed characters (for highlighting). */
export function parseStress(s: string): StressParse {
  const src = s.normalize('NFC');
  let text = '';
  const marks: number[] = [];
  for (const ch of src) {
    if (ch === '́' || ch === '̀') {
      if (text.length > 0) {
        const idx = text.length - 1;
        if (marks[marks.length - 1] !== idx) marks.push(idx);
      }
    } else if (ch in PRECOMPOSED_GRAVE) {
      text += PRECOMPOSED_GRAVE[ch];
      marks.push(text.length - 1);
    } else {
      text += ch;
    }
  }
  return { text, marks };
}

const CYRILLIC_RE = /[Ѐ-ӿ]/;
const LATIN_RE = /[A-Za-z]/;

export function hasCyrillic(s: string): boolean {
  return CYRILLIC_RE.test(s);
}

export function hasLatin(s: string): boolean {
  return LATIN_RE.test(s);
}

/** Ukrainian-aware collator for alphabetical tie-breaking / display sorting. */
export const ukCollator = new Intl.Collator('uk', { sensitivity: 'base' });
