/**
 * Dependency-free terminal progress display implementing `Progress` (contracts.ts).
 *
 * TTY mode: a live block of stage lines (icon, label, bar, current/total, rate, ETA, status text) re-rendered
 * at most 10×/s with ANSI cursor movement; `log()` prints above the live block.
 * Plain mode (no TTY, or CI): timestamped log lines at stage start/end and a progress line every ~5 s.
 */
import type { Progress, ProgressUnit, StageHandle } from '../contracts.ts';
import {
  formatAmount,
  formatProgress,
  formatRate,
  humanDuration,
  padEndVisible,
  truncateAnsi,
  visibleWidth,
} from './format.ts';

export type StageState = 'pending' | 'running' | 'done' | 'failed';

export interface StageInfo {
  id: string;
  label: string;
  parent?: string;
  state: StageState;
  current: number;
  total?: number;
  unit: ProgressUnit;
  status: string;
  summary?: string;
  error?: string;
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
}

interface Stage extends StageInfo {
  samples: { t: number; v: number }[];
  plainLogged: string;
}

export interface TuiOptions {
  stream?: NodeJS.WriteStream;
  /** Force plain (non-ANSI) mode. Default: !stream.isTTY || CI. */
  plain?: boolean;
  title?: string;
  /** Live re-render interval (≥100 ms ⇒ ≤10 renders/s). */
  intervalMs?: number;
  /** Plain-mode progress line interval. */
  plainIntervalMs?: number;
  /** Clock (tests). */
  now?: () => number;
}

export interface Tui extends Progress {
  /** Pre-register stages so they show as pending. */
  plan(stages: { id: string; label: string }[]): void;
  /** Extra text in the header line (e.g. "11 workers"). */
  setHeader(text: string): void;
  /**
   * A Progress view for a sub-module: its first `stage()` call maps onto `parentId` (keeping the planned label);
   * further stage ids become indented child stages.
   */
  scoped(parentId: string): Progress;
  stages(): StageInfo[];
  readonly plain: boolean;
}

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const BAR_WIDTH = 20;
const LABEL_WIDTH = 30;

