import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, unlinkSync, readFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readScope } from "../../core/src/scope-store.ts";
import { loadInventory } from "../../core/src/scope-index.ts";
import { discussionDigest } from "../../core/src/understanding.ts";

// B11 parity over the full owner path. Owner steps go through the BUILT CLI. Each state is then compared between
// the built CLI and a FRESH built MCP child (packages/mcp/dist/index.js, not src). Every owner reference is an
// explicit synthetic fixture value, and each owner decision uses its own distinct message reference and time.

const scratch = process.env.JCODE_SCRATCH_DIR ?? process.env.TMPDIR;
if (!scratch) throw new Error("scratch directory required");
const roots: string[] = [];
const children: ChildProcess[] = [];
after(() => {
  for (const c of children) if (c.exitCode === null) c.kill();
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});
const cliPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const mcpPath = fileURLToPath(new URL("../../mcp/dist/index.js", import.meta.url));

const OWNER = {
  direction: { ref: "synthetic-owner:fixture-direction", at: "2026-10-12T08:00:00.000Z" },
  implementation: { ref: "synthetic-owner:fixture-implementation", at: "2026-10-12T08:05:00.000Z" },
  pause: { ref: "synthetic-owner:fixture-pause", at: "2026-10-12T08:10:00.000Z" },
};
const OWN_ANSWER = (summary: string) => ({ summary, basis: "owner", ownerRef: "synthetic-owner:fixture-clarification", ownerMessageAt: "2026-10-12T08:02:00.000Z", evidence: [] });

function fixture() {
  const root = mkdtempSync(join(scratch!, "mozak-parity-"));
  roots.push(root);
  const path = join(root, "one");
  mkdirSync(path);
  writeFileSync(join(path, "README.md"), "# readme\n");
  writeFileSync(join(path, "AGENTS.md"), "# agents\n");
  writeFileSync(join(path, "spec.md"), "# Spec\n\nSynthetic bounded specification.\n");
  const config = join(root, "inventory.json");
  writeFileSync(config, JSON.stringify({ format: "mozak.local/v2", scopes: [{ id: "one", root: "./one" }] }));
  return { root, path, config, spec: join(root, "spec-backup.md") };
}

function cli(config: string, args: string[]) {
  const p = spawnSync(process.execPath, ["--no-warnings", cliPath, ...args, "--config", config, "--json"], { encoding: "utf8", timeout: 15000 });
  return { status: p.status, json: p.stdout ? JSON.parse(p.stdout) : null, err: p.stderr };
}

