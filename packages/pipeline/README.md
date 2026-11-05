# @ukdict/pipeline

Builds the offline Ukrainian–English dictionary from kaikki.org (Wiktionary) dumps, the publicistic
frequency list, a curated aspect-pair list and (optionally) lcorp inflection tables. TypeScript run directly
by Node (native type stripping), `worker_threads` for the JSONL passes, no runtime dependencies besides
`@ukdict/shared`.

## Running

```sh
pnpm install
pnpm download                       # only fetch missing kaikki dumps (= pnpm pipeline --download-only)
pnpm pipeline                       # full build (downloads missing kaikki dumps first) → artifacts/ and packages/web/public/data/
pnpm pipeline --lcorp-offline       # use only cached lcorp responses (no network)
pnpm pipeline --help
pnpm sync-data                      # re-mirror artifacts/web → packages/web/public/data
cd packages/pipeline && npx tsc -p tsconfig.json && pnpm test
```

Inputs (paths resolved from the repo root in `src/config.ts`):

| input | path |
|---|---|
| kaikki Ukrainian | `data/kaikki-uk/kaikki.org-dictionary-Ukrainian.jsonl` (~300 MB) |
| kaikki English | `data/kaikki-en/kaikki.org-dictionary-English.jsonl` (~3.3 GB; only Ukrainian translations are read) |
| frequency list | `raw_sources/publicist_84k_lex_dict_orig.csv` |
| known aspect pairs | `raw_sources/verb_aspect_known_pairs.json` |
| example sentences (optional plugin) | `raw_sources/example_sentences.tsv` |
| caches | `data/cache/` (English-translation extract, `lcorp/` responses) |

### Flags

| flag | default | meaning |
|---|---|---|
| `--workers N` | CPUs − 1 | worker threads for the JSONL passes; split ≈40 % Ukrainian / 60 % English |
| `--out DIR` | `<repo>/artifacts` | output root (`web/ machine/ debug/ reports/`) |
| `--no-sync` | sync on | don't mirror `artifacts/web` → `packages/web/public/data` (stale files there are deleted when syncing) |
| `--no-lcorp` | lcorp on | skip lcorp enrichment |
| `--lcorp-offline` | off | cache-only lcorp (no network requests) |
| `--lcorp-budget N` | 3000 | max lcorp *network* lookups this run (cache hits are free) |
| `--lcorp-rate R` | 1 | max lcorp requests per second |
| `--lcorp-concurrency N` | 1 | parallel lcorp ASP.NET sessions |
| `--no-created` | created on | don't synthesize entries from English translation tables (also skips the English pass) |
| `--shard-size N` | 200 | entries per web shard |
| `--samples a,b,c` | — | extra words for `debug/samples/` |
| `--download-only` | off | download the missing kaikki dumps and exit |
| `--no-download` | download on | fail (with the URLs) instead of downloading missing kaikki dumps |

The TUI shows every stage with a progress bar, counts, rate, ETA and status; when stdout is not a TTY (or
`CI` is set) it prints timestamped log lines instead. Ctrl-C closes the lcorp client (cache stays consistent),
restores the terminal and exits with code 130; a second Ctrl-C forces exit. Failures exit with code 1 and name
the failing stage.

## Stages

| # | stage | module | what it does |
|---|---|---|---|
| 0 | download | `sources/download.ts` | fetch missing kaikki dumps from kaikki.org, both in parallel (one bar each); streamed to `*.part` and renamed when complete; interrupted downloads resume via `Range` + `If-Range` (ETag), so a dump rebuilt upstream restarts instead of being spliced. Existing dumps are never re-fetched — delete one to refresh it. The English dump is skipped with `--no-created` |
| 1 | load | `sources/frequency.ts`, `sources/aspect-pairs.ts` | frequency index (rank by `rate_abs`), curated aspect pairs |
| 2 | kaikki-uk ∥ kaikki-en | `sources/kaikki-uk/`, `sources/kaikki-en/` | parallel byte-range JSONL parsing → `DraftEntry[]` + `IgnoredEntry[]`; English → `EnTranslation[]` (cached) |
| 3 | created | `stages/created.ts` | entries for Ukrainian words that only appear in English translation tables (DECISIONS 11) |
| 4 | merge | `stages/merge.ts` | same key + POS + gloss set + compatible stress ⇒ one entry (DECISIONS 10) → `debug/merges.jsonl` |
| 5 | lcorp | `stages/lcorp-enrich.ts` | paradigms for inflectable single words without a kaikki table, most frequent first; kaikki before created |
| 6 | resolve | `stages/resolve.ts` | ignored inflected-form entries → lemma `extraForms` (+ resolution), `linked` flags, aspect partners (curated first, symmetric) |
| 7 | rank | `stages/rank.ts` | `freqRank`, order (ranked → unranked kaikki → unranked created; ties by Ukrainian collation, POS, source line), `id`, `slug` |
| 8 | plugins | `plugins/` | `PipelinePlugin.enrich` (e.g. example sentences) |
| 9 | validate | `stages/validate.ts` | invariant checks (unique slugs, dense ids, relation duplicates, known slots, link offsets…) → report |
| 10 | emit | `emit/web.ts`, `emit/machine.ts`, `emit/debug.ts`, `emit/report.ts` | artifacts (in parallel), then sync |

