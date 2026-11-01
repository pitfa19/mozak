// mozak scope move (owner route): copy a scope's files into a vault folder, verify them byte for byte, then point the
// inventory entry at the new folder. Synthetic temp folders only. Never a real inventory or vault.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { content, NOW } from "./annotations-fixture.ts";
import { executeOperation } from "../src/api.ts";
import { loadInventory } from "../src/scope-index.ts";
import { initScopeState, mutateScope, readScope } from "../src/scope-store.ts";
import { reviewShow } from "../src/review.ts";
import { moveScope, renderMove, scopeMoveOutput } from "../src/scope-move.ts";

const made: string[] = [];
after(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });

const OWNER = { ownerRef: "synthetic:owner-move", ownerMessageAt: NOW, reason: "Synthetic move into the vault" };
const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

/** Make a scope at `root` with one accepted plan (so it has receipts) and the usual entry files. */
function makeScope(id: string, root: string, plans = 1): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "README.md"), `# ${id}\n`);
  writeFileSync(join(root, "AGENTS.md"), `Agents for ${id}\n`);
  const entry = { id, root: realpathSync(root) };
  initScopeState(entry, { operationId: `init-${id}`, scopeId: id, kind: "project", title: `Synthetic ${id}`, expectedAbsent: { graph: true, bridge: true }, ownerRef: "synthetic:init", ownerMessageAt: NOW });
  for (let i = 1; i <= plans; i++) {
    const planId = `${id}-p${i}`;
    mutateScope(entry, { operationId: `prop-${planId}`, scopeId: id, expected: readScope(entry).snapshot, action: "propose", payload: { planId, content: content(planId), distinctFromPlanIds: readScope(entry).state.plans.map((p) => p.id) } }, "agent");
    const shown = reviewShow(readScope(entry).state, planId, "approve-direction");
    mutateScope(entry, { operationId: `appr-${planId}`, scopeId: id, expected: readScope(entry).snapshot, action: "approve-direction", payload: { planId, revisionId: shown.revisionId, reviewDigest: shown.reviewDigest, ownerRef: "synthetic:approve", ownerMessageAt: NOW, reason: "Synthetic approval" } }, "owner");
  }
}

/**
 * base/inventory.json, a vault at base/vault (it has a .obsidian folder), a local scope outside the vault at
 * base/code/proj, a scope already in the vault at base/vault/home, and a 0-plan scope outside it at base/code/empty.
 */
function setup(extraEntries: unknown[] = []) {
  const base = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "mozak-move-"));
  made.push(base);
  const vault = join(base, "vault");
  mkdirSync(join(vault, ".obsidian"), { recursive: true });
  makeScope("proj", join(base, "code", "proj"), 2);
  makeScope("home", join(vault, "home"));
  makeScope("empty", join(base, "code", "empty"), 0);
  const config = join(base, "inventory.json");
  const text = `{\n  "format": "mozak.local/v3",\n  "x": { "note": "kept" },\n  "scopes": [\n    { "id": "home", "root": "vault/home", "focus": [] },\n    { "id": "proj", "root": "code/proj", "focus": ["proj-p1"], "x": { "colour": "red" } },\n    { "id": "empty", "root": "code/empty" }${extraEntries.map((e) => `,\n    ${JSON.stringify(e)}`).join("")}\n  ]\n}\n`;
  writeFileSync(config, text);
  return { base, vault, config, text };
}
const raw = (config: string) => JSON.parse(readFileSync(config, "utf8"));
const plansOf = (config: string, scope: string) => JSON.stringify(executeOperation(loadInventory(config), "plans", { scope, includeRejected: true, limit: 100 }).data.groups);
/** check after the move: no findings except the x-key notice this fixture's inventory causes on purpose. */
function assertClean(config: string, scope: string): void {
  const out = executeOperation(loadInventory(config), "check", { scope });
  const issues = (out.data.issues as { code: string }[]).filter((i) => i.code !== "inventory-x-ignored");
  assert.deepEqual(issues, [], `${scope}: ${JSON.stringify(out.data.issues)}`);
}

