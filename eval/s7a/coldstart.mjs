// S7a cold-start metric from a Claude Code stream-json transcript (claude -p --output-format stream-json --verbose).
// Useful action = first tool call that reads a gold note (Read on it, or Grep/Glob scoped to it) or a mozak write.
// Total tokens to the first useful action = full context of the assistant turn that makes that call
// (injected context plus everything read so far) plus that turn's output tokens.

import path from 'node:path';

const MOZAK_WRITE = /mozak_(observe|propose|revise|operation|complete|attach|discussion)/;

export function parseStreamJson(text) {
  const events = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try { events.push(JSON.parse(t)); } catch { /* skip partial lines */ }
  }
  return events;
}

function ctxOf(u = {}) {
  return (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
}

// Merge assistant events that share a message id (one event per content block).
export function assistantTurns(events) {
  const turns = [];
  const byId = new Map();
  for (const e of events) {
    if (e.type !== 'assistant' || !e.message) continue;
    const id = e.message.id ?? `anon-${turns.length}`;
    let t = byId.get(id);
    if (!t) { t = { id, content: [], usage: {} }; byId.set(id, t); turns.push(t); }
    t.content.push(...(e.message.content ?? []));
    const u = e.message.usage ?? {};
    for (const k of ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'output_tokens']) {
      t.usage[k] = Math.max(t.usage[k] ?? 0, u[k] ?? 0);
    }
  }
  return turns;
}

export function isUseful(toolUse, goldAbs, root) {
  const name = toolUse.name ?? '';
  if (MOZAK_WRITE.test(name)) return true;
  const inp = toolUse.input ?? {};
  const target = inp.file_path ?? inp.path ?? inp.notebook_path;
  if (!target || typeof target !== 'string') return false;
  const abs = path.resolve(root, target);
  return ['Read', 'Grep', 'Glob'].includes(name) && goldAbs.has(abs);
}

function toolResultChars(events, untilToolIds) {
  let chars = 0;
  for (const e of events) {
    if (e.type !== 'user' || !e.message) continue;
    for (const c of e.message.content ?? []) {
      if (c.type !== 'tool_result' || !untilToolIds.has(c.tool_use_id)) continue;
      const body = typeof c.content === 'string' ? c.content : JSON.stringify(c.content ?? '');
      chars += body.length;
    }
  }
  return chars;
}

// gold: vault-relative paths. root: the vault copy the agent ran in.
export function coldStart(events, gold, root) {
  const goldAbs = new Set(gold.map((g) => path.resolve(root, g)));
  const turns = assistantTurns(events);
  const result = events.find((e) => e.type === 'result') ?? null;
  if (turns.length === 0) return { turns: 0, reached: false, error: result?.result ?? 'no assistant turns' };
  const injected = ctxOf(turns[0].usage);
  let outBefore = 0;
  const priorToolIds = new Set();
  let toolCallsBefore = 0;
  for (let k = 0; k < turns.length; k++) {
    const t = turns[k];
    const uses = t.content.filter((c) => c.type === 'tool_use');
    const useful = uses.find((u) => isUseful(u, goldAbs, root));
    if (useful) {
      const ctx = ctxOf(t.usage);
      return {
        reached: true,
        turn: k + 1,
        toolCallsBefore,
        usefulTool: useful.name,
        injectedTokens: injected,
        toolReadTokens: Math.max(0, ctx - injected - outBefore),
        toolReadCharsCheck: toolResultChars(events, priorToolIds),
        totalTokens: ctx + (t.usage.output_tokens ?? 0),
        turns: turns.length,
      };
    }
    outBefore += t.usage.output_tokens ?? 0;
    for (const u of uses) { priorToolIds.add(u.id); toolCallsBefore++; }
  }
  const last = turns[turns.length - 1];
  return {
    reached: false,
    turn: null,
    toolCallsBefore,
    injectedTokens: injected,
    toolReadTokens: Math.max(0, ctxOf(last.usage) - injected - (outBefore - (last.usage.output_tokens ?? 0))),
    totalTokens: ctxOf(last.usage) + (last.usage.output_tokens ?? 0),
    turns: turns.length,
    censored: true,
  };
}

// Sum of all tokens in the run (quota proxy): every turn's full context plus output.
export function runTokens(events) {
  return assistantTurns(events).reduce((s, t) => s + ctxOf(t.usage) + (t.usage.output_tokens ?? 0), 0);
}
