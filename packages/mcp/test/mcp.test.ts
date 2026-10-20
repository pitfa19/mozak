import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { handle, TOOLS } from "../src/server.ts";
import { initScopeState, loadInventory } from "@mozak/core";

// Package 1 contract (docs/implementation-package-1-plan-state-review.md, sections 5 and 8).
// Read tools map to API operations; mutation tools map to API operations; every call is actor "agent".
const READ_TOOLS: Record<string, { op: string; args: string[]; required: string[] }> = {
  mozak_context: { op: "context", args: ["scope", "brief", "plan"], required: ["scope"] },
  mozak_plans: { op: "plans", args: ["scope", "all", "includeRejected", "limit", "continuation"], required: [] },
  mozak_scopes: { op: "scopes", args: [], required: [] },
  mozak_sync: { op: "sync", args: ["scope"], required: [] },
  mozak_review_show: { op: "review", args: ["scope", "plan", "purpose", "outcome"], required: ["scope", "plan"] },
  mozak_check: { op: "check", args: ["scope"], required: ["scope"] },
  mozak_operation: { op: "operation", args: ["scope", "id"], required: ["scope", "id"] },
};
const MUTATION_TOOLS: Record<string, { op: string }> = {
  mozak_propose: { op: "propose" },
  mozak_revise: { op: "revise" },
  mozak_observe: { op: "observe" },
  mozak_complete: { op: "complete" },
  mozak_save_discussion: { op: "save-discussion" },
  mozak_attach_spec: { op: "attach-spec" },
};
const ADVERTISED = [...Object.keys(READ_TOOLS), ...Object.keys(MUTATION_TOOLS)].sort();
const FORBIDDEN = [
  "mozak_set_plan",
  "mozak_read",
  "mozak_graph",
  "mozak_translation_packet",
  "mozak_init",
  "mozak_repair",
  "mozak_decide",
  "mozak_review_decide",
  "mozak_approve_direction",
  "mozak_projection_repair",
];

const SYNTHETIC_OWNER = "synthetic-owner:test-fixture";
const OWNER_AT = "2026-10-12T08:00:00.000Z";
const scratchDirs: string[] = [];
const servers: Server[] = [];
after(() => {
  for (const s of servers) s.stop();
  for (const d of scratchDirs) rmSync(d, { recursive: true, force: true });
});

/** A real scratch inventory with one scope created through core's public initScopeState. */
function fixture(): { dir: string; configPath: string; scopeDir: string } {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "mozak-mcp-")));
  scratchDirs.push(dir);
  const scopeDir = join(dir, "alpha");
  mkdirSync(scopeDir);
  writeFileSync(join(scopeDir, "README.md"), "# readme\n");
  writeFileSync(join(scopeDir, "AGENTS.md"), "# agents\n");
  const configPath = join(dir, "inventory.json");
  writeFileSync(configPath, JSON.stringify({ format: "mozak.local/v2", scopes: [{ id: "alpha", root: "./alpha" }] }));
  const inventory = loadInventory(configPath);
  initScopeState(inventory.scopes[0], {
    operationId: "op-init-1",
    scopeId: "alpha",
    kind: "project",
    title: "Alpha",
    expectedAbsent: { graph: true, bridge: true },
    ownerRef: SYNTHETIC_OWNER,
    ownerMessageAt: OWNER_AT,
  });
  return { dir, configPath, scopeDir };
}

function bytes(scopeDir: string): string {
  return readFileSync(join(scopeDir, "mozak.json"), "utf8") + "\u0000" + readFileSync(join(scopeDir, "mozak.md"), "utf8");
}

const PLAN_CONTENT = {
  title: "Ship the thing",
  purpose: "Make the plan reviewable",
  outcomes: [{ id: "o1", statement: "Reviewed", acceptance: "owner", criterion: "Owner accepts" }],
  constraints: [],
  nonGoals: [],
  rationale: "Because it matters",
  questions: [],
  sources: [],
};

