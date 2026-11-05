/** Number / byte / duration formatting for the TUI and reports. */
import type { ProgressUnit } from '../contracts.ts';

export function humanBytes(n: number): string {
  if (!Number.isFinite(n)) return '?';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (Math.abs(v) >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return i === 0 ? `${Math.round(v)} B` : `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

export function humanCount(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** Compact count for rates: 950, 12.3k, 4.5M. */
export function compactCount(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e4) return `${Math.round(n / 1e3)}k`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  if (a >= 10 || n === Math.round(n)) return `${Math.round(n)}`;
  return n.toFixed(1);
}

export function humanDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '?';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  const rs = Math.floor(s % 60);
  if (m < 60) return `${m}m ${String(rs).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, '0')}m`;
}

const UNIT_LABEL: Record<ProgressUnit, string> = { bytes: '', items: '', requests: 'req', lines: 'lines' };

export function formatAmount(n: number, unit: ProgressUnit): string {
  if (unit === 'bytes') return humanBytes(n);
  const label = UNIT_LABEL[unit];
  return label ? `${humanCount(n)} ${label}` : humanCount(n);
}

/** "12.3 / 45.6 MB" style pair. */
export function formatProgress(current: number, total: number | undefined, unit: ProgressUnit): string {
  if (total === undefined || total <= 0) return formatAmount(current, unit);
  if (unit === 'bytes') return `${humanBytes(current)} / ${humanBytes(total)}`;
  const label = UNIT_LABEL[unit];
  return `${humanCount(current)} / ${humanCount(total)}${label ? ' ' + label : ''}`;
}

export function formatRate(perSec: number, unit: ProgressUnit): string {
  if (!Number.isFinite(perSec) || perSec <= 0) return '';
  if (unit === 'bytes') return `${humanBytes(perSec)}/s`;
  if (unit === 'requests') return `${perSec.toFixed(perSec < 10 ? 1 : 0)} req/s`;
  return `${compactCount(perSec)}/s`;
}

const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

/** Visible width (ANSI stripped; counts code points — no wide glyphs are used by the TUI). */
export function visibleWidth(s: string): number {
  let n = 0;
  for (const ch of stripAnsi(s)) if (ch !== '́' && ch !== '̀') n++;
  return n;
}

/** Truncates a string with ANSI codes to `width` visible columns. */
export function truncateAnsi(s: string, width: number): string {
  if (visibleWidth(s) <= width) return s;
  let out = '';
  let w = 0;
  let i = 0;
  while (i < s.length && w < width - 1) {
    if (s[i] === '\x1b') {
      const m = /^\x1b\[[0-9;?]*[A-Za-z]/.exec(s.slice(i));
      if (m) {
        out += m[0];
        i += m[0].length;
        continue;
      }
    }
    const cp = s.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    out += ch;
    i += ch.length;
    if (ch !== '́' && ch !== '̀') w++;
  }
  return out + '…\x1b[0m';
}

export function padEndVisible(s: string, width: number): string {
  const w = visibleWidth(s);
  return w >= width ? s : s + ' '.repeat(width - w);
}
