/**
 * Example plugin: attaches example sentences from an optional TSV file to entries.
 *
 * File: raw_sources/example_sentences.tsv (UTF-8, tab-separated, optional header line starting with "word"):
 *   word <TAB> Ukrainian sentence <TAB> English translation <TAB> [source name]
 *
 * Each row is attached to the first (non-header) sense of every entry whose key equals searchKey(word).
 * If the file does not exist the plugin does nothing.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { searchKey } from '@ukdict/shared';
import type { Attribution, Sense } from '@ukdict/shared';
import type { PipelinePlugin } from '../contracts.ts';
import { exampleSentencesFile } from '../config.ts';

export const EXAMPLE_SENTENCES_SOURCE = 'example-sentences';

const attribution: Attribution = {
  id: EXAMPLE_SENTENCES_SOURCE,
  name: 'Example sentences (raw_sources/example_sentences.tsv)',
  url: '',
  description: 'Ukrainian example sentences with English translations from a user-supplied TSV file.',
};

export interface ExampleRow {
  word: string;
  text: string;
  translation?: string;
  ref?: string;
}

export function parseExampleTsv(content: string): ExampleRow[] {
  const rows: ExampleRow[] = [];
  const lines = content.replace(/^﻿/, '').split(/\r?\n/);
  lines.forEach((line, i) => {
    if (!line.trim() || line.startsWith('#')) return;
    const cols = line.split('\t').map((c) => c.trim());
    if (i === 0 && cols[0].toLowerCase() === 'word') return;
    const [word, text, translation, ref] = cols;
    if (!word || !text) return;
    const row: ExampleRow = { word, text };
    if (translation) row.translation = translation;
    if (ref) row.ref = ref;
    rows.push(row);
  });
  return rows;
}

function firstSense(senses: Sense[]): Sense | undefined {
  for (const s of senses) {
    if (!s.headerOnly) return s;
    const sub = s.subsenses && firstSense(s.subsenses);
    if (sub) return sub;
  }
  return senses[0];
}

export function createExampleSentencesPlugin(file?: string): PipelinePlugin {
  return {
    id: EXAMPLE_SENTENCES_SOURCE,
    attribution,
    async enrich(ctx) {
      const path = file ?? exampleSentencesFile(ctx.config.rootDir);
      if (!existsSync(path)) {
        ctx.log(`example-sentences: ${path} not found — skipped`);
        return;
      }
      const rows = parseExampleTsv(await readFile(path, 'utf8'));
      let attached = 0;
      let unmatched = 0;
      for (const row of rows) {
        const entries = ctx.byKey.get(searchKey(row.word));
        if (!entries?.length) {
          unmatched++;
          continue;
        }
        for (const e of entries) {
          const s = firstSense(e.senses);
          if (!s) continue;
          const ex = (s.examples ??= []);
          if (ex.some((x) => x.text === row.text)) continue;
          ex.push({ text: row.text, ...(row.translation ? { translation: row.translation } : {}), ...(row.ref ? { ref: row.ref } : {}), source: EXAMPLE_SENTENCES_SOURCE });
          if (!e.sources.some((x) => x.source === EXAMPLE_SENTENCES_SOURCE)) {
            e.sources.push({ source: EXAMPLE_SENTENCES_SOURCE, label: 'Example sentences', note: row.ref });
          }
          attached++;
        }
      }
      if (attached > 0) ctx.addAttribution(attribution);
      ctx.log(`example-sentences: ${rows.length} rows, ${attached} examples attached, ${unmatched} words not found`);
    },
  };
}

export const exampleSentencesPlugin: PipelinePlugin = createExampleSentencesPlugin();
