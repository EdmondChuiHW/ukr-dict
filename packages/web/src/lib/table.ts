/**
 * Inflection-table layout engine: paradigm slots → sections of grid rows → merged cells (colspan/rowspan).
 * Pure functions (unit-tested in table.test.ts); rendering lives in components/InflectionTable.tsx.
 */
import { CASE_LABELS, describeSlot, searchKey } from '@ukdict/shared';
import type { Aspect, CaseKey, Form, Paradigm, SlotKey } from '@ukdict/shared';

export interface CellData {
  /** Slot keys whose content this cell shows (several after merging). */
  slots: SlotKey[];
  forms: Form[];
}

export interface GridColumn {
  key: string;
  label: string;
  /** Short header for narrow screens. */
  abbr?: string;
}

export interface GridRow {
  key: string;
  label: string;
  /** Short label for narrow screens. */
  abbr?: string;
  /** Tooltip (e.g. Ukrainian case name). */
  title?: string;
  cells: (CellData | null)[];
}

export interface Section {
  key: string;
  title?: string;
  columns: GridColumn[];
  rows: GridRow[];
  /** Stressed Ukrainian text shown as a note row (e.g. analytic future). */
  note?: { label: string; text: string };
}

export interface MergedCell {
  col: number;
  colSpan: number;
  rowSpan: number;
  data: CellData | null;
}

export interface MergedRow extends Omit<GridRow, 'cells'> {
  cells: MergedCell[];
}

export interface MergedSection extends Omit<Section, 'rows'> {
  rows: MergedRow[];
}

export interface ExtraLine {
  slot: SlotKey;
  label: string;
  forms: Form[];
}

export interface TableLayout {
  kind: 'noun' | 'adjectival' | 'verb';
  sections: MergedSection[];
  /** Short form, comparative, superlative and any slots the layout does not place. */
  extras: ExtraLine[];
}

// ───────────────────────────── merging ─────────────────────────────

/** Identity of a cell's content; null for empty cells (empty cells never merge). */
export function contentKey(cell: CellData | null | undefined): string | null {
  if (!cell || cell.forms.length === 0) return null;
  return cell.forms.map((f) => `${f.form}|${(f.tags ?? []).join(',')}`).join(';');
}

interface Seg extends MergedCell {
  key: string | null;
  lastRow: number;
}

/**
 * Merge identical adjacent cells: first horizontally (colspan) within each row, then vertically (rowspan)
 * between segments with the same start column, the same column span and identical content.
 * Returns, per row, only the cells that are rendered (covered cells omitted).
 */
export function mergeGrid(rows: readonly (readonly (CellData | null)[])[]): MergedCell[][] {
  const out: Seg[][] = [];
  let open = new Map<number, Seg>();
  rows.forEach((cells, r) => {
    // 1. horizontal
    const segs: Seg[] = [];
    for (let c = 0; c < cells.length; ) {
      const key = contentKey(cells[c]);
      let span = 1;
      const slots = [...(cells[c]?.slots ?? [])];
      while (key !== null && c + span < cells.length && contentKey(cells[c + span]) === key) {
        slots.push(...(cells[c + span]?.slots ?? []));
        span++;
      }
      const data = cells[c] ? { slots, forms: cells[c]!.forms } : null;
      segs.push({ col: c, colSpan: span, rowSpan: 1, data, key, lastRow: r });
      c += span;
    }
    // 2. vertical
    const rowOut: Seg[] = [];
    const nextOpen = new Map<number, Seg>();
    for (const s of segs) {
      const above = open.get(s.col);
      if (above && above.key !== null && above.key === s.key && above.colSpan === s.colSpan && above.lastRow === r - 1) {
        above.rowSpan++;
        above.lastRow = r;
        if (above.data && s.data) above.data = { slots: [...above.data.slots, ...s.data.slots], forms: above.data.forms };
        nextOpen.set(s.col, above);
      } else {
        rowOut.push(s);
        nextOpen.set(s.col, s);
      }
    }
    open = nextOpen;
    out.push(rowOut);
  });
  return out.map((row) => row.map(({ col, colSpan, rowSpan, data }) => ({ col, colSpan, rowSpan, data })));
}

