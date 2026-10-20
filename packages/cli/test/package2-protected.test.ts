import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Nested protected-field refusals on the Package 2 routes (discussion save, spec attach).
// Each attack puts one protected or unknown field inside an otherwise valid envelope. Each case asserts the exact
// refusal code and message, so a refusal for an unrelated reason cannot pass. Graph and bridge bytes must be
// unchanged after every refused attack. A clean control runs first in each fixture. Owner references are synthetic.

const scratch = process.env.JCODE_SCRATCH_DIR ?? process.env.TMPDIR;
if (!scratch) throw new Error("scratch directory required");
const roots: string[] = [];
after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
const cliPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const ownerAt = "2026-10-12T08:00:00.000Z";
const OWNER = "synthetic-owner:fixture";

const content = {
  title: "Protected fields",
  purpose: "Preserve agreed meaning",
  outcomes: [{ id: "o1", statement: "Protected fields stay protected", acceptance: "owner", criterion: "Owner accepts" }],
  constraints: [],
  nonGoals: [],
  rationale: "Avoid forged authority",
  questions: [],
  sources: [{ id: "source", locator: "synthetic:source", anchor: null, observedAt: ownerAt, version: "fixture-v1", limitations: ["Synthetic fixture"] }],
};

function fixture() {
  const root = mkdtempSync(join(scratch!, "mozak-protected-"));
  roots.push(root);
  const path = join(root, "one");
  mkdirSync(path);
  writeFileSync(join(path, "README.md"), "# readme\n");
  writeFileSync(join(path, "AGENTS.md"), "# agents\n");
  writeFileSync(join(path, "spec.md"), "# Spec\n\nSynthetic bounded specification.\n");
  const config = join(root, "inventory.json");
  writeFileSync(config, JSON.stringify({ format: "mozak.local/v2", scopes: [{ id: "one", root: "./one" }] }));
  let seq = 0;
  const cli = (args: string[]) => spawnSync(process.execPath, ["--no-warnings", cliPath, ...args, "--config", config, "--json"], { encoding: "utf8", timeout: 15000 });
  const json = (r: { stdout: string }) => JSON.parse(r.stdout);
  const snapshot = () => json(cli(["context", "--scope", "one"])).snapshot;
  const envelope = (action: string, payload: object, route: string[]) => {
    const file = join(root, `req-${seq++}.json`);
    writeFileSync(file, JSON.stringify({ operationId: `op-${seq}`, scopeId: "one", expected: snapshot(), action, payload }));
    return cli([...route, "--scope", "one", "--request", file]);
  };
  const bytes = () => ["mozak.json", "mozak.md"].map((n) => readFileSync(join(path, n), "utf8")).join("\u0000");
  // Real owner setup through the built CLI, ending with an accepted plan and no discussion or specification.
  const init = join(root, "init.json");
  writeFileSync(init, JSON.stringify({ operationId: "init-one", scopeId: "one", kind: "project", title: "one", expectedAbsent: { graph: true, bridge: true }, ownerRef: OWNER, ownerMessageAt: ownerAt }));
  assert.equal(cli(["scope", "init", "--scope", "one", "--request", init]).status, 0);
  assert.equal(envelope("propose", { planId: "plan-a", content }, ["plan", "propose"]).status, 0);
  const pending = json(cli(["review", "show", "--scope", "one", "--plan", "plan-a", "--purpose", "approve-direction"])).review;
  assert.equal(envelope("approve-direction", { planId: "plan-a", revisionId: pending.revisionId, reviewDigest: pending.reviewDigest, ownerRef: OWNER, ownerMessageAt: ownerAt, reason: "Synthetic owner direction" }, ["review", "decide"]).status, 0);
  const acceptedId = json(cli(["context", "--scope", "one"])).context.plans[0].accepted.id as string;
  return { root, path, config, cli, json, envelope, bytes, acceptedId };
}

const DISCUSSION_BASE = (acceptedId: string) => ({ planId: "plan-a", acceptedRevisionId: acceptedId, pendingRevisionId: null, summary: "Clean", stage: "clarifying" });
const EVIDENCE = { id: "e", locator: "synthetic:x", anchor: null, version: "v", inspectedAt: ownerAt, activity: { kind: "run", description: "d" }, result: { verdict: "pass", summary: "s" }, limitations: ["l"] };