/** Long-lived stdio child process using the real entrypoint. */
class Server {
  readonly proc: ChildProcess;
  readonly replies = new Map<string, { id?: unknown; result?: any; error?: { code: number; message: string } }>();
  readonly raw: string[] = [];
  stderr = "";
  private next = 1;
  constructor(args: string[], env: Record<string, string> = {}) {
    const entry = fileURLToPath(new URL("../src/index.ts", import.meta.url));
    this.proc = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", entry, ...args], {
      env: { PATH: process.env.PATH ?? "", ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let buf = "";
    this.proc.stdout!.on("data", (d) => {
      buf += d;
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        this.raw.push(line);
        try {
          const m = JSON.parse(line);
          if (m.id !== undefined) this.replies.set(String(m.id), m);
        } catch {
          /* non-JSON output is recorded in raw and caught by assertions */
        }
      }
    });
    this.proc.stderr!.on("data", (d) => (this.stderr += d));
    servers.push(this);
  }
  stop(): void {
    if (this.proc.exitCode === null && this.proc.signalCode === null) this.proc.kill();
  }
  send(msg: unknown): void {
    this.proc.stdin!.write(JSON.stringify(msg) + "\n");
  }
  async call(method: string, params?: unknown, timeoutMs = 8000) {
    const id = this.next++;
    this.send({ jsonrpc: "2.0", id, method, params });
    return this.awaitId(String(id), timeoutMs);
  }
  async awaitId(id: string, timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs;
    while (!this.replies.has(id) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    const r = this.replies.get(id);
    assert.ok(r, `no reply for id ${id}; stderr: ${this.stderr}`);
    return r;
  }
  /** Calls a tool and returns the transport-level result without interpretation. */
  async tool(name: string, args: Record<string, unknown>) {
    const r = await this.call("tools/call", { name, arguments: args });
    if (r.error) return { isError: true, transportError: r.error, text: r.error.message };
    return { isError: r.result.isError === true, text: r.result.content[0].text as string, transportError: undefined };
  }
}

/** Runs the entrypoint once with given args and returns its exit code and stderr. */
function runOnce(args: string[], env: Record<string, string> = {}): Promise<{ code: number | null; stderr: string }> {
  const entry = fileURLToPath(new URL("../src/index.ts", import.meta.url));
  const p = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", entry, ...args], {
    env: { PATH: process.env.PATH ?? "", ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  p.stderr!.on("data", (d) => (stderr += d));
  p.stdin!.end();
  const killer = setTimeout(() => p.kill(), 5000);
  return new Promise((resolve) => p.on("exit", (code) => {
    clearTimeout(killer);
    resolve({ code, stderr });
  }));
}

async function snapshotOf(s: Server): Promise<{ revision: string; graphHash: string; bridge: { exists: boolean; sha256: string | null } }> {
  const r = await s.tool("mozak_context", { scope: "alpha" });
  assert.equal(r.isError, false, r.text);
  const data = JSON.parse(r.text);
  assert.ok(data.snapshot, "context returns a snapshot token");
  return data.snapshot;
}

// ---- tool metadata -------------------------------------------------------

test("tools/list advertises exactly the thirteen permitted tools", () => {
  const r = handle({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { inventory: emptyInventory(), execute: spyExecute().execute }) as {
    result: { tools: { name: string }[] };
  };
  assert.deepEqual(r.result.tools.map((t) => t.name).sort(), ADVERTISED);
  for (const name of FORBIDDEN) assert.equal(TOOLS.some((t) => t.name === name), false, `${name} must not be advertised`);
});

test("every advertised schema is closed and matches the contract", () => {
  for (const [name, spec] of Object.entries(READ_TOOLS)) {
    const tool = TOOLS.find((t) => t.name === name);
    assert.ok(tool, `${name} exists`);
    const schema = tool.inputSchema as { properties: Record<string, unknown>; required?: string[]; additionalProperties: unknown };
    assert.equal(schema.additionalProperties, false, `${name} is closed`);
    assert.deepEqual(Object.keys(schema.properties).sort(), [...spec.args].sort(), `${name} properties`);
    assert.deepEqual([...(schema.required ?? [])].sort(), [...spec.required].sort(), `${name} required`);
  }
  for (const name of Object.keys(MUTATION_TOOLS)) {
    const tool = TOOLS.find((t) => t.name === name);
    assert.ok(tool, `${name} exists`);
    const schema = tool.inputSchema as { properties: Record<string, unknown>; required?: string[]; additionalProperties: unknown };
    assert.equal(schema.additionalProperties, false, `${name} is closed`);
    assert.deepEqual(Object.keys(schema.properties).sort(), ["request", "scope"], `${name} properties`);
    assert.deepEqual([...(schema.required ?? [])].sort(), ["request", "scope"], `${name} required`);
  }
});

// ---- in-process: routing, actor and argument refusal -----------------------

test("each tool maps to its API operation and always runs as the agent actor", async () => {
  const spy = spyExecute();
  const rt = { inventory: emptyInventory(), execute: spy.execute };
  await handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "mozak_context", arguments: { scope: "alpha" } } }, rt);
  await handle({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "mozak_review_show", arguments: { scope: "alpha", plan: "p1", purpose: "approve-direction" } } }, rt);
  await handle({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "mozak_operation", arguments: { scope: "alpha", id: "op-1" } } }, rt);
  await handle({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "mozak_propose", arguments: { scope: "alpha", request: { operationId: "op-2" } } } }, rt);
  assert.deepEqual(
    spy.calls.map((c) => [c.op, c.actor]),
    [["context", "agent"], ["review", "agent"], ["operation", "agent"], ["propose", "agent"]],
  );
  assert.deepEqual(spy.calls[1].args, { scope: "alpha", plan: "p1", purpose: "approve-direction" });
});

test("runtime refuses unknown arguments such as actor or config, even when metadata would allow them", () => {
  const hostile: [string, Record<string, unknown>][] = [
    ["mozak_context", { scope: "alpha", actor: "owner" }],
    ["mozak_plans", { scope: "alpha", config: "/etc/other.json" }],
    ["mozak_review_show", { scope: "alpha", plan: "p1", actor: "owner" }],
    ["mozak_check", { scope: "alpha", inventory: "./elsewhere.json" }],
    ["mozak_operation", { scope: "alpha", id: "op-1", actor: "owner" }],
    ["mozak_propose", { scope: "alpha", request: {}, actor: "owner" }],
    ["mozak_observe", { scope: "alpha", request: {}, config: "/tmp/x" }],
  ];
  for (const [name, args] of hostile) {
    const spy = spyExecute();
    const r = call({ inventory: emptyInventory(), execute: spy.execute }, name, args);
    assert.equal(r.isError, true, `${name} refuses extra args`);
    assert.match(r.text, /unknown argument/, `${name} names the refusal`);
    assert.equal(spy.calls.length, 0, `${name} never reaches the API`);
  }
});

test("mutation tools refuse a request that is not an object", () => {
  for (const request of ["propose", ["x"], null, 7]) {
    const spy = spyExecute();
    const r = call({ inventory: emptyInventory(), execute: spy.execute }, "mozak_propose", { scope: "alpha", request });
    assert.equal(r.isError, true);
    assert.equal(spy.calls.length, 0);
  }
});

test("a successful API result is passed through as its full JSON", () => {
  const data = { status: "ok", committed: true, operationId: "op-9", snapshot: null, projectionStatus: "current", projectionUpdated: true, issues: [] };
  const r = call({ inventory: emptyInventory(), execute: () => ({ exitCode: 0, data }) }, "mozak_propose", { scope: "alpha", request: {} });
  assert.equal(r.isError, false);
  assert.deepEqual(JSON.parse(r.text), data);
});

test("a committed partial failure keeps its full structured result and sets isError", () => {
  const data = {
    status: "committed-lock-held",
    committed: true,
    operationId: "op-7",
    snapshot: { revision: "r", graphHash: "0".repeat(64), bridge: { exists: true, sha256: "1".repeat(64) } },
    projectionStatus: "current",
    projectionUpdated: true,
    issues: [{ code: "lock-release-failed", message: "held" }],
  };
  const r = call({ inventory: emptyInventory(), execute: () => ({ exitCode: 5, data }) }, "mozak_observe", { scope: "alpha", request: {} });
  assert.equal(r.isError, true);
  assert.deepEqual(JSON.parse(r.text), data, "committed state is not replaced by a generic message");
});

test("malformed tool calls and unknown tools are errors, never crashes", () => {
  const rt = { inventory: emptyInventory(), execute: spyExecute().execute };
  const bad = [
    { name: "mozak_context", arguments: [] },
    { name: "mozak_context", arguments: "alpha" },
    { name: 42, arguments: {} },
    {},
  ];
  for (const params of bad) {
    const r = handle({ jsonrpc: "2.0", id: 5, method: "tools/call", params }, rt) as { error?: { code: number }; result?: unknown };
    assert.ok(r, "a reply is produced");
    assert.ok(r.error || (r.result as { isError?: boolean })?.isError === true, "malformed call is reported");
  }
  assert.equal(handle({ jsonrpc: "2.0", id: 6, method: "tools/call" }, rt) !== null, true);
});

