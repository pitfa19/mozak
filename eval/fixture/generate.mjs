#!/usr/bin/env node
// Deterministic generator for the public synthetic vault fixture (D3 Goal 8).
// Usage: node eval/fixture/generate.mjs [OUT_DIR]   (default: this folder)
// Writes OUT_DIR/vault/** (50 notes plus plans.md), OUT_DIR/questions.json, OUT_DIR/timeline.json.
// Output depends only on timeline.mjs: no clocks, no randomness, sorted keys, LF line endings.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCOPES, FACTS, NOTES, PLANS, QUESTIONS } from './timeline.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HR_TEZA = /\/(ljudi|mjerenja|sastanci)\/|kalibracija|rokovi|pisanje/;

export function noteLang(p) {
  if (p.startsWith('vrt/')) return 'hr';
  if (p.startsWith('bikeshop/')) return 'en';
  return HR_TEZA.test(p) ? 'hr' : 'en';
}

function byDateThenId(a, b) {
  return a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function buildFixture() {
  const noteByPath = new Map(NOTES.map((n) => [n.path, n]));
  if (noteByPath.size !== NOTES.length) throw new Error('duplicate note path');
  const factById = new Map();
  for (const f of FACTS) {
    if (factById.has(f.id)) throw new Error(`duplicate fact ${f.id}`);
    for (const p of f.notes) if (!noteByPath.has(p)) throw new Error(`fact ${f.id} names unknown note ${p}`);
    factById.set(f.id, f);
  }
  const planByNote = new Map(PLANS.map((p) => [p.note, p]));
  const files = new Map();

  for (const n of NOTES) {
    const lang = noteLang(n.path);
    const facts = FACTS.filter((f) => f.notes.includes(n.path)).sort(byDateThenId);
    const plan = planByNote.get(n.path);
    const lines = ['---', `title: ${JSON.stringify(n.title)}`, `date: ${n.date}`, `tags: [${n.tags.join(', ')}]`];
    if (plan) lines.push(`plan-state: ${plan.state}`);
    lines.push('---', '', `# ${n.title}`, '', n.intro, '');
    for (const f of facts) lines.push(`- ${f.text}`);
    if (facts.length) lines.push('');
    if (n.links.length) {
      for (const l of n.links) if (!noteByPath.has(`${l}.md`)) throw new Error(`note ${n.path} links unknown ${l}`);
      lines.push(`${lang === 'hr' ? 'Veze' : 'Links'}: ${n.links.map((l) => `[[${l}]]`).join(', ')}`, '');
    }
    files.set(`vault/${n.path}`, lines.join('\n'));
  }

  const plansMd = ['# Plans', '', 'Generated index of plans: title and state only.', ''];
  for (const s of SCOPES) {
    plansMd.push(`## ${s.id}`, '');
    for (const p of PLANS.filter((x) => x.scope === s.id)) {
      plansMd.push(`- [[${p.note.replace(/\.md$/, '')}]] ${p.title} (${p.state})`);
    }
    plansMd.push('');
  }
  files.set('vault/plans.md', plansMd.join('\n'));

  const questions = QUESTIONS.map((q, i) => {
    for (const id of q.facts) if (!factById.has(id)) throw new Error(`question ${i + 1} names unknown fact ${id}`);
    const gold = [...new Set(q.facts.flatMap((id) => factById.get(id).notes))].sort();
    return {
      id: `q${String(i + 1).padStart(2, '0')}`,
      type: q.type,
      lang: q.lang,
      question: q.q,
      gold,
      goldMode: q.mode,
      facts: q.facts,
      answer: q.answer,
    };
  });
  files.set('questions.json', `${JSON.stringify({ fixture: 'mozak-synthetic-vault-v1', count: questions.length, questions }, null, 2)}\n`);

  const timeline = {
    fixture: 'mozak-synthetic-vault-v1',
    scopes: SCOPES,
    plans: PLANS,
    facts: FACTS.slice().sort(byDateThenId),
  };
  files.set('timeline.json', `${JSON.stringify(timeline, null, 2)}\n`);
  return files;
}

export function generate(outDir = HERE) {
  const files = buildFixture();
  fs.rmSync(path.join(outDir, 'vault'), { recursive: true, force: true });
  for (const [rel, content] of [...files.entries()].sort()) {
    const abs = path.join(outDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return [...files.keys()].sort();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = path.resolve(process.argv[2] ?? HERE);
  const written = generate(out);
  console.log(`wrote ${written.length} files to ${out}`);
}
