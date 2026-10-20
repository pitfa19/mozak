// S2 `mozak sync` for local scopes in a git repo: fetch outside the locks, take every scope lock in the repo in path
// order, `git merge --ff-only`, release; abort on a diverged history. Local bare repos in temp dirs only, never GitHub.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeOperation, initScopeState, loadInventory, readScope } from "../src/index.ts";
import { syncLocal } from "../src/local-sync.ts";

const scratch = process.env.JCODE_SCRATCH_DIR ?? process.env.TMPDIR ?? tmpdir();
const made: string[] = [];
after(() => { for (const d of made) { if (!d.includes("/mozak-s2sync-")) throw new Error(d); rmSync(d, { recursive: true, force: true }); } });
const g = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "-c", "protocol.file.allow=always", ...args], { cwd, encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }).trim();
const content = (title: string) => ({ constraints: [], nonGoals: [], outcomes: [{ acceptance: "objective", criterion: "c", id: "o", statement: "s" }], purpose: "p", questions: [], rationale: "r", sources: [], title });

function fixture() {
  const base = mkdtempSync(join(scratch, "mozak-s2sync-"));
  made.push(base);
  const bare = join(base, "vault.git");
  const seed = join(base, "seed");
  g(base, "init", "--bare", "-b", "main", bare);
  mkdirSync(seed);
  g(seed, "init", "-b", "main");
  for (const id of ["s1", "s2"]) {
    const root = join(seed, "notes", id);
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "README.md"), "# r\n");
    writeFileSync(join(root, "AGENTS.md"), "# a\n");
    initScopeState({ id, root }, { operationId: `init-${id}`, scopeId: id, kind: "project", title: id, expectedAbsent: { graph: true, bridge: true }, ownerRef: "host:t", ownerMessageAt: "2026-10-12T08:50:00.000Z" });
  }
  writeFileSync(join(seed, "other.md"), "a vault note\n");
  g(seed, "add", "."); g(seed, "commit", "-q", "-m", "seed"); g(seed, "remote", "add", "origin", bare); g(seed, "push", "-q", "-u", "origin", "main");
  const clone = (name: string) => {
    const dir = join(base, name);
    g(base, "clone", "-q", bare, dir);
    const inv = join(base, `${name}-inventory.json`);
    writeFileSync(inv, JSON.stringify({ format: "mozak.local/v3", scopes: [{ id: "s1", root: join(dir, "notes", "s1") }, { id: "s2", root: join(dir, "notes", "s2") }] }));
    return { dir, inv };
  };
  return { base, bare, a: clone("a"), b: clone("b") };
}
const exec = (inv: string, op: string, args: unknown) => executeOperation(loadInventory(inv), op, args, "agent");
function pushChange(side: { dir: string; inv: string }, planId: string) {
  const scope = "s1";
  const entry = loadInventory(side.inv).scopes[0]!;
  const out = exec(side.inv, "propose", { scope, request: { operationId: `op-${planId}`, scopeId: scope, expected: readScope(entry).snapshot, action: "propose", payload: { planId, content: content(planId) } } });
  assert.equal(out.exitCode, 0, JSON.stringify(out.data));
  g(side.dir, "add", "-A"); g(side.dir, "commit", "-q", "-m", `plan ${planId}`); g(side.dir, "push", "-q");
}