test("legacy, owner and repair names are unknown tools", () => {
  for (const name of FORBIDDEN) {
    const r = handle({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name, arguments: { scope: "alpha", plan: "x", base_hash: "y" } } }, {
      inventory: emptyInventory(),
      execute: spyExecute().execute,
    }) as { error?: { code: number; message: string } };
    assert.equal(r.error?.code, -32602, `${name} is unknown`);
  }
});

// ---- real stdio process ----------------------------------------------------

test("startup refuses a missing, duplicate, unknown or env-only config", async () => {
  const f = fixture();
  const noArgs = await runOnce([], { MOZAK_CONFIG: f.configPath });
  assert.notEqual(noArgs.code, 0, "no --config means no start, even with MOZAK_CONFIG set");
  assert.match(noArgs.stderr, /--config/);

  const dup = await runOnce(["--config", f.configPath, "--config", f.configPath]);
  assert.notEqual(dup.code, 0);
  assert.match(dup.stderr, /--config/);

  const unknown = await runOnce(["--config", f.configPath, "--global"]);
  assert.notEqual(unknown.code, 0);

  const missing = await runOnce(["--config", join(f.dir, "absent.json")]);
  assert.notEqual(missing.code, 0);

  const emptyEq = await runOnce(["--config="]);
  assert.notEqual(emptyEq.code, 0, "--config= with no file is refused");
  assert.match(emptyEq.stderr, /--config requires a FILE/);

  const dupMixed = await runOnce([`--config=${f.configPath}`, "--config", f.configPath]);
  assert.notEqual(dupMixed.code, 0, "mixing both forms still counts as two configs");
  assert.match(dupMixed.stderr, /only once/);
});

test("the stdio server starts with --config=FILE, the form MCP registries pass", async () => {
  const f = fixture();
  const s = new Server([`--config=${f.configPath}`]);
  const init = await s.call("initialize", { protocolVersion: "2024-11-05" });
  assert.equal(init.result.serverInfo.name, "mozak");
  const list = await s.call("tools/list");
  assert.deepEqual(list.result.tools.map((t: { name: string }) => t.name).sort(), ADVERTISED);
});

test("the stdio server advertises only the permitted tools", async () => {
  const f = fixture();
  const s = new Server(["--config", f.configPath]);
  const init = await s.call("initialize", { protocolVersion: "2024-11-05" });
  assert.equal(init.result.serverInfo.name, "mozak");
  const list = await s.call("tools/list");
  assert.deepEqual(list.result.tools.map((t: { name: string }) => t.name).sort(), ADVERTISED);
});

test("the stdio server rejects legacy and owner tool names over the wire", async () => {
  const f = fixture();
  const s = new Server(["--config", f.configPath]);
  for (const name of ["mozak_set_plan", "mozak_graph", "mozak_decide"]) {
    const r = await s.call("tools/call", { name, arguments: {} });
    assert.equal(r.error?.code, -32602, `${name} is an unknown tool`);
  }
});

test("malformed input and oversized lines get error replies and the server keeps running", async () => {
  const f = fixture();
  const s = new Server(["--config", f.configPath]);
  s.proc.stdin!.write("this is not json\n");
  s.proc.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id: "bad-args", method: "tools/call", params: { name: "mozak_context", arguments: [] } }) + "\n");
  s.proc.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id: "bad-params", method: "tools/call", params: null }) + "\n");
  s.proc.stdin!.write("x".repeat(1024 * 1024 + 16) + "\n");
  const ping = await s.call("ping");
  assert.deepEqual(ping.result, {}, "server still answers after abuse");
  assert.equal(s.proc.exitCode, null, "process did not exit");
  const oversized = [...s.replies.values()].some((m) => m.id === null && m.error);
  assert.equal(oversized, true, "oversized line receives an error reply");
  assert.equal(s.replies.get("bad-args")?.error !== undefined || s.replies.get("bad-args")?.result?.isError === true, true);
});

test("real round trip: propose in one process, then a fresh process reads it back", async () => {
  const f = fixture();
  const before = bytes(f.scopeDir);

  const first = new Server(["--config", f.configPath]);
  const snapshot = await snapshotOf(first);
  const proposed = await first.tool("mozak_propose", {
    scope: "alpha",
    request: { operationId: "op-propose-1", scopeId: "alpha", expected: snapshot, action: "propose", payload: { planId: "plan-first", content: PLAN_CONTENT } },
  });
  assert.equal(proposed.isError, false, proposed.text);
  assert.equal(JSON.parse(proposed.text).committed, true);
  first.stop();

  const second = new Server(["--config", f.configPath]);
  const plans = await second.tool("mozak_plans", { scope: "alpha" });
  assert.equal(plans.isError, false, plans.text);
  const grouped = JSON.parse(plans.text);
  const awaitingGroup = grouped.groups?.awaiting;
  assert.ok(awaitingGroup, "plans output has an awaiting group");
  assert.equal(JSON.stringify(awaitingGroup).includes("plan-first"), true, "fresh process sees the pending plan under awaiting");
  const context = await second.tool("mozak_context", { scope: "alpha" });
  assert.match(context.text, /"implementationAuthorized": false/);
  assert.notEqual(bytes(f.scopeDir), before, "the committed proposal changed the scope files");
});

test("a stale snapshot is refused, returns structured status, and leaves files unchanged", async () => {
  const f = fixture();
  const s = new Server(["--config", f.configPath]);
  const snapshot = await snapshotOf(s);
  const ok = await s.tool("mozak_propose", {
    scope: "alpha",
    request: { operationId: "op-a", scopeId: "alpha", expected: snapshot, action: "propose", payload: { planId: "plan-first", content: PLAN_CONTENT } },
  });
  assert.equal(ok.isError, false, ok.text);
  const afterFirst = bytes(f.scopeDir);

  const stale = await s.tool("mozak_propose", {
    scope: "alpha",
    request: { operationId: "op-b", scopeId: "alpha", expected: snapshot, action: "propose", payload: { planId: "plan-second", content: { ...PLAN_CONTENT, title: "Second" } } },
  });
  assert.equal(stale.isError, true);
  const result = JSON.parse(stale.text);
  assert.equal(result.committed, false);
  assert.ok(Array.isArray(result.issues) && result.issues.length > 0, "structured issues are kept");
  assert.equal(bytes(f.scopeDir), afterFirst, "refused write changed nothing");
});