/** Drop rows whose cells are all empty and columns that are empty in every row. */
export function pruneSection(s: Section): Section | null {
  const nonEmpty = (c: CellData | null) => !!c && c.forms.length > 0;
  const keepCols = s.columns.map((_, i) => s.rows.some((r) => nonEmpty(r.cells[i])));
  const rows = s.rows
    .filter((r) => r.cells.some(nonEmpty))
    .map((r) => ({ ...r, cells: r.cells.filter((_, i) => keepCols[i]) }));
  if (rows.length === 0 && !s.note) return null;
  return { ...s, columns: s.columns.filter((_, i) => keepCols[i]), rows };
}

export function mergeSection(s: Section): MergedSection {
  const merged = mergeGrid(s.rows.map((r) => r.cells));
  return { ...s, rows: s.rows.map((r, i) => ({ ...r, cells: merged[i] })) };
}

// ───────────────────────────── layouts ─────────────────────────────

type Forms = Paradigm['forms'];

function cell(forms: Forms, slot: SlotKey, used: Set<SlotKey>): CellData | null {
  const f = forms[slot];
  if (!f || f.length === 0) return null;
  used.add(slot);
  return { slots: [slot], forms: f };
}

function caseRow(c: CaseKey, cells: (CellData | null)[], key: string = c, suffix = ''): GridRow {
  const l = CASE_LABELS[c];
  return { key, label: l.en + suffix, abbr: l.abbr + suffix.replace('inanimate', 'inan.').replace('animate', 'anim.'), title: l.uk, cells };
}

const ADJ_COLS: GridColumn[] = [
  { key: 'm', label: 'masculine', abbr: 'm' },
  { key: 'n', label: 'neuter', abbr: 'n' },
  { key: 'f', label: 'feminine', abbr: 'f' },
  { key: 'pl', label: 'plural', abbr: 'pl' },
];

export function nounSection(forms: Forms, order: readonly CaseKey[], used: Set<SlotKey>): Section {
  const columns: GridColumn[] = [
    { key: 'sg', label: 'singular' },
    { key: 'pl', label: 'plural' },
  ];
  return {
    key: 'noun',
    columns,
    rows: order.map((c) => caseRow(c, columns.map((n) => cell(forms, `${c}.${n.key}`, used)))),
  };
}

export function adjectivalSection(forms: Forms, order: readonly CaseKey[], used: Set<SlotKey>): Section {
  const split = Object.keys(forms).some((k) => /^acc\.(m|n|f|pl)\.(anim|inan)$/.test(k));
  const rows: GridRow[] = [];
  for (const c of order) {
    if (c === 'acc' && split) {
      for (const anim of ['inan', 'anim'] as const) {
        const cells = ADJ_COLS.map((g) => cell(forms, `acc.${g.key}.${anim}`, used) ?? cell(forms, `acc.${g.key}`, used));
        rows.push(caseRow('acc', cells, `acc-${anim}`, anim === 'inan' ? ' inanimate' : ' animate'));
      }
    } else {
      rows.push(caseRow(c, ADJ_COLS.map((g) => cell(forms, `${c}.${g.key}`, used))));
    }
  }
  return { key: 'adjectival', columns: ADJ_COLS, rows };
}

const SG_PL: GridColumn[] = [
  { key: 'sg', label: 'singular' },
  { key: 'pl', label: 'plural' },
];
const ONE_COL: GridColumn[] = [{ key: 'v', label: '' }];
const PERSON_ROWS = [
  ['1', '1st person'],
  ['2', '2nd person'],
  ['3', '3rd person'],
] as const;

