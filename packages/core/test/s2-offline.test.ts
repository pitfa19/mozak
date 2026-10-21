// S2 offline reads: local and vault-plans reads never fetch; remote reads keep the 10-minute fetch, mark
// remoteFreshness, and after a failed fetch do not retry the network on every read. Local bare repos only.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeOperation, initScopeState, loadInventory, readRemoteMeta, writeRemoteMeta } from "../src/index.ts";

const scratch = process.env.JCODE_SCRATCH_DIR ?? process.env.TMPDIR ?? tmpdir();
const made: string[] = [];
after(() => { for (const d of made) { if (!d.includes("/mozak-s2off-")) throw new Error(d); rmSync(d, { recursive: true, force: true }); } });
const g = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "protocol.file.allow=always", ...args], { cwd, encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
const init = (id: string, root: string) => initScopeState({ id, root }, { operationId: `init-${id}`, scopeId: id, kind: "project", title: id, expectedAbsent: { graph: true, bridge: true }, ownerRef: "host:t", ownerMessageAt: "2026-10-12T08:50:00.000Z" });

function fixture() {
  const base = mkdtempSync(join(scratch, "mozak-s2off-"));
  made.push(base);
  const bare = join(base, "origin.git");
  const seed = join(base, "seed");
  g(base, "init", "--bare", "-b", "main", bare);
  mkdirSync(seed);
  g(seed, "init", "-b", "main");
  writeFileSync(join(seed, "README.md"), "# r\n");
  writeFileSync(join(seed, "AGENTS.md"), "# a\n");
  init("repo", seed);
  g(seed, "add", "."); g(seed, "commit", "-m", "seed"); g(seed, "remote", "add", "origin", bare); g(seed, "push", "origin", "main");
  // A local scope and a vault-plans scope whose repo URL does not exist: reads must not need it.
  const local = join(base, "local");
  const plans = join(base, "notes", "tool");
  for (const dir of [local, plans]) { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, "README.md"), "# r\n"); writeFileSync(join(dir, "AGENTS.md"), "# a\n"); }
  init("local", local);
  const inv = join(base, "inventory.json");
  writeFileSync(inv, JSON.stringify({ format: "mozak.local/v3", scopes: [
    { id: "repo", remote: `file://${bare}`, ref: "main" },
    { id: "local", root: "local" },
    { id: "tool", remote: `file://${join(base, "missing.git")}`, plans: "notes/tool" },
  ] }));
  init("tool", loadInventory(inv).scopes[2]!.root);
  return { base, bare, inv };
}
const exec = (inv: string, op: string, args: unknown) => executeOperation(loadInventory(inv), op, args, "agent");
type Row = { scope: string; stale: boolean; remoteFreshness: string };
const row = (out: ReturnType<typeof exec>, scope: string) => (out.data.remote as Row[]).find((r) => r.scope === scope)!;
const metaFile = (base: string, id: string) => join(base, ".mozak-cache", `${id}.meta.json`);

test("local and vault-plans reads never fetch or write cache metadata", () => {
  const { inv, base } = fixture();
  assert.equal(exec(inv, "context", { scope: "local" }).exitCode, 0);
  assert.equal(exec(inv, "check", { scope: "local" }).exitCode, 0);
  const vault = exec(inv, "context", { scope: "tool" });
  assert.equal(vault.exitCode, 0, JSON.stringify(vault.data.issues));
  assert.deepEqual(row(vault, "tool"), { scope: "tool", remote: `file://${join(base, "missing.git")}`, ref: "main", stale: false, lastFetchAt: null, source: "vault", remoteFreshness: "local" } as unknown as Row);
  assert.equal(existsSync(metaFile(base, "tool")), false);
  assert.equal(existsSync(metaFile(base, "local")), false);
  assert.equal(existsSync(metaFile(base, "repo")), false, "no read touched the repo-mode scope");
});

test("remote reads: fetched, then cached for ten minutes, then offline without retrying on every read", () => {
  const { inv, base, bare } = fixture();
  assert.equal(row(exec(inv, "context", { scope: "repo" }), "repo").remoteFreshness, "fetched");
  assert.equal(row(exec(inv, "context", { scope: "repo" }), "repo").remoteFreshness, "cached");
  // Go offline and age the last fetch past the window.
  rmSync(bare, { recursive: true });
  const meta = readRemoteMeta(base, "repo");
  writeRemoteMeta(base, "repo", { ...meta, lastFetchAt: new Date(Date.now() - 11 * 60_000).toISOString() });
  const first = exec(inv, "context", { scope: "repo" });
  assert.equal(first.exitCode, 0);
  assert.deepEqual([row(first, "repo").stale, row(first, "repo").remoteFreshness], [true, "offline"]);
  const afterFailure = readFileSync(metaFile(base, "repo"), "utf8");
  assert.ok(JSON.parse(afterFailure).lastAttemptAt);
  // The next reads use the cached copy and do not try the network again: the metadata is untouched.
  for (const op of ["context", "check", "plans"]) {
    const out = exec(inv, op, op === "plans" ? { all: true } : { scope: "repo" });
    assert.equal(row(out, "repo").remoteFreshness, "offline", op);
    assert.equal(readFileSync(metaFile(base, "repo"), "utf8"), afterFailure, `${op} did not retry the fetch`);
  }
  // sync always tries.
  assert.equal(exec(inv, "sync", { scope: "repo" }).exitCode, 6);
  assert.notEqual(readFileSync(metaFile(base, "repo"), "utf8"), afterFailure);
  // Once the failed attempt is ten minutes old, a read tries again.
  const m2 = readRemoteMeta(base, "repo");
  writeRemoteMeta(base, "repo", { ...m2, lastAttemptAt: new Date(Date.now() - 11 * 60_000).toISOString() });
  exec(inv, "context", { scope: "repo" });
  assert.ok(Date.parse(readRemoteMeta(base, "repo").lastAttemptAt!) > Date.now() - 60_000);
});
