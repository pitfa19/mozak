import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { executeOperation } from "../../core/src/api.ts";
import { loadInventory } from "../../core/src/scope-index.ts";
import { handle } from "../../mcp/src/server.ts";

// Flag forms for decide, delete and observe, plan show, and the revise/decide warnings.
// Synthetic scopes in isolated temp folders only; the owner provenance is a synthetic fixture value.
const roots: string[] = [];
after(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));
const cliPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const OWNER = ["--owner-ref", "synthetic:owner-msg", "--owner-message-at", "2026-10-12T10:01:00Z", "--reason", "Synthetic fixture only"];
const content = (title: string) => ({
  title, purpose: "Exercise flag forms", rationale: "Fixture only", constraints: [], nonGoals: [], questions: [], sources: [],
  outcomes: [{ id: "o1", statement: "Owner accepts the fixture", acceptance: "owner", criterion: "Owner says yes" }, { id: "o2", statement: "Check passes", acceptance: "objective", criterion: "Fixture passes" }],
});

function fixture() {
  const root = mkdtempSync(join(process.env.TMPDIR ?? "/tmp", "mozak-ergonomics-")); roots.push(root);
  for (const name of ["README.md", "AGENTS.md"]) writeFileSync(join(root, name), "# Synthetic fixture\n");
  const config = join(root, "inventory.json");
  writeFileSync(config, JSON.stringify({ format: "mozak.local/v3", scopes: [{ id: "fx", root }] }));
  const inv = loadInventory(config);
  const run = (operation: string, args: object = {}, actor: "agent" | "owner" = "agent") => executeOperation(inv, operation, { scope: "fx", ...args }, actor);
  assert.equal(run("init", { request: { operationId: "init", scopeId: "fx", kind: "project", title: "Fixture", expectedAbsent: { graph: true, bridge: true }, ownerRef: "synthetic:init", ownerMessageAt: "2026-10-12T10:00:00Z" } }, "owner").exitCode, 0);
  let n = 0;
  const write = (operation: string, action: string, payload: object) => {
    const out = run(operation, { request: { operationId: `op-${++n}`, scopeId: "fx", expected: run("context").data.snapshot, action, payload } });
    assert.equal(out.exitCode, 0, JSON.stringify(out.data)); return out;
  };
  write("propose", "propose", { planId: "alpha", content: content("Alpha") });
  const cli = (...args: string[]) => {
    const r = spawnSync(process.execPath, [cliPath, ...args, "--config", config], { encoding: "utf8", timeout: 30000 });
    return { code: r.status, out: r.stdout, err: r.stderr, json: () => JSON.parse(r.stdout) };
  };
  return { root, config, inv, run, write, cli };
}
const bytes = (root: string) => readdirSync(root).filter((n) => n.startsWith("mozak")).sort().map((n) => [n, readFileSync(join(root, n), "utf8")]);
const plan = (w: ReturnType<typeof fixture>) => (w.run("context", { plan: "alpha" }).data.context as any).plans[0];

test("review decide with flags: dry-run writes nothing, then commits without a request file", () => {
  const w = fixture();
  const before = bytes(w.root);
  const dry = w.cli("review", "decide", "--scope", "fx", "--plan", "alpha", "--purpose", "approve-direction", ...OWNER, "--dry-run", "--json");
  assert.equal(dry.code, 0, dry.out + dry.err);
  const d = dry.json();
  assert.equal(d.status, "dry-run");
  assert.equal(d.request.payload.ownerRef, "synthetic:owner-msg");
  assert.equal(d.request.payload.revisionId, d.subject.revisionId);
  assert.deepEqual(bytes(w.root), before, "dry run changed nothing");
  const human = w.cli("review", "decide", "--scope", "fx", "--plan", "alpha", "--purpose", "approve-direction", ...OWNER);
  assert.equal(human.code, 0, human.out);
  assert.match(human.out, /status: ok \(committed\)/);
  assert.match(human.out, /subject: Approve the proposed direction for plan alpha\?/);
  assert.ok(plan(w).accepted, "direction accepted");
});

