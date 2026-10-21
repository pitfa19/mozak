import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as coldstart from '../s7a/coldstart.mjs';
import { parseStreamJson, coldStart, runTokens, assistantTurns } from '../s7a/coldstart.mjs';
import { compare } from '../s7a/compare.mjs';
import { claudeArgs } from '../s7a/run-task.mjs';

const ROOT = '/tmp/vault-copy';
const u = (input, cc, cr, out) => ({ input_tokens: input, cache_creation_input_tokens: cc, cache_read_input_tokens: cr, output_tokens: out });
const asst = (id, content, usage) => JSON.stringify({ type: 'assistant', message: { id, content, usage } });
const res = (id, text) => JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: text }] } });

const transcript = [
  JSON.stringify({ type: 'system', subtype: 'init' }),
  asst('m1', [{ type: 'tool_use', id: 'a', name: 'Grep', input: { pattern: 'x' } }], u(10, 9000, 0, 50)),
  res('a', 'notes/one.md\nnotes/two.md'),
  asst('m2', [{ type: 'text', text: 'reading' }], u(5, 300, 9000, 20)),
  asst('m2', [{ type: 'tool_use', id: 'b', name: 'Read', input: { file_path: 'notes/one.md' } }], u(5, 300, 9000, 40)),
  res('b', 'one body'),
  asst('m3', [{ type: 'tool_use', id: 'c', name: 'Read', input: { file_path: `${ROOT}/notes/gold.md` } }], u(5, 800, 9300, 30)),
  res('c', 'gold body'),
  asst('m4', [{ type: 'text', text: 'done' }], u(5, 100, 10100, 60)),
  JSON.stringify({ type: 'result', subtype: 'success', usage: {} }),
  'not json',
].join('\n');

test('assistant events with one message id merge into one turn', () => {
  const turns = assistantTurns(parseStreamJson(transcript));
  assert.equal(turns.length, 4);
  assert.equal(turns[1].content.length, 2);
  assert.equal(turns[1].usage.output_tokens, 40);
});

test('cold-start tokens stop at the first read of a gold note', () => {
  const m = coldStart(parseStreamJson(transcript), ['notes/gold.md'], ROOT);
  assert.equal(m.reached, true);
  assert.equal(m.turn, 3);
  assert.equal(m.usefulTool, 'Read');
  assert.equal(m.injectedTokens, 9010);
  assert.equal(m.totalTokens, 5 + 800 + 9300 + 30);
  // 10105 context - 9010 injected - (50 + 40) earlier output
  assert.equal(m.toolReadTokens, 1005);
  assert.equal(m.toolCallsBefore, 2);
  assert.equal(m.toolReadCharsCheck, 'notes/one.md\nnotes/two.md'.length + 'one body'.length);
});

test('a run that never touches gold is censored at its last turn', () => {
  const m = coldStart(parseStreamJson(transcript), ['notes/missing.md'], ROOT);
  assert.equal(m.reached, false);
  assert.equal(m.censored, true);
  assert.equal(m.totalTokens, 5 + 100 + 10100 + 60);
  assert.equal(runTokens(parseStreamJson(transcript)), 9060 + 9345 + 10135 + 10265);
});

test('a mozak write counts as useful', () => {
  const t = asst('x', [{ type: 'tool_use', id: 'z', name: 'mcp__mozak__mozak_observe', input: {} }], u(1, 100, 0, 5));
  const m = coldStart(parseStreamJson(t), [], ROOT);
  assert.equal(m.reached, true);
  assert.equal(m.totalTokens, 106);
});

test('paired comparison runs Wilcoxon on task medians', () => {
  const tasks = Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, control: [100 + i, 120 + i, 110 + i], treatment: [50, 60, 55] }));
  const r = compare({ tasks });
  assert.equal(r.pairs, 6);
  assert.equal(r.wilcoxon.method, 'exact');
  assert.ok(Math.abs(r.wilcoxon.p - 0.03125) < 1e-12);
  assert.equal(r.significant, true);
  assert.equal(r.meetsTarget, true);
  assert.equal(r.medianTreatment, 55);
});

test('final streaming usage replaces provisional output without duplicate accounting', () => {
  const events = [
    { type: 'stream_event', event: { type: 'message_start', message: { id: 's1', usage: u(2, 100, 200, 1) } } },
    JSON.parse(asst('s1', [{ type: 'tool_use', id: 'r', name: 'Read', input: { file_path: 'notes/gold.md' } }], u(2, 100, 200, 8))),
    { type: 'stream_event', event: { type: 'message_delta', usage: { output_tokens: 20 } } },
    { type: 'stream_event', event: { type: 'message_delta', usage: { output_tokens: 80 } } },
    { type: 'stream_event', event: { type: 'message_stop' } },
  ];
  assert.equal(assistantTurns(events).length, 1);
  assert.equal(assistantTurns(events)[0].usage.output_tokens, 80);
  assert.equal(runTokens(events), 382);
  assert.equal(coldStart(events, ['notes/gold.md'], ROOT).totalTokens, 382);
});

test('usage validation rejects provisional or missing terminal totals', () => {
  assert.equal(typeof coldstart.validateUsage, 'function');
  const { validateUsage } = coldstart;
  assert.equal(validateUsage(parseStreamJson(transcript)).valid, false);
  const events = [JSON.parse(asst('a', [], u(2, 100, 200, 80))),
    { type: 'result', usage: u(2, 100, 200, 80) }];
  assert.equal(validateUsage(events).valid, true);
  events[1].usage.output_tokens = 81;
  assert.equal(validateUsage(events).valid, false);
});

test('failed gold reads do not count as useful actions', () => {
  const events = [JSON.parse(asst('a', [{ type: 'tool_use', id: 'r', name: 'Read', input: { file_path: 'notes/gold.md' } }], u(2, 100, 200, 80))),
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'r', is_error: true, content: 'permission denied' }] } }];
  assert.equal(coldStart(events, ['notes/gold.md'], ROOT).reached, false);
});

test('runner passes read-only tools to the CLI', () => {
  const a = claudeArgs('task', { instructionsFile: '/snapshot/AGENTS.md' });
  assert.equal(a[a.indexOf('--tools') + 1], 'Read,Grep,Glob');
  assert.ok(a.includes('--restricted'));
  assert.ok(a.includes('--strict-mcp-config'));
  assert.ok(a.includes('--include-partial-messages'));
  assert.ok(a.includes('--disable-slash-commands'));
  assert.ok(a.includes('--no-chrome'));
  assert.ok(a.includes('--session-id'));
  assert.ok(a.includes('--max-turns'));
  assert.equal(a[a.indexOf('--append-system-prompt-file') + 1], '/snapshot/AGENTS.md');
  assert.ok(a.join(' ').includes('Bash,Edit,Write'));
});
