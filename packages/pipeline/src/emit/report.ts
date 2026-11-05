/** reports/summary.json + reports/summary.md */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ValidationReport } from '../stages/validate.ts';
import { humanBytes, humanDuration } from '../tui/format.ts';
import type { WebEmitResult, WebFileCategory } from './web.ts';

export interface StageTiming {
  id: string;
  label: string;
  state: string;
  durationMs?: number;
  summary?: string;
}

export interface WebSizes {
  files: number;
  totalBytes: number;
  phase1Bytes: number;
  manifestBytes: number;
  categories: Record<WebFileCategory, { files: number; bytes: number; rawBytes: number }>;
}

export interface SummaryReport {
  builtAt: string;
  durationMs: number;
  options: Record<string, string | number | boolean>;
  stages: StageTiming[];
  counts: Record<string, number>;
  ignored: { byReason: Record<string, number>; byResolution: Record<string, number> };
  created: Record<string, number>;
  merges: { groups: number; mergedAway: number; droppedStubs: number };
  sanitize: Record<string, number>;
  resolve: Record<string, number>;
  lcorp: { enabled: boolean; mode: string; enrich?: Record<string, number | boolean>; client?: Record<string, number | boolean> };
  paradigms: { bySource: Record<string, number>; byKind: Record<string, number>; without: number; inflectableWithout: number };
  validation: ValidationReport;
  artifacts: { web: WebSizes; machine: { path: string; bytes: number }[]; debugFiles: number };
  missingSamples: string[];
  top20: { id: number; head: string; pos: string; freqRank?: number; slug: string }[];
  plugins: string[];
}

export function webSizes(res: WebEmitResult): WebSizes {
  const cats: WebSizes['categories'] = {
    manifest: { files: 1, bytes: res.manifestBytes, rawBytes: res.manifestBytes },
    core: { files: 0, bytes: 0, rawBytes: 0 },
    summaries: { files: 0, bytes: 0, rawBytes: 0 },
    shards: { files: 0, bytes: 0, rawBytes: 0 },
    forms: { files: 0, bytes: 0, rawBytes: 0 },
    english: { files: 0, bytes: 0, rawBytes: 0 },
  };
  for (const f of res.files) {
    const c = cats[f.category];
    c.files++;
    c.bytes += f.bytes;
    c.rawBytes += f.rawBytes;
  }
  return {
    files: res.files.length + 1,
    totalBytes: res.manifest.totalBytes + res.manifestBytes,
    phase1Bytes: res.manifestBytes + res.manifest.files.core.bytes,
    manifestBytes: res.manifestBytes,
    categories: cats,
  };
}

function table(head: string[], rows: (string | number)[][]): string {
  const esc = (x: string | number) => String(x).replace(/\|/g, '\\|');
  return [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map(esc).join(' | ')} |`)].join('\n');
}

const n = (x: number | undefined) => (x === undefined ? '-' : x.toLocaleString('en-US'));

export function renderMarkdown(r: SummaryReport): string {
  const out: string[] = [];
  out.push(`# Pipeline summary`, '', `Built ${r.builtAt} in ${humanDuration(r.durationMs)}.`, '');
  out.push('Options: ' + Object.entries(r.options).map(([k, v]) => `\`${k}=${v}\``).join(', '), '');
  out.push('## Stages', '', table(['stage', 'status', 'duration', 'summary'], r.stages.map((s) => [s.label, s.state, s.durationMs !== undefined ? humanDuration(s.durationMs) : '-', s.summary ?? ''])), '');
  out.push('## Counts', '', table(['count', 'value'], Object.entries(r.counts).map(([k, v]) => [k, n(v)])), '');
  out.push(
    '## Ignored kaikki entries',
    '',
    table(['reason', 'count'], Object.entries(r.ignored.byReason).map(([k, v]) => [k, n(v)])),
    '',
    table(['resolution', 'count'], Object.entries(r.ignored.byResolution).map(([k, v]) => [k, n(v)])),
    '',
  );
  out.push('## Created entries (English translation tables)', '', table(['metric', 'value'], Object.entries(r.created).map(([k, v]) => [k, n(v)])), '');
  out.push('## Merges', '', `${n(r.merges.groups)} merge groups; ${n(r.merges.mergedAway)} entries merged into others; ${n(r.merges.droppedStubs)} gloss-less stubs dropped (see debug/merges.jsonl).`, '');
  out.push('## Sanitize (source word clean-up)', '', table(['metric', 'value'], Object.entries(r.sanitize).map(([k, v]) => [k, n(v)])), '');
  out.push('## Resolve', '', table(['metric', 'value'], Object.entries(r.resolve).map(([k, v]) => [k, n(v)])), '');
  out.push('## lcorp', '', `Enabled: ${r.lcorp.enabled} (mode: ${r.lcorp.mode}).`, '');
  if (r.lcorp.enrich) out.push(table(['enrichment', 'value'], Object.entries(r.lcorp.enrich).map(([k, v]) => [k, typeof v === 'number' ? n(v) : String(v)])), '');
  if (r.lcorp.client) out.push(table(['client', 'value'], Object.entries(r.lcorp.client).map(([k, v]) => [k, typeof v === 'number' ? n(v) : String(v)])), '');
  out.push(
    '## Paradigms',
    '',
    table(['source', 'entries'], Object.entries(r.paradigms.bySource).map(([k, v]) => [k, n(v)])),
    '',
    table(['kind', 'entries'], Object.entries(r.paradigms.byKind).map(([k, v]) => [k, n(v)])),
    '',
    `Entries without paradigm: ${n(r.paradigms.without)} (inflectable POS without paradigm: ${n(r.paradigms.inflectableWithout)}).`,
    '',
  );
  out.push(
    '## Validation',
    '',
    r.validation.ok ? '**All checks passed.**' : `**${n(r.validation.totalViolations)} violations.**`,
    '',
    table(['check', 'violations', 'examples'], r.validation.checks.map((c) => [`${c.name} — ${c.description}`, n(c.violations), c.examples.slice(0, 3).join('; ')])),
    '',
  );
  const w = r.artifacts.web;
  out.push(
    '## Artifact sizes',
    '',
    `Web: **${humanBytes(w.totalBytes)}** in ${n(w.files)} files; phase-1 payload (manifest + core): **${humanBytes(w.phase1Bytes)}**.`,
    '',
    table(
      ['web category', 'files', 'gzip bytes', 'raw JSON bytes'],
      Object.entries(w.categories).map(([k, c]) => [k, n(c.files), humanBytes(c.bytes), humanBytes(c.rawBytes)]),
    ),
    '',
    table(['machine file', 'bytes'], r.artifacts.machine.map((f) => [f.path, humanBytes(f.bytes)])),
    '',
    `Debug files: ${r.artifacts.debugFiles}. Samples without entries: ${r.missingSamples.length ? r.missingSamples.join(', ') : 'none'}.`,
    '',
  );
  out.push('## Top 20 entries', '', table(['id', 'head', 'pos', 'freqRank', 'slug'], r.top20.map((e) => [e.id, e.head, e.pos, e.freqRank ?? '-', e.slug])), '');
  out.push(`Plugins: ${r.plugins.length ? r.plugins.join(', ') : 'none'}.`, '');
  return out.join('\n');
}

export async function emitReport(r: SummaryReport, opts: { outDir: string }): Promise<void> {
  await mkdir(opts.outDir, { recursive: true });
  await writeFile(join(opts.outDir, 'summary.json'), JSON.stringify(r, null, 2) + '\n');
  await writeFile(join(opts.outDir, 'summary.md'), renderMarkdown(r));
}
