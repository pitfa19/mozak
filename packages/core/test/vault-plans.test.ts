import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeOperation, initScopeState, loadInventory, readRemoteMeta, setVisibilityChecker } from "../src/index.ts";

const scratch = process.env.JCODE_SCRATCH_DIR ?? process.env.TMPDIR ?? tmpdir();
const made: string[] = [];
after(() => { for (const d of made) { if (!d.includes("/mozak-vault-")) throw new Error(d); rmSync(d, { recursive: true, force: true }); } });

const g = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "protocol.file.allow=always", ...args], { cwd, encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });

const content = (title: string) => ({
  title, purpose: "Keep agreed direction",
  outcomes: [{ id: "first-step", statement: "Context can be recovered", acceptance: "objective", criterion: "A new process reads the same direction" }],
  constraints: [], nonGoals: [], rationale: "r", questions: [], sources: [],
});

/** Snapshot of everything git knows about a bare repo: every ref and every object. */
function repoState(bare: string): string {
  return [g(bare, "for-each-ref", "--format=%(refname) %(objectname)"), g(bare, "count-objects", "-v"), readdirSync(join(bare, "refs", "heads")).sort().join(",")].join("\n");
}

/** A public-style code repo (no plan files) plus a vault folder holding the scope. */
function fixture() {
  const base = mkdtempSync(join(scratch, "mozak-vault-"));
  made.push(base);
  const bare = join(base, "code.git");
  const seed = join(base, "seed");
  g(base, "init", "--bare", "-b", "main", bare);
  mkdirSync(seed);
  g(seed, "init", "-b", "main");
  writeFileSync(join(seed, "README.md"), "# code\n");
  writeFileSync(join(seed, "index.js"), "console.log(1)\n");
  g(seed, "add", "."); g(seed, "commit", "-m", "code"); g(seed, "remote", "add", "origin", bare); g(seed, "push", "origin", "main");
  const vault = join(base, "vault");
  const plans = join(vault, "creations", "tool");
  mkdirSync(plans, { recursive: true });
  writeFileSync(join(plans, "README.md"), "# tool plans\n");
  writeFileSync(join(plans, "AGENTS.md"), "# agents\n");
  const inv = join(vault, "mozak-inventory.json");
  writeFileSync(inv, JSON.stringify({ format: "mozak.local/v3", scopes: [{ id: "tool", remote: `file://${bare}`, plans: "creations/tool" }] }));
  const entry = loadInventory(inv).scopes[0]!;
  initScopeState(entry, { operationId: "init-1", scopeId: "tool", kind: "project", title: "Tool", expectedAbsent: { graph: true, bridge: true }, ownerRef: "host:t", ownerMessageAt: "2026-10-18T08:50:00.000Z" });
  return { base, bare, vault, plans, inv };
}
const exec = (inv: string, op: string, args: unknown, actor: "agent" | "owner" = "agent") => executeOperation(loadInventory(inv), op, args, actor);

