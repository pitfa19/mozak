import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { executeOperation } from "../../core/src/api.ts";
import { loadInventory } from "../../core/src/scope-index.ts";

// Preapproved seams: executeOperation and built CLI/MCP. Fixtures are synthetic; no live inventory.
const roots: string[] = [];
after(() => roots.forEach(root => rmSync(root, { recursive: true, force: true })));
const cliPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const content = { title: "Synthetic compact context", purpose: "Recover bounded work", outcomes: [{ id: "out", statement: "Synthetic check passes", acceptance: "objective", criterion: "Fixture passes" }], constraints: [], nonGoals: [], rationale: "Fixture only", questions: [], sources: [] };
function fixture() {
  const root = mkdtempSync(join(process.env.TMPDIR!, "mozak-context-modes-")); roots.push(root);
  for (const name of ["README.md", "AGENTS.md"]) writeFileSync(join(root, name), "# Synthetic fixture\n");
  const config = join(root, "inventory.json");
  writeFileSync(config, JSON.stringify({ format: "mozak.local/v3", scopes: [{ id: "fixture", root }] }));
  const inv = loadInventory(config);
  const run = (operation: string, args: object = {}, actor: "agent" | "owner" = "agent") => executeOperation(inv, operation, { scope: "fixture", ...args }, actor);
  assert.equal(run("init", { request: { operationId: "init", scopeId: "fixture", kind: "project", title: "Fixture", expectedAbsent: { graph: true, bridge: true }, ownerRef: "synthetic:init", ownerMessageAt: "2026-10-12T10:00:00Z" } }, "owner").exitCode, 0);
  let serial = 0;
  const change = (action: string, payload: object, actor: "agent" | "owner" = "agent") => {
    const out = run(action === "approve-direction" || action === "pause" || action === "approve-implementation" ? "decide" : action, { request: { operationId: `op-${++serial}`, scopeId: "fixture", expected: run("context").data.snapshot, action, payload } }, actor);
    assert.equal(out.exitCode, 0, JSON.stringify(out)); return out;
  };
  change("propose", { planId: "alpha", content });
  return { root, config, inv, run, change };
}
// The counts-only usage log in .mozak-cache/usage is the one side file a read appends to; scope files must not change.
const files = (root: string) => readdirSync(root).filter(name => name !== ".mozak-cache").sort().map(name => [name, readFileSync(join(root, name))]);
function decide(w: ReturnType<typeof fixture>, purpose: string) {
  const review = w.run("review", { plan: "alpha", purpose }).data.review as any;
  w.change(purpose, { planId: "alpha", revisionId: review.revisionId, reviewDigest: review.reviewDigest,
    ownerRef: `synthetic:${purpose}`, ownerMessageAt: "2026-10-12T10:01:00Z", reason: "Synthetic fixture only",
    ...(purpose === "approve-implementation" ? { specificationId: review.specificationId } : {}),
  }, "owner");
}
function grant(w: ReturnType<typeof fixture>) {
  decide(w, "approve-direction");
  const revision = (w.run("context").data.context as any).plans[0].accepted.id;
  writeFileSync(join(w.root, "spec.md"), "# Synthetic bounded work\n");
  w.change("attach-spec", { planId: "alpha", acceptedRevisionId: revision, path: "spec.md", discussionDigest: null,
    bounds: { summary: "Fixture only", allowedPaths: ["fixture.ts"], excludedActions: ["network"], outcomeChecks: [{ outcomeId: "out", criterion: "Fixture passes" }], limitations: ["Synthetic owner; not live approval"] },
  });
  decide(w, "approve-implementation");
}

test("brief preserves snapshot, pending/lifecycle/handoff/next action without full plan bodies and writes nothing", () => {
  const w = fixture();
  const full = w.run("context").data as any;
  const before = files(w.root);
  const brief = w.run("context", { brief: true });
  assert.equal(brief.exitCode, 0);
  const data = brief.data as any;
  assert.deepEqual(data.snapshot, full.snapshot);
  assert.equal(data.committed, false); assert.equal(data.projectionUpdated, false);
  assert.equal(data.context.brief, true);
  const p = data.context.plans[0];
  assert.equal(p.planId, "alpha"); assert.equal(p.title, content.title);
  assert.deepEqual(p.lifecycle, full.context.plans[0].lifecycle);
  assert.equal(p.pending.id, full.context.plans[0].pending.id);
  assert.equal(p.pending.reviewState, "awaiting");
  assert.equal(p.handoff.executionEligible, false);
  assert.equal(p.permittedNextAction, "owner-review-direction");
  assert.equal(p.observations, undefined); assert.equal(p.decisions, undefined);
  assert.equal(p.pending.content, undefined); assert.equal(p.handoff.bounds, undefined);
  assert.deepEqual(files(w.root), before);
  assert.deepEqual(w.run("context").data, full, "default full DTO remains unchanged");
});

