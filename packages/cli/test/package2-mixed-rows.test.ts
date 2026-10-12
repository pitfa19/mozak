import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readScope } from "../../core/src/scope-store.ts";
import { loadInventory } from "../../core/src/scope-index.ts";

// Mixed awaiting rows through the real built CLI. One plan shows direction, outcome, and implementation rows at once.
// Each awaiting row carries its explicit purpose label, and titles stay visible. Every owner reference is a synthetic
// fixture value. No real owner message is claimed. Each step asserts its own success, so no step can pass by accident.

const scratch = process.env.JCODE_SCRATCH_DIR ?? process.env.TMPDIR;
if (!scratch) throw new Error("scratch directory required");
const roots: string[] = [];
after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
const cliPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const ownerAt = "2026-10-12T08:00:00.000Z";
const OWNER = "synthetic-owner:fixture";

const content = (title: string) => ({
  title,
  purpose: "Preserve agreed meaning",
  outcomes: [{ id: "o1", statement: "Formatter choice is recorded", acceptance: "owner", criterion: "Owner accepts" }],
  constraints: [],
  nonGoals: [],
  rationale: "Avoid lost decisions",
  questions: [],
  sources: [{ id: "source", locator: "synthetic:source", anchor: null, observedAt: ownerAt, version: "fixture-v1", limitations: ["Synthetic fixture"] }],
});

function fixture() {
  const root = mkdtempSync(join(scratch!, "mozak-mixed-"));
  roots.push(root);
  const path = join(root, "one");
  mkdirSync(path);
  writeFileSync(join(path, "README.md"), "# readme\n");
  writeFileSync(join(path, "AGENTS.md"), "# agents\n");
  writeFileSync(join(path, "spec.md"), "# Spec\n\nSynthetic bounded specification.\n");
  const config = join(root, "inventory.json");
  writeFileSync(config, JSON.stringify({ format: "mozak.local/v2", scopes: [{ id: "one", root: "./one" }] }));
  let seq = 0;
  const cli = (args: string[], json: boolean) =>
    spawnSync(process.execPath, ["--no-warnings", cliPath, ...args, "--config", config, ...(json ? ["--json"] : [])], { encoding: "utf8", timeout: 15000 });
  const envelope = (action: string, payload: object, route: string[]) => {
    const snapshot = JSON.parse(cli(["context", "--scope", "one"], true).stdout).snapshot;
    const file = join(root, `request-${seq++}.json`);
    writeFileSync(file, JSON.stringify({ operationId: `op-${seq}`, scopeId: "one", expected: snapshot, action, payload }));
    return cli([...route, "--scope", "one", "--request", file], true);
  };
  const state = () => readScope(loadInventory(config).scopes[0]).state;
  return { root, config, cli, envelope, state };
}