test("review decide flags refuse missing provenance and mixing with --request", () => {
  const w = fixture();
  const missing = w.cli("review", "decide", "--scope", "fx", "--plan", "alpha", "--purpose", "approve-direction", "--reason", "x");
  assert.equal(missing.code, 2);
  assert.match(missing.err, /missing --owner-ref/);
  const file = join(w.root, "req.json"); writeFileSync(file, "{}");
  const mixed = w.cli("review", "decide", "--scope", "fx", "--request", file, "--plan", "alpha");
  assert.equal(mixed.code, 2);
  assert.match(mixed.err, /cannot be combined/);
  const badTime = w.cli("review", "decide", "--scope", "fx", "--plan", "alpha", "--purpose", "approve-direction", "--owner-ref", "synthetic:x", "--owner-message-at", "yesterday", "--reason", "x", "--json");
  assert.notEqual(badTime.code, 0);
  assert.equal(plan(w).accepted, null, "nothing accepted");
});

test("observe flags link evidence to an accepted outcome; accept-outcome flags; revise warns about dropped acceptance", () => {
  const w = fixture();
  const early = w.cli("observe", "--scope", "fx", "--plan", "alpha", "--outcome", "o1", "--summary", "x", "--locator", "fixture://a", "--json");
  assert.equal(early.code, 3, "linking before direction approval is refused with a clear reason");
  assert.match(early.out, /no accepted revision/);
  assert.equal(w.cli("review", "decide", "--scope", "fx", "--plan", "alpha", "--purpose", "approve-direction", ...OWNER).code, 0);
  for (const o of ["o1", "o2"]) {
    const obs = w.cli("observe", "--scope", "fx", "--plan", "alpha", "--outcome", o, "--summary", `Fixture ${o} passes`, "--locator", "fixture://check", "--activity", "Ran the fixture", "--activity-kind", "run");
    assert.equal(obs.code, 0, obs.out);
    assert.match(obs.out, /observationId: obs-/);
  }
  const accepted = w.cli("review", "decide", "--scope", "fx", "--plan", "alpha", "--purpose", "accept-outcome", "--outcome", "o1",
    "--owner-ref", "synthetic:owner-msg-2", "--owner-message-at", "2026-10-12T10:05:00Z", "--reason", "Looks right", "--json");
  assert.equal(accepted.code, 0, accepted.out);
  const show = w.cli("plan", "show", "--scope", "fx", "--plan", "alpha", "--json").json().plan;
  assert.deepEqual(show.outcomes.map((o: any) => [o.id, o.status]), [["o1", "done"], ["o2", "done"]]);
  // Revise: the accepted outcome will need the owner again. The output says which and how.
  const p = plan(w);
  const revised = w.write("revise", "revise", { planId: "alpha", pendingRevisionId: null, acceptedRevisionId: p.accepted.id, content: content("Alpha v2") });
  const warnings = (revised.data as any).warnings;
  assert.deepEqual(warnings.map((x: any) => x.code).sort(), ["outcome-reacceptance-needed", "outcome-relink-needed"]);
  assert.match(warnings.find((x: any) => x.code === "outcome-reacceptance-needed").command, /--purpose accept-outcome --outcome o1/);
  // Approving the revision repeats it with the new revision id.
  const approve = w.cli("review", "decide", "--scope", "fx", "--plan", "alpha", "--purpose", "approve-direction",
    "--owner-ref", "synthetic:owner-msg-3", "--owner-message-at", "2026-10-12T10:06:00Z", "--reason", "v2 ok");
  assert.equal(approve.code, 0, approve.out);
  assert.match(approve.out, /warning outcome-reacceptance-needed: outcome o1/);
  assert.match(approve.out, new RegExp(`next: mozak review decide --config ${w.config.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} --scope fx --plan alpha --purpose accept-outcome --outcome o1`));
});

