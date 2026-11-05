/**
 * Pipeline entry point: `pnpm pipeline [flags]` (= `node src/cli.ts`). See packages/pipeline/README.md.
 */
import './emit/threadpool.ts';
import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { BUILTIN_ATTRIBUTIONS, searchKey } from '@ukdict/shared';
import type { Attribution, Entry, SourceId } from '@ukdict/shared';
import type {
  DraftEntry,
  EnIngestResult,
  FrequencyIndex,
  KnownAspectPair,
  LcorpClient,
  LcorpOptions,
  PipelineConfig,
  PipelinePlugin,
  Progress,
  StageHandle,
  UkIngestResult,
} from './contracts.ts';
import { resolveConfig } from './config.ts';
import type { CliOverrides } from './config.ts';
import { createTui } from './tui/index.ts';
import type { Tui } from './tui/index.ts';
import { humanBytes, humanDuration } from './tui/format.ts';
import { buildCreatedEntries } from './stages/created.ts';
import type { CreatedStats } from './stages/created.ts';
import { mergeEntries } from './stages/merge.ts';
import { sanitizeDrafts } from './stages/sanitize.ts';
import type { SanitizeStats } from './stages/sanitize.ts';
import type { MergeLog } from './stages/merge.ts';
import { enrichWithLcorp } from './stages/lcorp-enrich.ts';
import type { LcorpEnrichStats, LcorpRecord } from './stages/lcorp-enrich.ts';
import { resolveEntries } from './stages/resolve.ts';
import { rankEntries } from './stages/rank.ts';
import { validateEntries } from './stages/validate.ts';
import { INFLECTABLE } from './stages/common.ts';
import { plugins as defaultPlugins, runPlugins } from './plugins/index.ts';
import { emitWebArtifactsDetailed } from './emit/web.ts';
import { emitMachineArtifacts } from './emit/machine.ts';
import { DEFAULT_SAMPLES, emitDebugArtifacts } from './emit/debug.ts';
import { emitReport, webSizes } from './emit/report.ts';
import type { SummaryReport } from './emit/report.ts';
import { syncDir } from './emit/sync.ts';
import type { DownloadOptions, DownloadResult } from './sources/download.ts';

// ───────────────────────────── dependencies (sources) ─────────────────────────────

export interface PipelineDeps {
  loadFrequency(file: string): Promise<FrequencyIndex>;
  loadKnownAspectPairs(file: string): Promise<KnownAspectPair[]>;
  ingestKaikkiUk(file: string, opts: { workers: number; progress: Progress }): Promise<UkIngestResult>;
  ingestKaikkiEn(file: string, opts: { workers: number; progress: Progress; cacheDir: string }): Promise<EnIngestResult>;
  createLcorpClient(opts: LcorpOptions): LcorpClient;
  posCompatible?: (a: Entry['pos'], b: Entry['pos']) => boolean;
  /**
   * The lcorp module's candidate rules applied to the raw kaikki records (one streaming pass): accepted source
   * lines and `${word}\0${pos}` keys. Used so the pipeline's lookups match the pre-warmed lcorp cache.
   */
  scanLcorpKaikkiCandidates?: (kaikkiFile: string, onProgress: (bytes: number) => void) => Promise<{ lines: Set<number>; keys: Set<string> }>;
  /** Fetches a missing kaikki dump. Without it the download stage is skipped (tests with fake sources). */
  downloadFile?: (url: string, dest: string, opts: DownloadOptions) => Promise<DownloadResult>;
}

