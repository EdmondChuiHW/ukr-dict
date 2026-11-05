/** Which paradigm slots / extra forms of an entry match a search key (for form-match badges + cell highlight). */
import { searchKey } from '@ukdict/shared';
import type { Entry, ExtraForm, SlotKey } from '@ukdict/shared';

export interface FormMatch {
  slots: SlotKey[];
  /** The matching stressed spelling (first one found). */
  form?: string;
  extra: ExtraForm[];
}

export function matchEntryForms(entry: Entry, key: string): FormMatch {
  const res: FormMatch = { slots: [], extra: [] };
  if (!key) return res;
  for (const [slot, forms] of Object.entries(entry.paradigm?.forms ?? {})) {
    for (const f of forms ?? []) {
      if (searchKey(f.form) === key) {
        if (!res.slots.includes(slot)) res.slots.push(slot);
        res.form ??= f.form;
      }
    }
  }
  for (const x of entry.extraForms ?? []) {
    if (searchKey(x.form) === key) {
      res.extra.push(x);
      res.form ??= x.form;
    }
  }
  return res;
}