test("mixed rows: one plan shows direction, outcome and implementation awaiting rows, each labelled with its title", () => {
  const f = fixture();
  const file = join(f.root, "init.json");
  writeFileSync(file, JSON.stringify({ operationId: "init-one", scopeId: "one", kind: "project", title: "one", expectedAbsent: { graph: true, bridge: true }, ownerRef: OWNER, ownerMessageAt: ownerAt }));
  const init2 = f.cli(["scope", "init", "--scope", "one", "--request", file], true);
  assert.equal(init2.status, 0, init2.stdout + init2.stderr);

  const proposed = f.envelope("propose", { planId: "plan-a", content: content("Formatter") }, ["plan", "propose"]);
  assert.equal(proposed.status, 0, proposed.stdout + proposed.stderr);

  // Owner accepts direction. The review subject comes from the stored pending revision, bound via review show.
  const pending = f.state().plans.find((p) => p.id === "plan-a")!.pending!;
  const shown = JSON.parse(f.cli(["review", "show", "--scope", "one", "--plan", "plan-a", "--purpose", "approve-direction"], true).stdout);
  const accept = f.envelope("approve-direction", { planId: "plan-a", revisionId: pending.id, reviewDigest: shown.review.reviewDigest, ownerRef: OWNER, ownerMessageAt: ownerAt, reason: "Synthetic owner direction" }, ["review", "decide"]);
  assert.equal(accept.status, 0, accept.stdout + accept.stderr);
  const acceptedId = f.state().plans.find((p) => p.id === "plan-a")!.accepted!.id;

  // Direction row: a pending revision of the accepted plan, titled differently so the row is distinguishable.
  const revised = f.envelope("revise", { planId: "plan-a", pendingRevisionId: null, acceptedRevisionId: acceptedId, content: content("Formatter v2") }, ["plan", "revise"]);
  assert.equal(revised.status, 0, revised.stdout + revised.stderr);

  // Implementation row: attach a bounded spec on the accepted revision with no discussion (discussionDigest null).
  const attached = f.envelope("attach-spec", { planId: "plan-a", acceptedRevisionId: acceptedId, path: "spec.md", bounds: { summary: "Fixture bounds", allowedPaths: ["spec.md"], excludedActions: [], outcomeChecks: [{ outcomeId: "o1", criterion: "Owner accepts" }], limitations: [] }, discussionDigest: null }, ["spec", "attach"]);
  assert.equal(attached.status, 0, attached.stdout + attached.stderr);

  // Outcome row: one passing observation with a supports link to the outcome on the accepted revision.
  const observed = f.envelope(
    "observe",
    {
      planId: "plan-a",
      observation: { id: "obs-1", classification: "observed", summary: "Synthetic passing check", evidence: [{ id: "ev-1", locator: "synthetic:verification", anchor: null, version: "fixture-v1", inspectedAt: ownerAt, activity: { kind: "run", description: "Synthetic reported result" }, result: { verdict: "pass", summary: "Fixture result" }, limitations: ["Synthetic evidence"] }] },
      reasoningLinks: [{ id: "link-1", relation: "supports", from: { planId: "plan-a", revisionId: null, kind: "observation", id: "obs-1" }, to: { planId: "plan-a", revisionId: acceptedId, kind: "outcome", id: "o1" }, rationale: "Evidence bound to the current outcome" }],
    },
    ["observe"],
  );
  assert.equal(observed.status, 0, observed.stdout + observed.stderr);

  const human = f.cli(["plans", "--scope", "one"], false);
  assert.equal(human.status, 0, human.stdout + human.stderr);
  const text = human.stdout;
  assert.match(text, /awaiting \(3\)/, "three awaiting rows for one plan");
  assert.match(text, /review: outcome acceptance/);
  assert.match(text, /review: implementation approval/);
  assert.match(text, /review: direction approval/);
  assert.match(text, /- Formatter v2  \[plan-a\]/, "direction row keeps its own title");
  assert.match(text, /- Formatter  \[plan-a\]/, "outcome and implementation rows keep the accepted title");

  // Paging through the built CLI: one row per page, then continuation-only requests until the group is exhausted.
  const json = (args: string[]) => {
    const r = spawnSync(process.execPath, ["--no-warnings", cliPath, ...args, "--json"], { encoding: "utf8", timeout: 15000 });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    return JSON.parse(r.stdout);
  };
  const first = json(["plans", "--config", f.config, "--scope", "one", "--limit", "1"]);
  assert.equal(first.groups.awaiting.count, 3, "three awaiting rows across pages");
  assert.equal(first.groups.awaiting.rows.length, 1, "one row per page");
  assert.equal(first.groups.awaiting.hasMore, true);

  const pages: { row: { rowKind: string; compositeKey: string } }[] = [];
  let group = first.groups.awaiting;
  pages.push({ row: group.rows[0] });
  while (group.continuation) {
    const token = group.continuation as string;
    const decoded = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as { after: string; group: string };
    assert.equal(decoded.group, "awaiting", "the token pins the awaiting group");
    // The cursor must name exactly the last emitted row before it, so resuming cannot skip or repeat a row.
    assert.equal(decoded.after, pages[pages.length - 1]!.row.compositeKey, "cursor.after equals the previous page's last compositeKey");
    const next = json(["plans", "--config", f.config, "--continuation", token]);
    group = next.groups.awaiting;
    assert.equal(group.rows.length, 1, "continuation returns the next single row");
    pages.push({ row: group.rows[0] });
    assert.ok(pages.length <= 3, "the walk ends after the three rows");
  }

  const kinds = pages.map((p) => p.row.rowKind).sort();
  assert.deepEqual(kinds, ["implementation", "outcome", "pending"], "each awaiting kind appears exactly once across all pages");
  const keys = pages.map((p) => p.row.compositeKey);
  assert.equal(new Set(keys).size, keys.length, "no composite key repeats across pages");
});