test("route mismatch and owner-only actions are refused through mozak_propose and change nothing", async () => {
  const f = fixture();
  const s = new Server(["--config", f.configPath]);
  const snapshot = await snapshotOf(s);
  const before = bytes(f.scopeDir);
  const mismatch = await s.tool("mozak_propose", {
    scope: "alpha",
    request: { operationId: "op-m1", scopeId: "alpha", expected: snapshot, action: "observe", payload: {} },
  });
  assert.equal(mismatch.isError, true);
  const owner = await s.tool("mozak_propose", {
    scope: "alpha",
    request: { operationId: "op-m2", scopeId: "alpha", expected: snapshot, action: "approve-direction", payload: { planId: "x", reason: "yes" } },
  });
  assert.equal(owner.isError, true);
  assert.equal(bytes(f.scopeDir), before, "failed owner attempts changed nothing");
});

test("a failed attempt to pass an extra argument over stdio changes nothing", async () => {
  const f = fixture();
  const s = new Server(["--config", f.configPath]);
  const snapshot = await snapshotOf(s);
  const before = bytes(f.scopeDir);
  const r = await s.tool("mozak_observe", {
    scope: "alpha",
    actor: "owner",
    request: { operationId: "op-x", scopeId: "alpha", expected: snapshot, action: "observe", payload: {} },
  });
  assert.equal(r.isError, true);
  assert.match(r.text, /unknown argument/);
  assert.equal(bytes(f.scopeDir), before);
});

// ---- helpers ---------------------------------------------------------------

function emptyInventory() {
  return { format: "mozak.local/v2", scopes: [], digest: "0".repeat(64) };
}

function spyExecute(result: { exitCode: number; data: unknown } = { exitCode: 0, data: { ok: true } }) {
  const calls: { op: string; args: Record<string, unknown>; actor: string }[] = [];
  const execute = (_inventory: unknown, op: string, args: Record<string, unknown>, actor: string) => {
    calls.push({ op, args, actor });
    return result;
  };
  return { calls, execute };
}

function call(rt: { inventory: unknown; execute: unknown }, name: string, args: Record<string, unknown>) {
  const r = handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, rt as never) as {
    result: { content: { text: string }[]; isError?: boolean };
  };
  return { text: r.result.content[0].text, isError: r.result.isError === true };
}

// ---- JSON-RPC envelope, params and transport hardening (bounded) -----------

const MUTATION_NAMES = ["mozak_propose", "mozak_revise", "mozak_observe", "mozak_complete", "mozak_save_discussion", "mozak_attach_spec"];

/** Runtime whose execute spy records every reach into the API. A spy that is called is a bypass. */
function guardRuntime() {
  const spy = spyExecute({ exitCode: 0, data: { status: "ok", committed: true } });
  return { spy, rt: { inventory: emptyInventory(), execute: spy.execute } as never };
}

const mutationCall = (id: unknown = 1) => ({
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: { name: "mozak_propose", arguments: { scope: "alpha", request: { operationId: "op-env" } } },
});

test("envelope: wrong or missing jsonrpc version never reaches dispatch", () => {
  for (const version of [undefined, "1.0", 2, "2.0 ", null, true]) {
    const { spy, rt } = guardRuntime();
    const msg = { ...mutationCall(), jsonrpc: version };
    const r = handle(msg, rt) as { error?: { code: number } };
    assert.equal(r?.error?.code, -32600, `jsonrpc ${JSON.stringify(version)} is an invalid request`);
    assert.equal(spy.calls.length, 0, `jsonrpc ${JSON.stringify(version)} executed nothing`);
  }
});

test("envelope: id must be a string, a finite number or null; objects and arrays are refused", () => {
  const bad: unknown[] = [{ nested: 1 }, [1], true, Number.NaN, Number.POSITIVE_INFINITY, 1.5e400];
  for (const id of bad) {
    const { spy, rt } = guardRuntime();
    const r = handle({ ...mutationCall(), id }, rt) as { error?: { code: number } };
    assert.equal(r?.error?.code, -32600, `id ${JSON.stringify(id)} is refused`);
    assert.equal(spy.calls.length, 0, `id ${JSON.stringify(id)} executed nothing`);
  }
});

test("envelope: a string or finite number id is accepted and echoed", () => {
  for (const id of ["req-1", 0, 42, -7]) {
    const { rt, spy } = guardRuntime();
    const r = handle(mutationCall(id), rt) as { id: unknown; result?: unknown };
    assert.equal(r.id, id);
    assert.ok(r.result, "a well-formed request still runs");
    assert.equal(spy.calls.length, 1);
  }
});

test("envelope: method must be a nonempty string", () => {
  for (const method of [undefined, "", 7, null, ["tools/call"], { name: "tools/call" }]) {
    const { spy, rt } = guardRuntime();
    const r = handle({ jsonrpc: "2.0", id: 1, method, params: mutationCall().params }, rt) as { error?: { code: number } };
    assert.ok(r?.error, `method ${JSON.stringify(method)} is refused`);
    assert.equal(spy.calls.length, 0);
  }
});

test("envelope: a non-object message, array batch or inherited-prototype message is refused", () => {
  const { spy, rt } = guardRuntime();
  for (const msg of [null, "tools/call", 7, [mutationCall()]]) {
    const r = handle(msg, rt) as { error?: { code: number } };
    assert.equal(r?.error?.code, -32600);
  }
  const proto = Object.create({ jsonrpc: "2.0", id: 1, method: "tools/call", params: mutationCall().params });
  const r = handle(proto, rt) as { error?: { code: number } };
  assert.equal(r?.error?.code, -32600, "inherited envelope fields are not trusted");
  assert.equal(spy.calls.length, 0);
});

test("envelope: a notification with a malformed envelope never executes a mutation", () => {
  const { spy, rt } = guardRuntime();
  // A bad version is not a notification. It is malformed and gets an error reply.
  const malformed = handle({ jsonrpc: "1.0", method: "tools/call", params: mutationCall().params }, rt) as { error?: { code: number } };
  assert.equal(malformed?.error?.code, -32600, "bad version is an error, not silence");
  // A well-formed 2.0 notification is silent, and still runs nothing here because the message has no id.
  assert.equal(handle({ jsonrpc: "2.0", method: "tools/call", params: mutationCall().params }, rt), null, "a real notification gets no reply");
  assert.equal(spy.calls.length, 0, "neither a malformed message nor a notification executed a mutation");
});

