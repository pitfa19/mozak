#!/usr/bin/env node
// Verifier for the S0b eval fixture and harness. Exits 1 if any check fails, 0 otherwise.
// Usage: node eval/verify.mjs [--fixture DIR] [--expected FILE] [--skip-expected]
// Checks:
//   fixture-regenerates   the fixture files equal what generate.mjs builds, byte for byte, no extra files
//   fixture-shape         50 notes, 3 scopes, 8 plans in plans.md, 40 questions, unique ids
//   fixture-gold          every gold path exists and states the question's facts
//   fixture-croatian      at least 25% of notes and of questions are Croatian with diacritics
//   stats-known-values    McNemar and Wilcoxon match published values
//   harness-backends      the rg and node backends give identical results (rg skipped if absent)
//   harness-expected      arm A metrics and per-item results equal eval/results/synthetic-armA.json

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFixture } from './fixture/generate.mjs';
import { hasCroatianDiacritics } from './lib/fold.mjs';
import { listNotes, resolveRg } from './lib/armA.mjs';
import { mcnemarExact, wilcoxonSignedRank } from './lib/stats.mjs';
import { evaluate } from './run.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function args(argv) {
  const a = { fixture: path.join(HERE, 'fixture'), expected: path.join(HERE, 'results', 'synthetic-armA.json'), skipExpected: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--fixture') a.fixture = path.resolve(argv[++i]);
    else if (argv[i] === '--expected') a.expected = path.resolve(argv[++i]);
    else if (argv[i] === '--skip-expected') a.skipExpected = true;
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  return a;
}

function walkFiles(root) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else out.push(path.relative(root, abs).split(path.sep).join('/'));
    }
  };
  if (fs.existsSync(root)) walk(root);
  return out.sort();
}

const checks = [];
function check(name, fn) {
  try {
    const detail = fn();
    checks.push({ name, ok: true, detail: detail ?? '' });
  } catch (e) {
    checks.push({ name, ok: false, detail: e.message });
  }
}
function must(cond, msg) { if (!cond) throw new Error(msg); }

export function stripRun(r) {
  const { backend, ...rest } = r;
  return rest;
}