export function verbSections(forms: Forms, aspect: Aspect | undefined, used: Set<SlotKey>): Section[] {
  const c = (slot: SlotKey) => cell(forms, slot, used);
  const personal = (tense: 'pres' | 'fut'): GridRow[] =>
    PERSON_ROWS.map(([p, label]) => ({ key: `${tense}${p}`, label, abbr: `${p}`, cells: [c(`${tense}.${p}sg`), c(`${tense}.${p}pl`)] }));
  const hasFuture = Object.keys(forms).some((k) => k.startsWith('fut.'));
  const sections: Section[] = [
    { key: 'inf', title: 'Infinitive', columns: ONE_COL, rows: [{ key: 'inf', label: 'infinitive', cells: [c('inf')] }] },
    { key: 'pres', title: 'Present', columns: SG_PL, rows: personal('pres') },
    {
      key: 'fut',
      title: aspect === 'perfective' ? 'Future (simple)' : 'Future',
      columns: SG_PL,
      rows: personal('fut'),
      note:
        !hasFuture && aspect !== 'perfective'
          ? { label: 'compound future', text: 'бу́ду, бу́деш, бу́де, бу́демо, бу́дете, бу́дуть + infinitive' }
          : undefined,
    },
    {
      key: 'past',
      title: 'Past',
      columns: SG_PL,
      rows: [
        { key: 'past-m', label: 'masculine', abbr: 'm', cells: [c('past.m'), c('past.pl')] },
        { key: 'past-f', label: 'feminine', abbr: 'f', cells: [c('past.f'), c('past.pl')] },
        { key: 'past-n', label: 'neuter', abbr: 'n', cells: [c('past.n'), c('past.pl')] },
      ],
    },
    {
      key: 'imp',
      title: 'Imperative',
      columns: SG_PL,
      rows: [
        { key: 'imp1', label: '1st person', abbr: '1', cells: [c('imp.1sg'), c('imp.1pl')] },
        { key: 'imp2', label: '2nd person', abbr: '2', cells: [c('imp.2sg'), c('imp.2pl')] },
      ],
    },
    {
      key: 'ptcp',
      title: 'Participles',
      columns: ONE_COL,
      rows: [
        { key: 'pap', label: 'active present', cells: [c('ptcp.act.pres')] },
        { key: 'paa', label: 'active past', cells: [c('ptcp.act.past')] },
        { key: 'ppp', label: 'passive present', cells: [c('ptcp.pass.pres')] },
        { key: 'ppa', label: 'passive past', cells: [c('ptcp.pass.past')] },
      ],
    },
    {
      key: 'advp',
      title: 'Adverbial participles',
      columns: ONE_COL,
      rows: [
        { key: 'advp-pres', label: 'present', cells: [c('advp.pres')] },
        { key: 'advp-past', label: 'past', cells: [c('advp.past')] },
      ],
    },
    { key: 'impers', title: 'Impersonal', columns: ONE_COL, rows: [{ key: 'impers', label: 'impersonal', cells: [c('impers')] }] },
  ];
  return sections;
}

const ADJ_SLOT_RE = /^(nom|gen|dat|acc|ins|loc|voc)\.(m|n|f)(\.|$)/;

/** Which layout to use: verb tables by kind; noun vs adjectival by the slot shapes actually present. */
export function layoutKind(p: Paradigm): TableLayout['kind'] {
  if (p.kind === 'verb') return 'verb';
  if (p.kind === 'adjectival' || Object.keys(p.forms).some((k) => ADJ_SLOT_RE.test(k))) return 'adjectival';
  return 'noun';
}

const EXTRA_LABELS: Record<string, string> = { 'short.m': 'short form', cmp: 'comparative', sup: 'superlative' };

export function layoutParadigm(p: Paradigm, opts: { caseOrder: readonly CaseKey[]; aspect?: Aspect }): TableLayout {
  const kind = layoutKind(p);
  const used = new Set<SlotKey>();
  const raw =
    kind === 'verb'
      ? verbSections(p.forms, opts.aspect, used)
      : [kind === 'adjectival' ? adjectivalSection(p.forms, opts.caseOrder, used) : nounSection(p.forms, opts.caseOrder, used)];
  const sections = raw.map(pruneSection).filter((s): s is Section => s !== null).map(mergeSection);
  const extras: ExtraLine[] = [];
  for (const slot of ['short.m', 'cmp', 'sup']) {
    const f = p.forms[slot];
    if (f && f.length > 0) {
      used.add(slot);
      extras.push({ slot, label: EXTRA_LABELS[slot], forms: f });
    }
  }
  for (const [slot, f] of Object.entries(p.forms)) {
    if (!used.has(slot) && f && f.length > 0) extras.push({ slot, label: describeSlot(slot), forms: f });
  }
  return { kind, sections, extras };
}

/** True if any form in the cell matches the (search-key-normalized) query. */
export function cellMatches(data: CellData | null, key: string): boolean {
  return !!key && !!data && data.forms.some((f) => searchKey(f.form) === key);
}