test("params: unknown tools/call keys are refused, even alongside a valid tool", () => {
  for (const extra of [{ foo: 1 }, { actor: "owner" }, { config: "/tmp/x" }, { meta: {} }]) {
    const { spy, rt } = guardRuntime();
    const msg = { ...mutationCall(), params: { ...mutationCall().params, ...extra } };
    const r = handle(msg, rt) as { error?: { code: number; message: string } };
    assert.equal(r?.error?.code, -32602, `key ${Object.keys(extra)[0]} is refused`);
    assert.equal(spy.calls.length, 0, `key ${Object.keys(extra)[0]} executed nothing`);
  }
});

test("params: standard _meta object is the only accepted extra key and is not forwarded", () => {
  const { spy, rt } = guardRuntime();
  const msg = { ...mutationCall(), params: { ...mutationCall().params, _meta: { progressToken: "t1" } } };
  const r = handle(msg, rt) as { result?: { isError?: boolean } };
  assert.equal(r.result?.isError, undefined, "a valid _meta call still runs");
  assert.equal(spy.calls.length, 1);
  assert.equal(Object.hasOwn(spy.calls[0].args, "_meta"), false, "_meta never reaches the API arguments");

  const { spy: spy2, rt: rt2 } = guardRuntime();
  for (const meta of ["t1", 7, null, [1]]) {
    const bad = handle({ ...mutationCall(), params: { ...mutationCall().params, _meta: meta } }, rt2) as { error?: { code: number }; result?: unknown };
    assert.ok(bad.error || (bad.result as { isError?: boolean })?.isError === true, `_meta ${JSON.stringify(meta)} refused`);
  }
  assert.equal(spy2.calls.length, 0);
});

test("params: a mutation with extra keys inside tool arguments is refused by the MCP boundary", () => {
  const { spy, rt } = guardRuntime();
  const r = handle({ ...mutationCall(), params: { name: "mozak_propose", arguments: { scope: "alpha", request: {}, owner: "x" } } }, rt) as {
    result: { isError?: boolean; content: { text: string }[] };
  };
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /unknown argument/);
  assert.equal(spy.calls.length, 0);
});

test("envelope: every malformed mutation shape across methods executes nothing", () => {
  const { spy, rt } = guardRuntime();
  const shapes: unknown[] = [
    { jsonrpc: "2.0", id: { a: 1 }, method: "tools/call", params: mutationCall().params },
    { jsonrpc: "2.0", id: 1, method: "", params: mutationCall().params },
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "mozak_propose", arguments: null } },
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: MUTATION_NAMES[0], arguments: { scope: "alpha", request: {} }, extra: 1 } },
    { jsonrpc: "1.0", id: 1, method: "tools/call", params: mutationCall().params },
  ];
  for (const msg of shapes) handle(msg, rt);
  assert.equal(spy.calls.length, 0, "no malformed envelope reached the API");
});

test("transport: a line that is not valid UTF-8 is refused, not silently rewritten", async () => {
  const f = fixture();
  const before = bytes(f.scopeDir);
  const s = new Server(["--config", f.configPath]);
  const good = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "mozak_context", arguments: { scope: "alpha" } } });
  // 0xff is never valid UTF-8. A replacement-character repair would turn a bad request into a valid-looking one.
  s.proc.stdin!.write(Buffer.concat([Buffer.from('{"jsonrpc":"2.0","id":"u1","method":"tools/call","params":{"name":"mozak_propose","arguments":{"scope":"alpha","request":{"operationId":"op-\xff"}}}}\n', "latin1"), Buffer.from(good + "\n")]));
  // The id is unreadable once the bytes are invalid, so the refusal carries id null.
  const refused = await s.awaitId("null");
  assert.equal(refused.error?.code, -32700, "invalid UTF-8 is a parse-level error");
  // The valid context request that followed is answered, so the server kept running.
  const after = await s.awaitId("1");
  assert.equal(after.result?.isError, undefined, "the following valid request still runs");
  assert.equal(s.replies.has("u1"), false, "the mangled request is never answered as valid");
  assert.equal(bytes(f.scopeDir), before, "bad-UTF-8 request changed nothing");
});

// ---- transport: large output must survive immediate end of input -----------

/**
 * A real reply above 64 KiB: a real propose stores a large rationale, then a real review_show
 * returns it. The request is sent and stdin ends at once. A forced exit could cut the reply short.
 */
test("transport: a >64KiB real reply is complete valid JSON when stdin ends immediately", async () => {
  const f = fixture();
  const entry = fileURLToPath(new URL("../src/index.ts", import.meta.url));
  const run = (lines: string[]) =>
    new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
      const child = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", entry, "--config", f.configPath], {
        env: { PATH: process.env.PATH ?? "" },
        stdio: ["pipe", "pipe", "pipe"],
      });
      const out: Buffer[] = [];
      let err = "";
      child.stdout!.on("data", (d: Buffer) => out.push(d));
      child.stderr!.on("data", (d) => (err += d));
      child.stdin!.end(lines.join("\n") + "\n");
      child.on("exit", (code) => resolve({ code, stdout: Buffer.concat(out).toString("utf8"), stderr: err }));
    });

  const ctx = await run([JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "mozak_context", arguments: { scope: "alpha" } } })]);
  const snapshot = JSON.parse(JSON.parse(ctx.stdout.trim()).result.content[0].text).snapshot;
  const big = "r".repeat(80 * 1024);
  const content = { title: "Big", purpose: "p", outcomes: [{ id: "o1", statement: "s", acceptance: "owner", criterion: "c" }], constraints: [], nonGoals: [], rationale: big, questions: [], sources: [] };
  const prop = await run([JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "mozak_propose", arguments: { scope: "alpha", request: { operationId: "op-big", scopeId: "alpha", expected: snapshot, action: "propose", payload: { planId: "plan-big", content } } } } })]);
  assert.equal(JSON.parse(JSON.parse(prop.stdout.trim()).result.content[0].text).committed, true, `propose committed; stderr: ${prop.stderr}`);

  const req = JSON.stringify({ jsonrpc: "2.0", id: "big", method: "tools/call", params: { name: "mozak_review_show", arguments: { scope: "alpha", plan: "plan-big" } } });
  const res = await run([req]);
  assert.equal(res.code, 0, `clean exit after input ends; stderr: ${res.stderr}`);
  const lines = res.stdout.split("\n").filter((l) => l.length > 0);
  assert.equal(lines.length, 1, "exactly one reply");
  assert.ok(lines[0].length > 64 * 1024, `reply is larger than 64 KiB (${lines[0].length} bytes)`);
  const reply = JSON.parse(lines[0]);
  assert.equal(reply.id, "big");
  assert.equal(reply.result?.isError, undefined, "review_show succeeded");
  const inner = JSON.parse(reply.result.content[0].text);
  assert.equal(inner.operation, "review");
  assert.equal(inner.review.proposal.content.rationale.length >= big.length, true, "the full rationale is in the reply");
});

