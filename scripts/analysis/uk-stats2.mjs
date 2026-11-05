import fs from 'node:fs';
import readline from 'node:readline';
const rl = readline.createInterface({ input: fs.createReadStream(process.argv[2]), crlfDelay: Infinity });
const c = (m, k, n = 1) => m.set(k, (m.get(k) || 0) + n);
const headFormTags = new Map(), foTags = new Map(), canonTags = new Map(), soundTags = new Map(), relKeys = new Map(), synKeys = new Map();
const samples = { noTableNoun: [], synonyms: [], related: [], nestedGloss: [], alt: [], verbAspect: [], sounds: [], derivedSense: [], examples: [], dupWords: [] };
const words = new Map();
for await (const line of rl) {
  const e = JSON.parse(line);
  const key = e.word + '|' + e.pos; c(words, key);
  for (const f of e.forms || []) {
    if (!f.source) { const t = (f.tags || []).slice().sort().join(','); if ((f.tags||[]).includes('canonical')) c(canonTags, e.pos + ':' + t); else c(headFormTags, e.pos + ':' + t); }
  }
  const senses = e.senses || [];
  for (const s of senses) {
    if (s.form_of) c(foTags, (s.tags || []).filter(t => t !== 'form-of').sort().join(','));
    if (s.glosses && s.glosses.length > 1 && samples.nestedGloss.length < 6) samples.nestedGloss.push({ w: e.word, g: s.glosses, raw: s.raw_glosses, tags: s.tags });
    if (s.alt_of && samples.alt.length < 3) samples.alt.push({ w: e.word, s });
    if (s.synonyms && samples.synonyms.length < 4) samples.synonyms.push({ w: e.word, g: s.glosses, syn: s.synonyms });
    if (s.synonyms) for (const x of s.synonyms) for (const k of Object.keys(x)) c(synKeys, k);
    if (s.examples && samples.examples.length < 4) samples.examples.push({ w: e.word, ex: s.examples });
    if (s.derived && samples.derivedSense.length < 2) samples.derivedSense.push({ w: e.word, d: s.derived.slice(0, 5) });
  }
  for (const k of ['related', 'derived', 'synonyms']) if (e[k]) for (const x of e[k]) for (const kk of Object.keys(x)) c(relKeys, k + '.' + kk);
  if (e.related && samples.related.length < 3) samples.related.push({ w: e.word, r: e.related.slice(0, 5) });
  if (e.pos === 'verb' && samples.verbAspect.length < 4 && Math.random() < 0.01) samples.verbAspect.push({ w: e.word, ht: e.head_templates, hforms: (e.forms || []).filter(f => !f.source) });
  for (const s of e.sounds || []) c(soundTags, Object.keys(s).sort().join(',') + '|' + (s.tags || []).join(','));
  if (e.sounds && e.sounds.some(s => s.mp3_url) && samples.sounds.length < 2) samples.sounds.push({ w: e.word, s: e.sounds });
  const hasTable = (e.forms || []).some(f => f.source);
  const foOnly = senses.length && senses.every(s => s.form_of);
  if (!hasTable && !foOnly && e.pos === 'noun' && samples.noTableNoun.length < 6) samples.noTableNoun.push({ w: e.word, ht: e.head_templates?.map(h => h.expansion), g: senses.map(s => s.glosses?.join(' > ')).slice(0, 2), forms: e.forms });
}
const top = (m, k = 60) => [...m].sort((a, b) => b[1] - a[1]).slice(0, k);
const dups = [...words].filter(([k, v]) => v > 1);
console.log(JSON.stringify({ headFormTags: top(headFormTags, 50), canonTags: top(canonTags, 50), foTags: top(foTags, 80), soundTags: top(soundTags, 20), relKeys: top(relKeys), synKeys: top(synKeys), dupCount: dups.length, dupSample: dups.slice(0, 10) }));
console.log(JSON.stringify(samples));