const mcpPath = fileURLToPath(new URL("../../mcp/dist/index.js", import.meta.url));
function cli(w: ReturnType<typeof fixture>, flags: string[]) {
  const out = spawnSync(process.execPath, [cliPath, "context", "--config", w.config, "--scope", "fixture", "--json", ...flags], { encoding: "utf8", timeout: 15000 });
  assert.equal(out.error, undefined); return out;
}
function rpc(w: ReturnType<typeof fixture>, method: string, params: object = {}) {
  const out = spawnSync(process.execPath, [mcpPath, "--config", w.config], {
    input: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) + "\n", encoding: "utf8", timeout: 15000,
  });
  assert.equal(out.status, 0, out.stderr); return JSON.parse(out.stdout).result;
}
function parity(w: ReturnType<typeof fixture>, args: Record<string, unknown>, flags: string[]) {
  const core = w.run("context", args);
  const command = cli(w, flags);
  assert.equal(command.status, core.exitCode, command.stderr);
  assert.deepEqual(JSON.parse(command.stdout), core.data);
  const mcp = rpc(w, "tools/call", { name: "mozak_context", arguments: { scope: "fixture", ...args } });
  assert.equal(mcp.isError === true, core.exitCode !== 0);
  assert.deepEqual(JSON.parse(mcp.content[0].text), core.data);
  return core.data as any;
}

test("built CLI/MCP expose brief and exact plan selection, alone and combined; unknown plans refuse", () => {
  const w = fixture();
  w.change("propose", { planId: "beta", content: { ...content, title: "Unrelated gardening", outcomes: [{ ...content.outcomes[0], statement: "Grow carrots" }] } });
  const before = files(w.root);
  const full = parity(w, {}, []);
  const selected = parity(w, { plan: "beta" }, ["--plan", "beta"]);
  assert.deepEqual(selected.context.plans, [full.context.plans[1]]);
  assert.deepEqual(selected.snapshot, full.snapshot);
  parity(w, { brief: false }, []);
  parity(w, { brief: true }, ["--brief"]);
  const compact = parity(w, { brief: true, plan: "alpha" }, ["--brief", "--plan", "alpha"]);
  assert.equal(compact.context.plans.length, 1); assert.equal(compact.context.plans[0].planId, "alpha");
  for (const brief of [false, true]) {
    const missing = parity(w, { plan: "missing", brief }, ["--plan", "missing", ...(brief ? ["--brief"] : [])]);
    assert.equal(missing.status, "plan-not-found"); assert.equal(missing.committed, false);
  }
  const def = rpc(w, "tools/list").tools.find(t => t.name === "mozak_context");
  assert.equal(def.inputSchema.properties.brief.type, "boolean");
  assert.equal(def.inputSchema.properties.plan.type, "string");
  assert.equal(def.inputSchema.additionalProperties, false);
  assert.deepEqual(files(w.root), before);
});

test("brief and focused recovery preserve actual handoff blockers and pending accepted direction independently", () => {
  const w = fixture(); grant(w);
  const full = parity(w, { plan: "alpha" }, ["--plan", "alpha"]);
  assert.equal(full.context.plans[0].handoff.executionEligible, true);
  let compact = parity(w, { brief: true }, ["--brief"]).context.plans[0];
  const { bounds: _bounds, ...handoff } = full.context.plans[0].handoff;
  assert.deepEqual(compact.handoff, { ...handoff, boundsOmitted: true });
  assert.equal(compact.accepted.id, full.context.plans[0].accepted.id);
  w.change("revise", { planId: "alpha", acceptedRevisionId: compact.accepted.id, pendingRevisionId: null, content: { ...content, title: "Proposed new meaning" } });
  compact = parity(w, { brief: true, plan: "alpha" }, ["--brief", "--plan", "alpha"]).context.plans[0];
  assert.equal(compact.title, content.title, "pending never replaces accepted direction");
  assert.equal(compact.pending.reviewState, "awaiting");
  assert.equal(compact.permittedNextAction, "owner-review-direction");
  decide(w, "pause");
  compact = parity(w, { brief: true }, ["--brief"]).context.plans[0];
  assert.equal(compact.lifecycle.state, "paused");
  assert.equal(compact.handoff.executionEligible, false);
  assert.ok(compact.handoff.reasons.includes("lifecycle-paused"));
  writeFileSync(join(w.root, "spec.md"), "# Changed after approval\n");
  compact = parity(w, { brief: true }, ["--brief"]).context.plans[0];
  assert.equal(compact.handoff.specificationHealth, "changed");
  assert.ok(compact.handoff.reasons.includes("specification-changed"));
  const focused = parity(w, { plan: "alpha" }, ["--plan", "alpha"]);
  assert.equal(focused.context.plans[0].handoff.bounds.allowedPaths[0], "fixture.ts");
});

