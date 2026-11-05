/** Small persisted user settings (localStorage) exposed as external stores for useSyncExternalStore. */
import { useSyncExternalStore } from 'react';

export type CaseOrderSetting = 'grouped' | 'traditional';

interface Settings {
  caseOrder: CaseOrderSetting;
  recent: string[];
}

const KEY = 'ukdict.settings.v1';
const MAX_RECENT = 16;

function read(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
    return {
      caseOrder: raw.caseOrder === 'traditional' ? 'traditional' : 'grouped',
      recent: Array.isArray(raw.recent) ? raw.recent.filter((x) => typeof x === 'string').slice(0, MAX_RECENT) : [],
    };
  } catch {
    return { caseOrder: 'grouped', recent: [] };
  }
}

let state: Settings = typeof localStorage !== 'undefined' ? read() : { caseOrder: 'grouped', recent: [] };
const listeners = new Set<() => void>();

function set(next: Settings) {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage full / disabled */
  }
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) {
      state = read();
      for (const l of listeners) l();
    }
  });
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, () => state);
}

export function setCaseOrder(caseOrder: CaseOrderSetting) {
  set({ ...state, caseOrder });
}

/** Remember a looked-up word (most recent first, unique). */
export function addRecent(word: string) {
  const w = word.trim();
  if (!w) return;
  if (state.recent[0] === w) return;
  set({ ...state, recent: [w, ...state.recent.filter((x) => x !== w)].slice(0, MAX_RECENT) });
}

export function clearRecent() {
  set({ ...state, recent: [] });
}
