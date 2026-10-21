import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { generate } from '../fixture/generate.mjs';
import { fold, queryTerms, jsRegExp, hasCroatianDiacritics } from '../lib/fold.mjs';
import { makeBackend, searchArmA, resolveRg } from '../lib/armA.mjs';
import { scoreItem, aggregate } from '../lib/metrics.mjs';

const EVAL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(EVAL, 'fixture');
const tmp = (name) => fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), `mozak-eval-${name}-`));

function listAll(root) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) walk(abs); else out.push(path.relative(root, abs));
    }
  };
  walk(root);
  return out.sort();
}

test('generator regenerates the committed fixture byte for byte', () => {
  const out = tmp('regen');
  try {
    generate(out);
    const want = listAll(out);
    const have = listAll(FIXTURE).filter((p) => !p.endsWith('.mjs'));
    assert.deepEqual(have, want);
    for (const p of want) assert.ok(fs.readFileSync(path.join(out, p)).equals(fs.readFileSync(path.join(FIXTURE, p))), p);
    // Twice in a row gives the same bytes too.
    const out2 = tmp('regen2');
    generate(out2);
    for (const p of want) assert.ok(fs.readFileSync(path.join(out2, p)).equals(fs.readFileSync(path.join(out, p))), p);
    fs.rmSync(out2, { recursive: true, force: true });
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('folding is explicit for Croatian letters', () => {
  assert.equal(fold('čćšžđ ČĆŠŽĐ'), 'ccszd CCSZD');
  assert.ok(hasCroatianDiacritics('Đurić'));
  assert.ok(!hasCroatianDiacritics('Duric'));
  assert.deepEqual(queryTerms('Tko drži ključ šupe s alatom?'), ['drzi', 'kljuc', 'supe', 'alatom']);
  assert.deepEqual(queryTerms('What is the minimum stock of 700x28 tubes, 7?'), ['minimu', 'stock', '700x28', 'tubes']);
  const re = jsRegExp('duric');
  assert.ok(re.test('Marko Đurić'));
  re.lastIndex = 0;
  assert.ok(!re.test('neduric'), 'prefix match starts at a word boundary');
});

test('arm A finds Croatian notes from a folded ASCII query', () => {
  const b = makeBackend(path.join(FIXTURE, 'vault'), { backend: 'node' });
  const r = searchArmA(b, 'clanarina vrt')
  assert.equal(r.abstain, false);
  assert.ok(r.ranked.some((x) => x.path === 'vrt/odluke/clanarina.md'));
});

test('arm A with rg matches the node fallback when rg exists', { skip: !resolveRg() }, () => {
  const vault = path.join(FIXTURE, 'vault');
  const n = makeBackend(vault, { backend: 'node' });
  const g = makeBackend(vault, { backend: 'rg' });
  for (const q of ['Što raste na gredici 7?', 'Who owns the shop that rents the cargo bike?', 'Koliko pčelinjih košnica ima vrt?']) {
    assert.deepEqual(searchArmA(g, q), searchArmA(n, q), q);
  }
});

test('metrics score hits, ranks and abstains', () => {
  const item = { id: 'x', type: 'single', lang: 'en', gold: ['b.md'], goldMode: 'any' };
  const s = scoreItem(item, { ranked: [{ path: 'a.md' }, { path: 'b.md' }], abstain: false });
  assert.equal(s.rr, 0.5);
  assert.equal(s.correct, true);
  const abst = { id: 'y', type: 'abstain', lang: 'en', gold: [], goldMode: 'any' };
  const s2 = scoreItem(abst, { ranked: [], abstain: true });
  assert.equal(s2.correct, true);
  const all = { id: 'z', type: 'multi-hop', lang: 'en', gold: ['a.md', 'c.md'], goldMode: 'all' };
  const s3 = scoreItem(all, { ranked: [{ path: 'a.md' }], abstain: false });
  assert.equal(s3.hitAny, true);
  assert.equal(s3.correct, false);
  const agg = aggregate([s, s2, s3]);
  assert.equal(agg.recallAt5Any, 1);
  assert.equal(agg.recallAt5All, 0.5);
  assert.equal(agg.mrrAt5, 0.75);
  assert.equal(agg.abstainAccuracy, 1);
});

function verify(...args) {
  return spawnSync(process.execPath, [path.join(EVAL, 'verify.mjs'), ...args], { encoding: 'utf8', timeout: 120000 });
}

function copyFixture() {
  const dir = tmp('broken');
  for (const p of listAll(FIXTURE).filter((x) => !x.endsWith('.mjs'))) {
    fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
    fs.copyFileSync(path.join(FIXTURE, p), path.join(dir, p));
  }
  return dir;
}

test('verifier passes on the committed fixture and harness', () => {
  const r = verify();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /7\/7 checks passed/);
});

test('verifier fails on a missing gold note', () => {
  const dir = copyFixture();
  try {
    fs.rmSync(path.join(dir, 'vault/bikeshop/lease.md'));
    const r = verify('--fixture', dir);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /FAIL fixture-gold/);
    assert.match(r.stdout, /FAIL fixture-regenerates/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('verifier fails on an edited note or a wrong gold path', () => {
  const dir = copyFixture();
  try {
    const q = JSON.parse(fs.readFileSync(path.join(dir, 'questions.json'), 'utf8'));
    q.questions[0].gold = ['bikeshop/lease.md'];
    fs.writeFileSync(path.join(dir, 'questions.json'), JSON.stringify(q, null, 2));
    const r = verify('--fixture', dir);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /FAIL fixture-gold/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('verifier fails when harness results drift from the expected results', () => {
  const dir = tmp('expected');
  try {
    const exp = JSON.parse(fs.readFileSync(path.join(EVAL, 'results/synthetic-armA.json'), 'utf8'));
    exp.arms.A.recallAt5Any = 1;
    const f = path.join(dir, 'expected.json');
    fs.writeFileSync(f, JSON.stringify(exp));
    const r = verify('--expected', f);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /FAIL harness-expected/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