test("inventory: plans makes a vault scope; shape stays strict; old digests unchanged", () => {
  const base = mkdtempSync(join(scratch, "mozak-vault-")); made.push(base);
  const inv = join(base, "i.json");
  const load = (scopes: unknown[]) => { writeFileSync(inv, JSON.stringify({ format: "mozak.local/v3", scopes })); return loadInventory(inv); };
  const before = load([{ id: "a", remote: "github:o/r" }, { id: "b", root: "b" }]).digest;
  // Adding a vault entry elsewhere does not change how existing entries hash.
  const plain = load([{ id: "a", remote: "github:o/r" }, { id: "b", root: "b" }]);
  assert.equal(plain.digest, before);
  const v = load([{ id: "a", remote: "github:o/r", plans: "notes/a" }]).scopes[0]!;
  assert.equal(v.remote?.plansMode, "vault");
  assert.equal(v.root, join(execFileSync("realpath", [base], { encoding: "utf8" }).trim(), "notes", "a"));
  assert.equal(load([{ id: "a", remote: "github:o/r" }]).scopes[0]!.remote?.plansMode, "repo");
  assert.notEqual(load([{ id: "a", remote: "github:o/r", plans: "notes/a" }]).digest, load([{ id: "a", remote: "github:o/r" }]).digest);
  assert.throws(() => load([{ id: "a", remote: "github:o/r", plans: "" }]), /plans must be a nonempty path/);
  assert.throws(() => load([{ id: "a", remote: "github:o/r", plans: 3 }]), /plans must be a nonempty path/);
  assert.throws(() => load([{ id: "a", remote: "github:o/r", plans: ".mozak-cache/a" }]), /must not be inside \.mozak-cache/);
  assert.throws(() => load([{ id: "a", remote: "github:o/r", plans: "x", root: "y" }]), /exactly one/);
  assert.throws(() => load([{ id: "a", root: "y", plans: "x" }]), /unknown key "plans"/);
  assert.throws(() => load([{ id: "a", remote: "github:o/r", plans: "x" }, { id: "b", root: "x" }]), /same root/);
});

test("vault scope: reads, writes, sync and render never touch the repo", () => {
  const { inv, bare, base, plans } = fixture();
  const repoBefore = repoState(bare);
  const ctx = exec(inv, "context", { scope: "tool" });
  assert.equal(ctx.exitCode, 0, JSON.stringify(ctx.data));
  const status = (ctx.data.remote as any[])[0];
  assert.equal(status.source, "vault");
  assert.equal(status.stale, false);
  const req = { operationId: "op-1", scopeId: "tool", expected: ctx.data.snapshot, action: "propose", payload: { planId: "p1", content: content("Vault plan") } };
  const out = exec(inv, "propose", { scope: "tool", request: req });
  assert.equal(out.exitCode, 0, JSON.stringify(out.data));
  assert.equal((out.data as any).remotePush, undefined);
  assert.match(readFileSync(join(plans, "MOZAK.json"), "utf8"), /Vault plan/);
  assert.match(readFileSync(join(plans, "MOZAK.md"), "utf8"), /Vault plan/);
  const sync = exec(inv, "sync", {});
  assert.equal(sync.exitCode, 0);
  assert.equal((sync.data.remote as any[])[0].source, "vault");
  const render = exec(inv, "render", { all: true });
  assert.notEqual((render.data.scopes as any[])[0].result, "remote-skipped");
  assert.equal(exec(inv, "check", { scope: "tool" }).exitCode, 0);
  // No cache, no clone, no git work anywhere for this scope.
  assert.ok(!existsSync(join(base, "vault", ".mozak-cache", "tool")));
  assert.ok(!existsSync(join(plans, ".git")));
  assert.equal(repoState(bare), repoBefore);
});

test("vault scope works with no network and with the origin gone", () => {
  const { inv, bare } = fixture();
  rmSync(bare, { recursive: true });
  const ctx = exec(inv, "context", { scope: "tool" });
  assert.equal(ctx.exitCode, 0);
  const req = { operationId: "op-off", scopeId: "tool", expected: ctx.data.snapshot, action: "propose", payload: { planId: "p1", content: content("Offline") } };
  assert.equal(exec(inv, "propose", { scope: "tool", request: req }).exitCode, 0);
  const idx = exec(inv, "scopes", {});
  const row = (idx.data.scopes as any[])[0];
  assert.equal(row.source, "vault");
  assert.equal(row.remote.startsWith("file://"), true);
  assert.equal(row.stale, false);
});