/** Builds the granted state through the built CLI: direction, clarification, spec, implementation grant. */
function grant(f: ReturnType<typeof fixture>) {
  const init = join(f.root, "init.json");
  writeFileSync(init, JSON.stringify({ operationId: "init-one", scopeId: "one", kind: "project", title: "one", expectedAbsent: { graph: true, bridge: true }, ownerRef: OWNER.direction.ref, ownerMessageAt: OWNER.direction.at }));
  const initRun = cli(f.config, ["scope", "init", "--scope", "one", "--request", init]);
  assert.equal(initRun.status, 0, initRun.err);
  let seq = 0;
  const context = () => cli(f.config, ["context", "--scope", "one"]).json;
  const envelope = (action: string, payload: object, route: string[]) => {
    const file = join(f.root, `req-${seq++}.json`);
    writeFileSync(file, JSON.stringify({ operationId: `op-${seq}`, scopeId: "one", expected: context().snapshot, action, payload }));
    return cli(f.config, [...route, "--scope", "one", "--request", file]);
  };
  const state = () => readScope(loadInventory(f.config).scopes[0]).state.plans.find((p) => p.id === "plan-a")!;
  const review = (purpose: string) => cli(f.config, ["review", "show", "--scope", "one", "--plan", "plan-a", "--purpose", purpose]).json.review;

  const content = { title: "Formatter", purpose: "Preserve agreed meaning", outcomes: [{ id: "o1", statement: "Formatter choice is recorded", acceptance: "owner", criterion: "Owner accepts" }], constraints: [], nonGoals: [], rationale: "Avoid repeated interviews", questions: [], sources: [{ id: "source", locator: "synthetic:source", anchor: null, observedAt: OWNER.direction.at, version: "fixture-v1", limitations: ["Synthetic fixture"] }] };
  assert.equal(envelope("propose", { planId: "plan-a", content }, ["plan", "propose"]).status, 0);
  const pending = review("approve-direction");
  assert.equal(envelope("approve-direction", { planId: "plan-a", revisionId: pending.revisionId, reviewDigest: pending.reviewDigest, ownerRef: OWNER.direction.ref, ownerMessageAt: OWNER.direction.at, reason: "Synthetic owner direction" }, ["review", "decide"]).status, 0);
  const acceptedId = state().accepted!.id;

  // Clarification: one settled question with an owner answer, and one unresolved question.
  assert.equal(envelope("save-discussion", { planId: "plan-a", acceptedRevisionId: acceptedId, pendingRevisionId: null, summary: "Clarifying", stage: "clarifying", questions: [
    { id: null, text: "Which formatter?", status: "answered", answers: [OWN_ANSWER("Use the project formatter")], reopenReason: null },
    { id: null, text: "Which line width?", status: "open", answers: [], reopenReason: null },
  ] }, ["discussion", "save"]).status, 0);

  // Ready for spec: defer the open question and record its limitation in the specification bounds.
  const d = state().discussion!;
  const [settled, open] = d.questions;
  const strip = (a: { recordedAt?: string }[]) => a.map(({ recordedAt: _t, ...x }) => x);
  assert.equal(envelope("save-discussion", { planId: "plan-a", acceptedRevisionId: acceptedId, pendingRevisionId: null, summary: "Ready", stage: "ready-for-spec", questions: [
    { id: settled!.id, text: settled!.text, status: "answered", answers: strip(settled!.answers as never), reopenReason: null },
    { id: open!.id, text: open!.text, status: "deferred", answers: [{ ...OWN_ANSWER("Deferred to a later package"), ownerRef: "synthetic-owner:fixture-clarification" }], reopenReason: null },
  ] }, ["discussion", "save"]).status, 0);

  const digest = discussionDigest(state().discussion!);
  const bounds = { summary: "Fixture formatter bounds", allowedPaths: ["spec.md"], excludedActions: [], outcomeChecks: [{ outcomeId: "o1", criterion: "Owner accepts" }], limitations: ["Line width deferred to a later package"] };
  assert.equal(envelope("attach-spec", { planId: "plan-a", acceptedRevisionId: acceptedId, path: "spec.md", bounds, discussionDigest: digest }, ["spec", "attach"]).status, 0);

  // Owner implementation approval through review show, with its own distinct owner message reference.
  const impl = review("approve-implementation");
  assert.equal(impl.approvalAvailable, true, JSON.stringify(impl.approvalReasons));
  assert.equal(envelope("approve-implementation", { planId: "plan-a", revisionId: impl.revisionId, specificationId: impl.specificationId, reviewDigest: impl.reviewDigest, ownerRef: OWNER.implementation.ref, ownerMessageAt: OWNER.implementation.at, reason: "Synthetic owner implementation approval" }, ["review", "decide"]).status, 0);
  return { acceptedId, envelope, state, review, context };
}

/** Fresh built MCP child: one initialize, one tools/call, then exit. Returns the parsed tool payload. */
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

/** Compares the handoff DTO from CLI and fresh MCP for the same state, then returns the handoff for assertions. */
async function parityHandoff(f: ReturnType<typeof fixture>) {
  const cliReview = cli(f.config, ["review", "show", "--scope", "one", "--plan", "plan-a", "--purpose", "approve-implementation"]).json;
  const mcpReview = await mcpCall(f.config, "mozak_review_show", { scope: "one", plan: "plan-a", purpose: "approve-implementation" });
  assert.equal(mcpReview.isError, false, JSON.stringify(mcpReview.data));
  assert.deepEqual(mcpReview.data, cliReview, "review DTO is identical across CLI and fresh MCP");
  const cliContext = cli(f.config, ["context", "--scope", "one"]).json;
  const mcpContext = await mcpCall(f.config, "mozak_context", { scope: "one" });
  assert.deepEqual(mcpContext.data, cliContext, "context DTO is identical across CLI and fresh MCP");
  return { handoff: cliContext.context.plans[0].handoff, lifecycle: cliContext.context.plans[0].lifecycle, reviewHandoff: cliReview.review.handoff };
}

test("B11 granted: executionEligible true, same DTO from CLI and built MCP", async () => {
  const f = fixture();
  grant(f);
  const { handoff } = await parityHandoff(f);
  assert.equal(handoff.implementationAuthorized, true);
  assert.equal(handoff.executionEligible, true);
  assert.equal(handoff.specificationHealth, "current");
  assert.deepEqual(handoff.reasons, []);
  assert.ok(handoff.bounds.limitations.includes("Line width deferred to a later package"), "deferred limitation is in the bounds");
});

