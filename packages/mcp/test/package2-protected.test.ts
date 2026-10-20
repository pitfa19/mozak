import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readScope } from "../../core/src/scope-store.ts";
import { loadInventory } from "../../core/src/scope-index.ts";

// Package 2 nested protected-field attacks through a FRESH BUILT MCP child (packages/mcp/dist/index.js).
// Each attack is a valid-looking new-route call with one protected or forged field inside it. Every case asserts
// the exact refusal reason, that no commit happened, that graph and bridge bytes are byte-identical, and that no
// implementation grant appeared. Clean controls commit. Owner setup goes through the BUILT CLI owner path.
// Owner references are explicit synthetic fixture values.

const scratch = process.env.JCODE_SCRATCH_DIR ?? process.env.TMPDIR;
if (!scratch) throw new Error("scratch directory required");
const roots: string[] = [];
const children: ChildProcess[] = [];
after(() => {
  for (const c of children) if (c.exitCode === null) c.kill();
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});
const cliPath = fileURLToPath(new URL("../../cli/dist/index.js", import.meta.url));
const mcpPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));

const DIRECTION = { ref: "synthetic-owner:fixture-direction", at: "2026-10-12T08:00:00.000Z" };
const OWN_ANSWER = { basis: "owner", ownerRef: "synthetic-owner:fixture-clarification", ownerMessageAt: "2026-10-12T08:02:00.000Z", evidence: [] };
const EVIDENCE = { id: "e", locator: "synthetic:x", anchor: null, version: "v", inspectedAt: DIRECTION.at, activity: { kind: "run", description: "d" }, result: { verdict: "pass", summary: "s" }, limitations: ["l"] };
const BOUNDS = { summary: "Fixture formatter bounds", allowedPaths: ["spec.md"], excludedActions: [], outcomeChecks: [{ outcomeId: "o1", criterion: "Owner accepts" }], limitations: [] };

const content = {
  title: "Protected fields over MCP",
  purpose: "Preserve agreed meaning",
  outcomes: [{ id: "o1", statement: "Protected fields stay protected", acceptance: "owner", criterion: "Owner accepts" }],
  constraints: [],
  nonGoals: [],
  rationale: "Avoid forged authority",
  questions: [],
  sources: [{ id: "source", locator: "synthetic:source", anchor: null, observedAt: DIRECTION.at, version: "fixture-v1", limitations: ["Synthetic fixture"] }],
};

/** Owner setup through the built CLI, ending with an accepted plan and no discussion, specification or grant. */
function fixture() {
  const root = mkdtempSync(join(scratch!, "mozak-mcp-protected-"));
  roots.push(root);
  const path = join(root, "one");
  mkdirSync(path);
  writeFileSync(join(path, "README.md"), "# readme\n");
  writeFileSync(join(path, "AGENTS.md"), "# agents\n");
  writeFileSync(join(path, "spec.md"), "# Spec\n\nSynthetic bounded specification.\n");
  const config = join(root, "inventory.json");
  writeFileSync(config, JSON.stringify({ format: "mozak.local/v2", scopes: [{ id: "one", root: "./one" }] }));

  const cli = (args: string[]) => {
    const p = spawnSync(process.execPath, ["--no-warnings", cliPath, ...args, "--config", config, "--json"], { encoding: "utf8", timeout: 15000 });
    assert.ok(p.stdout, p.stderr);
    return JSON.parse(p.stdout);
  };
  const snapshot = () => cli(["context", "--scope", "one"]).snapshot;
  let seq = 0;
  const envelope = (action: string, payload: object, route: string[]) => {
    const file = join(root, `req-${seq++}.json`);
    writeFileSync(file, JSON.stringify({ operationId: `setup-${seq}`, scopeId: "one", expected: snapshot(), action, payload }));
    return cli([...route, "--scope", "one", "--request", file]);
  };
  const init = join(root, "init.json");
  writeFileSync(init, JSON.stringify({ operationId: "init-one", scopeId: "one", kind: "project", title: "one", expectedAbsent: { graph: true, bridge: true }, ownerRef: DIRECTION.ref, ownerMessageAt: DIRECTION.at }));
  assert.equal(cli(["scope", "init", "--scope", "one", "--request", init]).status, "ok");
  assert.equal(envelope("propose", { planId: "plan-a", content }, ["plan", "propose"]).status, "ok");
  const pending = cli(["review", "show", "--scope", "one", "--plan", "plan-a", "--purpose", "approve-direction"]).review;
  assert.equal(envelope("approve-direction", { planId: "plan-a", revisionId: pending.revisionId, reviewDigest: pending.reviewDigest, ownerRef: DIRECTION.ref, ownerMessageAt: DIRECTION.at, reason: "Synthetic owner direction" }, ["review", "decide"]).status, "ok");
  const acceptedId = readScope(loadInventory(config).scopes[0]).state.plans[0]!.accepted!.id;
  return {
    config,
    path,
    acceptedId,
    snapshot,
    bytes: () => ["mozak.json", "mozak.md"].map((n) => readFileSync(join(path, n), "utf8")).join("\u0000"),
    plan: () => readScope(loadInventory(config).scopes[0]).state.plans[0]!,
  };
}

