/**
 * Parser for lcorp.ulif.org.ua ("Словники України online") result pages.
 *
 * Pages are ASP.NET WebForms documents. The article lives in
 * `<div id="ContentPlaceHolder1_article" class="articleContent">` and contains a `<style>` block, the stressed
 * headword (`span.word_style`, homonyms carry a trailing number "стіл 2"), the grammatical label
 * (`span.gram_style`, "– іменник чоловічого роду"), an optional sense hint (`div.comment_style`, "(престол)"),
 * the inflection `<table>` and an optional end note (`p.comm_end_style`).
 *
 * Everything here is pure string processing (no DOM): a tiny tag tokenizer is enough for these tables and
 * tolerant of the stray tags lcorp emits (`<body>`, `</font></h4>`, unmatched `</span>`).
 */
import { ADJ_SLOTS, NOUN_SLOTS, VERB_SLOTS, type CaseKey, type Animacy, type Aspect, type Form, type Gender, type PartOfSpeech, type Paradigm, type ParadigmKind, type SlotKey } from '@ukdict/shared';
import type { LcorpEntry } from '../../contracts.ts';

/** Bump whenever parse output changes; cached records with an older version are re-parsed from stored HTML. */
export const LCORP_PARSER_VERSION = 1;

export interface LcorpArticle {
  /** Stressed headword, homonym number removed (NFC). */
  headword: string;
  /** Homonym index shown by lcorp ("стіл 2" → 2). */
  homonym?: number;
  /** Grammatical label without the leading dash, e.g. "іменник чоловічого роду, істота". */
  gram: string;
  /** The inflection `<table>…</table>` (empty string if the article has no table). */
  tableHtml: string;
  /** Sense hint shown under the headword, e.g. "(престол)". */
  comment?: string;
  /** Note below the table, e.g. "[вживається також як сполучне слово]". */
  endNote?: string;
}

export interface LcorpPage {
  article?: LcorpArticle;
  /** Inner HTML of the article container with the `<style>` block removed ('' when absent/empty). */
  articleHtml: string;
  /** The article container exists but holds no article (lcorp does this e.g. for personal pronouns). */
  emptyArticle: boolean;
  /** Position of the current article in the alphabetical registry. */
  centerOrder?: number;
  currentUid?: number;
  /** Text of `span#ContentPlaceHolder1_searchMessage` (usually empty). */
  searchMessage?: string;
  /** All `<input type="hidden">` fields (name → decoded value), to be chained into the next postback. */
  hidden: Record<string, string>;
  /** True when the page carries a viewstate (i.e. it is a normal WebForms page, not an error page). */
  valid: boolean;
}

// ───────────────────────────── HTML helpers ─────────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  ndash: '–',
  mdash: '—',
  laquo: '«',
  raquo: '»',
  rsquo: '’',
  lsquo: '‘',
  hellip: '…',
  shy: '',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return m;
      return code === 0xa0 ? ' ' : String.fromCodePoint(code);
    }
    const v = NAMED_ENTITIES[body.toLowerCase()];
    return v === undefined ? m : v;
  });
}

/** Strip tags, decode entities, collapse whitespace (incl. NBSP), trim, NFC. */
export function cleanText(html: string): string {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ''))
    .replace(/[\s\u200b]+/g, ' ')
    .trim()
    .normalize('NFC');
}