test("B11 changed current-grant file: eligibility false, canonical context still readable, same DTO from CLI and built MCP", async () => {
  const f = fixture();
  grant(f);
  copyFileSync(join(f.path, "spec.md"), f.spec);
  writeFileSync(join(f.path, "spec.md"), "# Spec\n\nSynthetic CHANGED.\n");
  const { handoff } = await parityHandoff(f);
  assert.equal(handoff.implementationAuthorized, true, "the grant itself is still current");
  assert.equal(handoff.executionEligible, false);
  assert.equal(handoff.specificationHealth, "changed");
  assert.ok(handoff.reasons.includes("specification-changed"));
});

test("B11 missing current-grant file: eligibility false, canonical context still readable, same DTO from CLI and built MCP", async () => {
  const f = fixture();
  grant(f);
  unlinkSync(join(f.path, "spec.md"));
  const { handoff } = await parityHandoff(f);
  assert.equal(handoff.executionEligible, false);
  assert.equal(handoff.specificationHealth, "unavailable");
  assert.ok(handoff.reasons.includes("specification-unavailable"));
});

test("B11 owner pause: lifecycle paused, grant kept, eligibility false, same DTO from CLI and built MCP", async () => {
  const f = fixture();
  grant(f);
  const pauseReview = cli(f.config, ["review", "show", "--scope", "one", "--plan", "plan-a", "--purpose", "pause"]).json.review;
  const pause = JSON.stringify({ operationId: "op-pause", scopeId: "one", expected: cli(f.config, ["context", "--scope", "one"]).json.snapshot, action: "pause", payload: { planId: "plan-a", revisionId: pauseReview.revisionId, reviewDigest: pauseReview.reviewDigest, ownerRef: OWNER.pause.ref, ownerMessageAt: OWNER.pause.at, reason: "Synthetic owner pause" } });
  writeFileSync(join(f.root, "pause.json"), pause);
  const paused = cli(f.config, ["review", "decide", "--scope", "one", "--request", join(f.root, "pause.json")]);
  assert.equal(paused.status, 0, paused.err);
  const { handoff, lifecycle } = await parityHandoff(f);
  assert.equal(lifecycle.state, "paused");
  assert.equal(handoff.implementationAuthorized, true, "pause keeps the grant");
  assert.equal(handoff.executionEligible, false);
  assert.ok(handoff.reasons.includes("lifecycle-paused"));
});

test("B11 protected-route controls: a valid fresh MCP save-discussion and attach-spec on a plan with no grant change nothing", async () => {
  // Fresh MCP calls with valid envelopes. They reach core, and a grant must not appear as a side effect.
  const f = fixture();
  const init = join(f.root, "init.json");
  writeFileSync(init, JSON.stringify({ operationId: "init-one", scopeId: "one", kind: "project", title: "one", expectedAbsent: { graph: true, bridge: true }, ownerRef: OWNER.direction.ref, ownerMessageAt: OWNER.direction.at }));
  assert.equal(cli(f.config, ["scope", "init", "--scope", "one", "--request", init]).status, 0);
  const snapshot = () => cli(f.config, ["context", "--scope", "one"]).json.snapshot;
  const content = { title: "Formatter", purpose: "Preserve", outcomes: [{ id: "o1", statement: "Formatter choice is recorded", acceptance: "owner", criterion: "Owner accepts" }], constraints: [], nonGoals: [], rationale: "x", questions: [], sources: [{ id: "source", locator: "synthetic:source", anchor: null, observedAt: OWNER.direction.at, version: "fixture-v1", limitations: ["Synthetic"] }] };
  const proposeFile = join(f.root, "p.json");
  writeFileSync(proposeFile, JSON.stringify({ operationId: "op-p", scopeId: "one", expected: snapshot(), action: "propose", payload: { planId: "plan-a", content } }));
  assert.equal(cli(f.config, ["plan", "propose", "--scope", "one", "--request", proposeFile]).status, 0);
  const pending = cli(f.config, ["review", "show", "--scope", "one", "--plan", "plan-a", "--purpose", "approve-direction"]).json.review;
  const decideFile = join(f.root, "d.json");
  writeFileSync(decideFile, JSON.stringify({ operationId: "op-d", scopeId: "one", expected: snapshot(), action: "approve-direction", payload: { planId: "plan-a", revisionId: pending.revisionId, reviewDigest: pending.reviewDigest, ownerRef: OWNER.direction.ref, ownerMessageAt: OWNER.direction.at, reason: "Synthetic owner direction" } }));
  assert.equal(cli(f.config, ["review", "decide", "--scope", "one", "--request", decideFile]).status, 0);
  const acceptedId = readScope(loadInventory(f.config).scopes[0]).state.plans[0]!.accepted!.id;

  const before = JSON.stringify(readScope(loadInventory(f.config).scopes[0]).state.plans[0]!.specifications);
  const disc = await mcpCall(f.config, "mozak_save_discussion", { scope: "one", request: { operationId: "op-mcp-disc", scopeId: "one", expected: snapshot(), action: "save-discussion", payload: { planId: "plan-a", acceptedRevisionId: acceptedId, pendingRevisionId: null, summary: "Agent clarifying", stage: "clarifying", questions: [{ id: null, text: "Which line width?", status: "open", answers: [], reopenReason: null }] } } });
  assert.equal(disc.isError, false, JSON.stringify(disc.data));
  assert.equal(disc.data.committed, true);
  const after = readScope(loadInventory(f.config).scopes[0]).state.plans[0]!;
  assert.equal(after.discussion!.stage, "clarifying", "agent saved the advisory checkpoint");
  assert.equal(JSON.stringify(after.specifications), before, "no specification was attached by the discussion save");
  assert.equal(after.implementationAuthorizations.length, 0, "no implementation grant was created by an agent route");
  assert.equal(after.implementationAuthorization, null, "no current grant pointer after the agent discussion save");
});