/** One fresh built MCP child per call: initialize, one tools/call, then exit. */
function mcpCall(config: string, tool: string, args: Record<string, unknown>): Promise<{ isError: boolean; data: any }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [mcpPath, "--config", config], { stdio: ["pipe", "pipe", "pipe"], env: { PATH: process.env.PATH ?? "" } });
    children.push(child);
    let buf = "";
    let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; child.kill(); reject(new Error(`no reply from ${tool}`)); } }, 15000);
    child.stdout!.on("data", (d) => {
      buf += d;
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        const msg = JSON.parse(line);
        if (msg.id === 2 && !settled) {
          settled = true;
          clearTimeout(timer);
          child.kill();
          resolve({ isError: msg.result?.isError === true, data: JSON.parse(msg.result.content[0].text) });
        }
      }
    });
    child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } }) + "\n");
    child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: tool, arguments: args } }) + "\n");
  });
}

let operation = 0;
const reasonOf = (data: { issues?: { message: string }[] }) => (data.issues ?? []).map((i) => i.message).join("|");

test("MCP discussion attacks: each nested protected field is refused with its exact reason, bytes identical, no grant", async () => {
  const f = fixture();
  // Clean control first: a valid fresh MCP save-discussion commits. Byte baseline is taken after the control.
  const clean = await mcpCall(f.config, "mozak_save_discussion", { scope: "one", request: { operationId: `mcp-op-${++operation}`, scopeId: "one", expected: f.snapshot(), action: "save-discussion", payload: { planId: "plan-a", acceptedRevisionId: f.acceptedId, pendingRevisionId: null, summary: "Clean", stage: "clarifying", questions: [{ id: null, text: "Clean question", status: "open", answers: [], reopenReason: null }] } } });
  assert.equal(clean.isError, false, JSON.stringify(clean.data));
  assert.equal(clean.data.committed, true, "clean control commits");
  const before = f.bytes();

  const base = { planId: "plan-a", acceptedRevisionId: f.acceptedId, pendingRevisionId: null, summary: "Attack", stage: "clarifying" };
  const cases: { label: string; payload: object; reason: RegExp }[] = [
    { label: "recordedAt injected into an answer", reason: /unknown or missing discussion input field/, payload: { ...base, questions: [{ id: null, text: "Q", status: "answered", reopenReason: null, answers: [{ summary: "a", basis: "inspection", ownerRef: null, ownerMessageAt: null, evidence: [EVIDENCE], recordedAt: DIRECTION.at }] }] } },
    { label: "reopenings injected onto a question", reason: /unknown or missing discussion input field/, payload: { ...base, questions: [{ id: null, text: "Q", status: "open", answers: [], reopenReason: null, reopenings: [{ reason: "forged", recordedAt: DIRECTION.at }] }] } },
    { label: "owner answer without an owner reference", reason: /discussion text must be nonempty/, payload: { ...base, questions: [{ id: null, text: "Q", status: "answered", reopenReason: null, answers: [{ summary: "a", basis: "owner", ownerRef: null, ownerMessageAt: DIRECTION.at, evidence: [] }] }] } },
    { label: "invented question id", reason: /question ID must name a retained question/, payload: { ...base, questions: [{ id: "00000000-0000-4000-8000-000000000000", text: "x", status: "open", answers: [], reopenReason: null }] } },
    { label: "implementation authority injected into the discussion payload", reason: /payload has unknown field "implementationAuthorization"/, payload: { ...base, implementationAuthorization: "forged-grant", questions: [] } },
  ];
  for (const c of cases) {
    const r = await mcpCall(f.config, "mozak_save_discussion", { scope: "one", request: { operationId: `mcp-op-${++operation}`, scopeId: "one", expected: f.snapshot(), action: "save-discussion", payload: c.payload } });
    assert.equal(r.isError, true, `${c.label}: must be an error reply`);
    assert.equal(r.data.committed, false, `${c.label}: not committed`);
    assert.match(reasonOf(r.data), c.reason, `${c.label}: exact reason`);
  }
  assert.equal(f.bytes(), before, "every refused MCP discussion attack left graph and bridge bytes identical");
  assert.equal(f.plan().implementationAuthorizations.length, 0, "no implementation grant was created");
  assert.equal(f.plan().implementationAuthorization, null, "no current grant pointer");
});

