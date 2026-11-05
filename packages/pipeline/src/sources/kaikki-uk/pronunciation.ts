/** kaikki `sounds[]` → `Pronunciation` (IPA list + audio files). DECISIONS item 14. */
import type { Audio, Pronunciation } from '@ukdict/shared';
import { isJunkTag } from './tags.ts';

const AUDIO_EXT = /\.(ogg|oga|wav|mp3|flac|opus|webm)$/i;
const LINGUA_LIBRE = /^LL-Q\d+ \([^)]*\)-([^-]+)-/;

export function audioLabel(file: unknown, note?: unknown): string | undefined {
  let label: string | undefined;
  if (typeof file === 'string' && file.trim()) {
    const f = file.trim();
    const ll = LINGUA_LIBRE.exec(f);
    label = ll ? `Lingua Libre: ${ll[1]}` : f.replace(AUDIO_EXT, '');
  }
  if (typeof note === 'string' && note.trim()) label = label ? `${label} (${note.trim()})` : note.trim();
  return label;
}

function cleanTags(tags: unknown): string[] | undefined {
  if (!Array.isArray(tags)) return undefined;
  const t = tags.filter((x): x is string => typeof x === 'string' && !isJunkTag(x));
  return t.length ? [...new Set(t)] : undefined;
}

export function buildPronunciation(sounds: unknown): Pronunciation | undefined {
  if (!Array.isArray(sounds)) return undefined;
  const ipa: NonNullable<Pronunciation['ipa']> = [];
  const audio: Audio[] = [];
  const seenIpa = new Set<string>();
  const seenAudio = new Set<string>();
  for (const s of sounds) {
    if (!s || typeof s !== 'object') continue;
    const tags = cleanTags(s.tags);
    if (typeof s.ipa === 'string' && s.ipa.trim()) {
      const value = s.ipa.trim();
      const note = typeof s.note === 'string' && s.note.trim() ? s.note.trim() : undefined;
      const key = `${value}|${tags?.join(',') ?? ''}|${note ?? ''}`;
      if (!seenIpa.has(key)) {
        seenIpa.add(key);
        const item: { value: string; tags?: string[]; note?: string } = { value };
        if (tags) item.tags = tags;
        if (note) item.note = note;
        ipa.push(item);
      }
    }
    const mp3 = typeof s.mp3_url === 'string' && s.mp3_url ? s.mp3_url : undefined;
    const ogg = typeof s.ogg_url === 'string' && s.ogg_url ? s.ogg_url : undefined;
    if (mp3 || ogg) {
      const key = mp3 ?? ogg!;
      if (seenAudio.has(key)) continue;
      seenAudio.add(key);
      const a: Audio = {};
      if (mp3) a.mp3 = mp3;
      if (ogg) a.ogg = ogg;
      const label = audioLabel(s.audio, s.note);
      if (label) a.label = label;
      if (tags) a.tags = tags;
      audio.push(a);
    }
  }
  if (!ipa.length && !audio.length) return undefined;
  const p: Pronunciation = {};
  if (ipa.length) p.ipa = ipa;
  if (audio.length) p.audio = audio;
  return p;
}
