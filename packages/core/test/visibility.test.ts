import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeOperation, githubSlug, initScopeState, loadInventory, readRemoteMeta, setVisibilityChecker, writeRemoteMeta, type Visibility } from "../src/index.ts";

const scratch = process.env.JCODE_SCRATCH_DIR ?? process.env.TMPDIR ?? tmpdir();
const made: string[] = [];
after(() => { for (const d of made) { if (!d.includes("/mozak-vis-")) throw new Error(d); rmSync(d, { recursive: true, force: true }); } });

const g = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "protocol.file.allow=always", ...args], { cwd, encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });

const content = (title: string) => ({
  title, purpose: "p",
  outcomes: [{ id: "first-step", statement: "s", acceptance: "objective", criterion: "c" }],
  constraints: [], nonGoals: [], rationale: "r", questions: [], sources: [],
});

/** A repo-mode remote scope: plans inside the repo. */
function fixture() {
  const base = mkdtempSync(join(scratch, "mozak-vis-"));
  made.push(base);
  const bare = join(base, "origin.git");
  const seed = join(base, "seed");
  g(base, "init", "--bare", "-b", "main", bare);
  mkdirSync(seed);
  g(seed, "init", "-b", "main");
  writeFileSync(join(seed, "README.md"), "# r\n");
  writeFileSync(join(seed, "AGENTS.md"), "# a\n");
  initScopeState({ id: "team", root: seed }, { operationId: "init-1", scopeId: "team", kind: "project", title: "Team", expectedAbsent: { graph: true, bridge: true }, ownerRef: "host:t", ownerMessageAt: "2026-10-18T08:50:00.000Z" });
  g(seed, "add", "."); g(seed, "commit", "-m", "seed"); g(seed, "remote", "add", "origin", bare); g(seed, "push", "origin", "main");
  const inv = join(base, "inventory.json");
  writeFileSync(inv, JSON.stringify({ format: "mozak.local/v3", scopes: [{ id: "team", remote: `file://${bare}`, ref: "main" }] }));
  return { base, bare, inv };
}
const exec = (inv: string, op: string, args: unknown, actor: "agent" | "owner" = "agent") => executeOperation(loadInventory(inv), op, args, actor);
function propose(inv: string, id: string) {
  const ctx = exec(inv, "context", { scope: "team" });
  return exec(inv, "propose", { scope: "team", request: { operationId: id, scopeId: "team", expected: ctx.data.snapshot, action: "propose", payload: { planId: id, content: content(id) } } });
}
function withChecker(answer: Visibility, fn: (calls: () => number) => void) {
  let calls = 0;
  const restore = setVisibilityChecker(() => { calls++; return answer; });
  try { fn(() => calls); } finally { restore(); }
}

test("githubSlug accepts github forms and nothing else", () => {
  assert.equal(githubSlug("github:Pitfa19/Mozak"), "pitfa19/mozak");
  assert.equal(githubSlug("https://github.com/o/r.git"), "o/r");
  assert.equal(githubSlug("git@github.com:o/r.git"), "o/r");
  assert.equal(githubSlug("https://gitlab.com/o/r"), null);
  assert.equal(githubSlug("file:///tmp/x.git"), null);
});

test("public repo with plans inside: writes refused, sync and scopes warn, reads still work", () => {
  const { inv, bare } = fixture();
  withChecker("public", () => {
    const before = g(bare, "rev-parse", "main");
    const w = propose(inv, "p1");
    assert.equal(w.exitCode, 3);
    assert.equal((w.data as any).status, "public-repo-plans");
    assert.match(String((w.data as any).issues[0].message), /"plans"/);
    assert.equal(g(bare, "rev-parse", "main"), before);
    const sync = exec(inv, "sync", {});
    assert.ok((sync.data.issues as any[]).some((i) => i.code === "public-repo-plans" && i.scope === "team"));
    const idx = exec(inv, "scopes", {});
    assert.ok((idx.data.issues as any[]).some((i) => i.code === "public-repo-plans"));
    assert.equal(exec(inv, "context", { scope: "team" }).exitCode, 0);
    assert.equal(exec(inv, "plans", { scope: "team" }).exitCode, 0);
  });
});

test("private and unknown never block", () => {
  for (const answer of ["private-or-missing", "unknown"] as const) {
    const { inv } = fixture();
    withChecker(answer, () => {
      assert.equal(propose(inv, "p1").exitCode, 0);
      assert.ok(!(exec(inv, "sync", {}).data.issues as any[]).some((i) => i.code === "public-repo-plans"));
    });
  }
});

test("visibility answer is cached; reads never call the checker", () => {
  const { inv, base } = fixture();
  withChecker("private-or-missing", (calls) => {
    exec(inv, "context", { scope: "team" });
    exec(inv, "scopes", {});
    assert.equal(calls(), 0);
    assert.equal(propose(inv, "p1").exitCode, 0);
    assert.equal(calls(), 1);
    assert.equal(propose(inv, "p2").exitCode, 0);
    assert.equal(calls(), 1);
    assert.equal(readRemoteMeta(base, "team").visibility, "private-or-missing");
    // Expired answers are checked again.
    const meta = readRemoteMeta(base, "team");
    writeRemoteMeta(base, "team", { ...meta, visibilityCheckedAt: new Date(Date.now() - 25 * 3600_000).toISOString() });
    assert.equal(propose(inv, "p3").exitCode, 0);
    assert.equal(calls(), 2);
  });
});

test("a repo that becomes public is refused once the cached answer expires; sync never refetches early", () => {
  const { inv, base } = fixture();
  withChecker("private-or-missing", () => assert.equal(propose(inv, "p1").exitCode, 0));
  withChecker("public", (calls) => {
    // Within 24 hours the cached private answer stands, so a minute-by-minute sync makes no API calls.
    exec(inv, "sync", {});
    assert.equal(calls(), 0);
    const meta = readRemoteMeta(base, "team");
    writeRemoteMeta(base, "team", { ...meta, visibilityCheckedAt: new Date(Date.now() - 25 * 3600_000).toISOString() });
    assert.ok((exec(inv, "sync", {}).data.issues as any[]).some((i) => i.code === "public-repo-plans"));
    assert.equal(calls(), 1);
    assert.equal(propose(inv, "p2").exitCode, 3);
  });
  const graph = JSON.parse(readFileSync(loadInventory(inv).scopes[0]!.root + "/MOZAK.json", "utf8"));
  assert.equal(graph.plans.length, 1);
});