test("discussion save: each protected nested field is refused with its exact reason, bytes unchanged, clean control succeeds", () => {
  const f = fixture();
  const base = DISCUSSION_BASE(f.acceptedId);
  const control = f.envelope("save-discussion", { ...base, questions: [{ id: null, text: "Clean question", status: "open", answers: [], reopenReason: null }] }, ["discussion", "save"]);
  assert.equal(control.status, 0, control.stdout + control.stderr);
  const before = f.bytes();

  const cases: { label: string; questions: object[]; status: number; message: RegExp }[] = [
    { label: "recordedAt injected into an answer", status: 2, message: /unknown or missing discussion input field/, questions: [{ id: null, text: "Q", status: "answered", reopenReason: null, answers: [{ summary: "a", basis: "inspection", ownerRef: null, ownerMessageAt: null, evidence: [EVIDENCE], recordedAt: ownerAt }] }] },
    { label: "reopenings injected onto a question", status: 2, message: /unknown or missing discussion input field/, questions: [{ id: null, text: "Q", status: "open", answers: [], reopenReason: null, reopenings: [{ reason: "forged", recordedAt: ownerAt }] }] },
    { label: "owner answer without an owner reference", status: 2, message: /discussion text must be nonempty/, questions: [{ id: null, text: "Q", status: "answered", reopenReason: null, answers: [{ summary: "a", basis: "owner", ownerRef: null, ownerMessageAt: ownerAt, evidence: [] }] }] },
    { label: "invented question id", status: 3, message: /question ID must name a retained question/, questions: [{ id: "forged-id", text: "Q", status: "open", answers: [], reopenReason: null }] },
  ];
  for (const c of cases) {
    const r = f.envelope("save-discussion", { ...base, questions: c.questions }, ["discussion", "save"]);
    assert.equal(r.status, c.status, `${c.label}: exit`);
    assert.match(r.stdout, c.message, `${c.label}: reason`);
    assert.equal(f.json(r).committed, false, `${c.label}: not committed`);
  }
  assert.equal(f.bytes(), before, "refused nested protected fields left graph and bridge bytes unchanged");
});

test("attach-spec: each protected or forged field is refused with its exact reason, bytes unchanged, clean control succeeds", () => {
  const bounds = { summary: "Fixture bounds", allowedPaths: ["spec.md"], excludedActions: [], outcomeChecks: [{ outcomeId: "o1", criterion: "Owner accepts" }], limitations: [] };
  const cases: { label: string; patch: (clean: object) => object; message: RegExp }[] = [
    { label: "forged specification id", patch: (c) => ({ ...c, id: "forged-spec" }), message: /payload has unknown field "id"/ },
    { label: "grant pointer injected into the payload", patch: (c) => ({ ...c, implementationAuthorization: "forged-grant" }), message: /payload has unknown field "implementationAuthorization"/ },
    { label: "caller-supplied sha256", patch: (c) => ({ ...c, sha256: "0".repeat(64) }), message: /payload has unknown field "sha256"/ },
    { label: "unknown field inside bounds", patch: (c) => ({ ...c, bounds: { ...bounds, approved: true } }), message: /bounds\.approved: unknown field/ },
    { label: "implementation authority inside bounds", patch: (c) => ({ ...c, bounds: { ...bounds, implementationAuthorized: true } }), message: /bounds\.implementationAuthorized: unknown field/ },
  ];
  for (const c of cases) {
    // A fresh fixture per attack so an earlier successful attach cannot cause a later refusal.
    const f = fixture();
    const clean = { planId: "plan-a", acceptedRevisionId: f.acceptedId, path: "spec.md", bounds, discussionDigest: null };
    const before = f.bytes();
    const r = f.envelope("attach-spec", c.patch(clean), ["spec", "attach"]);
    assert.notEqual(r.status, 0, `${c.label}: must not succeed`);
    const reason = (f.json(r).issues as { message: string }[]).map((i) => i.message).join("|");
    assert.match(reason, c.message, `${c.label}: reason`);
    assert.equal(f.json(r).committed, false, `${c.label}: not committed`);
    assert.equal(f.bytes(), before, `${c.label}: graph and bridge bytes unchanged`);
  }
  // Positive control in its own fixture: the same clean envelope succeeds.
  const f = fixture();
  const ok = f.envelope("attach-spec", { planId: "plan-a", acceptedRevisionId: f.acceptedId, path: "spec.md", bounds, discussionDigest: null }, ["spec", "attach"]);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.equal(f.json(ok).committed, true, "clean control commits");
});