test("MCP attach-spec attacks: each forged or protected field is refused with its exact reason, bytes identical, no grant", async () => {
  const cases: { label: string; patch: (clean: object) => object; reason: RegExp }[] = [
    { label: "caller-supplied specification id", patch: (c) => ({ ...c, id: "forged-spec" }), reason: /payload has unknown field "id"/ },
    { label: "grant pointer injected into the payload", patch: (c) => ({ ...c, implementationAuthorization: "forged-grant" }), reason: /payload has unknown field "implementationAuthorization"/ },
    { label: "caller-supplied sha256", patch: (c) => ({ ...c, sha256: "0".repeat(64) }), reason: /payload has unknown field "sha256"/ },
    { label: "approved flag inside bounds", patch: (c) => ({ ...c, bounds: { ...BOUNDS, approved: true } }), reason: /bounds\.approved: unknown field/ },
    { label: "implementation authority inside bounds", patch: (c) => ({ ...c, bounds: { ...BOUNDS, implementationAuthorized: true } }), reason: /bounds\.implementationAuthorized: unknown field/ },
  ];
  for (const c of cases) {
    // Fresh owner state per attack, so an earlier successful attach cannot cause a later refusal.
    const f = fixture();
    const before = f.bytes();
    const clean = { planId: "plan-a", acceptedRevisionId: f.acceptedId, path: "spec.md", bounds: BOUNDS, discussionDigest: null };
    const r = await mcpCall(f.config, "mozak_attach_spec", { scope: "one", request: { operationId: `mcp-op-${++operation}`, scopeId: "one", expected: f.snapshot(), action: "attach-spec", payload: c.patch(clean) } });
    assert.equal(r.isError, true, `${c.label}: must be an error reply`);
    assert.equal(r.data.committed, false, `${c.label}: not committed`);
    assert.match(reasonOf(r.data), c.reason, `${c.label}: exact reason`);
    assert.equal(f.bytes(), before, `${c.label}: graph and bridge bytes identical`);
    assert.equal(f.plan().implementationAuthorizations.length, 0, `${c.label}: no implementation grant`);
  }
});

test("MCP attach-spec clean control: a valid fresh MCP attach commits a descriptor only, bytes change, no grant", async () => {
  const f = fixture();
  const before = f.bytes();
  const r = await mcpCall(f.config, "mozak_attach_spec", { scope: "one", request: { operationId: `mcp-op-${++operation}`, scopeId: "one", expected: f.snapshot(), action: "attach-spec", payload: { planId: "plan-a", acceptedRevisionId: f.acceptedId, path: "spec.md", bounds: BOUNDS, discussionDigest: null } } });
  assert.equal(r.isError, false, JSON.stringify(r.data));
  assert.equal(r.data.committed, true, "clean control commits");
  assert.notEqual(f.bytes(), before, "the committed descriptor changed the graph bytes");
  assert.equal(f.plan().specifications.length, 1, "exactly one descriptor");
  assert.equal(f.plan().implementationAuthorizations.length, 0, "an agent attach creates no implementation grant");
  assert.equal(f.plan().implementationAuthorization, null, "no current grant pointer");
});
