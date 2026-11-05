/**
 * One shared <audio> element for pronunciation playback. Files are fetched with CORS (Wikimedia allows it) so the
 * service worker can cache them (a media element's range requests would not be cacheable); playback falls back to
 * the plain URL when fetching fails. MP3 first (Safari), OGG as the alternative source.
 */
import { useSyncExternalStore } from 'react';
import type { Audio as AudioRef } from '@ukdict/shared';

export interface AudioState {
  current: string | null;
  phase: 'loading' | 'playing' | null;
}

let el: HTMLAudioElement | undefined;
let state: AudioState = { current: null, phase: null };
let objectUrl: string | undefined;
const listeners = new Set<() => void>();

function setState(next: AudioState) {
  state = next;
  for (const l of listeners) l();
}

function element(): HTMLAudioElement {
  if (!el) {
    el = new Audio();
    el.preload = 'auto';
    const stop = () => {
      // Pause events caused by switching sources arrive while the next file is 'loading' → ignore those.
      if (state.phase === 'playing') setState({ current: null, phase: null });
    };
    el.addEventListener('ended', stop);
    el.addEventListener('pause', stop);
  }
  return el;
}

function candidates(a: AudioRef): string[] {
  const mp3First = element().canPlayType('audio/mpeg') !== '';
  const list = mp3First ? [a.mp3, a.ogg] : [a.ogg, a.mp3];
  return list.filter((x): x is string => !!x);
}

async function srcFor(url: string): Promise<string> {
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(blob);
    return objectUrl;
  } catch {
    return url;
  }
}

export async function toggleAudio(id: string, a: AudioRef): Promise<void> {
  const audio = element();
  if (state.current === id) {
    setState({ current: null, phase: null });
    audio.pause();
    return;
  }
  setState({ current: id, phase: 'loading' });
  audio.pause();
  for (const url of candidates(a)) {
    try {
      const src = await srcFor(url);
      if (state.current !== id) return; // superseded by another click
      audio.src = src;
      await audio.play();
      if (state.current === id) setState({ current: id, phase: 'playing' });
      return;
    } catch {
      /* try the next source */
    }
  }
  if (state.current === id) setState({ current: null, phase: null });
}

export function useAudioState(): AudioState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}