test("move: a local scope outside the vault is copied, verified and the entry rewritten; plans and receipts unchanged", () => {
  const f = setup();
  const src = join(f.base, "code", "proj");
  const before = { json: sha(join(src, "mozak.json")), md: sha(join(src, "mozak.md")), plans: plansOf(f.config, "proj"), receipts: readScope({ id: "proj", root: realpathSync(src) }).state.receipts };
  const out = moveScope(f.config, { scope: "proj", to: "vault/projects/proj", ...OWNER });
  assert.equal(out.status, "ok");
  assert.equal(out.changed, true);
  const target = join(f.vault, "projects", "proj");
  assert.deepEqual(out.files.map((x) => x.name).sort(), ["AGENTS.md", "README.md", "mozak.json", "mozak.md"]);
  for (const x of out.files) assert.equal(x.sha256, sha(join(target, x.name)));
  assert.equal(sha(join(target, "mozak.json")), before.json, "mozak.json byte-identical");
  assert.equal(sha(join(target, "mozak.md")), before.md, "mozak.md byte-identical");
  // The old files stay where they were.
  assert.equal(sha(join(src, "mozak.json")), before.json);
  // Only that entry changed: root replaced, focus and x kept; every other key and entry untouched.
  const doc = raw(f.config);
  assert.deepEqual(doc.x, { note: "kept" });
  assert.deepEqual(doc.scopes[0], { id: "home", root: "vault/home", focus: [] });
  assert.deepEqual(doc.scopes[1], { id: "proj", root: "vault/projects/proj", focus: ["proj-p1"], x: { colour: "red" } });
  assert.deepEqual(doc.scopes[2], { id: "empty", root: "code/empty" });
  assert.match(readFileSync(f.config, "utf8"), /^\{\n  "format"/, "indent kept");
  assert.equal(plansOf(f.config, "proj"), before.plans, "plans read the same through the new entry");
  assert.deepEqual(readScope({ id: "proj", root: realpathSync(target) }).state.receipts, before.receipts);
  assertClean(f.config, "proj");
  // No lock or temp file left behind in either place.
  assert.deepEqual(readdirSync(target).sort(), ["AGENTS.md", "README.md", "mozak.json", "mozak.md"]);
  assert.ok(!existsSync(join(src, ".mozak-write-lock")));
  assert.ok(!existsSync(join(f.base, ".mozak-inventory-lock")));
});

test("move --dry-run prints the files and the new entry and writes nothing", () => {
  const f = setup();
  const out = moveScope(f.config, { scope: "proj", to: "vault/projects/proj", dryRun: true, ...OWNER });
  assert.equal(out.status, "dry-run");
  assert.deepEqual(out.entry, { id: "proj", root: "vault/projects/proj", focus: ["proj-p1"], x: { colour: "red" } });
  assert.equal(out.files.length, 4);
  assert.ok(out.files.every((x) => x.bytes > 0 && /^[0-9a-f]{64}$/.test(x.sha256)));
  assert.equal(readFileSync(f.config, "utf8"), f.text);
  assert.ok(!existsSync(join(f.vault, "projects")));
});

test("move of a legacy vault-plans entry to its own plans folder rewrites the entry in place without copying", () => {
  const f = setup([{ id: "tool", remote: "github:synthetic/tool", plans: "vault/tool" }]);
  makeScope("tool", join(f.vault, "tool"));
  const bytes = sha(join(f.vault, "tool", "mozak.json"));
  const out = moveScope(f.config, { scope: "tool", to: "vault/tool", ...OWNER });
  assert.equal(out.status, "ok");
  assert.equal(out.inPlace, true);
  assert.deepEqual(out.files, []);
  assert.deepEqual(raw(f.config).scopes[3], { id: "tool", root: "vault/tool" });
  assert.equal(sha(join(f.vault, "tool", "mozak.json")), bytes);
  assertClean(f.config, "tool");
});

test("move of a legacy repo-cache entry copies the cached plan files into the vault", () => {
  const f = setup([{ id: "web", remote: "github:synthetic/web", ref: "main" }]);
  const cache = join(f.base, ".mozak-cache", "web");
  makeScope("web", cache);
  writeFileSync(join(cache, "mozak.annotations.json"), "{}\n");
  const json = sha(join(cache, "mozak.json"));
  const out = moveScope(f.config, { scope: "web", to: "vault/projects/web", ...OWNER });
  assert.equal(out.status, "ok");
  assert.deepEqual(out.files.map((x) => x.name).sort(), ["AGENTS.md", "README.md", "mozak.annotations.json", "mozak.json", "mozak.md"]);
  assert.equal(sha(join(f.vault, "projects", "web", "mozak.json")), json);
  assert.deepEqual(raw(f.config).scopes[3], { id: "web", root: "vault/projects/web" });
  assert.ok(existsSync(join(cache, "mozak.json")), "the cache copy stays");
  assertClean(f.config, "web");
});

test("move refuses a target outside a vault, a target that holds mozak files, another scope's root and a bad source", () => {
  const f = setup();
  const same = () => assert.equal(readFileSync(f.config, "utf8"), f.text);
  assert.throws(() => moveScope(f.config, { scope: "proj", to: "elsewhere/proj", ...OWNER }), { code: "move-target-outside-vault", message: /\.obsidian/ });
  mkdirSync(join(f.vault, "taken"), { recursive: true });
  writeFileSync(join(f.vault, "taken", "mozak.json"), "{}");
  assert.throws(() => moveScope(f.config, { scope: "proj", to: "vault/taken", ...OWNER }), { code: "move-target-has-scope" });
  assert.throws(() => moveScope(f.config, { scope: "proj", to: "vault/home", ...OWNER }), { code: "move-target-has-scope" });
  mkdirSync(join(f.vault, "readme"), { recursive: true });
  writeFileSync(join(f.vault, "readme", "README.md"), "someone else's notes\n");
  assert.throws(() => moveScope(f.config, { scope: "proj", to: "vault/readme", ...OWNER }), { code: "move-target-file-exists" });
  assert.equal(readFileSync(join(f.vault, "readme", "README.md"), "utf8"), "someone else's notes\n");
  assert.throws(() => moveScope(f.config, { scope: "nope", to: "vault/nope", ...OWNER }), { code: "scope-not-found" });
  // A source that fails check: mozak.md edited by hand.
  writeFileSync(join(f.base, "code", "proj", "mozak.md"), "hand edit\n");
  assert.throws(() => moveScope(f.config, { scope: "proj", to: "vault/projects/proj", ...OWNER }), { code: "move-source-fails-check" });
  assert.ok(!existsSync(join(f.vault, "projects")));
  same();
});

test("move refuses missing owner provenance and bad arguments before touching anything", () => {
  const f = setup();
  assert.throws(() => moveScope(f.config, { scope: "proj", to: "vault/p", ...OWNER, ownerRef: "" }), { code: "invalid-input" });
  assert.throws(() => moveScope(f.config, { scope: "proj", to: "vault/p", ...OWNER, ownerMessageAt: "yesterday" }), { code: "invalid-input" });
  assert.throws(() => moveScope(f.config, { scope: "proj", to: "vault/p", ...OWNER, reason: " " }), { code: "invalid-input" });
  assert.throws(() => moveScope(f.config, { scope: "proj", ...OWNER }), { code: "invalid-input", message: /--to PATH or --drop/ });
  assert.throws(() => moveScope(f.config, { scope: "proj", to: "vault/p", drop: true, ...OWNER }), { code: "invalid-input" });
  assert.equal(readFileSync(f.config, "utf8"), f.text);
});

test("a failure halfway through leaves the source, the target folder and the old inventory as they were", () => {
  for (const phase of ["after-copy:mozak.json", "before-inventory-write"]) {
    const f = setup();
    const src = join(f.base, "code", "proj");
    const json = sha(join(src, "mozak.json"));
    assert.throws(() => moveScope(f.config, { scope: "proj", to: "vault/projects/proj", ...OWNER }, { onPhase: (p) => { if (p === phase) throw new Error(`injected at ${p}`); } }), /injected/);
    assert.equal(readFileSync(f.config, "utf8"), f.text, `${phase}: inventory unchanged`);
    assert.equal(sha(join(src, "mozak.json")), json);
    assert.ok(!existsSync(join(f.vault, "projects", "proj", "mozak.json")), `${phase}: no partial copy left`);
    assert.ok(!existsSync(join(src, ".mozak-write-lock")), `${phase}: scope lock released`);
    assert.ok(!existsSync(join(f.base, ".mozak-inventory-lock")), `${phase}: inventory lock released`);
    // The route still works afterwards.
    assert.equal(moveScope(f.config, { scope: "proj", to: "vault/projects/proj", ...OWNER }).status, "ok");
  }
});

test("a scope file that changes between the plan and the scope lock stops the move with stale-input", () => {
  const changes: [string, (src: string) => void][] = [
    ["same size", (src) => writeFileSync(join(src, "README.md"), readFileSync(join(src, "README.md"), "utf8").toUpperCase())],
    ["file removed", (src) => rmSync(join(src, "AGENTS.md"))],
  ];
  for (const [label, change] of changes) {
    const f = setup();
    const src = join(f.base, "code", "proj");
    assert.throws(() => moveScope(f.config, { scope: "proj", to: "vault/projects/proj", ...OWNER }, { onPhase: (p) => { if (p === "all-locked") change(src); } }), { code: "stale-input" }, label);
    assert.equal(readFileSync(f.config, "utf8"), f.text, label);
    assert.ok(!existsSync(join(f.vault, "projects", "proj")), label);
  }
});

test("move is idempotent: a second run of the same move changes nothing", () => {
  const f = setup();
  moveScope(f.config, { scope: "proj", to: "vault/projects/proj", ...OWNER });
  const text = readFileSync(f.config, "utf8");
  const again = moveScope(f.config, { scope: "proj", to: "vault/projects/proj", ...OWNER });
  assert.equal(again.changed, false);
  assert.equal(readFileSync(f.config, "utf8"), text);
});

test("drop removes a 0-plan entry only, leaves its files, and refuses a scope that has plans", () => {
  const f = setup();
  assert.throws(() => moveScope(f.config, { scope: "proj", drop: true, ...OWNER }), { code: "drop-refused-has-plans" });
  assert.throws(() => moveScope(f.config, { scope: "home", drop: true, ...OWNER }), { code: "drop-refused-has-plans", message: /has 1 plan/ });
  const dry = moveScope(f.config, { scope: "empty", drop: true, dryRun: true, ...OWNER });
  assert.equal(dry.status, "dry-run");
  assert.equal(readFileSync(f.config, "utf8"), f.text);
  const out = moveScope(f.config, { scope: "empty", drop: true, ...OWNER });
  assert.equal(out.status, "ok");
  assert.equal(out.entry, null);
  assert.equal(out.inPlace, false);
  assert.equal(out.to, null);
  assert.deepEqual(raw(f.config).scopes.map((s: { id: string }) => s.id), ["home", "proj"]);
  assert.ok(existsSync(join(f.base, "code", "empty", "mozak.json")), "files stay");
});

test("a pinned specification that stays behind is reported as a warning", () => {
  const f = setup();
  const src = join(f.base, "code", "proj");
  mkdirSync(join(src, "docs"));
  writeFileSync(join(src, "docs", "spec.md"), "# spec\n");
  const entry = { id: "proj", root: realpathSync(src) };
  const st = readScope(entry).state;
  const plan = st.plans[0]!;
  const bounds = { summary: "fixture", allowedPaths: [], excludedActions: [], outcomeChecks: plan.accepted!.content.outcomes.map((o) => ({ outcomeId: o.id, criterion: "passes" })), limitations: [] };
  const r = mutateScope(entry, { operationId: "spec-1", scopeId: "proj", expected: readScope(entry).snapshot, action: "attach-spec", payload: { planId: plan.id, acceptedRevisionId: plan.accepted!.id, path: "docs/spec.md", bounds, discussionDigest: null } }, "agent");
  assert.equal(r.committed, true, JSON.stringify(r));
  const out = moveScope(f.config, { scope: "proj", to: "vault/projects/proj", dryRun: true, ...OWNER });
  assert.deepEqual(out.warnings.map((w) => w.code), ["spec-not-moved"]);
  assert.match(out.warnings[0]!.message, /docs\/spec\.md/);
});

test("renderMove: dry run, done, already done, in place, drop, warnings and errors", () => {
  const f = setup([{ id: "tool", remote: "github:synthetic/tool", plans: "vault/tool" }]);
  makeScope("tool", join(f.vault, "tool"));
  const dry = renderMove(moveScope(f.config, { scope: "proj", to: "vault/projects/proj", dryRun: true, ...OWNER }));
  assert.match(dry, /^status: dry-run \(nothing written\)\nmove proj: 2 plan\(s\)\n  from .*code\/proj\n  to   .*vault\/projects\/proj\n  copy mozak\.json \(\d+ bytes, sha256 [0-9a-f]{12}\)/);
  assert.match(dry, /new entry: \{"id":"proj","root":"vault\/projects\/proj","focus":\["proj-p1"\],"x":\{"colour":"red"\}\}\n$/);
  assert.doesNotMatch(dry, /old files stay/);
  const done = renderMove(moveScope(f.config, { scope: "proj", to: "vault/projects/proj", ...OWNER }));
  assert.match(done, /^status: ok\n/);
  assert.match(done, /the old files stay in .*code\/proj; delete them only after checking the new folder\n$/);
  assert.match(renderMove(moveScope(f.config, { scope: "proj", to: "vault/projects/proj", ...OWNER })), /^status: ok \(already done, nothing changed\)\n/);
  const inPlace = renderMove(moveScope(f.config, { scope: "tool", to: "vault/tool", ...OWNER }));
  assert.match(inPlace, /\(same folder, entry only\)/);
  assert.doesNotMatch(inPlace, /copy |old files stay/);
  assert.match(renderMove(moveScope(f.config, { scope: "empty", drop: true, ...OWNER })), /^status: ok\ndrop empty: remove its inventory entry \(0 plans\); files stay in .*code\/empty\n$/);
  assert.match(renderMove({ status: "ok", action: "move", scope: "s", plans: 1, from: "/a", to: "/b", files: [], entry: {}, changed: true, inPlace: false, warnings: [{ code: "spec-not-moved", message: "m" }] }), /warning spec-not-moved: m\n$/);
  assert.equal(renderMove({ status: "scope-not-found", issues: [] }), `${JSON.stringify({ status: "scope-not-found", issues: [] }, null, 2)}\n`);
});

test("scopeMoveOutput: errors become an envelope with the domain exit code", () => {
  const f = setup();
  const bad = scopeMoveOutput(f.config, { scope: "proj", to: "elsewhere", ...OWNER });
  assert.equal(bad.exitCode, 2);
  assert.equal(bad.data.status, "move-target-outside-vault");
  const ok = scopeMoveOutput(f.config, { scope: "proj", to: "vault/projects/proj", dryRun: true, ...OWNER });
  assert.equal(ok.exitCode, 0);
  assert.equal(ok.data.status, "dry-run");
});
