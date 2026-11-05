import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { englishQueryTokens, findBucket, searchKey, BUILTIN_ATTRIBUTIONS } from '@ukdict/shared';
import type { CoreFile, EnglishBucketFile, FormsBucketFile, Manifest, ShardFile, SummariesFile } from '@ukdict/shared';
import { emitWebArtifacts, gramLabel, summaryGloss, glossItems, entryEnglishWeights } from './web.ts';
import { buildBuckets } from './buckets.ts';
import { sampleEntries } from '../stages/_fixtures.ts';

async function readGz<T>(dir: string, rel: string): Promise<T> {
  return JSON.parse(gunzipSync(await readFile(join(dir, rel))).toString('utf8')) as T;
}

test('gramLabel', () => {
  assert.equal(gramLabel({ genders: ['f', 'm'], animacy: 'animate' }), 'm/f anim');
  assert.equal(gramLabel({ genders: ['m'], animacy: 'inanimate' }), 'm inan');
  assert.equal(gramLabel({ genders: ['f'], number: 'plural-only' }), 'f pl only');
  assert.equal(gramLabel({ aspect: 'biaspectual' }), 'impf/pf');
  assert.equal(gramLabel({ aspect: 'perfective' }), 'pf');
  assert.equal(gramLabel({}), '');
});

test('summaryGloss skips headers and truncates', () => {
  assert.equal(summaryGloss([{ gloss: '[with locative]', headerOnly: true, subsenses: [{ gloss: 'on' }, { gloss: 'after' }] }]), 'on; after');
  const long = 'a'.repeat(30) + ' ' + 'b'.repeat(80);
  const s = summaryGloss([{ gloss: long }]);
  assert.ok(s.length <= 100 && s.endsWith('…'), s);
});

test('glossItems / weights', () => {
  assert.deepEqual(glossItems('dog, hound (animal); cur'), ['dog', 'hound', 'cur']);
  const w = entryEnglishWeights([{ gloss: 'to sing' }, { gloss: 'to chant a long song' }]);
  assert.equal(w.get('sing'), 3);
  assert.equal(w.get('chant'), 1);
});

test('buildBuckets splits large buckets and routes every key', () => {
  const m = new Map<string, number[]>();
  for (let i = 0; i < 5000; i++) m.set(`с${String.fromCharCode(0x430 + (i % 20))}${i}`, [i]);
  m.set('с', [1]);
  m.set('а', [2]);
  const b = buildBuckets(m, { maxKeys: 1000, maxBytes: 1e9 });
  assert.ok(Object.keys(b).length > 3);
  let total = 0;
  for (const [p, obj] of Object.entries(b)) {
    for (const k of Object.keys(obj)) {
      assert.equal(findBucket(b, k), p);
      total++;
    }
  }
  assert.equal(total, m.size);
  assert.ok('с' in b['с']);
});

test('emitWebArtifacts round trip', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ukdict-web-'));
  try {
    await mkdir(join(dir, 'shards'), { recursive: true });
    await writeFile(join(dir, 'shards', 'stale.json.gz'), 'x');
    await writeFile(join(dir, 'core.deadbeef.json.gz'), 'x');
    await writeFile(join(dir, 'keep.txt'), 'x');
    const entries = sampleEntries();
    const manifest = await emitWebArtifacts(entries, {
      outDir: dir,
      shardSize: 2,
      attributions: BUILTIN_ATTRIBUTIONS,
      provenance: { test: 1 },
      ignoredCount: 7,
      bucketLimits: { maxKeys: 2, maxBytes: 1e9 },
    });
    const onDisk = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as Manifest;
    assert.deepEqual(onDisk, manifest);
    assert.equal(manifest.counts.entries, 5);
    assert.equal(manifest.counts.ignoredEntries, 7);
    assert.equal(manifest.files.shards.length, 3);
    const names = await readdir(dir);
    assert.ok(!names.includes('core.deadbeef.json.gz'));
    assert.ok(names.includes('keep.txt'));
    assert.deepEqual(await readdir(join(dir, 'shards')), manifest.files.shards.map((s) => s.path.split('/')[1]).sort());
    assert.match(manifest.files.core.path, /^core\.[0-9a-f]{8}\.json\.gz$/);

    const core = await readGz<CoreFile>(dir, manifest.files.core.path);
    assert.deepEqual(core.keys, [...core.keys].sort());
    const i = core.keys.indexOf('собака');
    assert.deepEqual(core.ids[i], [0]);

    const sums = await readGz<SummariesFile>(dir, manifest.files.summaries.path);
    assert.equal(sums.rows.length, 5);
    assert.deepEqual(sums.rows[0], ['соба́ка', 'noun', 'm/f anim', 'dog; cur (contemptible person)', 2 | 4]);

    const shard1 = await readGz<ShardFile>(dir, manifest.files.shards[1].path);
    assert.equal(shard1.start, 2);
    assert.equal(shard1.entries[0].word, 'стіл');

    // Forms: "співаю" → співати (id 1); "пса" (extra form) → пес (id 4); own key excluded.
    const fb = findBucket(manifest.files.forms, 'співаю')!;
    assert.ok(fb);
    const forms = await readGz<FormsBucketFile>(dir, manifest.files.forms[fb].path);
    assert.deepEqual(forms['співаю'], [1]);
    const fb2 = findBucket(manifest.files.forms, 'пса')!;
    assert.deepEqual((await readGz<FormsBucketFile>(dir, manifest.files.forms[fb2].path))['пса'], [4]);
    for (const [p, ref] of Object.entries(manifest.files.forms)) {
      const b = await readGz<FormsBucketFile>(dir, ref.path);
      for (const k of Object.keys(b)) assert.equal(findBucket(manifest.files.forms, k), p);
      assert.ok(!('собака' in b));
    }
    assert.equal(manifest.counts.formKeys, 6); // собаки, собаками, співаю, співають, стола, пса

    // English: "dog" → пес (weight 3, whole item) and собака (weight 3, first gloss item "dog")
    const tok = englishQueryTokens('dog').tokens[0];
    const eb = findBucket(manifest.files.english, tok)!;
    const eng = await readGz<EnglishBucketFile>(dir, manifest.files.english[eb].path);
    assert.deepEqual(eng[tok], [0, 3, 4, 3]);
    const sing = englishQueryTokens('sing').tokens[0];
    const sb = findBucket(manifest.files.english, sing)!;
    assert.deepEqual((await readGz<EnglishBucketFile>(dir, manifest.files.english[sb].path))[sing], [1, 3]);
    const after = searchKey('after');
    const ab = findBucket(manifest.files.english, after)!;
    assert.deepEqual((await readGz<EnglishBucketFile>(dir, manifest.files.english[ab].path))[after], [3, 3]);

    const total =
      manifest.files.core.bytes +
      manifest.files.summaries.bytes +
      manifest.files.shards.reduce((s, f) => s + f.bytes, 0) +
      Object.values(manifest.files.forms).reduce((s, f) => s + f.bytes, 0) +
      Object.values(manifest.files.english).reduce((s, f) => s + f.bytes, 0);
    assert.equal(manifest.totalBytes, total);

    // Deterministic: same input ⇒ same buildId.
    const again = await emitWebArtifacts(entries, {
      outDir: dir,
      shardSize: 2,
      attributions: BUILTIN_ATTRIBUTIONS,
      provenance: { test: 1 },
      ignoredCount: 7,
      bucketLimits: { maxKeys: 2, maxBytes: 1e9 },
    });
    assert.equal(again.buildId, manifest.buildId);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