test("approve-direction on a plan with an implementation grant says implementation approval is still needed", () => {
  const w = fixture();
  assert.equal(w.cli("review", "decide", "--scope", "fx", "--plan", "alpha", "--purpose", "approve-direction", ...OWNER).code, 0);
  writeFileSync(join(w.root, "spec.md"), "# Synthetic spec\n");
  w.write("attach-spec", "attach-spec", { planId: "alpha", acceptedRevisionId: plan(w).accepted.id, path: "spec.md", discussionDigest: null,
    bounds: { summary: "Fixture", allowedPaths: ["x.ts"], excludedActions: ["network"], outcomeChecks: [{ outcomeId: "o1", criterion: "Owner says yes" }, { outcomeId: "o2", criterion: "Fixture passes" }], limitations: ["synthetic"] } });
  const impl = w.cli("review", "decide", "--scope", "fx", "--plan", "alpha", "--purpose", "approve-implementation",
    "--owner-ref", "synthetic:impl", "--owner-message-at", "2026-10-12T10:02:00Z", "--reason", "go", "--json");
  assert.equal(impl.code, 0, impl.out);
  assert.equal(w.cli("plan", "show", "--scope", "fx", "--plan", "alpha", "--json").json().plan.implementationAuthorized, true);
  w.write("revise", "revise", { planId: "alpha", pendingRevisionId: null, acceptedRevisionId: plan(w).accepted.id, content: content("Alpha stop at 90%") });
  const dir = w.cli("review", "decide", "--scope", "fx", "--plan", "alpha", "--purpose", "approve-direction",
    "--owner-ref", "synthetic:yes-stop-90", "--owner-message-at", "2026-10-12T10:03:00Z", "--reason", "yes, stop at 90%", "--json");
  assert.equal(dir.code, 0, dir.out);
  const w1 = dir.json().warnings.find((x: any) => x.code === "implementation-approval-still-needed");
  assert.ok(w1, JSON.stringify(dir.json().warnings));
  assert.match(w1.message, /this message covers 1 approval/);
});

test("approve-implementation with --spec refuses a different current specification", () => {
  const w = fixture();
  assert.equal(w.cli("review", "decide", "--scope", "fx", "--plan", "alpha", "--purpose", "approve-direction", ...OWNER).code, 0);
  writeFileSync(join(w.root, "spec.md"), "# Synthetic spec\n");
  w.write("attach-spec", "attach-spec", { planId: "alpha", acceptedRevisionId: plan(w).accepted.id, path: "spec.md", discussionDigest: null,
    bounds: { summary: "Fixture", allowedPaths: ["x.ts"], excludedActions: [], outcomeChecks: [{ outcomeId: "o1", criterion: "c" }, { outcomeId: "o2", criterion: "c" }], limitations: [] } });
  const before = bytes(w.root);
  const wrong = w.cli("review", "decide", "--scope", "fx", "--plan", "alpha", "--purpose", "approve-implementation", "--spec", "not-this-one",
    "--owner-ref", "synthetic:impl", "--owner-message-at", "2026-10-12T10:02:00Z", "--reason", "go", "--json");
  assert.equal(wrong.code, 3);
  assert.equal(wrong.json().status, "subject-changed");
  assert.deepEqual(bytes(w.root), before);
});

test("plan show is compact and carries the fields a host needs", () => {
  const w = fixture();
  w.write("save-discussion", "save-discussion", { planId: "alpha", acceptedRevisionId: null, pendingRevisionId: plan(w).pending.id, summary: "x".repeat(1900), stage: "clarifying", questions: [] });
  const out = w.cli("plan", "show", "--scope", "fx", "--plan", "alpha", "--json");
  assert.equal(out.code, 0, out.out);
  const p = out.json().plan;
  for (const k of ["lifecycle", "executionEligible", "reasons", "authorizations", "outcomes", "specification", "permittedNextAction"]) assert.ok(k in p, k);
  assert.equal(p.permittedNextAction, "owner-review-direction");
  assert.ok(Buffer.byteLength(out.out) < 3072, `plan show is ${Buffer.byteLength(out.out)} bytes`);
  const human = w.cli("plan", "show", "--scope", "fx", "--plan", "alpha");
  assert.match(human.out, /next: owner-review-direction/);
  const unknown = w.cli("plan", "show", "--scope", "fx", "--plan", "nope", "--json");
  assert.equal(unknown.code, 2);
  assert.equal(unknown.json().status, "plan-not-found");
});

