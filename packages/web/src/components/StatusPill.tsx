import { getClient } from '../lib/client.ts';
import type { ClientState } from '../lib/client.ts';
import { formatBytes } from '../lib/labels.ts';

export function statusText(s: ClientState): { label: string; tone: 'busy' | 'ok' | 'done' | 'error'; pct?: number } {
  if (s.phase === 'error') return { label: 'Data unavailable', tone: 'error' };
  if (s.phase === 'loading') return { label: 'Loading index…', tone: 'busy' };
  const o = s.offline;
  if (o.state === 'running') {
    const pct = o.totalBytes > 0 ? Math.min(99, Math.floor((o.loadedBytes / o.totalBytes) * 100)) : 0;
    return { label: `Downloading for offline: ${pct} %`, tone: 'busy', pct };
  }
  if (o.state === 'done') return { label: 'Offline ready', tone: 'done' };
  if (o.state === 'error') return { label: 'Offline download incomplete', tone: 'error' };
  if (s.phase === 'core') return { label: 'Ready (headwords)', tone: 'ok' };
  return { label: 'Ready', tone: 'ok' };
}

export function OfflineDetails({ state }: { state: ClientState }) {
  const o = state.offline;
  const info = state.info;
  return (
    <div className="offline-details">
      <ol className="phases">
        <li className={state.phase !== 'loading' ? 'done' : 'active'}>
          <b>Headword index</b> — exact, prefix and substring search of headwords
          {info ? <span className="muted"> ({formatBytes(info.coreBytes)})</span> : null}
        </li>
        <li className={state.phase === 'ready' ? 'done' : state.phase === 'core' ? 'active' : ''}>
          <b>Summaries</b> — short glosses for result lists
          {info ? <span className="muted"> ({formatBytes(info.summariesBytes)})</span> : null}
        </li>
        <li className={o.state === 'done' ? 'done' : o.state === 'running' ? 'active' : ''}>
          <b>Offline download</b> — all entries, inflected forms and the English index; afterwards the dictionary works without a
          network connection
          {info ? <span className="muted"> ({formatBytes(info.totalBytes)} in {info.fileCount} files)</span> : null}
        </li>
      </ol>
      {o.state === 'running' ? (
        <div className="progress">
          <progress max={o.totalBytes || 1} value={o.loadedBytes} />
          <span className="muted small">
            {formatBytes(o.loadedBytes)} of {formatBytes(o.totalBytes)} · {o.files}/{o.filesTotal} files
          </span>
        </div>
      ) : null}
      {o.state === 'error' ? <p className="notice warn">{o.error} — check the connection and retry.</p> : null}
      {state.phase === 'error' ? <p className="notice warn">Could not load the dictionary data: {state.error}</p> : null}
      {state.phase !== 'loading' && state.phase !== 'error' && o.state !== 'running' ? (
        <button type="button" className="btn" onClick={() => getClient().prefetch(true)}>
          {o.state === 'done' ? 'Check offline data again' : o.state === 'error' ? 'Retry download' : 'Download for offline use'}
        </button>
      ) : null}
    </div>
  );
}

export function StatusPill({ state }: { state: ClientState }) {
  const s = statusText(state);
  return (
    <>
      <button
        type="button"
        className={`status-pill ${s.tone}`}
        popoverTarget="status-pop"
        title="Data loading and offline status — click for details"
        aria-live="polite"
      >
        <span className="dot" aria-hidden="true" />
        <span className="status-label" data-short={s.pct !== undefined ? `${s.pct} %` : '…'}>
          {s.label}
        </span>
        {s.pct !== undefined ? <span className="pill-bar" style={{ width: `${s.pct}%` }} aria-hidden="true" /> : null}
      </button>
      <div id="status-pop" popover="auto" className="popover">
        <h2 className="pop-title">{s.label}</h2>
        <OfflineDetails state={state} />
      </div>
    </>
  );
}