export async function loadDefaultDeps(): Promise<PipelineDeps> {
  const [uk, en, freq, pairs, lcorp, pos, download] = await Promise.all([
    import('./sources/kaikki-uk/index.ts'),
    import('./sources/kaikki-en/index.ts'),
    import('./sources/frequency.ts'),
    import('./sources/aspect-pairs.ts'),
    import('./sources/lcorp/client.ts'),
    import('./util/pos.ts'),
    import('./sources/download.ts'),
  ]);
  const cand = await import('./sources/lcorp/candidates.ts');
  const posCompatible = pos.posCompatible;
  return {
    loadFrequency: freq.loadFrequency,
    loadKnownAspectPairs: pairs.loadKnownAspectPairs,
    ingestKaikkiUk: uk.ingestKaikkiUk,
    ingestKaikkiEn: en.ingestKaikkiEn,
    createLcorpClient: lcorp.createLcorpClient,
    posCompatible,
    downloadFile: download.downloadFile,
    scanLcorpKaikkiCandidates: async (kaikkiFile, onProgress) => {
      const r = await cand.scanLcorpCandidates({ kaikkiFile, onProgress: (bytes) => onProgress(bytes) });
      return { lines: new Set(r.candidates.map((c) => c.line)), keys: new Set(r.candidates.map((c) => `${c.word}\u0000${c.pos}`)) };
    },
  };
}

// ───────────────────────────── options ─────────────────────────────

export interface RunOptions {
  samples?: string[];
  plugins?: PipelinePlugin[];
  signal?: AbortSignal;
  /** Called with the lcorp client as soon as it exists (so a SIGINT handler can close it). */
  onLcorpClient?: (c: LcorpClient | undefined) => void;
}

export const STAGES: { id: string; label: string }[] = [
  { id: 'download', label: 'Download kaikki dumps' },
  { id: 'load', label: 'Frequency list + aspect pairs' },
  { id: 'kaikki-uk', label: 'kaikki Ukrainian' },
  { id: 'kaikki-en', label: 'kaikki English translations' },
  { id: 'created', label: 'Created entries' },
  { id: 'merge', label: 'Merge identical entries' },
  { id: 'lcorp', label: 'lcorp enrichment' },
  { id: 'resolve', label: 'Resolve forms/links/aspect' },
  { id: 'rank', label: 'Rank + ids + slugs' },
  { id: 'plugins', label: 'Plugins' },
  { id: 'validate', label: 'Validate' },
  { id: 'emit-web', label: 'Emit web artifacts' },
  { id: 'emit-machine', label: 'Emit machine artifacts' },
  { id: 'emit-debug', label: 'Emit debug artifacts' },
  { id: 'report', label: 'Report' },
  { id: 'sync', label: 'Sync → web/public/data' },
];

const n = (x: number) => x.toLocaleString('en-US');

function countBy<T>(items: readonly T[], f: (x: T) => string | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items) {
    const k = f(it);
    if (k !== undefined) out[k] = (out[k] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
}

async function fileInfo(path: string): Promise<{ bytes: number; mtime: string } | undefined> {
  try {
    const s = await stat(path);
    return { bytes: s.size, mtime: s.mtime.toISOString() };
  } catch {
    return undefined;
  }
}

export class StageError extends Error {
  stage: string;
  constructor(stage: string, cause: unknown) {
    super(`stage "${stage}" failed: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.stage = stage;
  }
}

// ───────────────────────────── source download ─────────────────────────────

/**
 * Downloads the kaikki dumps the build needs but that are missing on disk, in parallel, as child lines of the
 * "download" stage (one bar per file, the parent shows the combined bytes). Existing dumps are never re-fetched;
 * delete a dump to refresh it. Interrupted downloads resume on the next run (see sources/download.ts).
 */
export async function ensureSources(cfg: PipelineConfig, tui: Tui, deps: PipelineDeps, signal?: AbortSignal): Promise<void> {
  const label = STAGES.find((s) => s.id === 'download')!.label;
  const wanted = [
    { id: 'uk', name: 'Ukrainian dump', url: cfg.kaikkiUkUrl, file: cfg.kaikkiUkFile },
    ...(cfg.createFromTranslations ? [{ id: 'en', name: 'English dump', url: cfg.kaikkiEnUrl, file: cfg.kaikkiEnFile }] : []),
  ];
  const missing = wanted.filter((w) => !existsSync(w.file));
  const h = tui.stage('download', label);
  if (!missing.length) return h.done('all dumps present');
  const rel = (f: string) => relative(cfg.rootDir, f);
  if (!deps.downloadFile) return h.done(`skipped (no downloader; missing ${missing.map((m) => rel(m.file)).join(', ')})`);
  try {
    if (!cfg.download) {
      throw new Error(
        `missing ${missing.map((m) => rel(m.file)).join(', ')} — run without --no-download, \`pnpm download\`, or fetch ${missing.map((m) => m.url).join(' and ')}`,
      );
    }
    const download = deps.downloadFile;
    const scope = tui.scoped('download');
    scope.stage('download', label); // binds the scope's first stage to the parent line; the next ones become children
    const totals = new Map<string, number>();
    const received = new Map<string, number>();
    const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
    h.setTotal(0, 'bytes');
    h.status(`${missing.length} in parallel`);
    const results = await Promise.allSettled(
      missing.map(async (m) => {
        const c = scope.stage(m.id, m.name);
        c.setTotal(0, 'bytes');
        try {
          const r = await download(m.url, m.file, {
            signal,
            onProgress(got, total) {
              if (total !== undefined && !totals.has(m.id)) {
                totals.set(m.id, total);
                c.setTotal(total, 'bytes');
                if (totals.size === missing.length) h.setTotal(sum(totals), 'bytes');
              }
              c.set(got);
              received.set(m.id, got);
              h.set(sum(received));
            },
          });
          c.done(`${humanBytes(r.bytes)} → ${rel(m.file)}${r.resumedFrom ? ` (resumed at ${humanBytes(r.resumedFrom)})` : ''}`);
          return r;
        } catch (e) {
          c.fail(e);
          throw e;
        }
      }),
    );
    const failed = results.flatMap((r, i) => (r.status === 'rejected' ? [`${missing[i].name}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`] : []));
    if (failed.length) throw new Error(`${failed.join('; ')} (partial downloads are kept; re-run to resume)`);
    h.done(`${missing.map((m) => m.name).join(' + ')} · ${humanBytes(sum(received))}`);
  } catch (e) {
    h.fail(e);
    throw e instanceof StageError ? e : new StageError('download', e);
  }
}

