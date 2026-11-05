# Acceptance criteria

Checked at the end of the build; each item names how it is verified.

## Pipeline (P)

- [x] P1 Pipeline is TypeScript, shares types with the web app via `@ukdict/shared` (`Entry`, artifact formats). — ✅ all packages typecheck (`pnpm typecheck`); pipeline + web import `@ukdict/shared`
- [x] P2 Reads kaikki Ukrainian + English JSONL in parallel worker threads with byte-range splitting. — ✅ TUI: kaikki-uk 4 workers 1.3 s, kaikki-en 7 workers (3.3 GB, 1.3 s cold page-cache / cached extract 0.05 s)
- [x] P3 Declension/conjugation tables extracted into slot-based paradigms (noun, adjectival, verb). — ✅ 29,013 Wiktionary paradigms, 99.99 % of table forms mapped; debug/samples/*
- [x] P4 Entries without kaikki tables get lcorp paradigms (when lcorp has the word); rate limited + cached + budgeted. — ✅ 4,225 lcorp paradigms (97 kaikki + 4,128 created); 1–1.5 req/s, persistent cache, budget; debug/lcorp.jsonl
- [x] P5 Inflected-form-only entries are ignored; all ignored entries listed with reason in `machine/ignored-entries.jsonl`. — ✅ 27,662 ignored entries with reason + resolution in machine/ignored-entries.jsonl
- [x] P6 Verb aspect partners extracted (kaikki + known pairs file); співати shows заспівати. — ✅ співати → заспіва́ти (known pair, first), поспіва́ти, спі́ти; symmetric partners added (556)
- [x] P7 Pronunciation audio URLs + IPA extracted. — ✅ 18k+ entries with audio (mp3/ogg), 31k with IPA
- [x] P8 Definitions keep tags, qualifiers, nesting (gloss hierarchy), examples. — ✅ по: header nodes + nested subsenses, tags, examples
- [x] P9 Ukrainian links inside gloss text extracted as spans. — ✅ ручка: "diminutive of рука́" → link span; 81k linked refs
- [x] P10 POS, gender, animacy normalized. — ✅ normalized POS, genders[], animacy, number, aspect fields
- [x] P11 Synonyms/related terms extracted and collapsed (no duplicate keys within a list). — ✅ validator check "no duplicate keys within a relation list": 0 violations
- [x] P12 Entries sorted by frequency list; ids follow that order. — ✅ debug/top-entries.txt: і, на, в, у, з, бути, та, що…; strict POS/case-aware rank lookup
- [x] P13 Identical-definition entries merged; merges logged. — ✅ 77 merges logged in debug/merges.jsonl
- [x] P14 Created entries from English translation tables, flagged `created`, with source links. — ✅ 18,170 created entries (machine/created-entries.jsonl), `created` + English Wiktionary sources
- [x] P15 Extensible: `PipelinePlugin` interface + example plugin that attaches example sentences from an optional file. — ✅ PipelinePlugin registry + plugins/example-sentences.ts (optional TSV); see pipeline README
- [x] P16 TUI progress for every stage (bars, counts, rates); plain log fallback when not a TTY. — ✅ live TTY TUI (bars, rates, ETA) + timestamped plain log when not a TTY/CI
- [x] P17 Multiple artifacts: web (optimized), machine (JSONL), debug, reports. — ✅ artifacts/{web,machine,debug,reports}

## Web app (W)

- [x] W1 React 19 + React Compiler (Babel preset) build. — ✅ built bundle contains react.memo_cache_sentinel / useMemoCache
- [x] W2 Responsive: phone (≈375 px) and wide (≥1440 px) layouts. — ✅ screenshots 375×812 and 1440×900 (packages/web/screenshots), QA audit: no page overflow
- [x] W3 Fully static: `vite build` output works from any static server / sub-path. — ✅ dist served from a sub-path by a plain static server works incl. service worker
- [x] W4 Search never needs a server; runs in a Web Worker; instant for exact headwords once core is loaded. — ✅ Web Worker search; first exact card 170 ms cold (unthrottled)
- [x] W5 Matches: exact, with stress marks, partial (prefix + infix), inflected forms (lower rank), English full text (lowest). — ✅ e2e: співати / співа́ти / співа / співаю / dog; QA: собак, обак, собаці, зеленому, "to sing", "gree"
- [x] W6 Exact matches visually marked; matched inflected form highlighted in its table cell. — ✅ badges exact / exact stress / inflected form + highlighted table cell
- [x] W7 No stress marks in rendered text; stressed vowel highlighted via CSS Custom Highlight API (fallback spans). — ✅ e2e: no U+0301 in innerText, CSS.highlights "stress" populated; span fallback verified
- [x] W8 Declension/conjugation tables with merged identical adjacent cells. — ✅ стіл nom=acc merged; зелений m/n columns + acc.anim=gen merged; past plural rowspan
- [x] W9 Aspect partners shown, clickable. — ✅ aspect partner links both directions
- [x] W10 `?q=` query param, back/forward history works. — ✅ e2e: link click pushes, Back returns, typing replaces after first keystroke
- [x] W11 Audio playback buttons. — ✅ listen buttons (mp3 with ogg fallback)
- [x] W12 Definitions nested by gloss hierarchy and shared tags. — ✅ groupByTags nesting + gloss hierarchy (по, співати)
- [x] W13 Ukrainian links in definitions clickable. — ✅ ручка → рука link
- [x] W14 POS / gender / animacy badges; same word with multiple POS/homonyms grouped sensibly. — ✅ замок NOUN 1/2, що CONJUNCTION/PRONOUN, мати VERB/NOUN; gender/animacy badges
- [x] W15 English full-text search ranked below Ukrainian matches. — ✅ English tier last; dog → собака, пес first
- [x] W16 Offline usable (service worker; background download with progress). — ✅ e2e: offline reload after prefetch, search works
- [x] W17 Deep link per entry (`?q=word`, optional `&e=slug`). — ✅ ?q=замок&e=замок~noun~2 scrolls + highlights
- [x] W18 Source links per entry (Wiktionary, kaikki, lcorp, English Wiktionary for created entries); iframe preview for Wiktionary. — ✅ per-entry Sources: Wiktionary, kaikki, lcorp, English Wiktionary (created); Wiktionary iframe toggle
- [x] W19 Attribution page (site-wide) + per-entry sources. — ✅ ?view=about lists all attributions + licenses; footer attribution
- [x] W20 Fast initial load: phase-1 payload small (core only), UI cues for phases. — ✅ phase 1 = manifest + core ≈ 368 KB gzip; status pill + skeleton cues; first exact result before summaries load (3.45 s at 1.5 Mbps)

## Process (X)

- [x] X1 Architecture + decisions documented (docs/). — ✅ docs/ARCHITECTURE.md, DECISIONS.md, ACCEPTANCE.md
- [x] X2 Pipeline run to completion; artifacts present; web app built against real artifacts. — ✅ final run: 50,308 entries, validation OK; web built against real data; e2e 18/18
