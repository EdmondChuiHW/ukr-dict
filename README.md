# Словник — offline Ukrainian–English dictionary

A static, installable PWA (React 19 + React Compiler) backed by a TypeScript build pipeline that turns the
kaikki.org Wiktionary dumps, a frequency list and lcorp inflection tables into compact, phase-loadable search
artifacts. Pipeline and web app share their types and normalization code (`packages/shared`).

```
packages/shared     @ukdict/shared   data model (Entry, Paradigm…), artifact formats, normalization, tokenization
packages/pipeline   @ukdict/pipeline build pipeline (Node ≥ 24, native TS, worker_threads, TUI)
packages/web        @ukdict/web      Vite + React PWA (fully static, offline via service worker)
artifacts/          pipeline output: web/ (UI data), machine/ (JSONL), debug/, reports/
docs/               ARCHITECTURE.md · DECISIONS.md · ACCEPTANCE.md
```

## Quick start

```sh
pnpm install

# 1. Source data (not committed): the kaikki dumps (~310 MB + ~3.2 GB) → data/kaikki-{uk,en}/
#    `pnpm pipeline` downloads missing dumps itself; this fetches them only (both in parallel, resumable)
pnpm download

# 2. Build the data (≈7 s with a warm lcorp cache; networked lcorp lookups are rate-limited to ~1 req/s)
pnpm pipeline                    # → artifacts/ and packages/web/public/data/
pnpm pipeline --lcorp-offline    # cache-only rebuild
pnpm pipeline --help

# 3. Web app
pnpm web:dev                     # development
pnpm web:build && pnpm web:preview
pnpm --filter @ukdict/web e2e    # Playwright end-to-end checks (uses installed Google Chrome)

pnpm typecheck && pnpm test
```

The built app (`packages/web/dist/`) can be served from any static host and any sub-path; data files are
gzip'd JSON decoded in the browser, so no server configuration is needed.

## Where to look

* Pipeline stages, flags, extension points (sources/plugins): `packages/pipeline/README.md`
* Artifact formats: `packages/shared/src/artifacts.ts`; machine-readable outputs: `artifacts/machine/README.md`
* Latest build report: `artifacts/reports/summary.md`; ignored kaikki entries: `artifacts/machine/ignored-entries.jsonl`
* Design and every judgement call on underspecified requirements: `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`
* Acceptance checklist with verification evidence: `docs/ACCEPTANCE.md`

## Data sources & licenses

Wiktionary content (via kaikki.org / Wiktextract) is CC BY-SA 4.0 / GFDL; inflection tables from
«Словники України online» © Український мовно-інформаційний фонд НАН України; frequency data from the
«Частотний словник сучасної української публіцистики» (mova.info). The app shows site-wide attributions on its
About page and per-entry source links.

## Known limitations

* ~14k inflectable entries still have no table: mostly rare, unranked *created* words (not yet looked up on lcorp
  — rerun `pnpm pipeline --lcorp-budget N` to extend the cache) and words lcorp does not know or renders empty
  (personal pronouns, uninflected words).
* Comparative-only adjectives such as "кращий" are ignored as inflected forms (per the rules), so they have no own
  entry; searching them finds the base adjectives through the forms index.
* English stemming conflates some words ("dogged" → "dog"), so a few loosely related results appear in the English tier.
* Pronunciation audio is streamed from Wikimedia Commons; it is available offline only after it has been played once.
