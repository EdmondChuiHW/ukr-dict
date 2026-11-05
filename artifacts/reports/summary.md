# Pipeline summary

Built 2026-10-10T16:31:40.425Z in 6.7s.

Options: `workers=11`, `workersUk=4`, `workersEn=7`, `shardSize=200`, `created=true`, `lcorp=offline (cache only)`, `outDir=/Users/edmondc/coding-project-6/tasks/ukr-dict/model-a-run/artifacts`

## Stages

| stage | status | duration | summary |
|---|---|---|---|
| Frequency list + aspect pairs | done | 116ms | 84,550 frequency rows · 1 known aspect pairs |
| kaikki Ukrainian | done | 1.2s | 59,877 lines → 32,215 entries, 27,662 ignored, 29,058 with tables (4 workers) |
| kaikki English translations | done | 64ms | 53,312 uk translations from 27,539 entries (cached) |
| Created entries | done | 174ms | 18,170 created (5,343 multi-word) from 53,312 translations |
| Merge identical entries | done | 312ms | 77 entries merged in 77 groups (32 gloss-less stubs dropped) → 50,308 |
| lcorp enrichment | done | 905ms | 188+12,424 candidates (kaikki+created) · 4,225 found · +4,225 paradigms · net 0 · cache 4,564 · skipped 8,048 |
| Resolve forms/links/aspect | done | 401ms | 421 extra forms · 743 lemma-missing · 556 aspect partners added |
| Rank + ids + slugs | done | 220ms | 50,308 entries · 26,038 ranked · 10,622 unranked kaikki · 13,648 unranked created |
| Plugins | done | 18ms | example-sentences |
| Validate | done | 251ms | all checks passed |
| Emit web artifacts | done | 3.0s | 538 files · 13.4 MB · phase-1 368 KB |
| Emit machine artifacts | done | 908ms | entries.jsonl 78.4 MB · ignored-entries.jsonl 10.7 MB · created-entries.jsonl 14.8 MB |
| Emit debug artifacts | done | 247ms | 25 files · samples without entries: кращий |

## Counts

| count | value |
|---|---|
| kaikkiUkLines | 59,877 |
| kaikkiUkEntries | 32,215 |
| kaikkiUkIgnored | 27,662 |
| kaikkiUkWithParadigm | 29,058 |
| englishLinesMatched | 27,539 |
| englishTranslations | 53,312 |
| createdEntries | 18,170 |
| draftsBeforeMerge | 50,385 |
| mergedAway | 77 |
| entries | 50,308 |
| createdEntriesFinal | 18,170 |
| rankedEntries | 26,038 |
| unrankedKaikki | 10,622 |
| unrankedCreated | 13,648 |
| homonymSlugs | 1,179 |
| withParadigm | 33,238 |
| withExtraForms | 397 |
| withAudio | 18,063 |
| withIpa | 31,479 |
| withAspectPartners | 4,976 |
| withRelations | 14,351 |
| headwordKeys | 48,451 |
| formKeys | 371,668 |
| englishTokens | 31,467 |

## Ignored kaikki entries

| reason | count |
|---|---|
| inflected-form-only | 27,662 |

| resolution | count |
|---|---|
| in-paradigm | 26,494 |
| lemma-missing | 743 |
| added-as-extra-form | 425 |

## Created entries (English translation tables)

| metric | value |
|---|---|
| translations | 53,312 |
| skippedLatinOrDigits | 61 |
| skippedTooLong | 93 |
| skippedInvalid | 6 |
| existingHeadword | 32,342 |
| existingForm | 251 |
| created | 18,170 |
| multiword | 5,343 |

## Merges

77 merge groups; 77 entries merged into others; 32 gloss-less stubs dropped (see debug/merges.jsonl).

## Sanitize (source word clean-up)

| metric | value |
|---|---|
| headsCleaned | 238 |
| headsDropped | 84 |
| primaryHeadFixed | 227 |
| relationWordsCleaned | 40 |
| relationWordsDropped | 3 |
| refWordsCleaned | 20 |
| partnerWordsCleaned | 0 |

## Resolve

| metric | value |
|---|---|
| ignored | 27,662 |
| inParadigm | 26,494 |
| addedAsExtraForm | 425 |
| lemmaMissing | 743 |
| extraFormsAdded | 421 |
| knownPairsApplied | 2 |
| symmetricPartnersAdded | 554 |
| partnersStressFilled | 2 |
| linkedRefs | 81,673 |
| unlinkedRefs | 38,691 |
| relationDuplicatesRemoved | 0 |

