#!/usr/bin/env node
// S0b retrieval eval harness.
// Usage:
//   node eval/run.mjs [--fixture DIR] [--vault DIR --questions FILE] [--backend auto|rg|node] [--rg PATH]
//                     [--out FILE] [--per-item]
// Default: the public synthetic fixture in eval/fixture. Private sets pass --vault and --questions and
// must write --out outside this repo.
// Arms: A (rg folded pattern + plans.md), A-noplans (ablation, same without plans.md),
// Q (qmd search) only when `qmd` is on PATH; otherwise reported as not run. Nothing is installed.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeBackend, searchArmA, findOnPath } from './lib/armA.mjs';
import { scoreItem, aggregate, aggregateBy } from './lib/metrics.mjs';
import { mcnemarFromPairs } from './lib/stats.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function parseArgs(argv) {
  const a = { fixture: path.join(HERE, 'fixture'), backend: 'auto', perItem: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => argv[++i];
    if (k === '--fixture') a.fixture = path.resolve(v());
    else if (k === '--vault') a.vault = path.resolve(v());
    else if (k === '--questions') a.questions = path.resolve(v());
    else if (k === '--backend') a.backend = v();
    else if (k === '--rg') a.rg = v();
    else if (k === '--out') a.out = path.resolve(v());
    else if (k === '--per-item') a.perItem = true;
    else throw new Error(`unknown argument ${k}`);
  }
  a.vault ??= path.join(a.fixture, 'vault');
  a.questions ??= path.join(a.fixture, 'questions.json');
  return a;
}

export function loadQuestions(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const qs = Array.isArray(data) ? data : data.questions;
  if (!Array.isArray(qs) || qs.length === 0) throw new Error('no questions');
  for (const q of qs) {
    if (typeof q.id !== 'string' || typeof q.question !== 'string' || !Array.isArray(q.gold)) throw new Error(`bad question ${JSON.stringify(q).slice(0, 80)}`);
  }
  return qs;
}

export function runArm(backend, questions, opts) {
  return questions.map((q) => {
    const res = searchArmA(backend, q.question, opts);
    return { score: scoreItem(q, res), top: res.ranked.map((r) => r.path), terms: res.terms };
  });
}

export function evaluate(args) {
  const questions = loadQuestions(args.questions);
  const backend = makeBackend(args.vault, { backend: args.backend, rg: args.rg });
  const hasPlans = fs.existsSync(path.join(args.vault, 'plans.md'));
  const a = runArm(backend, questions, { usePlans: true });
  const a0 = runArm(backend, questions, { usePlans: false });
  const scoredA = a.map((x) => x.score);
  const scoredA0 = a0.map((x) => x.score);
  const qmd = findOnPath('qmd');
  const result = {
    harness: 'mozak-s0b-eval-v1',
    backend: backend.name,
    notes: backend.notes.length,
    plansMd: hasPlans,
    arms: {
      A: { status: 'run', ...aggregate(scoredA), byType: aggregateBy(scoredA, 'type'), byLang: aggregateBy(scoredA, 'lang') },
      'A-noplans': { status: 'run', ...aggregate(scoredA0) },
      Q: qmd ? { status: 'not-run', reason: 'qmd found but the Q adapter is not built yet' } : { status: 'not-run', reason: 'qmd not installed' },
    },
    paired: {
      'A vs A-noplans': mcnemarFromPairs(scoredA.map((s) => s.correct), scoredA0.map((s) => s.correct)),
    },
  };
  if (args.perItem) {
    result.perItem = questions.map((q, i) => ({ id: q.id, correct: scoredA[i].correct, abstained: scoredA[i].abstained, rr: scoredA[i].rr, top: a[i].top, terms: a[i].terms }));
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const result = evaluate(args);
  const text = `${JSON.stringify(result, null, 2)}\n`;
  if (args.out) {
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, text);
    console.log(`wrote ${args.out}`);
  } else {
    process.stdout.write(text);
  }
}