// ───────────────────────────── pipeline ─────────────────────────────

export async function runPipeline(cfg: PipelineConfig, tui: Tui, deps: PipelineDeps, opts: RunOptions = {}): Promise<SummaryReport> {
  const t0 = Date.now();
  tui.plan(STAGES);
  const label = (id: string) => STAGES.find((s) => s.id === id)?.label ?? id;
  const checkAbort = () => {
    if (opts.signal?.aborted) throw new Error('interrupted');
  };
  async function step<T>(id: string, fn: (h: StageHandle) => Promise<T> | T, summary?: (r: T) => string): Promise<T> {
    checkAbort();
    const h = tui.stage(id, label(id));
    try {
      const r = await fn(h);
      h.done(summary?.(r));
      return r;
    } catch (e) {
      h.fail(e);
      throw e instanceof StageError ? e : new StageError(id, e);
    }
  }
  const skip = (id: string, why: string) => tui.stage(id, label(id)).done(why);

  const wUk = cfg.createFromTranslations ? Math.max(1, Math.round(cfg.workers * 0.4)) : cfg.workers;
  const wEn = Math.max(1, cfg.workers - wUk);
  const lcorpMode = !cfg.lcorp.enabled ? 'disabled' : cfg.lcorp.offline ? 'offline (cache only)' : `budget ${cfg.lcorp.budget}, ${cfg.lcorp.ratePerSec} req/s`;
  tui.setHeader(`${cfg.workers} workers · lcorp ${lcorpMode}`);

  // 0. missing kaikki dumps
  checkAbort();
  await ensureSources(cfg, tui, deps, opts.signal);

  // 1. frequency + aspect pairs
  const { frequency, pairs } = await step(
    'load',
    async (h) => {
      h.status('reading CSV + JSON');
      const [frequency, pairs] = await Promise.all([deps.loadFrequency(cfg.frequencyFile), deps.loadKnownAspectPairs(cfg.aspectPairsFile)]);
      return { frequency, pairs };
    },
    (r) => `${n(r.frequency.size)} frequency rows · ${r.pairs.length} known aspect pairs`,
  );

  // 2. kaikki-uk ∥ kaikki-en
  const [uk, en] = await Promise.all([
    step(
      'kaikki-uk',
      (h) => {
        h.status(`${wUk} workers`);
        return deps.ingestKaikkiUk(cfg.kaikkiUkFile, { workers: wUk, progress: tui.scoped('kaikki-uk') });
      },
      (r) => `${n(r.stats.lines)} lines → ${n(r.entries.length)} entries, ${n(r.ignored.length)} ignored, ${n(r.stats.withParadigm)} with tables (${wUk} workers)`,
    ),
    cfg.createFromTranslations
      ? step(
          'kaikki-en',
          (h) => {
            h.status(`${wEn} workers`);
            return deps.ingestKaikkiEn(cfg.kaikkiEnFile, { workers: wEn, progress: tui.scoped('kaikki-en'), cacheDir: cfg.cacheDir });
          },
          (r) => `${n(r.translations.length)} uk translations from ${n(r.stats.matchedLines)} entries${r.stats.fromCache ? ' (cached)' : ` (${wEn} workers)`}`,
        )
      : Promise.resolve(undefined).then(() => {
          skip('kaikki-en', 'skipped (--no-created)');
          return undefined;
        }),
  ]);

  // 3. created entries
  let createdStats: CreatedStats | undefined;
  let drafts: DraftEntry[] = [...uk.entries];
  if (en) {
    const created = await step(
      'created',
      () => {
        const headwordKeys = new Set(uk.entries.map((e) => e.key));
        const ignoredFormKeys = new Set(uk.ignored.filter((i) => i.reason === 'inflected-form-only').map((i) => searchKey(i.word)));
        return buildCreatedEntries(en.translations, { headwordKeys, ignoredFormKeys });
      },
      (r) => `${n(r.entries.length)} created (${n(r.stats.multiword)} multi-word) from ${n(r.stats.translations)} translations`,
    );
    createdStats = created.stats;
    drafts = drafts.concat(created.entries);
  } else skip('created', 'skipped (--no-created)');

  // 4. merge
  let sanitizeStats: SanitizeStats | undefined;
  const merged = await step(
    'merge',
    (h) => {
      h.setTotal(drafts.length, 'items');
      h.status('sanitizing words');
      sanitizeStats = sanitizeDrafts(drafts);
      h.status('merging');
      return mergeEntries(drafts);
    },
    (r) => `${n(drafts.length - r.entries.length)} entries merged in ${n(r.merges.length)} groups (${n(r.droppedStubs)} gloss-less stubs dropped) → ${n(r.entries.length)}`,
  );
  const merges: MergeLog[] = merged.merges;
  drafts = merged.entries;

  // 5. lcorp
  let lcorpStats: LcorpEnrichStats | undefined;
  let lcorpRecords: LcorpRecord[] = [];
  let lcorpClientStats: Record<string, number | boolean> | undefined;
  if (cfg.lcorp.enabled) {
    await step(
      'lcorp',
      async (h) => {
        const client = deps.createLcorpClient({
          cacheDir: cfg.cacheDir,
          ratePerSec: cfg.lcorp.ratePerSec,
          concurrency: cfg.lcorp.concurrency,
          budget: cfg.lcorp.budget,
          offline: cfg.lcorp.offline,
          // The enrichment stage counts items itself; the client only contributes its status text.
          progress: { ...h, tick() {} },
        });
        opts.onLcorpClient?.(client);
        try {
          let kaikkiFilter: ((e: DraftEntry) => boolean) | undefined;
          if (deps.scanLcorpKaikkiCandidates) {
            h.status('applying lcorp candidate rules to kaikki records');
            const ukSize = (await fileInfo(cfg.kaikkiUkFile))?.bytes ?? 0;
            h.setTotal(ukSize, 'bytes');
            const acc = await deps.scanLcorpKaikkiCandidates(cfg.kaikkiUkFile, (b) => h.set(b));
            kaikkiFilter = (e) => (e.origin.line !== undefined && acc.lines.has(e.origin.line)) || acc.keys.has(`${e.word}\u0000${e.pos}`);
            h.set(0);
          }
          const r = await enrichWithLcorp(drafts, client, {
            frequency,
            kaikkiFilter,
            progress: h,
            parallel: cfg.lcorp.offline ? 8 : Math.max(2, cfg.lcorp.concurrency * 2),
            signal: opts.signal,
          });
          lcorpStats = r.stats;
          lcorpRecords = r.records;
          lcorpClientStats = { ...client.stats() };
        } finally {
          await client.close();
          opts.onLcorpClient?.(undefined);
        }
        checkAbort();
      },
      () =>
        `${n(lcorpStats!.candidatesKaikki)}+${n(lcorpStats!.candidatesCreated)} candidates (kaikki+created) · ${n(lcorpStats!.found)} found · +${n(lcorpStats!.paradigmsAdded)} paradigms · net ${n(Number(lcorpClientStats?.network ?? 0))} · cache ${n(Number(lcorpClientStats?.cacheHits ?? 0))} · skipped ${n(lcorpStats!.skipped)}`,
    );
  } else skip('lcorp', 'disabled (--no-lcorp)');

  // 6. resolve
  const resolveStats = await step(
    'resolve',
    () => resolveEntries(drafts, uk.ignored, pairs, { posCompatible: deps.posCompatible }),
    (r) => `${n(r.extraFormsAdded)} extra forms · ${n(r.lemmaMissing)} lemma-missing · ${n(r.knownPairsApplied + r.symmetricPartnersAdded)} aspect partners added`,
  );

  // 7. rank
  const ranked = await step(
    'rank',
    () => rankEntries(drafts, frequency),
    (r) => `${n(r.entries.length)} entries · ${n(r.stats.ranked)} ranked · ${n(r.stats.unrankedKaikki)} unranked kaikki · ${n(r.stats.unrankedCreated)} unranked created`,
  );
  const entries = ranked.entries;

  // 8. plugins
  const pluginList = opts.plugins ?? defaultPlugins;
  const pluginRes = await step(
    'plugins',
    () => runPlugins(pluginList, { config: cfg, entries, progress: tui, log: (m) => tui.log(m) }),
    (r) => (r.ran.length ? r.ran.join(', ') : 'none'),
  );

  // 9. validate
  const validation = await step(
    'validate',
    () => validateEntries(entries),
    (v) => (v.ok ? 'all checks passed' : `${n(v.totalViolations)} violations (${v.checks.filter((c) => c.violations).map((c) => c.name).join(', ')})`),
  );

  // attributions: built-ins actually used + plugin attributions
  const used = new Set<SourceId>(['wiktionary', 'kaikki', 'frequency']);
  for (const e of entries) {
    for (const s of e.sources) used.add(s.source);
    if (e.paradigm) used.add(e.paradigm.source);
    for (const p of e.aspectPartners ?? []) used.add(p.source);
  }
  const attributions: Attribution[] = [...BUILTIN_ATTRIBUTIONS.filter((a) => used.has(a.id)), ...pluginRes.attributions];

  const [ukInfo, enInfo, freqInfo] = await Promise.all([fileInfo(cfg.kaikkiUkFile), fileInfo(cfg.kaikkiEnFile), fileInfo(cfg.frequencyFile)]);
  const provenance: Record<string, string | number> = {
    pipeline: '@ukdict/pipeline 0.1.0',
    kaikkiUkFile: 'kaikki.org-dictionary-Ukrainian.jsonl',
    kaikkiUkBytes: ukInfo?.bytes ?? 0,
    kaikkiUkModified: ukInfo?.mtime ?? '',
    kaikkiEnFile: 'kaikki.org-dictionary-English.jsonl',
    kaikkiEnBytes: enInfo?.bytes ?? 0,
    kaikkiEnModified: enInfo?.mtime ?? '',
    frequencyFile: 'publicist_84k_lex_dict_orig.csv',
    frequencyRows: frequency.size,
    frequencyModified: freqInfo?.mtime ?? '',
    kaikkiUkEntries: uk.stats.entries,
    ignoredEntries: uk.ignored.length,
    createdEntries: entries.filter((e) => e.created).length,
    mergedEntries: merges.reduce((s, m) => s + m.merged.length, 0),
    lcorpMode,
    lcorpLookups: lcorpStats?.lookedUp ?? 0,
    lcorpFound: lcorpStats?.found ?? 0,
    lcorpParadigms: lcorpStats?.paradigmsAdded ?? 0,
  };

  // 10. emit (parallel)
  const webDir = join(cfg.outDir, 'web');
  const [web, machine, debug] = await Promise.all([
    step(
      'emit-web',
      (h) =>
        emitWebArtifactsDetailed(entries, {
          outDir: webDir,
          shardSize: cfg.shardSize,
          attributions,
          provenance,
          ignoredCount: uk.ignored.length,
          progress: h,
        }),
      (r) => `${n(r.files.length + 1)} files · ${humanBytes(r.manifest.totalBytes + r.manifestBytes)} · phase-1 ${humanBytes(r.manifestBytes + r.manifest.files.core.bytes)}`,
    ),
    step(
      'emit-machine',
      () => emitMachineArtifacts(entries, uk.ignored, { outDir: join(cfg.outDir, 'machine') }),
      (r) => r.files.map((f) => `${f.path} ${humanBytes(f.bytes)}`).slice(0, 3).join(' · '),
    ),
    step(
      'emit-debug',
      () =>
        emitDebugArtifacts(
          {
            entries,
            ignored: uk.ignored,
            merges,
            lcorp: lcorpRecords,
            unmappedForms: uk.unmappedForms,
            samples: [...DEFAULT_SAMPLES, ...(opts.samples ?? [])],
          },
          { outDir: join(cfg.outDir, 'debug') },
        ),
      (r) => `${r.files} files${r.missingSamples.length ? ` · samples without entries: ${r.missingSamples.join(', ')}` : ''}`,
    ),
  ]);

  // 11. report
  const paradigmBySource = countBy(entries, (e) => (e.paradigm ? String(e.paradigm.source) : undefined));
  const paradigmByKind = countBy(entries, (e) => e.paradigm?.kind);
  const report: SummaryReport = {
    builtAt: web.manifest.builtAt,
    durationMs: Date.now() - t0,
    options: {
      workers: cfg.workers,
      workersUk: wUk,
      workersEn: cfg.createFromTranslations ? wEn : 0,
      shardSize: cfg.shardSize,
      created: cfg.createFromTranslations,
      lcorp: lcorpMode,
      outDir: cfg.outDir,
    },
    stages: [],
    counts: {
      kaikkiUkLines: uk.stats.lines,
      kaikkiUkEntries: uk.entries.length,
      kaikkiUkIgnored: uk.ignored.length,
      kaikkiUkWithParadigm: uk.stats.withParadigm,
      englishLinesMatched: en?.stats.matchedLines ?? 0,
      englishTranslations: en?.translations.length ?? 0,
      createdEntries: createdStats?.created ?? 0,
      draftsBeforeMerge: uk.entries.length + (createdStats?.created ?? 0),
      mergedAway: merges.reduce((s, m) => s + m.merged.length, 0),
      entries: entries.length,
      createdEntriesFinal: entries.filter((e) => e.created).length,
      rankedEntries: ranked.stats.ranked,
      unrankedKaikki: ranked.stats.unrankedKaikki,
      unrankedCreated: ranked.stats.unrankedCreated,
      homonymSlugs: ranked.stats.homonymSlugs,
      withParadigm: entries.filter((e) => e.paradigm).length,
      withExtraForms: entries.filter((e) => e.extraForms?.length).length,
      withAudio: entries.filter((e) => e.pronunciation?.audio?.length).length,
      withIpa: entries.filter((e) => e.pronunciation?.ipa?.length).length,
      withAspectPartners: entries.filter((e) => e.aspectPartners?.length).length,
      withRelations: entries.filter((e) => e.relations).length,
      headwordKeys: web.manifest.counts.headwordKeys,
      formKeys: web.manifest.counts.formKeys,
      englishTokens: web.manifest.counts.englishTokens,
    },
    ignored: {
      byReason: countBy(uk.ignored, (i) => i.reason),
      byResolution: countBy(uk.ignored, (i) => i.resolution ?? 'unresolved'),
    },
    created: { ...(createdStats ?? {}) } as Record<string, number>,
    merges: { groups: merges.length, mergedAway: merges.reduce((s, m) => s + m.merged.length, 0), droppedStubs: merged.droppedStubs },
    sanitize: { ...(sanitizeStats ?? {}) } as Record<string, number>,
    resolve: { ...resolveStats },
    lcorp: {
      enabled: cfg.lcorp.enabled,
      mode: lcorpMode,
      ...(lcorpStats ? { enrich: { ...lcorpStats } } : {}),
      ...(lcorpClientStats ? { client: lcorpClientStats } : {}),
    },
    paradigms: {
      bySource: paradigmBySource,
      byKind: paradigmByKind,
      without: entries.filter((e) => !e.paradigm).length,
      inflectableWithout: entries.filter((e) => !e.paradigm && INFLECTABLE.has(e.pos)).length,
    },
    validation,
    artifacts: { web: webSizes(web), machine: machine.files, debugFiles: debug.files },
    missingSamples: debug.missingSamples,
    top20: entries.slice(0, 20).map((e) => ({ id: e.id, head: e.heads[0] ?? e.word, pos: e.pos, freqRank: e.freqRank, slug: e.slug })),
    plugins: pluginRes.ran,
  };
  await step(
    'report',
    async () => {
      // The report and the sync after it are still running/pending at this point; leave them out of the report.
      report.stages = tui
        .stages()
        .filter((s) => s.id !== 'report' && s.id !== 'sync')
        .map((s) => ({ id: s.id, label: s.label, state: s.state, durationMs: s.durationMs, summary: s.summary }));
      report.durationMs = Date.now() - t0;
      await emitReport(report, { outDir: join(cfg.outDir, 'reports') });
    },
    () => 'reports/summary.{json,md}',
  );

  // 12. sync
  if (cfg.webPublicDataDir) {
    await step(
      'sync',
      () => syncDir(webDir, cfg.webPublicDataDir!),
      (r) => `${r.copied} copied (${humanBytes(r.bytesCopied)}), ${r.unchanged} unchanged, ${r.deleted} deleted`,
    );
  } else skip('sync', 'skipped (--no-sync)');
  return report;
}

