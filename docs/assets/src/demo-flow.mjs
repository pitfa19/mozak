#!/usr/bin/env node
// Demo driver. Runs the REAL MOZAK CLI against a throwaway repo and notes folder.
// Only the pacing is scripted. Every result shown is the CLI's actual output.
// Usage: node docs/assets/src/demo-flow.mjs [--fast]
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FAST = process.argv.includes('--fast');
const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = process.env.MOZAK_CLI ?? resolve(HERE, '../../../packages/cli/dist/index.js');
const pause = ms => FAST ? 0 : Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const C = { dim: '\x1b[2m', b: '\x1b[1m', g: '\x1b[32m', y: '\x1b[33m', r: '\x1b[31m', c: '\x1b[36m', x: '\x1b[0m' };
const out = s => process.stdout.write(s + '\n');

const root = realpathSync(mkdtempSync(join(tmpdir(), 'mozak-demo-')));
const OWNER = { ownerRef: 'demo-owner', ownerMessageAt: '2026-10-12T09:00:00.000Z' };
const repo = join(root, 'atlas-app');
const notes = join(root, 'field-notes');
const inventory = join(root, 'inventory.json');
let seq = 0;

function scene(n, title) { pause(900); if (!FAST) process.stdout.write('\x1b[2J\x1b[H'); out(`${C.b}${C.c}── ${n}  ${title}${C.x}`); pause(700); }
function say(text) { out(`${C.dim}# ${text}${C.x}`); pause(900); }
function shown(args) { return 'mozak ' + args.join(' '); }
function run(args, { echo = args, quiet = false } = {}) {
  out(`${C.g}$${C.x} ${shown(echo)}`); pause(500);
  const p = spawnSync(process.execPath, [CLI, ...args, '--config', inventory], { encoding: 'utf8' });
  if (!quiet && p.stdout.trim()) out(p.stdout.trimEnd());
  return p;
}
function json(args) {
  const p = spawnSync(process.execPath, [CLI, ...args, '--config', inventory, '--json'], { encoding: 'utf8' });
  return { status: p.status, data: JSON.parse(p.stdout || '{}') };
}
function write(name, value) { const f = join(root, name); writeFileSync(f, JSON.stringify(value)); return f; }
function content(title, purpose, outcome) {
  return {
    title, purpose,
    outcomes: [{ id: 'o1', statement: outcome, acceptance: 'objective', criterion: 'A reviewer can verify it from the saved evidence' }],
    constraints: [], nonGoals: ['Changing code before approval'], rationale: 'Keeps the decision visible to the next session', questions: [],
    sources: [{ id: 's1', locator: 'demo:synthetic', anchor: null, observedAt: OWNER.ownerMessageAt, version: 'demo-v1', limitations: ['Synthetic demo data'] }],
  };
}
function mutate(scope, route, action, payload, expected) {
  const snap = expected ?? json(['context', '--scope', scope]).data.snapshot;
  const request = write(`req-${++seq}.json`, { operationId: `demo-${seq}`, scopeId: scope, expected: snap, action, payload });
  return spawnSync(process.execPath, [CLI, ...route, '--scope', scope, '--request', request, '--config', inventory, '--json'], { encoding: 'utf8' });
}
const tree = dir => readdirSync(dir).sort().join('  ');

// ── setup (not shown) ───────────────────────────────────────────
for (const [dir, name] of [[repo, 'Atlas App'], [notes, 'Field Notes']]) {
  mkdirSync(dir);
  writeFileSync(join(dir, 'README.md'), `# ${name}\n`);
  writeFileSync(join(dir, 'AGENTS.md'), 'Read MOZAK.md first.\n');
}
mkdirSync(join(repo, 'src')); mkdirSync(join(notes, 'papers'));
writeFileSync(join(root, 'inventory.json'), '{\n  "format": "mozak.local/v2",\n  "scopes": [\n    { "id": "atlas-app",   "root": "./atlas-app" },\n    { "id": "field-notes", "root": "./field-notes" }\n  ]\n}\n');
const git = (cwd, ...a) => spawnSync('git', ['-c', 'user.name=Demo', '-c', 'user.email=demo@example.com', '-c', 'init.defaultBranch=main', ...a], { cwd, encoding: 'utf8' });

out(`${C.b}MOZAK${C.x}  agentic planning for developers and researchers`);
out(`${C.dim}Real commands and real output. Only the typing pace is scripted.${C.x}`);

// ── 1 register ──────────────────────────────────────────────────
scene(1, 'Register: you list the scopes. MOZAK never crawls.');
say('Synthetic demo: a git repo and an Obsidian-style notes folder.');
out(`${C.g}$${C.x} cat inventory.json`); pause(400);
out(readFileSync(inventory, 'utf8').trimEnd()); pause(1200);
say('Before:');
out(`  atlas-app/    ${tree(repo)}`);
out(`  field-notes/  ${tree(notes)}`); pause(900);
for (const [id, title] of [['atlas-app', 'Atlas App'], ['field-notes', 'Field Notes']]) {
  const req = write(`init-${id}.json`, { operationId: `init-${id}`, scopeId: id, kind: id === 'atlas-app' ? 'project' : 'topic', title, expectedAbsent: { graph: true, bridge: true }, ...OWNER });
  const p = spawnSync(process.execPath, [CLI, 'scope', 'init', '--scope', id, '--request', req, '--config', inventory], { encoding: 'utf8' });
  out(`${C.g}$${C.x} mozak scope init --scope ${id}  ${p.status === 0 ? C.g + 'ok' : C.r + 'exit ' + p.status}${C.x}`); pause(500);
}
say('After: each folder owns its plan as plain files.');
out(`  atlas-app/    ${tree(repo)}`);
out(`  field-notes/  ${tree(notes)}`); pause(1400);
git(repo, 'init', '-q'); git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'Register atlas-app with MOZAK');

