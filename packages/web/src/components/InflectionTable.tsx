import { CASE_ORDER_GROUPED, CASE_ORDER_TRADITIONAL, describeSlot, tagLabel } from '@ukdict/shared';
import type { Entry, Form } from '@ukdict/shared';
import { cellMatches, layoutParadigm } from '../lib/table.ts';
import type { MergedCell, MergedSection } from '../lib/table.ts';
import { setCaseOrder, useSettings } from '../lib/settings.ts';
import { Stressed } from './Stressed.tsx';

interface Props {
  entry: Entry;
  /** Highlight cells whose forms match this search key (form matches). */
  matchKey?: string;
  defaultOpen: boolean;
}

function Forms({ forms }: { forms: Form[] }) {
  return (
    <>
      {forms.map((f, i) => (
        <span key={i} className={f.tags?.length ? 'variant qualified' : 'variant'}>
          <Stressed text={f.form} />
          {f.tags?.length ? <small className="qual">{f.tags.map(tagLabel).join(', ')}</small> : null}
          {i < forms.length - 1 ? <span className="sep">,</span> : null}
        </span>
      ))}
    </>
  );
}

function Cell({ cell, matchKey, spanFactor }: { cell: MergedCell; matchKey?: string; spanFactor: number }) {
  const colSpan = cell.colSpan * spanFactor;
  if (!cell.data) {
    return (
      <td className="empty" colSpan={colSpan > 1 ? colSpan : undefined} rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined}>
        —
      </td>
    );
  }
  const hit = !!matchKey && cellMatches(cell.data, matchKey);
  const merged = cell.colSpan > 1 || cell.rowSpan > 1;
  return (
    <td
      className={[hit ? 'hit' : '', merged ? 'merged' : ''].filter(Boolean).join(' ') || undefined}
      colSpan={colSpan > 1 ? colSpan : undefined}
      rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined}
      title={cell.data.slots.map(describeSlot).join(' · ')}
      data-slots={cell.data.slots.join(' ')}
    >
      <Forms forms={cell.data.forms} />
    </td>
  );
}

function RowHeader({ label, abbr, title }: { label: string; abbr?: string; title?: string }) {
  return (
    <th scope="row" title={title} className={abbr ? 'has-abbr' : undefined}>
      <span className="full">{label}</span>
      {abbr ? <span className="abbr">{abbr}</span> : null}
    </th>
  );
}

/** Noun / adjectival table: one section with a column header row. */
function CaseTable({ section, matchKey, kind }: { section: MergedSection; matchKey?: string; kind: string }) {
  return (
    <table className={`paradigm paradigm-${kind}`}>
      <thead>
        <tr>
          <td className="corner" />
          {section.columns.map((c) => (
            <th key={c.key} scope="col" className={c.abbr ? 'has-abbr' : undefined} title={c.abbr ? c.label : undefined}>
              <span className="full">{c.label}</span>
              {c.abbr ? <span className="abbr">{c.abbr}</span> : null}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {section.rows.map((r) => (
          <tr key={r.key}>
            <RowHeader label={r.label} abbr={r.abbr} title={r.title} />
            {r.cells.map((c) => (
              <Cell key={c.col} cell={c} matchKey={matchKey} spanFactor={1} />
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Verb table: label column + up to two data columns (singular / plural); one tbody per section. */
function VerbTable({ sections, matchKey }: { sections: MergedSection[]; matchKey?: string }) {
  return (
    <table className="paradigm paradigm-verb">
      {sections.map((s) => {
        const two = s.columns.length === 2;
        return (
          <tbody key={s.key} className={`sec sec-${s.key}`}>
            <tr className="sec-head">
              {two ? (
                <>
                  <th scope="colgroup">{s.title}</th>
                  {s.columns.map((c) => (
                    <th key={c.key} scope="col" className="col-label">
                      {c.label}
                    </th>
                  ))}
                </>
              ) : (
                <th scope="colgroup" colSpan={3}>
                  {s.title}
                  {s.columns.length === 1 && s.columns[0].label ? <span className="col-label"> · {s.columns[0].label}</span> : null}
                </th>
              )}
            </tr>
            {s.rows.map((r) => (
              <tr key={r.key}>
                <RowHeader label={r.label} abbr={r.abbr} title={r.title} />
                {r.cells.map((c) => (
                  <Cell key={c.col} cell={c} matchKey={matchKey} spanFactor={two ? 1 : 2} />
                ))}
              </tr>
            ))}
            {s.note ? (
              <tr className="note-row">
                <th scope="row">{s.note.label}</th>
                <td colSpan={2}>
                  <Stressed text={s.note.text} />
                </td>
              </tr>
            ) : null}
          </tbody>
        );
      })}
    </table>
  );
}

export function InflectionTable({ entry, matchKey, defaultOpen }: Props) {
  const { caseOrder } = useSettings();
  const p = entry.paradigm;
  if (!p || Object.keys(p.forms).length === 0) return null;
  const layout = layoutParadigm(p, {
    caseOrder: caseOrder === 'traditional' ? CASE_ORDER_TRADITIONAL : CASE_ORDER_GROUPED,
    aspect: entry.aspect,
  });
  if (layout.sections.length === 0 && layout.extras.length === 0) return null;
  const title = layout.kind === 'verb' ? 'Conjugation' : 'Declension';
  const source = p.source === 'lcorp' ? 'Словники України (lcorp)' : p.source === 'wiktionary' || p.source === 'kaikki' ? 'Wiktionary' : p.source;
  const extrasHit = !!matchKey && layout.extras.some((x) => cellMatches({ slots: [x.slot], forms: x.forms }, matchKey));
  return (
    <details className="inflection" open={defaultOpen}>
      <summary>
        <span className="summary-title">{title}</span>
        <span className="summary-meta">Inflection: {source}</span>
      </summary>
      {layout.sections.length > 0 ? (
        <div className="table-scroll">
          {layout.kind === 'verb' ? (
            <VerbTable sections={layout.sections} matchKey={matchKey} />
          ) : (
            <CaseTable section={layout.sections[0]} matchKey={matchKey} kind={layout.kind} />
          )}
        </div>
      ) : null}
      {layout.extras.length > 0 ? (
        <dl className={extrasHit ? 'extras has-hit' : 'extras'}>
          {layout.extras.map((x) => (
            <div key={x.slot} className={matchKey && cellMatches({ slots: [x.slot], forms: x.forms }, matchKey) ? 'hit' : undefined}>
              <dt>{x.label}</dt>
              <dd>
                <Forms forms={x.forms} />
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      <div className="table-foot">
        <span className="muted">{p.notes?.length ? p.notes.join('; ') : ''}</span>
        {layout.kind !== 'verb' ? (
          <span className="case-order" role="group" aria-label="Case order">
            <span className="muted">Case order:</span>
            <button type="button" aria-pressed={caseOrder === 'grouped'} onClick={() => setCaseOrder('grouped')} title="nominative, accusative, genitive, dative, instrumental, locative, vocative">
              N A G D I L V
            </button>
            <button type="button" aria-pressed={caseOrder === 'traditional'} onClick={() => setCaseOrder('traditional')} title="Traditional order: nominative, genitive, dative, accusative, instrumental, locative, vocative">
              N G D A I L V
            </button>
          </span>
        ) : null}
      </div>
    </details>
  );
}