test("pull of a vault scope clones code only and leaves the plans untouched", () => {
  const { inv, base, plans } = fixture();
  const plansBefore = readFileSync(join(plans, "MOZAK.json"));
  const dest = join(base, "Downloads", "tool");
  const out = exec(inv, "pull", { scope: "tool", into: dest }, "owner");
  assert.equal(out.exitCode, 0, JSON.stringify(out.data));
  assert.ok(existsSync(join(dest, "index.js")));
  assert.ok(!existsSync(join(dest, "MOZAK.json")));
  assert.ok(!existsSync(join(dest, "MOZAK.md")));
  assert.deepEqual(readFileSync(join(plans, "MOZAK.json")), plansBefore);
  // The scope root is still the vault folder, not the clone.
  assert.equal(loadInventory(inv).scopes[0]!.root, execFileSync("realpath", [plans], { encoding: "utf8" }).trim());
  assert.equal(readRemoteMeta(join(base, "vault"), "tool").fullClone, null);
  // Deleting the clone loses nothing.
  rmSync(dest, { recursive: true });
  assert.equal(exec(inv, "context", { scope: "tool" }).exitCode, 0);
});

test("vault scopes are never blocked or warned for being public; visibility is only a label", () => {
  const { inv } = fixture();
  let calls = 0;
  const restore = setVisibilityChecker(() => { calls++; return "public"; });
  try {
    const ctx = exec(inv, "context", { scope: "tool" });
    const req = { operationId: "op-v", scopeId: "tool", expected: ctx.data.snapshot, action: "propose", payload: { planId: "p1", content: content("Public code, private plans") } };
    assert.equal(exec(inv, "propose", { scope: "tool", request: req }).exitCode, 0);
    assert.equal(calls, 0, "writes and reads never ask about visibility");
    const sync = exec(inv, "sync", {});
    assert.equal(sync.exitCode, 0);
    assert.ok(!(sync.data.issues as any[]).some((i) => i.code === "public-repo-plans"));
    assert.equal(calls, 1, "sync caches the answer once for the sidebar label");
    exec(inv, "sync", {});
    assert.equal(calls, 1);
  } finally { restore(); }
});

test("spec files resolve inside the plans folder", () => {
  const { inv, plans } = fixture();
  assert.ok(statSync(plans).isDirectory());
  mkdirSync(join(plans, "docs"));
  writeFileSync(join(plans, "docs", "spec.md"), "# spec\n");
  let ctx = exec(inv, "context", { scope: "tool" });
  const p = { operationId: "op-p", scopeId: "tool", expected: ctx.data.snapshot, action: "propose", payload: { planId: "p1", content: content("Spec plan") } };
  assert.equal(exec(inv, "propose", { scope: "tool", request: p }).exitCode, 0);
  const show = exec(inv, "review", { scope: "tool", plan: "p1" });
  ctx = exec(inv, "context", { scope: "tool" });
  const d = { operationId: "op-d", scopeId: "tool", expected: ctx.data.snapshot, action: "approve-direction", payload: { planId: "p1", revisionId: (show.data as any).review.revisionId, reviewDigest: (show.data as any).review.reviewDigest, ownerRef: "host:t", ownerMessageAt: "2026-10-18T09:00:00.000Z", reason: "ok" } };
  assert.equal(exec(inv, "decide", { scope: "tool", request: d }, "owner").exitCode, 0);
  const graph = JSON.parse(readFileSync(join(plans, "MOZAK.json"), "utf8"));
  const accepted = graph.plans[0].accepted.id;
  ctx = exec(inv, "context", { scope: "tool" });
  const bounds = { summary: "s", allowedPaths: ["src"], excludedActions: [], outcomeChecks: [{ outcomeId: "first-step", criterion: "c" }], limitations: [] };
  const a = { operationId: "op-a", scopeId: "tool", expected: ctx.data.snapshot, action: "attach-spec", payload: { planId: "p1", acceptedRevisionId: accepted, path: "docs/spec.md", bounds, discussionDigest: null } };
  const attached = exec(inv, "attach-spec", { scope: "tool", request: a });
  assert.equal(attached.exitCode, 0, JSON.stringify(attached.data));
});
