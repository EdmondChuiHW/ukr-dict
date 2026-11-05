/** English kaikki entry → Ukrainian translations (pure; used by the workers and tests). */
import { hasCyrillic } from '@ukdict/shared';
import type { EnTranslation } from '../../contracts.ts';

/** Byte pattern present on every line that has a Ukrainian translation item (cheap prefilter before JSON.parse). */
export const UK_TRANSLATION_PREFILTER = '"code": "uk"';

const isUk = (t: any) => t && typeof t === 'object' && (t.code === 'uk' || t.lang_code === 'uk');

function toTranslation(t: any, enWord: string, enPos: string, fallbackSense: string | undefined): EnTranslation | undefined {
  if (!isUk(t) || typeof t.word !== 'string') return undefined;
  const ukWord = t.word.replace(/\s+/g, ' ').trim();
  if (!ukWord || !hasCyrillic(ukWord)) return undefined;
  const out: EnTranslation = { ukWord, enWord, enPos };
  const sense = typeof t.sense === 'string' && t.sense.trim() ? t.sense.trim() : fallbackSense;
  if (sense) out.sense = sense;
  if (Array.isArray(t.tags)) {
    const tags = t.tags.filter((x: unknown): x is string => typeof x === 'string' && x !== '');
    if (tags.length) out.tags = [...new Set<string>(tags)];
  }
  if (typeof t.roman === 'string' && t.roman.trim()) out.roman = t.roman.trim();
  return out;
}

/** All Ukrainian translations of one English entry (top-level `translations` and `senses[].translations`), deduped. */
export function extractUkTranslations(raw: any): EnTranslation[] {
  if (!raw || typeof raw !== 'object' || typeof raw.word !== 'string') return [];
  const enWord = raw.word;
  const enPos = typeof raw.pos === 'string' ? raw.pos : '';
  const out: EnTranslation[] = [];
  const seen = new Set<string>();
  const push = (t: EnTranslation | undefined) => {
    if (!t) return;
    const k = `${t.ukWord}|${t.sense ?? ''}|${t.tags?.join(',') ?? ''}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(t);
  };
  if (Array.isArray(raw.translations)) for (const t of raw.translations) push(toTranslation(t, enWord, enPos, undefined));
  if (Array.isArray(raw.senses)) {
    for (const s of raw.senses) {
      if (!s || !Array.isArray(s.translations)) continue;
      const g = Array.isArray(s.glosses) ? s.glosses.filter((x: unknown) => typeof x === 'string' && x) : [];
      const fallback = g.length ? String(g[g.length - 1]) : undefined;
      for (const t of s.translations) push(toTranslation(t, enWord, enPos, fallback));
    }
  }
  return out;
}
