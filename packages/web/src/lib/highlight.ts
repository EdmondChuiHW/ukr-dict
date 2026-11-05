/**
 * CSS Custom Highlight API registry: one global `Highlight` per name ("stress", "search-match").
 * Components add/remove their Ranges; styling is done with ::highlight(stress) etc. in styles.css.
 */

export const HIGHLIGHTS_SUPPORTED: boolean =
  typeof CSS !== 'undefined' && 'highlights' in CSS && typeof (globalThis as { Highlight?: unknown }).Highlight === 'function';

const registry = new Map<string, Highlight>();

export function getHighlight(name: 'stress' | 'search-match'): Highlight | undefined {
  if (!HIGHLIGHTS_SUPPORTED) return undefined;
  let h = registry.get(name);
  if (!h) {
    h = new Highlight();
    if (name === 'search-match') h.priority = 1;
    CSS.highlights.set(name, h);
    registry.set(name, h);
  }
  return h;
}