test("B11 protected-route control: a valid fresh MCP attach-spec attaches a descriptor only, with no implementation grant", async () => {
  const f = fixture();
  const init = join(f.root, "init.json");
  writeFileSync(init, JSON.stringify({ operationId: "init-one", scopeId: "one", kind: "project", title: "one", expectedAbsent: { graph: true, bridge: true }, ownerRef: OWNER.direction.ref, ownerMessageAt: OWNER.direction.at }));
  assert.equal(cli(f.config, ["scope", "init", "--scope", "one", "--request", init]).status, 0);
  const snapshot = () => cli(f.config, ["context", "--scope", "one"]).json.snapshot;
  const content = { title: "Formatter", purpose: "Preserve", outcomes: [{ id: "o1", statement: "Formatter choice is recorded", acceptance: "owner", criterion: "Owner accepts" }], constraints: [], nonGoals: [], rationale: "x", questions: [], sources: [{ id: "source", locator: "synthetic:source", anchor: null, observedAt: OWNER.direction.at, version: "fixture-v1", limitations: ["Synthetic"] }] };
  const proposeFile = join(f.root, "p.json");
  writeFileSync(proposeFile, JSON.stringify({ operationId: "op-p", scopeId: "one", expected: snapshot(), action: "propose", payload: { planId: "plan-a", content } }));
  assert.equal(cli(f.config, ["plan", "propose", "--scope", "one", "--request", proposeFile]).status, 0);
  const pending = cli(f.config, ["review", "show", "--scope", "one", "--plan", "plan-a", "--purpose", "approve-direction"]).json.review;
  const decideFile = join(f.root, "d.json");
  writeFileSync(decideFile, JSON.stringify({ operationId: "op-d", scopeId: "one", expected: snapshot(), action: "approve-direction", payload: { planId: "plan-a", revisionId: pending.revisionId, reviewDigest: pending.reviewDigest, ownerRef: OWNER.direction.ref, ownerMessageAt: OWNER.direction.at, reason: "Synthetic owner direction" } }));
  assert.equal(cli(f.config, ["review", "decide", "--scope", "one", "--request", decideFile]).status, 0);
  const acceptedId = readScope(loadInventory(f.config).scopes[0]).state.plans[0]!.accepted!.id;

  const bounds = { summary: "Agent-attached descriptor", allowedPaths: ["spec.md"], excludedActions: [], outcomeChecks: [{ outcomeId: "o1", criterion: "Owner accepts" }], limitations: [] };
  const attach = await mcpCall(f.config, "mozak_attach_spec", { scope: "one", request: { operationId: "op-mcp-spec", scopeId: "one", expected: snapshot(), action: "attach-spec", payload: { planId: "plan-a", acceptedRevisionId: acceptedId, path: "spec.md", bounds, discussionDigest: null } } });
  assert.equal(attach.isError, false, JSON.stringify(attach.data));
  assert.equal(attach.data.committed, true);

  const after = readScope(loadInventory(f.config).scopes[0]).state.plans[0]!;
  assert.equal(after.specifications.length, 1, "the agent attached one descriptor");
  assert.notEqual(after.downstreamSpec, null, "the descriptor is the pending candidate");
  assert.equal(after.implementationAuthorizations.length, 0, "an agent attach creates no implementation grant");
  assert.equal(after.implementationAuthorization, null, "no current grant pointer after an agent attach");

  // The same CLI and fresh built MCP report the unapproved candidate identically, and eligibility stays false.
  const { handoff } = await parityHandoff(f);
  assert.equal(handoff.implementationAuthorized, false, "no grant from an agent attach");
  assert.equal(handoff.executionEligible, false);
});