test("plan delete with flags: dry-run, then delete, without a request file", () => {
  const w = fixture();
  w.write("propose", "propose", { planId: "beta", content: { ...content("Beta, unrelated topic about gardens"), purpose: "Grow tomatoes", outcomes: [{ id: "b1", statement: "Tomatoes grow", acceptance: "objective", criterion: "Red fruit" }] }, distinctFromPlanIds: ["alpha"] });
  const before = bytes(w.root);
  const dry = w.cli("plan", "delete", "--scope", "fx", "--plans", "beta", ...OWNER, "--dry-run", "--json");
  assert.equal(dry.code, 0, dry.out);
  assert.deepEqual(dry.json().request.planIds, ["beta"]);
  assert.deepEqual(bytes(w.root), before);
  const del = w.cli("plan", "delete", "--scope", "fx", "--plans", "beta", ...OWNER);
  assert.equal(del.code, 0, del.out + del.err);
  assert.deepEqual((w.run("context").data.context as any).plans.map((p: any) => p.id), ["alpha"]);
});

test("decide and delete flag forms stay owner-only in core and MCP keeps decide off by default", () => {
  const w = fixture();
  // MCP without the launcher flag: no mozak_decide.
  const rt = { inventory: w.inv, execute: executeOperation };
  const list = handle({ jsonrpc: "2.0", id: 1, method: "tools/list" }, rt) as any;
  const names = list.result.tools.map((t: any) => t.name);
  assert.ok(!names.includes("mozak_decide"));
  assert.ok(names.includes("mozak_plan_show"));
  const refused = handle({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "mozak_decide", arguments: {} } }, rt) as any;
  assert.equal(refused.error?.code, -32602);
  // With --owner-decisions: advertised, closed arguments, provenance required, and it records the decision.
  const owner = { ...rt, ownerDecisions: true };
  assert.ok((handle({ jsonrpc: "2.0", id: 3, method: "tools/list" }, owner) as any).result.tools.some((t: any) => t.name === "mozak_decide"));
  const noProv = handle({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "mozak_decide", arguments: { scope: "fx", plan: "alpha", purpose: "approve-direction", reason: "x" } } }, owner) as any;
  assert.equal(noProv.result.isError, true);
  assert.match(noProv.result.content[0].text, /ownerRef/);
  const ok = handle({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "mozak_decide", arguments: { scope: "fx", plan: "alpha", purpose: "approve-direction", ownerRef: "synthetic:mcp", ownerMessageAt: "2026-10-12T10:01:00Z", reason: "ok" } } }, owner) as any;
  assert.notEqual(ok.result.isError, true, ok.result.content[0].text);
  assert.ok(plan(w).accepted);
  const show = handle({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "mozak_plan_show", arguments: { scope: "fx", plan: "alpha" } } }, rt) as any;
  assert.equal(JSON.parse(show.result.content[0].text).plan.lifecycle, "open");
});

test("built CLI help lists the flag forms", () => {
  const out = execFileSync(process.execPath, [cliPath, "--help"], { encoding: "utf8", timeout: 10000 });
  assert.match(out, /mozak plan show/);
  assert.match(out, /review decide --scope ID --plan ID --purpose P/);
  assert.match(out, /plan delete --scope ID --plans A,B/);
  assert.match(out, /observe --scope ID --plan ID --summary TEXT --locator WHERE/);
});

test("observe --payload takes an examples/observe.json shaped file, builds the envelope and commits", () => {
  const w = fixture();
  const file = join(w.root, "payload.json");
  writeFileSync(file, JSON.stringify({ _doc: "synthetic", payload: { planId: "alpha", observation: { id: "obs-p", classification: "observed", summary: "Fixture read",
    evidence: [{ id: "ev-p", locator: "fixture://p", anchor: null, version: null, inspectedAt: "2026-10-12T10:00:00.000Z", activity: { kind: "read", description: "Read" }, result: { verdict: "pass", summary: "ok" }, limitations: [] }] } } }));
  const out = w.cli("observe", "--scope", "fx", "--payload", file);
  assert.equal(out.code, 0, out.out + out.err);
  assert.match(out.out, /status: ok \(committed\)/);
  assert.equal(plan(w).observations[0].id, "obs-p");
  const mixed = w.cli("observe", "--scope", "fx", "--payload", file, "--plan", "alpha");
  assert.equal(mixed.code, 2);
});