// ───────────────────────────── CLI ─────────────────────────────

export const HELP = `Usage: pnpm pipeline [options]   (node packages/pipeline/src/cli.ts)

Builds the Ukrainian–English dictionary artifacts from kaikki.org dumps, the frequency list and lcorp.

Options:
  --workers N             worker threads for JSONL parsing (default: CPUs - 1; split 40% uk / 60% en)
  --out DIR               output root (default: <repo>/artifacts) → web/ machine/ debug/ reports/
  --no-sync               do not mirror artifacts/web → packages/web/public/data
  --no-lcorp              skip lcorp enrichment entirely
  --lcorp-offline         lcorp from cache only (no network)
  --lcorp-budget N        max lcorp network lookups this run (default 3000; cache hits are free)
  --lcorp-rate R          max lcorp requests per second (default 1)
  --lcorp-concurrency N   parallel lcorp sessions (default 1)
  --no-created            do not create entries from English translation tables (skips the English pass)
  --download-only         only download missing kaikki dumps (both in parallel, resumable) and exit
  --no-download           fail instead of downloading missing kaikki dumps
  --shard-size N          entries per web shard file (default 200)
  --samples a,b,c         extra words for debug/samples/
  -h, --help              show this help
`;

function intArg(name: string, v: string | undefined, min: number): number | undefined {
  if (v === undefined) return undefined;
  const x = Number(v);
  if (!Number.isFinite(x) || x < min) throw new Error(`--${name} expects a number ≥ ${min}, got "${v}"`);
  return x;
}

