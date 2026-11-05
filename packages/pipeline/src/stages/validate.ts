/**
 * Validation pass: checks invariants of the final entry list. Violations are counted (with a few examples)
 * for the report; only structural breakage (non-dense ids, missing required fields) throws.
 */
import { isKnownSlot, searchKey } from '@ukdict/shared';
import type { Entry, Relations } from '@ukdict/shared';
import { walkSenses } from './common.ts';

export interface ValidationCheck {
  name: string;
  description: string;
  violations: number;
  examples: string[];
}

export interface ValidationReport {
  ok: boolean;
  totalViolations: number;
  checks: ValidationCheck[];
}

const MAX_EXAMPLES = 10;

export function validateEntries(entries: readonly Entry[]): ValidationReport {
  const checks = new Map<string, ValidationCheck>();
  const def = (name: string, description: string) => checks.set(name, { name, description, violations: 0, examples: [] });
  def('unique-slugs', 'every slug is unique');
  def('key-matches-word', 'entry.key === searchKey(entry.word)');
  def('heads-present', 'at least one head; the primary head has the same key as the word');
  def('senses-present', 'at least one sense with a gloss');
  def('sources-present', 'at least one source reference');
  def('relation-duplicates', 'no duplicate search keys within any relation list (entry and sense level)');
  def('partner-duplicates', 'no duplicate keys within aspectPartners');
  def('paradigm-slots', 'every paradigm slot key is in the closed vocabulary (isKnownSlot)');
  def('paradigm-empty-forms', 'no empty form strings in paradigms / extraForms');
  def('gloss-link-bounds', 'gloss link offsets within the gloss: 0 ≤ start < end ≤ gloss.length');
  def('freqrank-valid', 'freqRank is a positive integer when present');

  const bump = (name: string, example: string) => {
    const c = checks.get(name)!;
    c.violations++;
    if (c.examples.length < MAX_EXAMPLES) c.examples.push(example);
  };

  // Structural checks (throw).
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!e || typeof e !== 'object') throw new Error(`validate: entry ${i} is not an object`);
    if (e.id !== i) throw new Error(`validate: ids are not dense (entries[${i}].id = ${e.id})`);
    if (typeof e.word !== 'string' || !e.word || typeof e.key !== 'string' || !e.key) throw new Error(`validate: entry ${i} lacks word/key`);
    if (typeof e.pos !== 'string' || !Array.isArray(e.senses) || !Array.isArray(e.heads) || !Array.isArray(e.sources)) {
      throw new Error(`validate: entry ${i} (${e.word}) lacks pos/senses/heads/sources`);
    }
  }

  const slugs = new Set<string>();
  for (const e of entries) {
    const tag = `${e.id}:${e.slug}`;
    if (slugs.has(e.slug)) bump('unique-slugs', tag);
    slugs.add(e.slug);
    if (searchKey(e.word) !== e.key) bump('key-matches-word', `${tag} key=${e.key}`);
    if (e.heads.length === 0 || searchKey(e.heads[0]) !== e.key) bump('heads-present', `${tag} heads=${e.heads.join('|')}`);
    let hasGloss = false;
    walkSenses(e.senses, (s) => {
      if (s.gloss && !s.headerOnly) hasGloss = true;
    });
    if (!hasGloss) bump('senses-present', tag);
    if (e.sources.length === 0) bump('sources-present', tag);

    const checkRel = (rel: Relations | undefined, where: string) => {
      if (!rel) return;
      for (const [type, list] of Object.entries(rel)) {
        const seen = new Set<string>();
        for (const t of list ?? []) {
          const k = searchKey(t.word);
          if (seen.has(k)) bump('relation-duplicates', `${tag} ${where}.${type}: ${t.word}`);
          seen.add(k);
        }
      }
    };
    checkRel(e.relations, 'relations');
    if (e.aspectPartners) {
      const seen = new Set<string>();
      for (const p of e.aspectPartners) {
        const k = searchKey(p.word);
        if (seen.has(k)) bump('partner-duplicates', `${tag}: ${p.word}`);
        seen.add(k);
      }
    }
    walkSenses(e.senses, (s, depth) => {
      checkRel(s.relations, `sense[d${depth}]`);
      for (const l of s.links ?? []) {
        if (!(Number.isInteger(l.start) && Number.isInteger(l.end) && l.start >= 0 && l.start < l.end && l.end <= s.gloss.length)) {
          bump('gloss-link-bounds', `${tag} "${s.gloss.slice(0, 40)}" [${l.start},${l.end})`);
        }
      }
    });
    if (e.paradigm) {
      for (const [slot, forms] of Object.entries(e.paradigm.forms)) {
        if (!isKnownSlot(slot)) bump('paradigm-slots', `${tag} ${slot}`);
        for (const f of forms ?? []) if (!f.form || !f.form.trim()) bump('paradigm-empty-forms', `${tag} ${slot}`);
      }
    }
    for (const x of e.extraForms ?? []) if (!x.form || !x.form.trim()) bump('paradigm-empty-forms', `${tag} extraForms`);
    if (e.freqRank !== undefined && !(Number.isInteger(e.freqRank) && e.freqRank > 0)) bump('freqrank-valid', `${tag} ${e.freqRank}`);
  }
  const list = [...checks.values()];
  const totalViolations = list.reduce((s, c) => s + c.violations, 0);
  return { ok: totalViolations === 0, totalViolations, checks: list };
}