// ---- A08 / A09: real built CLI scenario, then fresh MCP parity ------------------

const CLI_ENTRY = fileURLToPath(new URL("../../cli/dist/index.js", import.meta.url));
const OWNER_REF = "synthetic-owner:parity-fixture";
const OWNER_MSG_AT = "2026-10-12T08:05:00.000Z";

/** Runs the real built CLI as a child process. Returns its exit code and parsed stdout JSON. */
function cli(configPath: string, args: string[]): { code: number | null; json: any; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, ["--no-warnings", CLI_ENTRY, ...args, "--config", configPath], { encoding: "utf8" });
  let json: unknown = undefined;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    /* non-JSON stdout is kept in the raw field for diagnosis */
  }
  return { code: r.status, json, stdout: r.stdout, stderr: r.stderr };
}

function writeRequest(dir: string, name: string, body: unknown): string {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(body));
  return path;
}

/** Runs a single MCP stdio call against a fresh process and returns the parsed API output. */
async function mcpOnce(configPath: string, name: string, args: Record<string, unknown>): Promise<{ isError: boolean; data: any }> {
  const s = new Server(["--config", configPath]);
  const r = await s.tool(name, args);
  s.stop();
  return { isError: r.isError, data: JSON.parse(r.text) };
}

/**
 * Normalises a context DTO for CLI/MCP parity. Compares the real canonical plan records and scope fields.
 * Snapshot tokens are excluded: they are per-read identity, not semantic content.
 */
function normalizeContext(d: any) {
  return {
    status: d.status,
    scopeId: d.context?.scopeId,
    implementationAuthorized: d.context?.implementationAuthorized,
    plans: (d.context?.plans ?? []).map((p: any) => ({
      planId: p.planId,
      lifecycle: p.lifecycle,
      accepted: p.accepted,
      pending: p.pending,
      effectiveDecisions: p.effectiveDecisions,
      permittedNextAction: p.permittedNextAction,
      nextAction: p.nextAction,
      implementationAuthorized: p.implementationAuthorized,
      reviewNeeded: p.reviewNeeded,
      historicalLinks: p.historicalLinks,
      completionRecords: p.completionRecords,
      // Full plan records carry the content, observations, decisions and links that must match exactly.
      observations: p.observations,
      decisions: p.decisions,
      reasoningLinks: p.reasoningLinks,
    })),
  };
}