test("brief size does not grow with observation/evidence bodies or history; focused recovery retains them", () => {
  const w = fixture();
  const initial = parity(w, { brief: true }, ["--brief"]);
  const marker = "SYNTHETIC_BODY_NOT_FOR_BRIEF".repeat(500);
  for (let n = 0; n < 4; n++) w.change("observe", { planId: "alpha", observation: {
    id: `obs-${n}`, classification: "observed", summary: marker, evidence: [{ id: `ev-${n}`, locator: "synthetic:fixture", anchor: null,
      version: "fixture", inspectedAt: "2026-10-12T10:02:00Z", activity: { kind: "read", description: marker },
      result: { verdict: "pass", summary: marker }, limitations: ["Synthetic only"],
    }],
  } });
  const before = files(w.root);
  const compact = parity(w, { brief: true }, ["--brief"]);
  assert.equal(JSON.stringify(compact.context), JSON.stringify(initial.context));
  assert.ok(Buffer.byteLength(cli(w, ["--brief"]).stdout) < 8000);
  assert.ok(!JSON.stringify(compact).includes("SYNTHETIC_BODY_NOT_FOR_BRIEF"));
  const focused = parity(w, { plan: "alpha" }, ["--plan", "alpha"]);
  assert.equal(focused.context.plans[0].observations.length, 4);
  assert.equal(focused.context.plans[0].observations[0].evidence[0].activity.description, marker);
  assert.deepEqual(files(w.root), before);
});

test("brief snapshot supports writes; stale conflict recovers only the named plan with a fresh CAS", () => {
  const w = fixture();
  const expected = w.run("context", { brief: true }).data.snapshot;
  const request = { operationId: "brief-cas", scopeId: "fixture", expected, action: "observe", payload: {
    planId: "alpha", observation: { id: "cas-obs", classification: "unverified", summary: "Synthetic CAS fixture", evidence: [] },
  } };
  assert.equal(w.run("observe", { request }).exitCode, 0);
  const stale = { ...request, operationId: "stale-cas", payload: { planId: "alpha", observation: { id: "second", classification: "unverified", summary: "Synthetic retry", evidence: [] } } };
  const refused = w.run("observe", { request: stale });
  assert.equal(refused.exitCode, 3); assert.equal(refused.data.status, "stale-input");
  const fresh = parity(w, { plan: "alpha" }, ["--plan", "alpha"]);
  assert.equal(fresh.context.plans.length, 1);
  assert.equal(w.run("observe", { request: { ...stale, operationId: "fresh-cas", expected: fresh.snapshot } }).exitCode, 0);
  assert.equal((w.run("context", { plan: "alpha" }).data.context as any).plans[0].observations.length, 2);
});

test("strict public boundaries reject malformed options without writes", () => {
  const w = fixture(); const before = files(w.root);
  for (const args of [{ brief: "true" }, { brief: null }, { plan: "" }, { plan: " " }, { plan: 42 }, { plan: null }, { unknown: true }]) {
    assert.equal(w.run("context", args).exitCode, 2);
    const mcp = rpc(w, "tools/call", { name: "mozak_context", arguments: { scope: "fixture", ...args } });
    assert.equal(mcp.isError, true);
  }
  for (const flags of [["--brief", "--brief"], ["--plan"], ["--plan", ""], ["--plan", "alpha", "--plan", "beta"], ["--brief=true"]]) {
    assert.equal(cli(w, flags).status, 2);
  }
  assert.deepEqual(files(w.root), before);
});
