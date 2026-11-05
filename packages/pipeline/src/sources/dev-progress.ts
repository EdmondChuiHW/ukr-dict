/** Minimal console `Progress` for the dev scripts of the sources (the real TUI lives in src/tui). */
import type { Progress, ProgressUnit, StageHandle } from '../contracts.ts';

function fmt(n: number, unit: ProgressUnit | undefined): string {
  if (unit === 'bytes') return n >= 1 << 30 ? `${(n / (1 << 30)).toFixed(2)} GiB` : `${(n / (1 << 20)).toFixed(1)} MiB`;
  return String(n);
}

export function consoleProgress(): Progress {
  const isTty = process.stderr.isTTY;
  return {
    stage(id: string, label: string): StageHandle {
      let total = 0;
      let unit: ProgressUnit | undefined;
      let current = 0;
      let status = '';
      let lastDraw = 0;
      const t0 = performance.now();
      const draw = (force = false) => {
        const now = performance.now();
        if (!force && now - lastDraw < 200) return;
        lastDraw = now;
        const pct = total ? ` ${((100 * current) / total).toFixed(0)}%` : '';
        const line = `[${id}] ${label}: ${fmt(current, unit)}${total ? ' / ' + fmt(total, unit) : ''}${pct} ${status} (${((now - t0) / 1000).toFixed(1)}s)`;
        if (isTty) process.stderr.write(`\r\x1b[K${line}`);
      };
      return {
        setTotal(t, u) {
          total = t;
          unit = u;
          draw();
        },
        set(c) {
          current = c;
          draw();
        },
        tick(d = 1) {
          current += d;
          draw();
        },
        status(text) {
          status = text;
          draw();
        },
        done(summary) {
          draw(true);
          if (isTty) process.stderr.write('\n');
          process.stderr.write(`[${id}] done in ${((performance.now() - t0) / 1000).toFixed(2)}s${summary ? ': ' + summary : ''}\n`);
        },
        fail(error) {
          if (isTty) process.stderr.write('\n');
          process.stderr.write(`[${id}] FAILED: ${String((error as Error)?.stack ?? error)}\n`);
        },
      };
    },
    log(message) {
      process.stderr.write(`${message}\n`);
    },
    close() {},
  };
}
