import fs from 'node:fs'; import readline from 'node:readline';
const want = new Set(process.argv.slice(3));
const rl = readline.createInterface({ input: fs.createReadStream(process.argv[2]) });
for await (const line of rl) {
  const m = line.match(/"word": "([^"]+)"/); if (!m || !want.has(m[1])) continue;
  const e = JSON.parse(line); if (!e.senses.some(s => !s.form_of)) continue;
  console.log('###', e.word, e.pos, JSON.stringify(e.head_templates?.map(h => h.expansion)));
  console.log((e.forms || []).map(f => `${f.form} [${(f.tags || []).join(',')}]${f.source ? '<' + f.source + '>' : ''}`).join(' | '));
}