test("A08/A09: a real built CLI scenario, then a fresh MCP process returns equivalent context and review DTOs", async () => {
  const f = fixture();
  // The fixture already initialised the scope through core. This scenario drives the real CLI from a clean scope instead.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "mozak-parity-")));
  scratchDirs.push(dir);
  const scopeDir = join(dir, "beta");
  mkdirSync(scopeDir);
  writeFileSync(join(scopeDir, "README.md"), "# beta\n");
  writeFileSync(join(scopeDir, "AGENTS.md"), "# beta agents\n");
  const cfgPath = join(dir, "inventory.json");
  writeFileSync(cfgPath, JSON.stringify({ format: "mozak.local/v2", scopes: [{ id: "beta", root: "./beta" }] }));

  // 1. Init through the real built CLI (owner route).
  const initReq = writeRequest(dir, "init.json", {
    operationId: "op-init",
    scopeId: "beta",
    kind: "project",
    title: "Beta",
    expectedAbsent: { graph: true, bridge: true },
    ownerRef: OWNER_REF,
    ownerMessageAt: OWNER_MSG_AT,
  });
  const init = cli(cfgPath, ["scope", "init", "--scope", "beta", "--request", initReq]);
  assert.equal(init.code, 0, `init exits 0; stdout: ${init.stdout} stderr: ${init.stderr}`);

  // 2. Propose a plan through the real CLI (agent route).
  const ctx0 = cli(cfgPath, ["context", "--scope", "beta", "--json"]);
  assert.equal(ctx0.code, 0, `context before propose: ${ctx0.stdout}`);
  const proposeReq = writeRequest(dir, "propose.json", {
    operationId: "op-propose",
    scopeId: "beta",
    expected: ctx0.json.snapshot,
    action: "propose",
    payload: { planId: "plan-beta", content: { ...PLAN_CONTENT, title: "Beta plan" } },
  });
  const propose = cli(cfgPath, ["plan", "propose", "--scope", "beta", "--request", proposeReq]);
  assert.equal(propose.code, 0, `propose exits 0; stdout: ${propose.stdout}`);

  // 3. Owner reads the exact review, then approves that exact displayed digest.
  const review1 = cli(cfgPath, ["review", "show", "--scope", "beta", "--plan", "plan-beta", "--json"]);
  assert.equal(review1.code, 0, `review show: ${review1.stdout}`);
  const approveReq = writeRequest(dir, "approve.json", {
    operationId: "op-approve",
    scopeId: "beta",
    expected: (cli(cfgPath, ["context", "--scope", "beta", "--json"]).json).snapshot,
    action: "approve-direction",
    payload: {
      planId: "plan-beta",
      revisionId: review1.json.review.revisionId,
      reviewDigest: review1.json.review.reviewDigest,
      ownerRef: OWNER_REF,
      ownerMessageAt: OWNER_MSG_AT,
      reason: "owner approves the beta direction",
    },
  });
  const approve = cli(cfgPath, ["review", "decide", "--scope", "beta", "--request", approveReq]);
  assert.equal(approve.code, 0, `approve exits 0; stdout: ${approve.stdout}`);

  // 4. Agent observes a sourced fact, then revises the accepted plan into a new awaiting revision.
  const obsReq = writeRequest(dir, "observe.json", {
    operationId: "op-observe",
    scopeId: "beta",
    expected: (cli(cfgPath, ["context", "--scope", "beta", "--json"]).json).snapshot,
    action: "observe",
    payload: {
      planId: "plan-beta",
      observation: {
        id: "obs-1",
        classification: "observed",
        summary: "The beta README states the goal",
        evidence: [
          {
            id: "ev-1",
            locator: "beta/README.md",
            anchor: null,
            version: null,
            inspectedAt: "2026-10-12T08:06:00.000Z",
            activity: { kind: "read", description: "read README" },
            result: { verdict: "pass", summary: "goal present" },
            limitations: [],
          },
        ],
      },
    },
  });
  const observe = cli(cfgPath, ["observe", "--scope", "beta", "--request", obsReq]);
  assert.equal(observe.code, 0, `observe exits 0; stdout: ${observe.stdout}`);

  const reviseReq = writeRequest(dir, "revise.json", {
    operationId: "op-revise",
    scopeId: "beta",
    expected: (cli(cfgPath, ["context", "--scope", "beta", "--json"]).json).snapshot,
    action: "revise",
    payload: { planId: "plan-beta", acceptedRevisionId: approve.json.result?.ids?.[1] ?? null, pendingRevisionId: null, content: { ...PLAN_CONTENT, title: "Beta plan revised" } },
  });
  const revise = cli(cfgPath, ["plan", "revise", "--scope", "beta", "--request", reviseReq]);
  assert.equal(revise.code, 0, `revise exits 0; stdout: ${revise.stdout}`);

  // 5. Read context and review through the built CLI.
  const cliCtx = cli(cfgPath, ["context", "--scope", "beta", "--json"]);
  const cliRev = cli(cfgPath, ["review", "show", "--scope", "beta", "--plan", "plan-beta", "--json"]);
  assert.equal(cliCtx.code, 0);
  assert.equal(cliRev.code, 0);

  // 6. Read the same through a fresh MCP stdio process each time.
  const mcpCtx = await mcpOnce(cfgPath, "mozak_context", { scope: "beta" });
  const mcpRev = await mcpOnce(cfgPath, "mozak_review_show", { scope: "beta", plan: "plan-beta" });
  assert.equal(mcpCtx.isError, false, "mcp context ok");
  assert.equal(mcpRev.isError, false, "mcp review ok");

  // 7. Deep-compare: MCP and CLI must agree on the normalized DTO.
  assert.deepEqual(normalizeContext(mcpCtx.data), normalizeContext(cliCtx.json), "context DTO parity");
  assert.deepEqual(mcpRev.data.review, cliRev.json.review, "review DTO parity");

  // The observation is committed (observe exits 0). Context and review must expose it. Asserted, not skipped.
  const observed = JSON.stringify(mcpCtx.data).includes("obs-1") || JSON.stringify(mcpRev.data).includes("obs-1");
  assert.equal(observed, true, "the committed observation obs-1 is visible in context or review");
  const evidenced = JSON.stringify(mcpCtx.data).includes("ev-1") || JSON.stringify(mcpRev.data).includes("ev-1");
  assert.equal(evidenced, true, "the observation evidence ev-1 is visible in context or review");
  // 8. Meaning checks on the real output, read from the fields the API actually returns.
  const plan = mcpCtx.data.context.plans.find((p: { planId: string }) => p.planId === "plan-beta");
  assert.ok(plan, "plan-beta is in context");
  // Context carries canonical records: accepted.id, pending.id, accepted.content, and provenance links.
  assert.ok(plan.accepted && typeof plan.accepted.id === "string", "accepted direction is present with its canonical id");
  assert.equal(plan.accepted.content.title, "Beta plan", "accepted meaning: the title approved by the owner");
  assert.equal(plan.accepted.content.outcomes[0].statement, "Reviewed", "accepted meaning: the outcome approved by the owner");
  assert.equal(typeof plan.accepted.directionDecisionId, "string", "accepted direction records its decision");
  assert.equal(plan.effectiveDecisions["approve-direction"], plan.accepted.directionDecisionId, "the effective approval is the accepted decision");
  const decision = plan.decisions.find((d: { id: string }) => d.id === plan.accepted.directionDecisionId);
  assert.ok(decision, "the accepted decision is recorded on the plan");
  assert.equal(decision.purpose, "approve-direction", "provenance: the decision is the owner direction approval");
  assert.equal(decision.revisionId, plan.accepted.acceptedFromRevision, "provenance: the decision binds the revision it approved");
  assert.equal(decision.contentDigest, plan.accepted.contentDigest, "provenance: the decision binds the approved content digest");
  assert.equal(decision.ownerRef, "synthetic-owner:parity-fixture", "provenance: the owner reference is kept");
  assert.ok(plan.pending && plan.pending.reviewState === "awaiting", "the revision is pending for review");
  assert.notEqual(plan.pending.id, plan.accepted.id, "the pending revision is a distinct revision");
  assert.equal(plan.pending.content.title, "Beta plan revised", "pending meaning: the revised title awaiting review");
  assert.equal(plan.pending.baseAcceptedRevision, plan.accepted.id, "pending is based on the accepted revision");
  assert.equal(plan.pending.baseAcceptedDigest, plan.accepted.contentDigest, "pending is based on the accepted digest");
  assert.equal(plan.observations[0].id, "obs-1", "the observation is recorded on the plan");
  assert.equal(plan.observations[0].classification, "observed", "the observation keeps its classification");
  assert.equal(plan.observations[0].evidence[0].id, "ev-1", "the observation keeps its evidence");
  assert.equal(plan.observations[0].evidence[0].result.verdict, "pass", "the evidence keeps its verdict");
  assert.equal(plan.permittedNextAction, "owner-review-direction", "the permitted next action is owner review");
  assert.equal(plan.implementationAuthorized, false, "implementation is not authorised for the plan");
  assert.equal(mcpCtx.data.context.implementationAuthorized, false, "implementation is not authorised for the scope");
  assert.equal(mcpRev.data.review.implementationAuthorized, false, "review does not authorise implementation");
  assert.equal(mcpRev.data.review.purpose, "approve-direction", "review is for the owner direction action");
  assert.ok(mcpRev.data.review.changedFields.includes("title"), "review shows the changed title");
  void f;
});

// ---- A04: protected nested-field injection reaches runtime core, both transports -------------