All stage functions are pure-ish (they mutate the drafts they are given, no I/O) and unit-tested with
synthetic entries (`src/**/*.test.ts`, `node:test`). `cli.test.ts` runs the whole orchestration with fake
sources into a temp dir.

## Artifacts

```
artifacts/
  web/        manifest.json, core.<h>.json.gz, summaries.<h>.json.gz, shards/<n>.<h>.json.gz,
              forms/<prefix>.<h>.json.gz, english/<prefix>.<h>.json.gz   (formats: packages/shared/src/artifacts.ts)
  machine/    entries.jsonl, created-entries.jsonl, ignored-entries.jsonl, schema.d.ts, README.md
  debug/      samples/<word>.json, merges.jsonl, lcorp.jsonl, unmapped-forms.json, top-entries.txt
  reports/    summary.json, summary.md  (counts, timings, validation, artifact sizes, top-20)
```

Web files are gzip-9 JSON with an 8-hex content hash (sha256 of the JSON) in the name; `buildId` hashes all
file hashes, so identical input produces identical output. Forms/English indexes are split into
variable-length prefix buckets (1–3 chars): a bucket is split while it has more than ~3000 keys or ~150 KB of
JSON, moving the largest child groups out first; the emitter verifies with `findBucket` that every key routes
to the file it was written to. `emitWebArtifacts(entries, opts)` (in `src/emit/web.ts`) has no pipeline
dependencies and can be called from fixture scripts.

## lcorp politeness, caching and budget

- Only entries with an inflectable POS, no kaikki table, a single word and no `indeclinable` tag are looked up,
  ordered by frequency rank (kaikki entries before created entries), so a limited budget is spent on common words.
- The client (`sources/lcorp/client.ts`) uses a token bucket (default 1 req/s, 1 session), exponential back-off,
  honours `Retry-After`, trips a circuit breaker after repeated errors and caches every response permanently in
  `data/cache/lcorp/` — re-runs only hit the network for words never seen before.
- `--lcorp-budget` caps network lookups per run; `--lcorp-offline` never touches the network. Lookups that are
  skipped because of budget/offline mode are listed in `debug/lcorp.jsonl` with `status: "skipped"`.
- A found result is applied only if lcorp's headword matches the entry (see DECISIONS 5). It sets
  `paradigm` (source `lcorp`), fills missing gender/animacy/aspect/number and adds an lcorp source link.

## Extending

### Adding a plugin

1. Create `src/plugins/<name>.ts` exporting a `PipelinePlugin` (`src/contracts.ts`):
   ```ts
   export const myPlugin: PipelinePlugin = {
     id: 'my-source',
     attribution: { id: 'my-source', name: 'My corpus', url: 'https://…', description: '…' },
     async enrich(ctx) {
       // ctx.entries (final, ranked, with ids), ctx.byKey (searchKey → entries), ctx.config, ctx.log
       // mutate entries: add examples (Example.source = 'my-source'), sources, ext['my-source'], …
       ctx.addAttribution(this.attribution!);
     },
   };
   ```
2. Append it to `plugins` in `src/plugins/index.ts`.

Plugins run after ranking (ids are final) and before validation/emission, so anything they add is validated,
indexed (English glosses, forms) and emitted. Don't add or remove entries in a plugin (ids must stay dense);
add a source stage instead. `plugins/example-sentences.ts` is a complete example (optional TSV input,
no-op when missing).

### Adding a source

A source that produces new entries or data before ranking:

1. Put the reader in `src/sources/<name>/` and return contract types (`DraftEntry`, or a lookup index).
   Use `util/parallel-jsonl.ts` for large JSONL files and report progress through the `Progress` handed in.
2. Add a stage in `runPipeline` (`src/cli.ts`): register it in `STAGES` (so the TUI lists it), call it via
   `step(id, fn, summary)` and feed its result into the drafts before `merge` (new entries) or into `resolve` /
   `lcorp` (enrichment).
3. Add its attribution to the manifest (either in `BUILTIN_ATTRIBUTIONS` in `@ukdict/shared` or by pushing it
   into the `attributions` list in `runPipeline`), and a `SourceRef` to the entries it touches.

## Timings

Reference run on a 12-core laptop (11 workers, `--lcorp-offline`, lcorp cache warm): **~7 s end to end**.

| stage | time |
|---|---|
| frequency + aspect pairs | 0.1 s |
| kaikki-uk (300 MB, 4 workers) ∥ kaikki-en (3.3 GB, 7 workers) | 1.3 s ∥ 1.3 s cold (byte pre-filter, file in OS cache) / 0.06 s cached |
| created + merge + resolve + rank + validate | ~1.5 s |
| lcorp (offline: candidate scan + cache reads) | ~0.8 s |
| emit web (≈515 gzip-9 files, parallel) ∥ machine ∥ debug | ~3 s |

A networked lcorp pass is dominated by the rate limit (default 1 req/s; a lookup takes 1–3 requests), so
`--lcorp-budget 3000` can take about an hour; re-runs are served from the cache. See
`artifacts/reports/summary.md` for the per-stage timings of the last run.
