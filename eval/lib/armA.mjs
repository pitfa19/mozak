// Arm A of the D3 S7b retrieval eval: ripgrep with a diacritic-folded pattern, plus plans.md if present.
// Backends: 'rg' (ripgrep binary) and 'node' (pure node fallback with the same semantics).
// Ranking: sum of idf over distinct matched query terms, ties by path. Abstain when the best note
// matches fewer than half of the query terms, or nothing matches.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { queryTerms, rgPattern, jsRegExp } from './fold.mjs';

export const DEFAULT_RG = '/Users/pitfa19/.hermes/tools/ripgrep-15.2.0-darwin-arm64/rg';
const SKIP_DIRS = new Set(['node_modules', '.git', '.obsidian', '.trash']);

export function findOnPath(bin) {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    const p = path.join(dir, bin);
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { /* not here */ }
  }
  return null;
}

export function resolveRg(explicit) {
  for (const c of [explicit, process.env.MOZAK_EVAL_RG, DEFAULT_RG]) {
    if (c && fs.existsSync(c)) return c;
  }
  return findOnPath('rg');
}

// Markdown notes under root, relative paths with forward slashes, dot folders skipped. plans.md at root is
// an index, not a note.
export function listNotes(root) {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.isFile() && e.name.endsWith('.md')) out.push(path.relative(root, abs).split(path.sep).join('/'));
    }
  };
  walk(root);
  return out.filter((p) => p !== 'plans.md').sort();
}

class NodeBackend {
  constructor(root) {
    this.name = 'node';
    this.root = root;
    this.notes = listNotes(root);
    this.text = new Map(this.notes.map((p) => [p, fs.readFileSync(path.join(root, p), 'utf8')]));
  }
  filesMatching(term) {
    const re = jsRegExp(term);
    const hits = new Set();
    for (const [p, t] of this.text) { re.lastIndex = 0; if (re.test(t)) hits.add(p); }
    return hits;
  }
  linesMatching(term, file) {
    const re = jsRegExp(term);
    const lines = fs.readFileSync(path.join(this.root, file), 'utf8').split('\n');
    const hits = new Set();
    lines.forEach((l, i) => { re.lastIndex = 0; if (re.test(l)) hits.add(i + 1); });
    return hits;
  }
}

class RgBackend {
  constructor(root, rg) {
    this.name = 'rg';
    this.root = root;
    this.rg = rg;
    this.notes = listNotes(root);
    this.noteSet = new Set(this.notes);
  }
  run(args) {
    try {
      return execFileSync(this.rg, args, { cwd: this.root, encoding: 'utf8', timeout: 20000, maxBuffer: 64 * 1024 * 1024 });
    } catch (e) {
      if (e.status === 1) return ''; // no match
      throw e;
    }
  }
  filesMatching(term) {
    const out = this.run(['--no-config', '--no-ignore', '--ignore-case', '--files-with-matches', '--glob', '*.md', '-e', rgPattern(term), '.']);
    const hits = new Set();
    for (const line of out.split('\n')) {
      if (!line) continue;
      const p = line.replace(/^\.\//, '');
      if (this.noteSet.has(p)) hits.add(p);
    }
    return hits;
  }
  linesMatching(term, file) {
    const out = this.run(['--no-config', '--no-ignore', '--ignore-case', '--line-number', '--no-filename', '-e', rgPattern(term), file]);
    const hits = new Set();
    for (const line of out.split('\n')) {
      const m = /^(\d+):/.exec(line);
      if (m) hits.add(Number(m[1]));
    }
    return hits;
  }
}

export function makeBackend(root, { backend = 'auto', rg } = {}) {
  if (backend === 'node') return new NodeBackend(root);
  const bin = resolveRg(rg);
  if (bin) return new RgBackend(root, bin);
  if (backend === 'rg') throw new Error('ripgrep not found');
  return new NodeBackend(root);
}

// Map plans.md lines that hold a wikilink to the linked note path.
function planIndexLines(root) {
  const p = path.join(root, 'plans.md');
  if (!fs.existsSync(p)) return null;
  const map = new Map();
  fs.readFileSync(p, 'utf8').split('\n').forEach((l, i) => {
    const m = /\[\[([^\]|#]+)/.exec(l);
    if (m) map.set(i + 1, m[1].endsWith('.md') ? m[1] : `${m[1]}.md`);
  });
  return map;
}

// Search one question. Returns { terms, ranked: [{path, score, matched}], abstain }.
export function searchArmA(backend, question, { usePlans = true, k = 5 } = {}) {
  const terms = queryTerms(question);
  const N = backend.notes.length;
  const planLines = usePlans ? planIndexLines(backend.root) : null;
  const matched = new Map(); // path -> Set(term)
  const df = new Map();
  for (const t of terms) {
    const files = backend.filesMatching(t);
    if (planLines) {
      for (const ln of backend.linesMatching(t, 'plans.md')) {
        const note = planLines.get(ln);
        if (note && backend.notes.includes(note)) files.add(note);
      }
    }
    df.set(t, files.size);
    for (const f of files) {
      if (!matched.has(f)) matched.set(f, new Set());
      matched.get(f).add(t);
    }
  }
  const idf = (t) => Math.log(1 + N / Math.max(1, df.get(t)));
  const ranked = [...matched.entries()].map(([p, set]) => ({
    path: p,
    matched: set.size,
    score: Math.round([...set].reduce((s, t) => s + idf(t), 0) * 1e6) / 1e6,
  })).sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const best = ranked[0];
  const abstain = !best || terms.length === 0 || best.matched < terms.length / 2;
  return { terms, ranked: abstain ? [] : ranked.slice(0, k), abstain };
}