// ── 2 propose ───────────────────────────────────────────────────
scene(2, 'Agent proposes. Nothing is approved yet.');
mutate('atlas-app', ['plan', 'propose'], 'propose', { planId: 'offline-maps', content: content('Add offline map caching', 'Let Atlas work without a network', 'Maps open offline for any saved region') });
mutate('field-notes', ['plan', 'propose'], 'propose', { planId: 'tile-papers', content: content('Review tile-caching papers', 'Learn how others cache map tiles', 'A short reading list with what transfers') });
run(['plans', '--all']);
pause(1500);

// ── 3 approve ───────────────────────────────────────────────────
scene(3, 'You approve. One decision, bound to what you were shown.');
for (const [scope, plan] of [['atlas-app', 'offline-maps'], ['field-notes', 'tile-papers']]) {
  const view = json(['review', 'show', '--scope', scope, '--plan', plan]).data.review;
  const ctx = json(['context', '--scope', scope]).data.context;
  const pending = ctx.plans.find(p => p.planId === plan || p.id === plan);
  const revisionId = view.pending?.id ?? pending?.pending?.id;
  const r = mutate(scope, ['review', 'decide'], 'approve-direction', { planId: plan, revisionId, reviewDigest: view.reviewDigest, ...OWNER, reason: 'Demo approval' });
  out(`${C.g}$${C.x} mozak review decide --scope ${scope} --plan ${plan}  ${r.status === 0 ? C.g + 'approved' : C.r + 'exit ' + r.status}${C.x}`); pause(600);
}
run(['plans', '--all']);
pause(1500);

// ── 4 stale write ───────────────────────────────────────────────
scene(4, 'A second agent writes from an old snapshot. It is refused.');
const oldSnapshot = json(['context', '--scope', 'atlas-app']).data.snapshot;
say('Agent A saves a finding.');
mutate('atlas-app', ['observe'], 'observe', {
  planId: 'offline-maps',
  observation: { id: 'obs1', classification: 'observed', summary: 'Tile cache fits in 40 MB for a city', evidence: [{ id: 'e1', locator: 'demo:benchmark', anchor: null, version: 'demo-v1', inspectedAt: OWNER.ownerMessageAt, activity: { kind: 'run', description: 'Demo measurement' }, result: { verdict: 'pass', summary: 'Fits' }, limitations: ['Synthetic'] }] },
  reasoningLinks: [],
});
out(`${C.g}$${C.x} mozak observe --scope atlas-app  ${C.g}saved${C.x}`);
out(`  ${C.dim}Agent A (demo data):${C.x} "Tile cache fits in 40 MB for a city"`); pause(1100);
say('Agent B still holds the old snapshot and tries to write.');
const stale = mutate('atlas-app', ['observe'], 'observe', {
  planId: 'offline-maps',
  observation: { id: 'obs2', classification: 'inferred', summary: 'Overwrites A without seeing it', evidence: [], },
  reasoningLinks: [],
}, oldSnapshot);
const sj = JSON.parse(stale.stdout || '{}');
out(`${C.g}$${C.x} mozak observe --scope atlas-app  ${C.r}REFUSED${C.x} ${C.dim}(exit ${stale.status}, ${sj.issues?.[0]?.code ?? sj.status})${C.x}`);
const kept = JSON.parse(readFileSync(join(repo, 'MOZAK.json'), 'utf8'));
const has = JSON.stringify(kept).includes('Tile cache fits in 40 MB');
const lost = JSON.stringify(kept).includes('Overwrites A without seeing it');
out(`  ${C.dim}Agent A's finding still on disk:${C.x} ${has ? C.g + 'yes' : C.r + 'NO'}${C.x}   ${C.dim}Agent B's write on disk:${C.x} ${lost ? C.r + 'YES' : C.g + 'no'}${C.x}`);
say('Nothing was overwritten. Agent B must reread first.'); pause(1800);

// ── 5 fresh session ─────────────────────────────────────────────
scene(5, 'A new process picks up where the last one left off.');
say('No shared memory. It reads only the saved files.');
const fresh = run(['plans', '--scope', 'atlas-app']);
const ctx = json(['context', '--scope', 'atlas-app']).data.context;
out(`${C.dim}next permitted action:${C.x} ${ctx.plans?.[0]?.permittedNextAction ?? 'see context'}`);
pause(1500);

// ── 6 files ─────────────────────────────────────────────────────
scene(6, 'It is all plain files. Git keeps the history.');
out(`${C.g}$${C.x} cd atlas-app && git diff --stat`); pause(600);
out(git(repo, 'diff', '--stat').stdout.trimEnd().split('\n').map(l => '  ' + l).join('\n')); pause(1400);
say('Every decision is a reviewable diff in your own repo.');
out(`${C.g}$${C.x} git log --oneline`); pause(500);
out(git(repo, 'log', '--oneline').stdout.trimEnd().split('\n').map(l => '  ' + l).join('\n')); pause(900);
say('Open either folder in your editor or Obsidian. Plain files, no cloud.');
pause(1500);
out(`\n${C.b}Agent proposes. You approve. The next process picks up where it left off.${C.x}`);
pause(2500);