/** A valid observe request for an existing plan, with one protected field injected at a chosen depth. */
function observeWith(snapshot: unknown, inject: "payload.accepted" | "observation.implementationAuthorization" | "payload.decisions") {
  const observation = {
    id: "obs-injected",
    classification: "observed",
    summary: "A valid observation",
    evidence: [
      { id: "ev-injected", locator: "alpha/README.md", anchor: null, version: null, inspectedAt: "2026-10-12T08:06:00.000Z", activity: { kind: "read", description: "read" }, result: { verdict: "pass", summary: "ok" }, limitations: [] },
    ],
  };
  const payload: Record<string, unknown> = { planId: "plan-alpha", observation };
  if (inject === "payload.accepted") payload.accepted = { id: "forged", content: PLAN_CONTENT };
  if (inject === "payload.decisions") payload.decisions = [{ id: "forged-decision", purpose: "approve-direction" }];
  if (inject === "observation.implementationAuthorization") (observation as Record<string, unknown>).implementationAuthorization = { granted: true };
  return { operationId: `op-inject-${inject.replace(/\W/g, "-")}`, scopeId: "alpha", expected: snapshot, action: "observe", payload };
}

/** Seeds plan-alpha through core so there is a real plan for the observe to target. */
async function seedPlan(s: Server, f: ReturnType<typeof fixture>): Promise<void> {
  const snapshot = await snapshotOf(s);
  const seeded = await s.tool("mozak_propose", {
    scope: "alpha",
    request: { operationId: "op-seed-alpha", scopeId: "alpha", expected: snapshot, action: "propose", payload: { planId: "plan-alpha", content: PLAN_CONTENT } },
  });
  assert.equal(seeded.isError, false, `seed plan: ${seeded.text}`);
  void f;
}

for (const inject of ["payload.accepted", "payload.decisions", "observation.implementationAuthorization"] as const) {
  test(`A04 stdio: a valid observe with injected ${inject} is refused by core and changes no bytes`, async () => {
    const f = fixture();
    const s = new Server(["--config", f.configPath]);
    await seedPlan(s, f);
    const before = bytes(f.scopeDir);
    const snapshot = await snapshotOf(s);
    const r = await s.tool("mozak_observe", { scope: "alpha", request: observeWith(snapshot, inject) });
    assert.equal(r.isError, true, "the injected request is refused");
    const data = JSON.parse(r.text);
    assert.equal(data.committed, false, "nothing was committed");
    assert.equal(data.status, "invalid-payload", `refused by core validation, not the MCP boundary: ${r.text}`);
    const field = inject.split(".").pop()!;
    assert.ok(
      data.issues.some((i: { message: string }) => i.message.includes(field)),
      `the issue names the injected field "${field}": ${JSON.stringify(data.issues)}`,
    );
    assert.equal(bytes(f.scopeDir), before, "mozak.json and mozak.md are byte-identical after the refusal");
  });
}

for (const inject of ["payload.accepted", "payload.decisions", "observation.implementationAuthorization"] as const) {
  test(`A04 CLI: the same injected ${inject} is refused by the built CLI with the same status and no bytes changed`, async () => {
    const f = fixture();
    const s = new Server(["--config", f.configPath]);
    await seedPlan(s, f);
    s.stop();
    const before = bytes(f.scopeDir);
    const snapshot = await snapshotOf(new Server(["--config", f.configPath]));
    const request = observeWith(snapshot, inject);
    const reqPath = join(f.dir, `inject-${inject.replace(/\W/g, "-")}.json`);
    writeFileSync(reqPath, JSON.stringify(request));
    const r = cli(f.configPath, ["observe", "--scope", "alpha", "--request", reqPath]);
    assert.equal(r.code, 2, `CLI refuses with exit 2: ${r.stdout} ${r.stderr}`);
    assert.equal(r.json?.committed, false, "nothing was committed");
    assert.equal(r.json?.status, "invalid-payload", "same refusal status as the MCP transport");
    const field = inject.split(".").pop()!;
    assert.ok(r.json.issues.some((i: { message: string }) => i.message.includes(field)), "the CLI names the injected field");
    assert.equal(bytes(f.scopeDir), before, "CLI refusal leaves mozak.json and mozak.md byte-identical");
  });
}

test("A04 control: the same valid observe without injection commits, so refusals are caused by the field", async () => {
  const f = fixture();
  const s = new Server(["--config", f.configPath]);
  await seedPlan(s, f);
  const snapshot = await snapshotOf(s);
  const req = observeWith(snapshot, "payload.accepted");
  delete (req.payload as Record<string, unknown>).accepted;
  const ok = await s.tool("mozak_observe", { scope: "alpha", request: req });
  assert.equal(ok.isError, false, `valid observe commits: ${ok.text}`);
  assert.equal(JSON.parse(ok.text).committed, true, "the clean observation is committed");
  assert.notEqual(bytes(f.scopeDir), "", "the scope bytes changed");
});

// ---------- mozak_scopes: read-only navigation index ----------

test("mozak_scopes takes no arguments and refuses any, so an agent cannot choose a path or scope", () => {
  const def = TOOLS.find((t) => t.name === "mozak_scopes")!;
  assert.deepEqual(def.inputSchema.properties, {});
  assert.deepEqual(def.inputSchema.required, []);
  assert.equal(def.inputSchema.additionalProperties, false);
});

test("mozak_scopes is dispatched as a read-only agent operation and never as an owner action", () => {
  const calls: { op: string; actor: string }[] = [];
  const runtime = {
    inventory: { format: "mozak.local/v2", scopes: [], digest: "x" },
    execute: (_inv: unknown, op: string, _args: unknown, actor: string) => {
      calls.push({ op, actor });
      return { exitCode: 0, data: { status: "ok", committed: false, operation: op } };
    },
  };
  const reply = handle({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "mozak_scopes", arguments: {} } }, runtime as never);
  assert.ok(reply);
  assert.deepEqual(calls, [{ op: "scopes", actor: "agent" }]);
});

test("mozak_scopes rejects an unexpected argument before reaching the core", () => {
  let reached = false;
  const runtime = {
    inventory: { format: "mozak.local/v2", scopes: [], digest: "x" },
    execute: () => { reached = true; return { exitCode: 0, data: {} }; },
  };
  const reply = handle({ jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "mozak_scopes", arguments: { root: "/etc" } } }, runtime as never) as { error?: unknown; result?: { isError?: boolean } };
  assert.equal(reached, false);
  assert.ok(reply.error || reply.result?.isError);
});