export function createTui(opts: TuiOptions = {}): Tui {
  const stream = opts.stream ?? process.stdout;
  const plain = opts.plain ?? (!stream.isTTY || !!process.env.CI);
  const color = !plain && !process.env.NO_COLOR;
  const now = opts.now ?? (() => Date.now());
  const startedAt = now();
  const title = opts.title ?? 'ukdict pipeline';
  let header = '';
  const order: string[] = [];
  const map = new Map<string, Stage>();
  let liveLines = 0;
  let closed = false;
  let frame = 0;
  let dirty = true;

  const c = (code: string, s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
  const dim = (s: string) => c('2', s);
  const ts = () => new Date(now()).toISOString().slice(11, 19);
  const write = (s: string) => {
    stream.write(s);
  };

  function insert(st: Stage) {
    if (st.parent) {
      // after the parent's last child
      let idx = order.indexOf(st.parent);
      if (idx >= 0) {
        while (idx + 1 < order.length && map.get(order[idx + 1])?.parent === st.parent) idx++;
        order.splice(idx + 1, 0, st.id);
        return;
      }
    }
    order.push(st.id);
  }

  function create(id: string, label: string, parent?: string, state: StageState = 'pending'): Stage {
    const st: Stage = { id, label, parent, state, current: 0, unit: 'items', status: '', samples: [], plainLogged: '' };
    map.set(id, st);
    insert(st);
    return st;
  }

  function start(st: Stage) {
    if (st.state !== 'pending') return;
    st.state = 'running';
    st.startedAt = now();
    st.samples = [{ t: st.startedAt, v: st.current }];
    dirty = true;
    if (plain) write(`[${ts()}] ▶ ${st.parent ? '  ' : ''}${st.label}\n`);
  }

  function sample(st: Stage) {
    const t = now();
    const last = st.samples[st.samples.length - 1];
    if (!last || t - last.t >= 200) st.samples.push({ t, v: st.current });
    else last.v = st.current;
    while (st.samples.length > 2 && t - st.samples[0].t > 5000) st.samples.shift();
  }

  function rate(st: Stage): number {
    const t = now();
    const first = st.samples[0];
    if (!first) return 0;
    const dt = (t - first.t) / 1000;
    if (dt < 0.3) return 0;
    return (st.current - first.v) / dt;
  }

  function handle(st: Stage): StageHandle {
    return {
      setTotal(total, unit) {
        start(st);
        st.total = total;
        if (unit) st.unit = unit;
        dirty = true;
      },
      set(current) {
        start(st);
        st.current = current;
        sample(st);
        dirty = true;
      },
      tick(delta = 1) {
        start(st);
        st.current += delta;
        sample(st);
        dirty = true;
      },
      status(text) {
        start(st);
        st.status = text;
        dirty = true;
      },
      done(summary) {
        start(st);
        if (summary !== undefined) st.summary = summary;
        if (st.state === 'done') return;
        st.state = 'done';
        st.endedAt = now();
        st.durationMs = st.endedAt - (st.startedAt ?? st.endedAt);
        if (st.total !== undefined && st.current < st.total) st.current = st.total;
        dirty = true;
        if (plain) {
          write(`[${ts()}] ✓ ${st.parent ? '  ' : ''}${st.label} (${humanDuration(st.durationMs)})${st.summary ? ' — ' + st.summary : ''}\n`);
        } else render();
      },
      fail(error) {
        start(st);
        st.state = 'failed';
        st.endedAt = now();
        st.durationMs = st.endedAt - (st.startedAt ?? st.endedAt);
        st.error = error instanceof Error ? error.message : String(error);
        dirty = true;
        if (plain) write(`[${ts()}] ✗ ${st.label}: ${st.error}\n`);
        else render();
      },
    };
  }

  function stage(id: string, label: string, parent?: string): StageHandle {
    let st = map.get(id);
    if (!st) st = create(id, label, parent);
    else if (label && st.state === 'pending') st.label = label;
    start(st);
    return handle(st);
  }

  // ───────── rendering ─────────

  function bar(st: Stage): string {
    if (st.total === undefined || st.total <= 0) return ' '.repeat(BAR_WIDTH);
    const frac = Math.max(0, Math.min(1, st.current / st.total));
    const full = Math.round(frac * BAR_WIDTH);
    return c('36', '█'.repeat(full)) + dim('░'.repeat(BAR_WIDTH - full));
  }

  function eta(st: Stage): string {
    if (st.total === undefined || st.total <= 0 || st.current >= st.total) return '';
    const r = rate(st);
    if (r <= 0) return '';
    return `ETA ${humanDuration(((st.total - st.current) / r) * 1000)}`;
  }

  function stageLine(st: Stage): string {
    const indent = st.parent ? '  ' : '';
    const label = padEndVisible(indent + st.label, LABEL_WIDTH);
    switch (st.state) {
      case 'pending':
        return dim(`○ ${label}`);
      case 'failed':
        return `${c('31', '✗')} ${label} ${c('31', 'failed: ' + (st.error ?? ''))}`;
      case 'done': {
        const parts = [humanDuration(st.durationMs ?? 0)];
        if (st.summary) parts.push(st.summary);
        return `${c('32', '✓')} ${label} ${dim(parts.join(' · '))}`;
      }
      default: {
        const spin = c('36', SPINNER[frame % SPINNER.length]);
        const hasTotal = st.total !== undefined && st.total > 0;
        const pct = hasTotal ? `${String(Math.floor((100 * st.current) / st.total!)).padStart(3)}%` : '    ';
        const parts: string[] = [];
        if (hasTotal || st.current > 0) parts.push(formatProgress(st.current, st.total, st.unit));
        const r = formatRate(rate(st), st.unit);
        if (r) parts.push(r);
        const e = eta(st);
        if (e) parts.push(e);
        if (st.status) parts.push(dim(st.status));
        const elapsed = dim(humanDuration(now() - (st.startedAt ?? now())));
        return `${spin} ${label} ${bar(st)} ${pct} ${elapsed}  ${parts.join('  ')}`;
      }
    }
  }

  function frameLines(): string[] {
    const head = `${c('1', title)} ${dim('·')} elapsed ${humanDuration(now() - startedAt)}${header ? ' ' + dim('·') + ' ' + header : ''}`;
    return [head, ...order.map((id) => stageLine(map.get(id)!))];
  }

  function clearLive(): string {
    return liveLines > 0 ? `\x1b[${liveLines}A\r\x1b[J` : '';
  }

  function render() {
    if (plain || closed) return;
    frame++;
    const cols = Math.max(20, (stream.columns || 120) - 1);
    const lines = frameLines().map((l) => (visibleWidth(l) > cols ? truncateAnsi(l, cols) : l));
    let out = liveLines > 0 ? `\x1b[${liveLines}A\r` : '\r';
    for (const l of lines) out += `\x1b[2K${l}\n`;
    out += '\x1b[J';
    write(out);
    liveLines = lines.length;
    dirty = false;
  }

  function plainTick() {
    for (const id of order) {
      const st = map.get(id)!;
      if (st.state !== 'running') continue;
      const parts: string[] = [];
      if (st.total !== undefined && st.total > 0) parts.push(`${Math.floor((100 * st.current) / st.total)}%`);
      if (st.current > 0 || st.total) parts.push(formatProgress(st.current, st.total, st.unit));
      const r = formatRate(rate(st), st.unit);
      if (r) parts.push(r);
      const e = eta(st);
      if (e) parts.push(e);
      if (st.status) parts.push(st.status);
      const line = parts.join(' · ');
      if (line && line !== st.plainLogged) {
        st.plainLogged = line;
        write(`[${ts()}] … ${st.label}: ${line}\n`);
      }
    }
  }

  let timer: NodeJS.Timeout | undefined;
  if (plain) {
    timer = setInterval(plainTick, opts.plainIntervalMs ?? 5000);
  } else {
    write('\x1b[?25l'); // hide cursor
    timer = setInterval(() => {
      const anyRunning = order.some((id) => map.get(id)!.state === 'running');
      if (dirty || anyRunning) render();
    }, Math.max(100, opts.intervalMs ?? 100));
  }
  timer.unref();

  const tui: Tui = {
    plain,
    stage: (id, label) => stage(id, label),
    log(message) {
      if (closed) {
        write(message + '\n');
        return;
      }
      if (plain) {
        write(`[${ts()}] ${message}\n`);
        return;
      }
      write(clearLive() + message + '\n');
      liveLines = 0;
      render();
    },
    close() {
      if (closed) return;
      if (!plain) render();
      closed = true;
      if (timer) clearInterval(timer);
      if (!plain) write('\x1b[?25h');
    },
    plan(stages) {
      for (const s of stages) if (!map.has(s.id)) create(s.id, s.label);
      dirty = true;
    },
    setHeader(text) {
      header = text;
      dirty = true;
    },
    scoped(parentId) {
      let first: string | undefined;
      return {
        stage(id, label) {
          if (first === undefined || first === id) {
            first = id;
            const parent = map.get(parentId);
            return stage(parentId, parent ? parent.label : label);
          }
          return stage(`${parentId}/${id}`, label, parentId);
        },
        log: (m) => tui.log(m),
        close() {},
      };
    },
    stages() {
      return order.map((id) => {
        const { samples: _s, plainLogged: _p, ...info } = map.get(id)!;
        return { ...info };
      });
    },
  };
  return tui;
}

/** Alias kept for readability at call sites. */
export const createProgress = createTui;
export { formatAmount };