function main() {
  const a = args(process.argv.slice(2));
  const dir = a.fixture;
  const vault = path.join(dir, 'vault');

  check('fixture-regenerates', () => {
    const want = buildFixture();
    const have = new Set([...walkFiles(vault).map((p) => `vault/${p}`), ...['questions.json', 'timeline.json'].filter((f) => fs.existsSync(path.join(dir, f)))]);
    for (const [rel, content] of want) {
      must(have.has(rel), `missing ${rel}`);
      must(fs.readFileSync(path.join(dir, rel)).equals(Buffer.from(content)), `differs: ${rel}`);
      have.delete(rel);
    }
    must(have.size === 0, `extra files: ${[...have].join(', ')}`);
    return `${want.size} files identical`;
  });

  let questions = [];
  let timeline = { facts: [] };
  let qcount = null;
  try {
    const data = JSON.parse(fs.readFileSync(path.join(dir, 'questions.json'), 'utf8'));
    questions = data.questions ?? [];
    qcount = data.count;
    timeline = JSON.parse(fs.readFileSync(path.join(dir, 'timeline.json'), 'utf8'));
  } catch (e) {
    checks.push({ name: 'fixture-load', ok: false, detail: e.message });
  }
  check('fixture-shape', () => {
    const notes = listNotes(vault);
    must(notes.length === 50, `expected 50 notes, found ${notes.length}`);
    const scopes = new Set(notes.map((p) => p.split('/')[0]));
    must(scopes.size === 3, `expected 3 scopes, found ${scopes.size}`);
    const plansMd = fs.readFileSync(path.join(vault, 'plans.md'), 'utf8');
    const planLinks = [...plansMd.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => `${m[1]}.md`);
    must(planLinks.length === 8, `expected 8 plans in plans.md, found ${planLinks.length}`);
    for (const p of planLinks) {
      must(notes.includes(p), `plans.md links missing note ${p}`);
      must(/^plan-state: /m.test(fs.readFileSync(path.join(vault, p), 'utf8')), `plan note without plan-state: ${p}`);
    }
    must(questions.length === 40 && qcount === 40, `expected 40 questions, found ${questions.length}`);
    must(new Set(questions.map((q) => q.id)).size === 40, 'duplicate question ids');
    const abstain = questions.filter((q) => q.gold.length === 0);
    must(abstain.length >= 1 && abstain.every((q) => q.type === 'abstain' && q.answer === null), 'abstain items malformed');
    return `50 notes, scopes ${[...scopes].sort().join('/')}, 8 plans, 40 questions (${abstain.length} abstain)`;
  });

  check('fixture-gold', () => {
    must(questions.length > 0, 'no questions loaded');
    const factText = new Map(timeline.facts.map((f) => [f.id, f.text]));
    let goldRefs = 0;
    for (const q of questions) {
      if (q.type === 'abstain') { must(q.facts.length === 0, `${q.id} abstain with facts`); continue; }
      must(q.gold.length > 0, `${q.id} has no gold`);
      const texts = new Map(q.gold.map((g) => {
        const abs = path.join(vault, g);
        must(fs.existsSync(abs), `${q.id} gold missing: ${g}`);
        return [g, fs.readFileSync(abs, 'utf8')];
      }));
      for (const id of q.facts) {
        const t = factText.get(id);
        must(t, `${q.id} unknown fact ${id}`);
        must([...texts.values()].some((body) => body.includes(t)), `${q.id} fact ${id} not stated in any gold note`);
      }
      for (const [g, body] of texts) {
        must(q.facts.some((id) => body.includes(factText.get(id))), `${q.id} gold ${g} states none of its facts`);
        goldRefs++;
      }
      // Gold is exact: no note outside gold states one of the question's facts.
      for (const n of listNotes(vault)) {
        if (q.gold.includes(n)) continue;
        const body = fs.readFileSync(path.join(vault, n), 'utf8');
        for (const id of q.facts) must(!body.includes(factText.get(id)), `${q.id} fact ${id} also in non-gold ${n}`);
      }
    }
    return `${goldRefs} gold references verified`;
  });

  check('fixture-croatian', () => {
    const notes = listNotes(vault);
    const hrNotes = notes.filter((p) => hasCroatianDiacritics(fs.readFileSync(path.join(vault, p), 'utf8'))).length;
    const hrQs = questions.filter((q) => q.lang === 'hr' && hasCroatianDiacritics(q.question)).length;
    must(hrNotes / notes.length >= 0.25, `Croatian notes ${hrNotes}/${notes.length} under 25%`);
    must(hrQs / questions.length >= 0.25, `Croatian questions ${hrQs}/${questions.length} under 25%`);
    return `notes ${hrNotes}/${notes.length}, questions ${hrQs}/${questions.length}`;
  });

  check('stats-known-values', () => {
    const near = (x, y) => Math.abs(x - y) < 1e-9;
    must(near(mcnemarExact(10, 2).p, 0.03857421875), 'McNemar b=10 c=2');
    must(near(mcnemarExact(0, 5).p, 0.0625), 'McNemar b=0 c=5');
    const w = wilcoxonSignedRank([6, 8, 14, 16, 23, 24, 28, 29, 41, -48, 49, 56, 60, -67, 75]);
    must(w.statistic === 24 && near(w.p, 0.041259765625), `Wilcoxon scipy example gave ${w.statistic}, ${w.p}`);
    return 'McNemar and Wilcoxon match';
  });

  let runNode = null;
  check('harness-backends', () => {
    runNode = evaluate({ vault, questions: path.join(dir, 'questions.json'), backend: 'node', perItem: true });
    for (const arm of ['A', 'A-noplans']) {
      const m = runNode.arms[arm];
      for (const k of ['recallAt5Any', 'recallAt5All', 'mrrAt5', 'abstainAccuracy']) must(m[k] >= 0 && m[k] <= 1, `${arm}.${k} out of range`);
    }
    if (!resolveRg()) return 'rg absent, node backend only';
    const runRg = evaluate({ vault, questions: path.join(dir, 'questions.json'), backend: 'rg', perItem: true });
    must(JSON.stringify(stripRun(runRg)) === JSON.stringify(stripRun(runNode)), 'rg and node backends disagree');
    return 'rg and node identical';
  });

  if (!a.skipExpected) {
    check('harness-expected', () => {
      must(runNode, 'no harness run');
      const expected = JSON.parse(fs.readFileSync(a.expected, 'utf8'));
      must(JSON.stringify(stripRun(expected)) === JSON.stringify(stripRun(runNode)), `results differ from ${path.relative(process.cwd(), a.expected)}`);
      const A = runNode.arms.A;
      return `arm A recall@5 ${A.recallAt5Any}, MRR ${A.mrrAt5}, abstain acc ${A.abstainAccuracy}`;
    });
  }

  let failed = 0;
  for (const c of checks) {
    console.log(`${c.ok ? 'PASS' : 'FAIL'} ${c.name}${c.detail ? `: ${c.detail}` : ''}`);
    if (!c.ok) failed++;
  }
  console.log(`${checks.length - failed}/${checks.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main();