export function parseCli(argv: string[]): { overrides: CliOverrides; samples: string[]; help: boolean; downloadOnly: boolean } {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: false,
    options: {
      workers: { type: 'string' },
      out: { type: 'string' },
      'no-sync': { type: 'boolean' },
      'no-lcorp': { type: 'boolean' },
      'lcorp-offline': { type: 'boolean' },
      'lcorp-budget': { type: 'string' },
      'lcorp-rate': { type: 'string' },
      'lcorp-concurrency': { type: 'string' },
      'no-created': { type: 'boolean' },
      'shard-size': { type: 'string' },
      samples: { type: 'string' },
      'download-only': { type: 'boolean' },
      'no-download': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const overrides: CliOverrides = {
    workers: intArg('workers', values.workers, 1),
    outDir: values.out,
    sync: !values['no-sync'],
    lcorp: !values['no-lcorp'],
    lcorpOffline: !!values['lcorp-offline'],
    lcorpBudget: intArg('lcorp-budget', values['lcorp-budget'], 0),
    lcorpRate: intArg('lcorp-rate', values['lcorp-rate'], 0.01),
    lcorpConcurrency: intArg('lcorp-concurrency', values['lcorp-concurrency'], 1),
    created: !values['no-created'],
    shardSize: intArg('shard-size', values['shard-size'], 1),
    download: !values['no-download'],
  };
  if (values['download-only'] && values['no-download']) throw new Error('--download-only and --no-download are mutually exclusive');
  const samples = (values.samples ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return { overrides, samples, help: !!values.help, downloadOnly: !!values['download-only'] };
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  let parsed: ReturnType<typeof parseCli>;
  try {
    parsed = parseCli(argv);
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n\n${HELP}`);
    return 2;
  }
  if (parsed.help) {
    process.stdout.write(HELP);
    return 0;
  }
  const cfg = resolveConfig(parsed.overrides);
  const tui = createTui();
  const abort = new AbortController();
  let lcorpClient: LcorpClient | undefined;
  let interrupted = false;
  const onSigint = () => {
    if (interrupted) {
      tui.close();
      process.stderr.write('\nForced exit.\n');
      process.exit(130);
    }
    interrupted = true;
    abort.abort();
    tui.log('Interrupted (Ctrl-C) — closing lcorp client and exiting (partial downloads resume next run)… (press again to force)');
    const c = lcorpClient;
    void (c ? c.close().catch(() => {}) : Promise.resolve()).finally(() => {
      tui.close();
      process.stderr.write('Pipeline interrupted.\n');
      process.exit(130);
    });
  };
  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigint);
  const restore = () => tui.close();
  process.on('exit', restore);

  const t0 = Date.now();
  try {
    const deps = await loadDefaultDeps();
    if (parsed.downloadOnly) {
      tui.plan(STAGES.filter((s) => s.id === 'download'));
      await ensureSources(cfg, tui, deps, abort.signal);
      tui.close();
      process.stdout.write(`\nkaikki dumps ready in ${humanDuration(Date.now() - t0)}: ${relative(cfg.rootDir, cfg.kaikkiUkFile)}${cfg.createFromTranslations ? `, ${relative(cfg.rootDir, cfg.kaikkiEnFile)}` : ''}\n`);
      return 0;
    }
    const report = await runPipeline(cfg, tui, deps, {
      samples: parsed.samples,
      signal: abort.signal,
      onLcorpClient: (c) => (lcorpClient = c),
    });
    tui.close();
    const w = report.artifacts.web;
    process.stdout.write(
      `\nDone in ${humanDuration(Date.now() - t0)}: ${n(report.counts.entries)} entries (${n(report.counts.createdEntriesFinal)} created), ` +
        `${n(report.counts.kaikkiUkIgnored)} ignored, web ${humanBytes(w.totalBytes)} in ${n(w.files)} files (phase-1 ${humanBytes(w.phase1Bytes)}). ` +
        `Validation: ${report.validation.ok ? 'OK' : `${n(report.validation.totalViolations)} violations`}.\n` +
        `Artifacts: ${cfg.outDir}  ·  report: ${join(cfg.outDir, 'reports/summary.md')}\n`,
    );
    return 0;
  } catch (e) {
    if (interrupted) return 130;
    tui.close();
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`\nPipeline failed: ${msg}\n`);
    const cause = e instanceof Error ? (e.cause ?? e) : e;
    if (cause instanceof Error && cause.stack) process.stderr.write(`${cause.stack}\n`);
    return 1;
  } finally {
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigint);
  }
}

if ((import.meta as { main?: boolean }).main) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      process.stderr.write(`Pipeline crashed: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
      process.exit(1);
    },
  );
}