## lcorp

Enabled: true (mode: offline (cache only)).

| enrichment | value |
|---|---|
| candidates | 12,612 |
| candidatesKaikki | 188 |
| candidatesCreated | 12,424 |
| lookedUp | 12,612 |
| found | 4,225 |
| notFound | 339 |
| skipped | 8,048 |
| errors | 0 |
| paradigmsAdded | 4,225 |
| paradigmsAddedCreated | 4,128 |
| fieldsFilled | 3,272 |
| aborted | false |

| client | value |
|---|---|
| network | 0 |
| cacheHits | 4,564 |
| found | 4,225 |
| notFound | 339 |
| errors | 0 |
| skipped | 8,048 |
| requests | 0 |
| sessions | 0 |
| failedRequests | 0 |
| circuitOpen | false |

## Paradigms

| source | entries |
|---|---|
| wiktionary | 29,013 |
| lcorp | 4,225 |

| kind | entries |
|---|---|
| noun | 20,421 |
| verb | 6,480 |
| adjectival | 6,337 |

Entries without paradigm: 17,070 (inflectable POS without paradigm: 14,284).

## Validation

**All checks passed.**

| check | violations | examples |
|---|---|---|
| unique-slugs — every slug is unique | 0 |  |
| key-matches-word — entry.key === searchKey(entry.word) | 0 |  |
| heads-present — at least one head; the primary head has the same key as the word | 0 |  |
| senses-present — at least one sense with a gloss | 0 |  |
| sources-present — at least one source reference | 0 |  |
| relation-duplicates — no duplicate search keys within any relation list (entry and sense level) | 0 |  |
| partner-duplicates — no duplicate keys within aspectPartners | 0 |  |
| paradigm-slots — every paradigm slot key is in the closed vocabulary (isKnownSlot) | 0 |  |
| paradigm-empty-forms — no empty form strings in paradigms / extraForms | 0 |  |
| gloss-link-bounds — gloss link offsets within the gloss: 0 ≤ start < end ≤ gloss.length | 0 |  |
| freqrank-valid — freqRank is a positive integer when present | 0 |  |

## Artifact sizes

Web: **13.4 MB** in 538 files; phase-1 payload (manifest + core): **368 KB**.

| web category | files | gzip bytes | raw JSON bytes |
|---|---|---|---|
| manifest | 1 | 33.3 KB | 33.3 KB |
| core | 1 | 335 KB | 1.4 MB |
| summaries | 1 | 1.1 MB | 3.7 MB |
| shards | 252 | 9.9 MB | 78.4 MB |
| forms | 243 | 1.4 MB | 10.7 MB |
| english | 40 | 722 KB | 1.8 MB |

| machine file | bytes |
|---|---|
| entries.jsonl | 78.4 MB |
| ignored-entries.jsonl | 10.7 MB |
| created-entries.jsonl | 14.8 MB |
| schema.d.ts | 8.9 KB |
| README.md | 1.3 KB |

Debug files: 25. Samples without entries: кращий.

## Top 20 entries

| id | head | pos | freqRank | slug |
|---|---|---|---|---|
| 0 | і | conjunction | 1 | і~conjunction |
| 1 | і | particle | 1 | і~particle |
| 2 | на | preposition | 2 | на~preposition |
| 3 | в | preposition | 3 | в~preposition |
| 4 | у | preposition | 4 | у~preposition |
| 5 | у | preposition | 4 | у~preposition~2 |
| 6 | з | preposition | 6 | з~preposition |
| 7 | з | preposition | 6 | з~preposition~2 |
| 8 | бу́ти | verb | 7 | бути~verb |
| 9 | та | conjunction | 8 | та~conjunction |
| 10 | що | conjunction | 9 | що~conjunction |
| 11 | до | preposition | 10 | до~preposition |
| 12 | за | preposition | 11 | за~preposition |
| 13 | Украї́на | proper-noun | 12 | Україна~proper-noun |
| 14 | й | conjunction | 13 | й~conjunction |
| 15 | про | preposition | 14 | про~preposition |
| 16 | цей | determiner | 15 | цей~determiner |
| 17 | рік | noun | 16 | рік~noun |
| 18 | для | preposition | 17 | для~preposition |
| 19 | це | pronoun | 18 | це~pronoun |

Plugins: example-sentences.
