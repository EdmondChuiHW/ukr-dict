/**
 * Renders Ukrainian text without combining stress marks; stressed letters are coloured via the CSS Custom
 * Highlight API (global "stress" highlight), optionally plus a "search-match" range. Fallback: <span class="stress">.
 */
import { useLayoutEffect, useRef } from 'react';
import { normalizeApostrophes, parseStress } from '@ukdict/shared';
import { getHighlight, HIGHLIGHTS_SUPPORTED } from '../lib/highlight.ts';

interface Props {
  text: string;
  /** Search key to mark inside the text (compact result rows). */
  match?: string;
  className?: string;
  /** Defaults to "uk"; pass null for mixed English text (e.g. glosses). */
  lang?: string | null;
}

/** [start, end) of `key` inside `plain` (case/apostrophe-insensitive), or undefined. */
function findMatch(plain: string, key: string | undefined): [number, number] | undefined {
  if (!key) return undefined;
  const i = normalizeApostrophes(plain).toLowerCase().indexOf(key);
  return i < 0 ? undefined : [i, i + key.length];
}

export function Stressed({ text, match, className, lang = 'uk' }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const { text: plain, marks } = parseStress(text);
  const marksKey = marks.join(',');
  const range = findMatch(plain, match);
  const start = range?.[0] ?? -1;
  const end = range?.[1] ?? -1;

  useLayoutEffect(() => {
    if (!HIGHLIGHTS_SUPPORTED) return;
    const node = ref.current?.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE) return;
    const len = (node as Text).length;
    const stress = getHighlight('stress')!;
    const added: [Highlight, Range][] = [];
    for (const m of marksKey ? marksKey.split(',').map(Number) : []) {
      if (m >= len) continue;
      const r = new Range();
      r.setStart(node, m);
      r.setEnd(node, m + 1);
      stress.add(r);
      added.push([stress, r]);
    }
    if (start >= 0 && end <= len) {
      const hl = getHighlight('search-match')!;
      const r = new Range();
      r.setStart(node, start);
      r.setEnd(node, end);
      hl.add(r);
      added.push([hl, r]);
    }
    return () => {
      for (const [h, r] of added) h.delete(r);
    };
  }, [plain, marksKey, start, end]);

  if (HIGHLIGHTS_SUPPORTED) {
    return (
      <span ref={ref} className={className} lang={lang ?? undefined}>
        {plain}
      </span>
    );
  }
  // Fallback: wrap stressed characters (and the match) in spans.
  const markSet = new Set(marks);
  const parts: React.ReactNode[] = [];
  let buf = '';
  let bufMatch = false;
  const flush = (k: number) => {
    if (buf) parts.push(bufMatch ? <mark key={k} className="match">{buf}</mark> : buf);
    buf = '';
  };
  for (let i = 0; i < plain.length; i++) {
    const inMatch = i >= start && i < end;
    if (markSet.has(i)) {
      flush(i * 2);
      const s = (
        <span key={i * 2 + 1} className="stress">
          {plain[i]}
        </span>
      );
      parts.push(inMatch ? <mark key={`m${i}`} className="match">{s}</mark> : s);
      bufMatch = inMatch;
      continue;
    }
    if (inMatch !== bufMatch) {
      flush(i * 2);
      bufMatch = inMatch;
    }
    buf += plain[i];
  }
  flush(plain.length * 2 + 2);
  return (
    <span className={className} lang={lang ?? undefined}>
      {parts}
    </span>
  );
}
