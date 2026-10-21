#!/usr/bin/env node
// Run one S7a cold-start session with the Claude Code CLI, read-only, with a hard timeout.
// Usage: node eval/s7a/run-task.mjs --copy DIR --prompt-file FILE --gold-file FILE --out PREFIX
//          [--claude PATH] [--timeout-s 300] [--model NAME]
// DIR must be a scratch copy of the vault, never the real vault. Tools: Read, Grep, Glob only.
// Writes PREFIX.stream.jsonl (raw transcript) and PREFIX.metric.json. Exits 3 with a reason if the CLI is
// not logged in, so a batch stops instead of burning retries.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseStreamJson, coldStart, runTokens } from './coldstart.mjs';

export function claudeArgs(prompt, { model } = {}) {
  const a = ['-p', prompt, '--output-format', 'stream-json', '--verbose',
    '--tools', 'Read,Grep,Glob', '--allowedTools', 'Read,Grep,Glob',
    '--disallowedTools', 'Bash,Edit,Write,NotebookEdit,WebFetch,WebSearch,Task',
    '--restricted', '--strict-mcp-config', '--permission-mode', 'dontAsk', '--no-session-persistence'];
  if (model) a.push('--model', model);
  return a;
}

export function authStatus(claude) {
  const r = spawnSync(claude, ['auth', 'status'], { encoding: 'utf8', timeout: 30000 });
  try { return JSON.parse(r.stdout); } catch { return { loggedIn: false, raw: (r.stdout || r.stderr || '').slice(0, 200) }; }
}

function main() {
  const a = { claude: '/Users/pitfa19/.local/bin/claude', timeoutS: 300 };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const v = () => argv[++i];
    if (argv[i] === '--copy') a.copy = path.resolve(v());
    else if (argv[i] === '--prompt-file') a.prompt = v();
    else if (argv[i] === '--gold-file') a.gold = v();
    else if (argv[i] === '--out') a.out = path.resolve(v());
    else if (argv[i] === '--claude') a.claude = v();
    else if (argv[i] === '--timeout-s') a.timeoutS = Number(v());
    else if (argv[i] === '--model') a.model = v();
    else { console.error(`unknown argument ${argv[i]}`); process.exit(2); }
  }
  if (!a.copy || !a.prompt || !a.gold || !a.out) { console.error('missing --copy, --prompt-file, --gold-file or --out'); process.exit(2); }
  if (fs.existsSync(path.join(a.copy, '.git'))) { console.error('refusing: --copy has a .git folder; use a scratch copy, not the vault'); process.exit(2); }
  const auth = authStatus(a.claude);
  if (!auth.loggedIn) {
    console.error(`blocked: claude CLI not logged in (authMethod ${auth.authMethod ?? 'unknown'})`);
    process.exit(3);
  }
  const prompt = fs.readFileSync(a.prompt, 'utf8');
  const gold = JSON.parse(fs.readFileSync(a.gold, 'utf8'));
  const started = Date.now();
  const r = spawnSync(a.claude, claudeArgs(prompt, a), { cwd: a.copy, encoding: 'utf8', timeout: a.timeoutS * 1000, killSignal: 'SIGKILL', maxBuffer: 256 * 1024 * 1024 });
  fs.mkdirSync(path.dirname(a.out), { recursive: true });
  fs.writeFileSync(`${a.out}.stream.jsonl`, r.stdout ?? '');
  const events = parseStreamJson(r.stdout ?? '');
  const metric = { ...coldStart(events, gold, a.copy), runTokens: runTokens(events), exit: r.status, signal: r.signal, timedOut: r.signal === 'SIGKILL', wallMs: Date.now() - started };
  fs.writeFileSync(`${a.out}.metric.json`, `${JSON.stringify(metric, null, 2)}\n`);
  console.log(JSON.stringify(metric));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
