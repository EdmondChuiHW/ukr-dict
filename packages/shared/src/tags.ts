/**
 * Sense tag vocabulary: which kaikki tags are structural (dropped), display ordering, labels,
 * and the generic tag-grouping algorithm used to render nested definition lists.
 */

/** Tags that carry no display value (structure/extraction artefacts). */
export const STRUCTURAL_TAGS: ReadonlySet<string> = new Set([
  'form-of',
  'alt-of',
  'morpheme',
  'canonical',
  'romanization',
  'table-tags',
  'inflection-template',
  'class',
  'error-unrecognized-form',
  'no-gloss',
  'empty-gloss',
]);

/** Grammatical tags shown first (they change how a word is used). Lower index = higher priority. */
const GRAMMATICAL_ORDER = [
  'transitive',
  'intransitive',
  'ambitransitive',
  'reflexive',
  'impersonal',
  'imperfective',
  'perfective',
  'biaspectual',
  'with-genitive',
  'with-dative',
  'with-accusative',
  'with-instrumental',
  'with-locative',
  'countable',
  'uncountable',
  'plural-only',
  'singular-only',
  'in-plural',
  'collective',
  'relational',
  'attributive',
  'predicative',
  'indeclinable',
  'noun-from-verb',
];

/** Register / usage tags shown after grammatical ones. */
const USAGE_ORDER = [
  'figuratively',
  'literally',
  'broadly',
  'narrowly',
  'idiomatic',
  'colloquial',
  'informal',
  'formal',
  'literary',
  'poetic',
  'bookish',
  'officialese',
  'slang',
  'Internet',
  'vulgar',
  'derogatory',
  'offensive',
  'humorous',
  'ironic',
  'endearing',
  'diminutive',
  'augmentative',
  'dated',
  'archaic',
  'obsolete',
  'historical',
  'rare',
  'uncommon',
  'nonstandard',
  'proscribed',
  'dialectal',
  'regional',
  'neologism',
];

const PRIORITY = new Map<string, number>();
GRAMMATICAL_ORDER.forEach((t, i) => PRIORITY.set(t, i));
USAGE_ORDER.forEach((t, i) => PRIORITY.set(t, 100 + i));

export function tagPriority(tag: string): number {
  return PRIORITY.get(tag) ?? 1000;
}

export function sortTags(tags: readonly string[]): string[] {
  return [...tags].sort((a, b) => tagPriority(a) - tagPriority(b) || a.localeCompare(b));
}

const LABELS: Record<string, string> = {
  figuratively: 'figurative',
  literally: 'literal',
  'noun-from-verb': 'verbal noun',
  'plural-only': 'plural only',
  'singular-only': 'singular only',
  'in-plural': 'in the plural',
  'with-genitive': 'with genitive',
  'with-dative': 'with dative',
  'with-accusative': 'with accusative',
  'with-instrumental': 'with instrumental',
  'with-locative': 'with locative',
  imperfective: 'impf.',
  perfective: 'pf.',
};

export function tagLabel(tag: string): string {
  return LABELS[tag] ?? tag.replace(/-/g, ' ');
}

export interface TagGroup<T> {
  tag: string;
  children: Array<T | TagGroup<T>>;
}

export function isTagGroup<T>(x: T | TagGroup<T>): x is TagGroup<T> {
  return typeof x === 'object' && x !== null && 'children' in x && 'tag' in x && !('gloss' in x);
}

/**
 * Groups consecutive items that share a tag under a single tag header, recursively (multiple nest levels).
 * At each position, the tag giving the longest run of ≥2 consecutive items wins (ties → tag priority).
 * Inside a group the header tag is considered consumed; `remainingTags` reports what is left to show inline.
 *
 * @param items     items in source order
 * @param getTags   tags of an item
 * @param consumed  tags already shown by ancestor headers
 */
export function groupByTags<T>(
  items: readonly T[],
  getTags: (item: T) => readonly string[],
  consumed: ReadonlySet<string> = new Set(),
): Array<T | TagGroup<T>> {
  const out: Array<T | TagGroup<T>> = [];
  const tagsOf = (item: T) => getTags(item).filter((t) => !consumed.has(t));
  let i = 0;
  while (i < items.length) {
    let best: string | undefined;
    let bestLen = 1;
    for (const tag of tagsOf(items[i])) {
      let len = 1;
      while (i + len < items.length && tagsOf(items[i + len]).includes(tag)) len++;
      if (len > bestLen || (len === bestLen && best !== undefined && tagPriority(tag) < tagPriority(best))) {
        if (len >= 2) {
          best = tag;
          bestLen = len;
        }
      }
    }
    if (best !== undefined && bestLen >= 2) {
      const next = new Set(consumed);
      next.add(best);
      out.push({ tag: best, children: groupByTags(items.slice(i, i + bestLen), getTags, next) });
      i += bestLen;
    } else {
      out.push(items[i]);
      i++;
    }
  }
  return out;
}

/** Tags of an item that are not shown by ancestor group headers. */
export function remainingTags(tags: readonly string[] | undefined, consumed: ReadonlySet<string>): string[] {
  return sortTags((tags ?? []).filter((t) => !consumed.has(t)));
}
