/**
 * UI-side handle of the search worker, exposed as an external store (useSyncExternalStore).
 * Results of stale queries are dropped (sequence numbers); the previous result stays visible until a newer one
 * arrives. The offline prefetch starts after the first completed query or after ~3 s of idle time.
 */
import { useSyncExternalStore } from 'react';
import type { DataInfo, DataPhase, FromWorker, OfflineProgress, SearchResult, ToWorker } from './protocol.ts';

export interface ClientState {
  phase: DataPhase;
  info?: DataInfo;
  error?: string;
  offline: OfflineProgress;
  result?: SearchResult;
  /** Sequence number of the latest query sent. */
  seq: number;
  /** The latest query string sent. */
  query: string;
}

/** Data directory: VITE_DATA_DIR (default "data"), overridable with ?data=<dir> for development. */
export function dataDir(): string {
  const fromUrl = new URLSearchParams(location.search).get('data');
  if (fromUrl && /^[a-z0-9-]+$/.test(fromUrl)) return fromUrl;
  return (import.meta.env.VITE_DATA_DIR as string | undefined) || 'data';
}

class SearchClient {
  private worker: Worker;
  private listeners = new Set<() => void>();
  private prefetchRequested = false;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  state: ClientState = {
    phase: 'loading',
    offline: { state: 'idle', loadedBytes: 0, totalBytes: 0, files: 0, filesTotal: 0 },
    seq: 0,
    query: '',
  };

  constructor() {
    this.worker = new Worker(new URL('../worker/search.worker.ts', import.meta.url), { type: 'module', name: 'search' });
    this.worker.onmessage = (ev: MessageEvent<FromWorker>) => this.onMessage(ev.data);
    this.worker.onerror = (ev) => this.set({ phase: 'error', error: ev.message || 'search worker failed to start' });
    const dataUrl = new URL(`${dataDir()}/`, document.baseURI).href;
    this.send({ type: 'init', dataUrl });
  }

  private send(msg: ToWorker) {
    this.worker.postMessage(msg);
  }

  private set(patch: Partial<ClientState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  private onMessage(msg: FromWorker) {
    switch (msg.type) {
      case 'phase':
        this.set({ phase: msg.phase, info: msg.info ?? this.state.info, error: msg.error });
        if (msg.phase === 'core' || msg.phase === 'ready') this.armIdlePrefetch();
        break;
      case 'offline':
        this.set({ offline: msg.progress });
        break;
      case 'result':
        if (msg.result.seq !== this.state.seq) return; // stale
        this.set({ result: msg.result });
        if (msg.result.done && msg.result.key) this.prefetch();
        break;
    }
  }

  private armIdlePrefetch() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.prefetch(), 3000);
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };

  getSnapshot = () => this.state;

  query(q: string) {
    if (q === this.state.query && this.state.seq > 0) return;
    const seq = this.state.seq + 1;
    this.set({ seq, query: q });
    this.send({ type: 'query', seq, q });
    if (this.state.phase !== 'loading') this.armIdlePrefetchIfPending();
  }

  private armIdlePrefetchIfPending() {
    if (!this.prefetchRequested) this.armIdlePrefetch();
  }

  /** Start (or re-verify) the background download of every data file. */
  prefetch(force = false) {
    if (this.prefetchRequested && !force) return;
    this.prefetchRequested = true;
    clearTimeout(this.idleTimer);
    this.send({ type: 'prefetch' });
    void navigator.storage?.persist?.().catch(() => false);
  }
}

let client: SearchClient | undefined;
export function getClient(): SearchClient {
  client ??= new SearchClient();
  return client;
}

export function useClientState(): ClientState {
  const c = getClient();
  return useSyncExternalStore(c.subscribe, c.getSnapshot);
}
