import fs from 'node:fs';
import readline from 'node:readline';
const file = process.argv[2];
const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
const c = (m, k, n = 1) => m.set(k, (m.get(k) || 0) + n);
const topKeys = new Map(), pos = new Map(), senseKeys = new Map(), formTags = new Map(), formSources = new Map(), soundKeys = new Map(), tagsAll = new Map(), headTpl = new Map(), langCodes = new Map();
let n = 0, formOfOnly = 0, mixed = 0, hasDecl = 0, hasConj = 0, noTable = 0, cyrLinks = 0, withSounds = 0, withAudio = 0, examples = 0, hasDerived = 0, hasSyn = 0, senseSyn = 0;
const noTableByPos = new Map(), formOfOnlyByPos = new Map(), samplesFormOf = [], sampleCyrLinks = [], sampleMixed = [];
for await (const line of rl) {
  if (!line) continue; n++;
  const e = JSON.parse(line);
  c(langCodes, e.lang_code);
  for (const k of Object.keys(e)) c(topKeys, k);
  c(pos, e.pos);
  for (const h of e.head_templates || []) c(headTpl, h.name);
  const senses = e.senses || [];
  let fo = 0;
  for (const s of senses) {
    for (const k of Object.keys(s)) c(senseKeys, k);
    for (const t of s.tags || []) c(tagsAll, t);
    if (s.form_of || (s.tags || []).includes('form-of')) fo++;
    if (s.examples) examples += s.examples.length;
    if (s.synonyms) senseSyn++;
    for (const l of s.links || []) if (/[Ѐ-ӿ]/.test(l[0])) { cyrLinks++; if (sampleCyrLinks.length < 8) sampleCyrLinks.push({ w: e.word, g: s.glosses, l }); }
  }
  if (senses.length && fo === senses.length) { formOfOnly++; c(formOfOnlyByPos, e.pos); if (samplesFormOf.length < 5) samplesFormOf.push({ w: e.word, pos: e.pos, senses: senses.map(s => ({ g: s.glosses, t: s.tags, fo: s.form_of })) }); }
  else if (fo > 0) { mixed++; if (sampleMixed.length < 5) sampleMixed.push({ w: e.word, pos: e.pos, senses: senses.map(s => ({ g: s.glosses, t: s.tags, fo: s.form_of })) }); }
  let d = false, cj = false;
  for (const f of e.forms || []) {
    c(formSources, f.source || '(none)');
    if (f.source === 'declension') d = true;
    if (f.source === 'conjugation') cj = true;
    if (f.source) c(formTags, (f.source) + ':' + (f.tags || []).slice().sort().join(','));
  }
  if (d) hasDecl++; if (cj) hasConj++;
  if (!d && !cj && !(senses.length && fo === senses.length)) { noTable++; c(noTableByPos, e.pos); }
  if (e.sounds) { withSounds++; for (const s of e.sounds) for (const k of Object.keys(s)) c(soundKeys, k); if (e.sounds.some(s => s.mp3_url || s.ogg_url)) withAudio++; }
  if (e.derived) hasDerived++; if (e.synonyms) hasSyn++;
}
const top = (m, k = 50) => [...m].sort((a, b) => b[1] - a[1]).slice(0, k);
console.log(JSON.stringify({ n, langCodes: top(langCodes), formOfOnly, mixed, hasDecl, hasConj, noTable, withSounds, withAudio, examples, cyrLinks, hasDerived, hasSyn, senseSyn,
  topKeys: top(topKeys), pos: top(pos), senseKeys: top(senseKeys), formSources: top(formSources), soundKeys: top(soundKeys), headTpl: top(headTpl, 40),
  tags: top(tagsAll, 80), noTableByPos: top(noTableByPos), formOfOnlyByPos: top(formOfOnlyByPos) }));
console.log('FORMTAGS', JSON.stringify(top(formTags, 200)));
console.log('SAMPLES', JSON.stringify({ samplesFormOf, sampleMixed, sampleCyrLinks }));
