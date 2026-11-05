/**
 * Plugin registry. Plugins run after entries are ranked and have ids (before validation and emission).
 * To add a plugin: implement `PipelinePlugin` (contracts.ts) in this directory and append it to `plugins`.
 */
import type { Attribution, Entry } from '@ukdict/shared';
import type { PipelineConfig, PipelineContext, PipelinePlugin, Progress } from '../contracts.ts';
import { exampleSentencesPlugin } from './example-sentences.ts';

export const plugins: PipelinePlugin[] = [exampleSentencesPlugin];

export function buildByKey(entries: readonly Entry[]): Map<string, Entry[]> {
  const m = new Map<string, Entry[]>();
  for (const e of entries) {
    let l = m.get(e.key);
    if (!l) m.set(e.key, (l = []));
    l.push(e);
  }
  return m;
}

/** Runs plugins sequentially; returns attributions added by them. */
export async function runPlugins(
  list: readonly PipelinePlugin[],
  args: { config: PipelineConfig; entries: Entry[]; progress: Progress; log: (m: string) => void },
): Promise<{ attributions: Attribution[]; ran: string[] }> {
  const attributions: Attribution[] = [];
  const ctx: PipelineContext = {
    config: args.config,
    entries: args.entries,
    byKey: buildByKey(args.entries),
    progress: args.progress,
    addAttribution(a) {
      if (!attributions.some((x) => x.id === a.id)) attributions.push(a);
    },
    log: args.log,
  };
  const ran: string[] = [];
  for (const p of list) {
    await p.enrich(ctx);
    ran.push(p.id);
  }
  return { attributions, ran };
}