test("sync --scope LOCAL fast-forwards the vault under every scope lock in path order, then is up to date", () => {
  const { a, b } = fixture();
  pushChange(b, "from-b");
  const inv = loadInventory(a.inv);
  const seen: string[][] = [];
  const rows = syncLocal([inv.scopes[0]!], inv.scopes, {
    onPhase(phase) { if (phase === "sync-locked") seen.push(["s1", "s2"].filter((id) => existsSync(join(a.dir, "notes", id, ".mozak-write-lock")))); },
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.status, "fast-forwarded", JSON.stringify(rows));
  assert.deepEqual(rows[0]!.locked, ["s1", "s2"]);
  assert.deepEqual(seen, [["s1", "s2"]], "both scope locks were held during the merge");
  assert.equal(existsSync(join(a.dir, "notes", "s1", ".mozak-write-lock")) || existsSync(join(a.dir, "notes", "s2", ".mozak-write-lock")), false, "locks released");
  assert.equal(readFileSync(join(a.dir, "notes", "s1", "mozak.json"), "utf8"), readFileSync(join(b.dir, "notes", "s1", "mozak.json"), "utf8"));
  assert.equal(g(a.dir, "rev-parse", "HEAD"), g(b.dir, "rev-parse", "HEAD"));
  const again = exec(a.inv, "sync", { scope: "s2" });
  assert.equal(again.exitCode, 0);
  assert.equal((again.data.local as { status: string }[])[0]!.status, "up-to-date");
  // An agent reading after sync sees the new plan.
  assert.ok(readScope(inv.scopes[0]!).state.plans.some((p) => p.id === "from-b"));
});

test("sync aborts on a diverged history and changes nothing", () => {
  const { a, b } = fixture();
  pushChange(b, "from-b");
  // A commits its own change without pushing.
  pushChangeLocalOnly(a, "from-a");
  const head = g(a.dir, "rev-parse", "HEAD");
  const bytes = readFileSync(join(a.dir, "notes", "s1", "mozak.json"));
  const out = exec(a.inv, "sync", { scope: "s1" });
  assert.equal(out.data.status, "local-sync-not-fast-forward");
  assert.equal(out.exitCode, 3);
  assert.equal(g(a.dir, "rev-parse", "HEAD"), head);
  assert.deepEqual(readFileSync(join(a.dir, "notes", "s1", "mozak.json")), bytes);
  assert.equal(g(a.dir, "status", "--porcelain"), "");
});
function pushChangeLocalOnly(side: { dir: string; inv: string }, planId: string) {
  const entry = loadInventory(side.inv).scopes[0]!;
  exec(side.inv, "propose", { scope: "s1", request: { operationId: `op-${planId}`, scopeId: "s1", expected: readScope(entry).snapshot, action: "propose", payload: { planId, content: content(planId) } } });
  g(side.dir, "add", "-A"); g(side.dir, "commit", "-q", "-m", `plan ${planId}`);
}

test("sync refuses while any scope lock in the repo is held, releases what it took, and reports ahead and fetch failures", () => {
  const { a, b, bare } = fixture();
  pushChange(b, "from-b");
  const lock = join(a.dir, "notes", "s2", ".mozak-write-lock");
  mkdirSync(lock);
  writeFileSync(join(lock, "owner.json"), JSON.stringify({ token: "held", pid: process.pid, host: "elsewhere" }));
  const head = g(a.dir, "rev-parse", "HEAD");
  const busy = exec(a.inv, "sync", { scope: "s1" });
  assert.equal(busy.data.status, "local-sync-busy");
  assert.equal(busy.exitCode, 4);
  assert.equal(g(a.dir, "rev-parse", "HEAD"), head);
  assert.equal(existsSync(join(a.dir, "notes", "s1", ".mozak-write-lock")), false, "the s1 lock taken first was released");
  rmSync(lock, { recursive: true });
  // --local syncs every local repo (and remotes, none here).
  const all = exec(a.inv, "sync", { local: true });
  assert.equal(all.exitCode, 0, JSON.stringify(all.data));
  assert.equal((all.data.local as { status: string }[])[0]!.status, "fast-forwarded");
  // Local commits not yet pushed: nothing to merge, reported as ahead.
  pushChangeLocalOnly(a, "only-a");
  assert.equal((exec(a.inv, "sync", { scope: "s1" }).data.local as { status: string }[])[0]!.status, "ahead");
  rmSync(bare, { recursive: true });
  const offline = exec(a.inv, "sync", { scope: "s1" });
  assert.equal((offline.data.local as { status: string }[])[0]!.status, "fetch-failed");
  assert.equal(offline.exitCode, 6);
  assert.equal(exec(a.inv, "sync", { scope: "s1", local: true }).data.status, "invalid-input");
});

test("sync of a local scope outside git reports not-in-git", () => {
  const base = mkdtempSync(join(scratch, "mozak-s2sync-"));
  made.push(base);
  const root = join(base, "plain");
  mkdirSync(root);
  writeFileSync(join(root, "README.md"), "# r\n"); writeFileSync(join(root, "AGENTS.md"), "# a\n");
  initScopeState({ id: "plain", root }, { operationId: "init", scopeId: "plain", kind: "project", title: "p", expectedAbsent: { graph: true, bridge: true }, ownerRef: "host:t", ownerMessageAt: "2026-10-12T08:50:00.000Z" });
  const inv = join(base, "inventory.json");
  writeFileSync(inv, JSON.stringify({ format: "mozak.local/v3", scopes: [{ id: "plain", root }] }));
  const out = exec(inv, "sync", { scope: "plain" });
  assert.equal(out.data.status, "local-sync-not-in-git");
  assert.equal(out.exitCode, 2);
});