function parseAttrs(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([^\s=<>"'\/]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  // skip the tag name
  const start = tag.search(/\s/);
  if (start < 0) return attrs;
  const body = tag.slice(start).replace(/\/?>$/, '');
  for (const m of body.matchAll(re)) {
    attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

export function parseHiddenFields(html: string): Record<string, string> {
  const hidden: Record<string, string> = {};
  for (const m of html.matchAll(/<input\b[^>]*>/gi)) {
    const a = parseAttrs(m[0]);
    if ((a.type ?? '').toLowerCase() !== 'hidden' || !a.name) continue;
    hidden[a.name] = a.value ?? '';
  }
  return hidden;
}

function hiddenBySuffix(hidden: Record<string, string>, suffix: string): string | undefined {
  for (const [k, v] of Object.entries(hidden)) if (k.endsWith(suffix)) return v;
  return undefined;
}

function toInt(s: string | undefined): number | undefined {
  if (s === undefined || s.trim() === '') return undefined;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : undefined;
}

/** Inner HTML of the element whose opening tag starts at `openIdx` (div nesting aware). */
function innerDiv(html: string, openIdx: number): string {
  const openEnd = html.indexOf('>', openIdx);
  if (openEnd < 0) return '';
  const re = /<(\/?)div\b[^>]*>/gi;
  re.lastIndex = openEnd + 1;
  let depth = 1;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(openEnd + 1, m.index);
  }
  // Unbalanced markup: fall back to the timer span that follows the article.
  const stop = html.indexOf('ContentPlaceHolder1_cbtimer', openEnd);
  return html.slice(openEnd + 1, stop > 0 ? stop : undefined);
}

/** Remove `<style>` blocks, comments and scripts from article HTML. */
export function stripArticleChrome(html: string): string {
  return html
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();
}

// ───────────────────────────── page / article ─────────────────────────────

export function parseLcorpPage(html: string): LcorpPage {
  const hidden = parseHiddenFields(html);
  const centerOrder = toInt(hiddenBySuffix(hidden, '$registryCenterOrder'));
  const currentUid = toInt(hiddenBySuffix(hidden, '$registryCurrentUid'));
  const msgMatch = /id="ContentPlaceHolder1_searchMessage"[^>]*>([\s\S]*?)<\/span>/i.exec(html);
  const searchMessage = msgMatch ? cleanText(msgMatch[1]) : undefined;
  const idx = html.search(/<div\b[^>]*id="ContentPlaceHolder1_article"/i);
  const articleHtml = idx >= 0 ? stripArticleChrome(innerDiv(html, idx)) : '';
  const article = articleHtml ? extractLcorpArticle(articleHtml) : undefined;
  return {
    article,
    articleHtml,
    emptyArticle: idx >= 0 && !article && cleanText(articleHtml) === '',
    centerOrder,
    currentUid,
    searchMessage: searchMessage || undefined,
    hidden,
    valid: typeof hidden.__VIEWSTATE === 'string' && hidden.__VIEWSTATE.length > 0,
  };
}

/** Split "стіл 2" → { headword: "стіл", homonym: 2 }. */
export function splitHomonym(raw: string): { headword: string; homonym?: number } {
  const t = raw.trim().normalize('NFC');
  const m = /^(.*\S)\s+(\d+)$/.exec(t);
  return m ? { headword: m[1], homonym: Number(m[2]) } : { headword: t };
}

/** Extract headword / gram / table from article inner HTML (as returned by parseLcorpPage or stored in the cache). */
export function extractLcorpArticle(articleHtml: string): LcorpArticle | undefined {
  const html = stripArticleChrome(articleHtml);
  const hw = /<span\b[^>]*class\s*=\s*"word_style"[^>]*>([\s\S]*?)<\/span>/i.exec(html);
  if (!hw) return undefined;
  const { headword, homonym } = splitHomonym(cleanText(hw[1]));
  if (!headword) return undefined;
  const gramM = /<span\b[^>]*class\s*=\s*"gram_style"[^>]*>([\s\S]*?)<\/span>/i.exec(html);
  const gram = gramM ? cleanText(gramM[1]).replace(/^[–—\-‒]\s*/, '').trim() : '';
  const commentM = /<div\b[^>]*class\s*=\s*"comment_style"[^>]*>([\s\S]*?)(?:<hr\b[^>]*>|<\/div>)/i.exec(html);
  const comment = commentM ? cleanText(commentM[1]) : '';
  const endM = /<p\b[^>]*class\s*=\s*"comm_end_style"[^>]*>([\s\S]*?)<\/p>/i.exec(html);
  const endNote = endM ? cleanText(endM[1]) : '';
  const tableM = /<table\b[\s\S]*?<\/table>/i.exec(html);
  return {
    headword,
    ...(homonym !== undefined ? { homonym } : {}),
    gram,
    tableHtml: tableM ? tableM[0] : '',
    ...(comment ? { comment } : {}),
    ...(endNote ? { endNote } : {}),
  };
}

// ───────────────────────────── table grid ─────────────────────────────

export interface TableCell {
  text: string;
  /** 'header' (td_style), 'label' (td_left_style), 'value' (td_inner_*), '' unknown. */
  role: 'header' | 'label' | 'value' | '';
  colspan: number;
  rowspan: number;
}

function cellRole(cls: string, rowCls: string): TableCell['role'] {
  const c = cls.toLowerCase();
  if (/\btd_left_style\b/.test(c)) return 'label';
  if (/\btd_inner(_center)?_style\b/.test(c)) return 'value';
  if (/\btd_style\b/.test(c)) return 'header';
  if (/\btd_style\b/.test(rowCls.toLowerCase())) return 'header';
  return '';
}

/** Tokenize a `<table>` into logical rows of cells (spans not expanded). */
export function parseTableRows(tableHtml: string): TableCell[][] {
  const rows: TableCell[][] = [];
  let row: TableCell[] | null = null;
  let rowCls = '';
  let cell: { attrs: Record<string, string>; start: number } | null = null;
  const closeCell = (end: number) => {
    if (!cell) return;
    if (!row) {
      row = [];
      rows.push(row);
    }
    const a = cell.attrs;
    row.push({
      text: cleanText(tableHtml.slice(cell.start, end)),
      role: cellRole(a.class ?? '', rowCls),
      colspan: Math.max(1, toInt(a.colspan) ?? 1),
      rowspan: Math.max(1, toInt(a.rowspan) ?? 1),
    });
    cell = null;
  };
  const re = /<(\/?)(tr|td|th|table)\b[^>]*>/gi;
  for (let m = re.exec(tableHtml); m; m = re.exec(tableHtml)) {
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    if (tag === 'table') {
      if (closing) closeCell(m.index);
      continue;
    }
    if (tag === 'tr') {
      closeCell(m.index);
      if (!closing) {
        row = [];
        rows.push(row);
        rowCls = parseAttrs(m[0]).class ?? '';
      } else {
        row = null;
        rowCls = '';
      }
      continue;
    }
    // td / th
    closeCell(m.index);
    if (!closing) cell = { attrs: parseAttrs(m[0]), start: m.index + m[0].length };
  }
  closeCell(tableHtml.length);
  return rows.filter((r) => r.length > 0);
}

/** Expand colspan/rowspan into a rectangular grid of cell references. */
export function expandGrid(rows: TableCell[][]): (TableCell | undefined)[][] {
  const grid: (TableCell | undefined)[][] = [];
  rows.forEach((r, ri) => {
    grid[ri] ??= [];
    let c = 0;
    for (const cell of r) {
      while (grid[ri][c]) c++;
      for (let dr = 0; dr < cell.rowspan; dr++) {
        grid[ri + dr] ??= [];
        for (let dc = 0; dc < cell.colspan; dc++) grid[ri + dr][c + dc] = cell;
      }
      c += cell.colspan;
    }
  });
  return grid.slice(0, rows.length);
}

// ───────────────────────────── cell values ─────────────────────────────

/** Prepositions lcorp prints in front of locative forms ("на/у столі́", "по Ки́єву", "при Собаке́вичеві"). */
const LOC_PREP_RE = /^(?:(?:на|у|в|по|при|о|об)(?:\/(?:на|у|в|по|при))*)\s+(?=\S)/iu;

/**
 * Split a cell into variant forms: comma/semicolon separated, `*` markers and bracketed remarks removed,
 * locative prepositions dropped. Multi-word variants ("до́ себе") are dropped (prepositional phrases).
 */
export function splitVariants(text: string, opts: { locative?: boolean } = {}): string[] {
  const t = cleanText(text);
  if (!t || /^[-–—\s]*$/.test(t)) return [];
  const out: string[] = [];
  for (let part of t.split(/\s*[,;]\s*/)) {
    part = part
      .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
      .replace(/[*†]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (opts.locative) part = part.replace(LOC_PREP_RE, '');
    part = part.trim();
    if (!part || /\s/.test(part) || /^[-–—]+$/.test(part)) continue;
    if (!out.includes(part)) out.push(part);
  }
  return out;
}

// ───────────────────────────── grammatical label ─────────────────────────────

export interface LcorpGram {
  pos?: PartOfSpeech;
  genders?: Gender[];
  animacy?: Animacy;
  aspect?: Aspect;
  number?: 'plural-only';
  /** True for "дієприкметник" (mapped to adjective). */
  participle?: boolean;
}

function isCapitalized(s: string | undefined): boolean {
  if (!s) return false;
  const ch = s.trim().charAt(0);
  return ch !== '' && ch === ch.toUpperCase() && ch !== ch.toLowerCase();
}

/** Map an lcorp grammatical label (+ headword for capitalization) to normalized POS / features. */
export function mapLcorpGram(gram: string, headword?: string): LcorpGram {
  const g = gram.toLowerCase().replace(/[’ʼ`]/g, "'").replace(/\s+/g, ' ').trim();
  const out: LcorpGram = {};
  // NB: `\b` is ASCII-only in JS regexes, so word boundaries are spelled out for Cyrillic.
  const name = /(^|[\s,(])ім'я($|[\s,)])/.test(g);
  const properName = name || /прізвище|по батькові|власн\S* назва|географічн\S* назва|топонім/.test(g);
  if (/дієприкметник/.test(g)) {
    out.pos = 'adjective';
    out.participle = true;
  } else if (properName) out.pos = 'proper-noun';
  else if (/іменник/.test(g)) out.pos = isCapitalized(headword) ? 'proper-noun' : 'noun';
  else if (/прикметник/.test(g)) out.pos = 'adjective';
  else if (/дієслово/.test(g)) out.pos = 'verb';
  else if (/числівник/.test(g)) out.pos = 'numeral';
  else if (/займенник/.test(g)) out.pos = 'pronoun';
  else if (/дієприслівник|прислівник/.test(g)) out.pos = 'adverb';
  else if (/прийменник/.test(g)) out.pos = 'preposition';
  else if (/сполучник/.test(g)) out.pos = 'conjunction';
  else if (/частка/.test(g)) out.pos = 'particle';
  else if (/вигук/.test(g)) out.pos = 'interjection';
  else if (/присудков/.test(g)) out.pos = 'predicative';

  const genders: Gender[] = [];
  if (/чоловіч/.test(g)) genders.push('m');
  if (/жіноч/.test(g)) genders.push('f');
  if (/середн/.test(g)) genders.push('n');
  if (/спільн\S* роду/.test(g)) for (const x of ['m', 'f'] as const) if (!genders.includes(x)) genders.push(x);
  if (genders.length && (out.pos === 'noun' || out.pos === 'proper-noun')) out.genders = genders;

  if (/множинн|тільки множ|лише множ|тільки у множ|лише у множ|pluralia/.test(g)) out.number = 'plural-only';

  if (out.pos === 'noun' || out.pos === 'proper-noun') {
    if (/неістота/.test(g)) out.animacy = 'inanimate';
    else if (/істота/.test(g) || name || /прізвище|по батькові/.test(g)) out.animacy = 'animate';
    else out.animacy = 'inanimate';
  }

  if (out.pos === 'verb') {
    const impf = /недоконан/.test(g);
    const pf = /(^|[^е])доконан/.test(g.replace(/недоконан/g, ''));
    if (impf && pf) out.aspect = 'biaspectual';
    else if (impf) out.aspect = 'imperfective';
    else if (pf) out.aspect = 'perfective';
  }
  return out;
}

// ───────────────────────────── paradigm ─────────────────────────────

const CASE_BY_LABEL: [RegExp, CaseKey][] = [
  [/^назив/, 'nom'],
  [/^родов/, 'gen'],
  [/^давальн/, 'dat'],
  [/^знахідн/, 'acc'],
  [/^орудн/, 'ins'],
  [/^місцев/, 'loc'],
  [/^клична?/, 'voc'],
];

function caseOf(label: string): CaseKey | undefined {
  const l = label.toLowerCase().trim();
  for (const [re, c] of CASE_BY_LABEL) if (re.test(l)) return c;
  return undefined;
}

type Col = 'sg' | 'pl' | 'm' | 'f' | 'n' | 'single';

function colOf(header: string): Col | undefined {
  const h = header.toLowerCase().replace(/\s+/g, ' ').trim();
  if (h === '' || h === 'відмінок') return h === '' ? 'single' : undefined;
  if (/^однин/.test(h)) return 'sg';
  if (/^множин/.test(h)) return 'pl';
  if (/^чол/.test(h)) return 'm';
  if (/^жін/.test(h)) return 'f';
  if (/^сер/.test(h)) return 'n';
  return undefined;
}

class FormsBuilder {
  forms: Record<SlotKey, Form[]> = {};
  add(slot: SlotKey, variants: string[]): void {
    if (!variants.length) return;
    const list = (this.forms[slot] ??= []);
    for (const v of variants) if (!list.some((f) => f.form === v)) list.push({ form: v });
  }
  get(slot: SlotKey): string[] {
    return (this.forms[slot] ?? []).map((f) => f.form);
  }
  delete(slot: SlotKey): void {
    delete this.forms[slot];
  }
  get size(): number {
    return Object.keys(this.forms).length;
  }
}

export interface TableParse {
  kind: ParadigmKind;
  forms: Record<SlotKey, Form[]>;
  /** Labels / headers that could not be mapped (for debugging). */
  unmapped: string[];
}

function isVerbTable(rows: TableCell[][]): boolean {
  return rows.some((r) => r.some((c) => /^(інфінітив|наказовий спосіб|минулий час|теперішній час|майбутній час)/i.test(c.text)));
}

/** Parse a declension/conjugation table into slot → forms. `numeral` makes single-column tables plural. */
export function parseLcorpTable(tableHtml: string, opts: { numeral?: boolean } = {}): TableParse | undefined {
  if (!tableHtml) return undefined;
  const rows = parseTableRows(tableHtml);
  if (!rows.length) return undefined;
  return isVerbTable(rows) ? parseVerbTable(rows) : parseNominalTable(rows, opts);
}

function parseNominalTable(rows: TableCell[][], opts: { numeral?: boolean }): TableParse {
  const grid = expandGrid(rows);
  const unmapped: string[] = [];
  const firstData = rows.findIndex((r) => r.length > 0 && caseOf(r[0].text) !== undefined);
  const headerGrid = firstData > 0 ? grid[firstData - 1] : [];
  const width = Math.max(...grid.map((r) => r.length));
  const cols: (Col | undefined)[] = [];
  for (let c = 1; c < width; c++) {
    const h = headerGrid?.[c];
    const col = h ? colOf(h.text) : 'single';
    if (h && col === undefined) unmapped.push(`header:${h.text}`);
    cols[c] = col;
  }
  const present = new Set(cols.filter(Boolean));
  const adjectival = present.has('f') || present.has('n');
  const kind: ParadigmKind = adjectival ? 'adjectival' : 'noun';
  const colKey = (col: Col | undefined): string | undefined => {
    if (!col) return undefined;
    if (adjectival) return col === 'sg' ? undefined : col === 'single' ? undefined : col;
    if (col === 'm' || col === 'sg') return 'sg';
    if (col === 'pl') return 'pl';
    if (col === 'single') return opts.numeral ? 'pl' : 'sg';
    return undefined;
  };
  const b = new FormsBuilder();
  for (let ri = Math.max(0, firstData); ri < rows.length; ri++) {
    const r = grid[ri];
    const label = r?.[0];
    if (!label) continue;
    const cs = caseOf(label.text);
    if (!cs) {
      if (label.text && label.role !== 'header') unmapped.push(`row:${label.text}`);
      continue;
    }
    for (let c = 1; c < r.length; c++) {
      const cell = r[c];
      if (!cell || cell === label) continue;
      const key = colKey(cols[c]);
      if (!key) continue;
      b.add(`${cs}.${key}`, splitVariants(cell.text, { locative: cs === 'loc' }));
    }
  }
  if (adjectival) splitAdjectivalAccusative(b);
  return { kind, forms: b.forms, unmapped };
}

/**
 * lcorp prints the adjectival accusative as one cell "зеле́ний, зеле́ного" (inanimate = nominative,
 * animate = genitive). Split it into `acc.X.inan` / `acc.X.anim` when both variants are present.
 */
function splitAdjectivalAccusative(b: FormsBuilder): void {
  for (const g of ['m', 'n', 'f', 'pl']) {
    const acc = b.get(`acc.${g}`);
    if (acc.length < 2) continue;
    const nom = new Set(b.get(`nom.${g}`));
    const gen = new Set(b.get(`gen.${g}`));
    const inan = acc.filter((f) => nom.has(f) && !gen.has(f));
    const anim = acc.filter((f) => gen.has(f) && !nom.has(f));
    if (!inan.length || !anim.length) continue;
    const rest = acc.filter((f) => !inan.includes(f) && !anim.includes(f));
    b.delete(`acc.${g}`);
    b.add(`acc.${g}.inan`, [...inan, ...rest]);
    b.add(`acc.${g}.anim`, [...anim, ...rest]);
  }
}

type VerbSection = 'imp' | 'fut' | 'pres' | 'past' | 'ptcp.act.pres' | 'ptcp.act.past' | 'ptcp.pass.pres' | 'ptcp.pass.past' | 'impers' | 'advp.pres' | 'advp.past';

function verbSection(text: string, seenPast: boolean): VerbSection | undefined {
  const t = text.toLowerCase();
  if (/наказов/.test(t)) return 'imp';
  if (/майбутн/.test(t)) return 'fut';
  if (/теперішн/.test(t)) return 'pres';
  if (/минул/.test(t)) return 'past';
  if (/активн\S*\s+дієприкметн/.test(t)) return seenPast ? 'ptcp.act.past' : 'ptcp.act.pres';
  if (/пасивн\S*\s+дієприкметн/.test(t)) return seenPast ? 'ptcp.pass.past' : 'ptcp.pass.pres';
  if (/безособов/.test(t)) return 'impers';
  if (/дієприслівн/.test(t)) return seenPast ? 'advp.past' : 'advp.pres';
  return undefined;
}

function parseVerbTable(rows: TableCell[][]): TableParse {
  const b = new FormsBuilder();
  const unmapped: string[] = [];
  let section: VerbSection | undefined;
  let seenPast = false;
  for (const r of rows) {
    const texts = r.map((c) => c.text);
    const first = texts[0] ?? '';
    if (/^інфінітив/i.test(first)) {
      b.add('inf', texts.slice(1).flatMap((t) => splitVariants(t)));
      continue;
    }
    if (r.length === 1) {
      const sec = r[0].role === 'value' ? undefined : verbSection(first, seenPast);
      if (sec) {
        section = sec;
        if (sec === 'past') seenPast = true;
        continue;
      }
      if (!first) continue;
      if (section && /^(ptcp|advp|impers)/.test(section)) b.add(section, splitVariants(first));
      else unmapped.push(`value:${first}`);
      continue;
    }
    if (texts.slice(1).some((t) => /^однин/i.test(t)) || texts.slice(1).some((t) => /^множин/i.test(t))) continue;
    const person = /^([123])\s*особ/i.exec(first);
    if (person && section && (section === 'imp' || section === 'fut' || section === 'pres')) {
      const p = person[1];
      b.add(`${section}.${p}sg`, splitVariants(texts[1] ?? ''));
      b.add(`${section}.${p}pl`, splitVariants(texts[2] ?? ''));
      continue;
    }
    const gender = /^(чол|жін|сер)/i.exec(first);
    if (gender && section === 'past') {
      const g = { чол: 'm', жін: 'f', сер: 'n' }[gender[1].toLowerCase() as 'чол' | 'жін' | 'сер'];
      b.add(`past.${g}`, splitVariants(texts[1] ?? ''));
      if (texts.length > 2) b.add('past.pl', splitVariants(texts[2] ?? ''));
      continue;
    }
    if (first) unmapped.push(`row:${first}`);
  }
  // Imperative 1sg does not exist in Ukrainian; lcorp leaves it empty — nothing to do. Keep slot order stable.
  return { kind: 'verb', forms: b.forms, unmapped };
}

// ───────────────────────────── entry ─────────────────────────────

/**
 * Build an `LcorpEntry` from article inner HTML (string) or an already extracted article.
 * Returns undefined when there is no recognizable article.
 */
export function parseLcorpArticle(input: string | LcorpArticle): LcorpEntry | undefined {
  const art = typeof input === 'string' ? extractLcorpArticle(input) : input;
  if (!art) return undefined;
  const gram = mapLcorpGram(art.gram, art.headword);
  const table = parseLcorpTable(art.tableHtml, { numeral: gram.pos === 'numeral' });
  let paradigm: Paradigm | undefined;
  if (table && Object.keys(table.forms).length > 0) {
    const notes = [art.gram, art.comment, art.endNote].filter((x): x is string => !!x);
    paradigm = { kind: table.kind, forms: orderForms(table.forms), source: 'lcorp', ...(notes.length ? { notes } : {}) };
  }
  const entry: LcorpEntry = { headword: art.headword, gram: art.gram };
  if (gram.pos) entry.pos = gram.pos;
  if (gram.genders) entry.genders = gram.genders;
  if (gram.animacy) entry.animacy = gram.animacy;
  if (gram.aspect) entry.aspect = gram.aspect;
  if (gram.number) entry.number = gram.number;
  if (paradigm) entry.paradigm = paradigm;
  return entry;
}

const SLOT_RANK: Map<string, number> = new Map();
for (const k of [...NOUN_SLOTS, ...ADJ_SLOTS, ...VERB_SLOTS]) if (!SLOT_RANK.has(k)) SLOT_RANK.set(k, SLOT_RANK.size);

/** Deterministic slot order (nice for diffs/debug output). */
function orderForms(forms: Record<SlotKey, Form[]>): Record<SlotKey, Form[]> {
  const keys = Object.keys(forms);
  const rank = (k: string) => SLOT_RANK.get(k) ?? 10_000 + keys.indexOf(k);
  const out: Record<SlotKey, Form[]> = {};
  for (const k of [...keys].sort((a, b) => rank(a) - rank(b))) out[k] = forms[k];
  return out;
}
