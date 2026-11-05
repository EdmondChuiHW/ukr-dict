# Ukrainian–English offline dictionary — architecture

## Repository layout

```
raw_sources/                    provided inputs (frequency CSV, known aspect pairs)
data/                           downloaded + cached data (untrusted input; never executed)
  kaikki-uk/…Ukrainian.jsonl    300 MB, ~60k entries (English Wiktionary, Ukrainian section)
  kaikki-en/…English.jsonl      3.3 GB, English entries (we only read their Ukrainian translations)
  cache/                        pipeline caches (lcorp responses, English-translation extract)
packages/
  shared/    @ukdict/shared     TS types + normalization + tokenization + artifact formats (used by both sides)
  pipeline/  @ukdict/pipeline   Node (native TS type-stripping, worker_threads) build pipeline
  web/       @ukdict/web        Vite + React 19 + React Compiler PWA (static)
artifacts/                      pipeline output (see "Artifacts")
docs/                           this file, DECISIONS.md, ACCEPTANCE.md
```

Run everything with Node ≥ 24 and pnpm:

```
pnpm install
pnpm pipeline                   # full build (see packages/pipeline/README.md for flags)
pnpm web:build && pnpm web:preview
```

## Data flow

```
                ┌──────────────────────┐   ┌──────────────────────┐   ┌───────────────┐  ┌──────────────┐
 sources        │ kaikki-uk (workers)  │   │ kaikki-en (workers)  │   │ frequency CSV │  │ aspect pairs │
                └─────────┬────────────┘   └──────────┬───────────┘   └──────┬────────┘  └──────┬───────┘
                 DraftEntry[] + IgnoredEntry[]   EnTranslation[]               │                  │
                          └──────────────┬───────────┘                        │                  │
 stages                     created entries (uk words only in EN translation tables)              │
                                         │                                     │                  │
                            merge identical-definition entries ◄───────────────┼──────────────────┘
                                         │                                     │
                            lcorp enrichment (missing paradigms; rate-limited, cached, budgeted)
                                         │                                     │
                            resolve links / relations / aspect partners / ignored form-of → extraForms
                                         │                                     │
                            rank (frequency) → sort → assign ids + slugs ◄─────┘
                                         │
                            plugins (PipelinePlugin.enrich — e.g. example sentences)
                                         │
 emit            web/ (manifest, core, summaries, shards, forms/*, english/*)  machine/  debug/  reports/
```

Parallelism: both JSONL files are split into byte ranges aligned on newlines and processed by a
`worker_threads` pool (`os.availableParallelism()-1` workers). The English file is pre-filtered per line with a
substring test (`"code": "uk"`) before `JSON.parse`, so only ~27k of millions of lines are parsed. The result of
the English pass is cached in `data/cache/` keyed by file size + mtime.

lcorp: sequential-ish ASP.NET postbacks (viewstate chaining), a shared token bucket (default 1 req/s,
concurrency 1), exponential back-off on errors/429/5xx, persistent per-word cache (re-runs cost nothing), and a
per-run network budget. Only entries that (a) have an inflectable POS, (b) have no paradigm from kaikki, (c) are
single words without `indeclinable` tag are looked up, most frequent first.

## Artifacts (`artifacts/`)

| path | consumer | content |
|---|---|---|
| `web/manifest.json` | web app | build id, counts, file list (content-hashed names + sizes), attributions |
| `web/core.<h>.json.gz` | web, phase 1 | sorted headword search keys → entry ids (exact / prefix / infix search) |
| `web/summaries.<h>.json.gz` | web, phase 2 | per-entry compact row (head, POS, gram label, short gloss, flags) |
| `web/shards/<n>.<h>.json.gz` | web, on demand | full `Entry` objects, `shardSize` per file, id order = frequency order |
| `web/forms/<prefix>.<h>.json.gz` | web, on demand | inflected form key → entry ids (variable-length prefix buckets) |
| `web/english/<prefix>.<h>.json.gz` | web, on demand | stemmed English token → weighted postings |
| `machine/entries.jsonl` | other tools | one full `Entry` per line (shared `Entry` type), sorted by id |
| `machine/ignored-entries.jsonl` | report (required) | every ignored kaikki entry with reason, base form(s), resolution |
| `machine/created-entries.jsonl` | other tools | entries synthesized from English translation tables |
| `machine/schema.d.ts` | other tools | copy of the shared type definitions |
| `debug/samples/<word>.json` | humans | pretty-printed entries for a fixed list of sample words |
| `debug/merges.jsonl` | humans | which entries were merged and why |
| `debug/lcorp.jsonl` | humans | every lcorp lookup with status / matched headword |
| `debug/unmapped-forms.json` | humans | kaikki form tag-sets that did not map to a paradigm slot |
| `reports/summary.json`, `reports/summary.md` | humans/CI | counts per stage, timings, artifact sizes, ignored-by-reason |

All web data files are gzip-compressed JSON decoded in the browser with `DecompressionStream`, so the app
works on any static host without server-side compression config.

## Web app

* **Shell**: Vite + React 19 with the React Compiler (Babel preset via `@rolldown/plugin-babel`). Relative
  `base` so it can be served from any sub-path. Query-param routing (`?q=…`), no server rewrites needed.
* **Search worker** (Web Worker) owns all data: loads manifest → core; fetches summaries, buckets and shards
  on demand; caches decoded files in memory. Results are streamed tier by tier (exact headword is answered
  from core as soon as core is loaded; forms/English tiers arrive when their bucket is fetched).
* **Ranking tiers** (each tier ordered by frequency = entry id, English tier by weight then id):
  1. exact headword incl. stress marks (if the query has stress marks)
  2. exact headword, stress-insensitive
  3. exact inflected form (table cell highlighted, "matched form" badge)
  4. headword prefix
  5. headword infix (substring)
  6. English full-text match on definitions (AND of stemmed tokens; last token prefix-matched while typing)
* **Offline**: service worker (vite-plugin-pwa / Workbox) precaches the app shell; data files are cached
  cache-first (immutable, content-hashed). A background prefetch downloads every data file after the first
  idle moment and shows progress ("Offline ready" when complete). `navigator.storage.persist()` is requested.
* **Stress display**: stress marks are removed from the text and the stressed vowel is coloured with the CSS
  Custom Highlight API (`::highlight(stress)`), with a `<span>` fallback when unsupported.
* **Tables**: noun (case × number), adjectival (case × m/n/f/pl with animate/inanimate accusative rows) and verb
  (sections) layouts; identical adjacent cells merged (colspan, then rowspan). Default case order N-A-G-D-I-L-V
  (accusative next to nominative and genitive, so syncretic forms merge), switchable to traditional N-G-D-A-I-L-V.
* **Deep links / history**: `?q=<word>` is the canonical deep link for every entry; `&e=<slug>` scrolls to and
  highlights one entry. Typing replaces the current history entry; the first keystroke after a navigation and
  every link click push a new one, so Back walks through looked-up words.

See `docs/DECISIONS.md` for all judgement calls and `docs/ACCEPTANCE.md` for the acceptance checklist.
