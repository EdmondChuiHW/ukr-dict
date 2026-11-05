# Decisions (gaps in the requirements and how they were resolved)

Each decision lists the requirement it interprets. Implementation notes for later phases are appended at the end.

## Data / pipeline

1. **What counts as an ignorable "derived form" entry.** A kaikki entry is ignored only if *every* sense is a
   `form_of` sense whose tags contain an *inflectional* category (case, number, person, tense, mood, infinitive,
   participle, adverbial participle, comparative/superlative, impersonal). Form-of senses that are lexical
   derivations — `diminutive`, `augmentative`, `endearing`, `pejorative`, `noun-from-verb`, gender counterparts
   ("feminine of вчитель"), `passive` (-ся verbs), `abbreviation`, untagged — are *kept*, because those are
   separate lexemes with their own inflection tables. Mixed entries (some real senses + some form-of senses,
   e.g. "є", "ручка") are kept with all senses; form-of senses render as "… of X" with X linked.
2. **Ignored entries are not lost for search.** Each ignored entry's headword is attached to its base entry as
   an `extraForm` when the form does not already appear in the base entry's paradigm, so searching an inflected
   form that is missing from a table still finds the lemma. The resolution (`in-paradigm`,
   `added-as-extra-form`, `lemma-missing`) is recorded per ignored entry in `machine/ignored-entries.jsonl`.
3. **Participles** that only exist as "past passive participle of X" entries are inflectional (they are verb
   table cells) → ignored; comparative/superlative-only adjective entries likewise (they appear as `cmp`/`sup`).
4. **Paradigm model.** Tables are stored as a closed vocabulary of slot keys (`packages/shared/src/paradigm.ts`)
   → list of variant forms with optional qualifier tags (`dated`, `dialectal`, `rare`…). The same vocabulary is
   produced by the kaikki and lcorp parsers and consumed by the UI, so table rendering is source-independent.
   Analytic constructions (`бу́ду співа́ти`, `би співа́в`, kaikki's `error-unrecognized-form`) are not stored.
   Personal-pronoun pages in kaikki contain the table of *all* personal pronouns; only the column matching the
   entry's own nominative is kept.
5. **lcorp fallback** is used only for entries with an inflectable POS (noun, proper noun, verb, adjective,
   pronoun, determiner, numeral), no kaikki table, single word, not tagged indeclinable. lcorp's search lands
   on the alphabetically nearest registry word, so a result is accepted only if its headword equals the entry
   word (stress-insensitive, case-sensitive, homonym index removed) and its POS is compatible. Homonyms are
   disambiguated by stress (entry heads) then POS. lcorp has no per-word URL, so the per-entry source link
   points to the dictionary front page with the word to search.
6. **Rate limiting.** No published limit exists; the client defaults to 1 request/s with one session, honours
   `Retry-After`, backs off exponentially on errors, caches every response permanently and has a per-run
   network budget (`--lcorp-budget`). Lookups are ordered by frequency so the budget is spent on common words.
7. **Aspect pairs.** Sources merged in priority order: `verb_aspect_known_pairs.json` (curated) → kaikki head
   forms tagged `perfective`/`imperfective`. Pairs are made symmetric (if A lists B as its perfective, B gets
   A as imperfective partner) when the partner entry exists. The curated list is consulted first and its
   partner is listed first (e.g. співати → заспівати, then kaikki's поспівати).
8. **POS / gender / animacy normalization.** kaikki POS → `PartOfSpeech` (`name` → `proper-noun`, `det` →
   `determiner`, `character` → `letter`, `prep_phrase` → `prepositional-phrase`, …). Gender is a list
   (`собака` is m and f). Animacy: kaikki `person`, `animal-not-person`, `animate` → animate; `inanimate` →
   inanimate. Number restriction: `plural-only`/pluralia tantum. Aspect: `imperfective`/`perfective`/both →
   `biaspectual`.
9. **Synonym collapsing** ("if synonyms have an identical entry, collapse them to one entry"): every relation
   list (entry level and sense level) is de-duplicated by search key (stress-insensitive); duplicates are merged
   into one item (tags/sense notes unioned, stressed spelling preferred). A relation equal to the headword
   itself is dropped. Sense-level relations that repeat an entry-level relation are removed from the entry level.
10. **Merging entries with the same definitions.** Two entries are merged when they have the same headword key,
    the same normalized POS and the same set of normalized glosses (kaikki sometimes splits one word into
    several etymology sections with identical senses; English translation tables produce many duplicates).
    Paradigms, pronunciations, relations and sources are unioned. Entries whose stressed heads differ
    (за́мок/замо́к) are never merged. Every merge is logged to `debug/merges.jsonl`.
11. **Created entries.** A Ukrainian word found in an English translation table (`code: uk`) whose search key is
    neither a headword nor an ignored inflected form in the Ukrainian data becomes a `created` entry: one entry
    per (word, POS); senses are the English headwords (grouped by English POS, with the translation-table sense
    label as qualifier); gender/aspect/animacy come from translation tags (and lcorp, when looked up). Multi-word
    translations are included (useful for English search) but are not sent to lcorp. Created entries link to the
    English Wiktionary pages they came from.
12. **Frequency ordering.** The CSV is ranked by `rate_abs` descending (ties by `rowid`). An entry's rank is
    taken from a row with the same lower-cased lemma and a compatible POS; rows of an incompatible POS are never
    used (so the river "По" does not inherit the preposition's rank). For nouns/proper nouns a POS-tagged row
    must also agree in initial capitalization (the CSV capitalizes proper names: "Україна" ranks the country,
    not the dated common noun "украї́на"; "влада" does not rank the name "Влада").
    Final order: ranked entries by rank; then unranked kaikki entries; then created entries; ties
    alphabetically (Ukrainian collation). The entry id equals the position in this order, so "lower id = more
    frequent" everywhere (shards, postings).
13. **Gloss links.** kaikki `links` (text, target) pairs whose text contains Cyrillic are located in the gloss
    text and stored as `{start, end, target}` spans; `form_of`/`alt_of` targets are always linkable.
14. **Pronunciations**: IPA strings plus audio files (MP3 preferred for Safari, OGG kept as an alternative
    source). Audio stays remote (Wikimedia Commons); it is cached by the service worker once played.
15. **Examples** from kaikki are kept (text, translation, reference). The `Example.source` field and the
    `PipelinePlugin` interface let other corpora attach examples later (see `plugins/example-sentences.ts`).
16. **Etymology text is not included** (not requested; saves ~15 % of data size). It is a one-line change in the
    transform if wanted.

## Web app

17. **Phased loading**: phase 1 = manifest + core (headword keys only) → exact/prefix/infix headword search
    is available almost immediately. Inflected forms and English full text are bucketed by key prefix and
    fetched on demand (one small file per query) — the UI shows a "searching forms / English…" cue while a
    bucket is in flight and a status pill for the background offline download.
18. **IndexedDB vs Cache Storage**: all data files are immutable, content-hashed, gzip'd JSON, so the service
    worker's Cache Storage is the offline store (simpler and atomic per file, no duplication of 30+ MB of data
    into a second store). Small user settings (case order, recent searches) live in `localStorage`.
19. **Detail page**: there is no separate detail page; `?q=<word>` renders the result page whose top card(s)
    are the entry. Homonyms / same word with different POS are grouped under one headword heading, one section
    per entry (ordered by frequency rank).
20. **Source links / iframes**: every entry lists its sources (Wiktionary page, kaikki page, lcorp, English
    Wiktionary pages for created entries). Wiktionary allows framing, so a "Show source" toggle lazily embeds
    the page in an `<iframe>`; lcorp (postback-only, no deep link) is linked, not framed.
21. **Attribution**: site-wide "About & sources" view (licenses, links) + per-entry source list.
22. **Case order** default N-A-G-D-I-L-V so nom=acc and acc=gen syncretism produces merged cells (requirement
    example); traditional order selectable and persisted.

## Implementation notes (appended during the build)

- Web: **Data access** — the search worker reads every data file cache-first from Cache Storage (`ukdict-data`, the same cache the
  service worker's CacheFirst route uses) and writes network responses into it itself, so offline works even before the
  service worker controls the page (first visit). `manifest.json` is fetched `no-cache` with a cached fallback. Files are
  decoded via `arrayBuffer` + gzip magic-byte sniffing (`1f 8b` → `DecompressionStream`, else plain JSON — `vite preview`
  sends `Content-Encoding: gzip` for `.json.gz`). After the offline download, cache entries of older builds are deleted.
- Web: **Streaming results** — the worker evaluates a query against whatever is loaded (`compute()` returns the result plus the
  list of missing files), posts it, and re-posts as each missing file arrives. The first post is delayed ≤ 45 ms so cached/fast
  loads don't flash skeletons. Stale queries are dropped by sequence number on both sides.
- Web: **Exact tier order** — stress-exact entries first, then entries whose `word` equals the query case-sensitively
  ("по" before the river "По"), then by id. Real data showed the proper noun "По" carrying the preposition's frequency rank.
- Web: **Compact-row deep links** — summaries have no slug, so rows whose key is shared by several entries link to
  `?q=word&e=word~pos`; `e` matches a slug exactly or as a `slug~n` prefix (first homonym).
- Web: **History** — the push that starts a new entry happens immediately; subsequent keystroke `replaceState`s are debounced
  300 ms (Safari throws after 100 history calls per 30 s).
- Web: **Audio** is fetched with CORS into a blob URL (Wikimedia sends `Access-Control-Allow-Origin: *`), so the response is a
  cacheable 200 (a media element's range requests would yield uncacheable 206s); falls back to the plain URL.
- Web: **Table layout** picks noun vs adjectival by the slot shapes present (not only `kind`); slots the layout doesn't place
  are listed under the table (with `describeSlot`) so nothing is silently dropped. Form-match highlighting is applied only in
  form-tier cards (in exact cards it would just mark the citation form).
- Web: Fixture data (`packages/web/scripts/fixture-entries.ts` → `public/data-fixture/`, via the pipeline's `emitWebArtifacts`
  with tiny bucket limits) is selected with `?data=data-fixture` (or `VITE_DATA_DIR`); the e2e runs against both.
- Pipeline: **lcorp scope in practice.** Only ~215 kaikki entries lack a table and pass the candidate filter (lcorp's
  `lcorpCandidateVerdict` also drops non-lemma head lines such as "verb form", predicatives and abbreviations); all of them
  are cached. The bulk of lcorp candidates are *created* entries (~12.4k). The delivered build used a networked pass with
  `--lcorp-budget 4600 --lcorp-rate 1.5 --lcorp-concurrency 2`, which covers the frequency-ranked created words first;
  the remaining (rare, unranked) created words can be filled by re-running with a larger budget — the cache makes
  re-runs incremental, and `--lcorp-offline` rebuilds from cache in seconds.
- Pipeline: lcorp does not render articles for personal pronouns and uninflected words (they exist in its registry but
  the article is empty) — these are recorded as not-found with a note.
- Pipeline: created verb senses are glossed in the infinitive ("to sing") to match Wiktionary-sourced glosses.
- Pipeline: a sanitize pass before merging cleans wikitext residue that leaks into kaikki words (`ма́впа f animal ]`,
  `прі́сний[unleavened]]>`), counted in the report.
