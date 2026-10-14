import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeOperation, initScopeState, loadInventory, parseRemoteSpec, writeRemoteMeta, readRemoteMeta } from "../src/index.ts";

const scratch = process.env.JCODE_SCRATCH_DIR ?? process.env.TMPDIR ?? tmpdir();
const made: string[] = [];
after(() => { for (const d of made) { if (!d.includes("/mozak-remote-")) throw new Error(d); rmSync(d, { recursive: true, force: true }); } });

const g = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "protocol.file.allow=always", ...args], { cwd, encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });

const content = (title: string) => ({
  title, purpose: "Keep agreed direction",
  outcomes: [{ id: "o1", statement: "Context can be recovered", acceptance: "objective", criterion: "A new process reads the same direction" }],
  constraints: [], nonGoals: [], rationale: "r", questions: [], sources: [],
});

/** Bare origin with an initialised scope plus a decoy file that must never be checked out. */
function fixture() {
  const base = mkdtempSync(join(scratch, "mozak-remote-"));
  made.push(base);
  const bare = join(base, "origin.git");
  const seed = join(base, "seed");
  g(base, "init", "--bare", "-b", "main", bare);
  mkdirSync(seed);
  g(seed, "init", "-b", "main");
  writeFileSync(join(seed, "README.md"), "# r\n");
  writeFileSync(join(seed, "AGENTS.md"), "# a\n");
  writeFileSync(join(seed, "big.bin"), "decoy");
  initScopeState({ id: "genome-mcp", root: seed }, { operationId: "init-1", scopeId: "genome-mcp", kind: "project", title: "Genome", expectedAbsent: { graph: true, bridge: true }, ownerRef: "host:t", ownerMessageAt: "2026-10-12T08:50:00.000Z" });
  g(seed, "add", "."); g(seed, "commit", "-m", "seed"); g(seed, "remote", "add", "origin", bare); g(seed, "push", "origin", "main");
  const inv = join(base, "inventory.json");
  writeFileSync(inv, JSON.stringify({ format: "mozak.local/v3", scopes: [{ id: "genome-mcp", remote: `file://${bare}`, ref: "main" }] }));
  return { base, bare, inv };
}
const exec = (inv: string, op: string, args: unknown, actor: "agent" | "owner" = "agent") => executeOperation(loadInventory(inv), op, args, actor);

test("inventory: remote entry validation stays strict, v2 still accepted", () => {
  const base = mkdtempSync(join(scratch, "mozak-remote-")); made.push(base);
  const inv = join(base, "i.json");
  const bad = (scopes: unknown[], format = "mozak.local/v3") => { writeFileSync(inv, JSON.stringify({ format, scopes })); return () => loadInventory(inv); };
  assert.throws(bad([{ id: "a", remote: "github:o/r", root: "x" }]), /exactly one/);
  assert.throws(bad([{ id: "a", remote: "github:o/r", extra: 1 }]), /unknown key/);
  assert.throws(bad([{ id: "a", remote: "ftp://x/y" }]), /remote must look like/);
  assert.throws(bad([{ id: "a", remote: "github:o/r", ref: "--upload-pack=x" }]), /ref/);
  assert.throws(bad([{ id: "../a", remote: "github:o/r" }]), /cache folder/);
  assert.throws(bad([{ id: "a", remote: "github:o/r" }], "mozak.local/v2"), /unknown key "remote"/);
  const ok = bad([{ id: "a", remote: "github:pitfa19/genome-mcp" }])();
  assert.equal(ok.scopes[0]?.remote?.ref, "main");
  assert.equal(ok.scopes[0]?.remote?.url, "https://github.com/pitfa19/genome-mcp.git");
  assert.equal(ok.scopes[0]?.root, join(realpathOf(base), ".mozak-cache", "a"));
  writeFileSync(inv, JSON.stringify({ format: "mozak.local/v2", scopes: [] }));
  assert.equal(loadInventory(inv).format, "mozak.local/v2");
  assert.equal(parseRemoteSpec("github:a/b/c"), null);
});
function realpathOf(p: string) { return execFileSync("realpath", [p], { encoding: "utf8" }).trim(); }

test("first read fetches a sparse copy with only the four files", () => {
  const { inv, base } = fixture();
  const out = exec(inv, "context", { scope: "genome-mcp" });
  assert.equal(out.exitCode, 0, JSON.stringify(out.data));
  const remote = (out.data.remote as any[])[0];
  assert.equal(remote.stale, false);
  const cache = join(base, ".mozak-cache", "genome-mcp");
  assert.ok(existsSync(join(cache, "MOZAK.json")));
  assert.ok(existsSync(join(cache, "AGENTS.md")));
  assert.ok(!existsSync(join(cache, "big.bin")));
  assert.ok(existsSync(join(cache, ".git")));
  const idx = exec(inv, "scopes", {});
  const row = (idx.data.scopes as any[])[0];
  assert.equal(row.remote.startsWith("file://"), true);
  assert.equal(row.stale, false);
});

test("offline: cached copy is used and marked stale; fresh copy skips fetch", () => {
  const { inv, base, bare } = fixture();
  assert.equal(exec(inv, "context", { scope: "genome-mcp" }).exitCode, 0);
  // Within ten minutes nothing is fetched, even with the origin gone.
  rmSync(bare, { recursive: true });
  const fresh = exec(inv, "context", { scope: "genome-mcp" });
  assert.equal((fresh.data.remote as any[])[0].stale, false);
  // Age the last fetch beyond the window.
  const meta = readRemoteMeta(base, "genome-mcp");
  writeRemoteMeta(base, "genome-mcp", { ...meta, lastFetchAt: new Date(Date.now() - 11 * 60_000).toISOString() });
  const stale = exec(inv, "context", { scope: "genome-mcp" });
  assert.equal(stale.exitCode, 0);
  assert.equal((stale.data.remote as any[])[0].stale, true);
  assert.ok((stale.data.issues as any[]).some((i) => i.code === "remote-stale"));
  const sync = exec(inv, "sync", {});
  assert.equal(sync.exitCode, 6);
  // A write is refused while stale.
  const w = exec(inv, "propose", { scope: "genome-mcp", request: {} });
  assert.equal((w.data as any).status, "remote-stale");
});

test("write commits only MOZAK.json and MOZAK.md and pushes; sync pulls it elsewhere", () => {
  const { inv, base, bare } = fixture();
  const ctx = exec(inv, "context", { scope: "genome-mcp" });
  const req = { operationId: "op-1", scopeId: "genome-mcp", expected: ctx.data.snapshot, action: "propose", payload: { planId: "p1", content: content("Remote plan") } };
  // An unrelated dirty file in the cache must not be committed.
  writeFileSync(join(base, ".mozak-cache", "genome-mcp", "README.md"), "# edited\n");
  const out = exec(inv, "propose", { scope: "genome-mcp", request: req });
  assert.equal(out.exitCode, 0, JSON.stringify(out.data));
  assert.deepEqual((out.data as any).remotePush, { committed: true, pushed: true });
  const verify = join(base, "verify");
  g(base, "clone", bare, verify);
  assert.match(readFileSync(join(verify, "MOZAK.json"), "utf8"), /Remote plan/);
  assert.equal(readFileSync(join(verify, "README.md"), "utf8"), "# r\n");
  assert.equal(g(verify, "show", "--name-only", "--format=", "HEAD").trim().split("\n").sort().join(","), "MOZAK.json,MOZAK.md");
  const plans = exec(inv, "plans", { scope: "genome-mcp" });
  assert.equal((plans.data as any).groups.awaiting.count, 1);
  // Owner rules unchanged: an agent cannot decide.
  assert.equal((exec(inv, "decide", { scope: "genome-mcp", request: {} }).data as any).status, "not-permitted");
});

test("push failure keeps the local commit and reports it; sync recovers", () => {
  const { inv, base, bare } = fixture();
  const ctx = exec(inv, "context", { scope: "genome-mcp" });
  g(bare, "config", "receive.denyCurrentBranch", "refuse");
  writeFileSync(join(bare, "hooks-pre-receive-marker"), "");
  mkdirSync(join(bare, "hooks"), { recursive: true });
  writeFileSync(join(bare, "hooks", "pre-receive"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  const req = { operationId: "op-2", scopeId: "genome-mcp", expected: ctx.data.snapshot, action: "propose", payload: { planId: "p2", content: content("Queued plan") } };
  const out = exec(inv, "propose", { scope: "genome-mcp", request: req });
  assert.equal(out.exitCode, 5);
  assert.ok((out.data.issues as any[]).some((i) => i.code === "remote-push-failed"));
  rmSync(join(bare, "hooks", "pre-receive"));
  const sync = exec(inv, "sync", { scope: "genome-mcp" });
  assert.equal(sync.exitCode, 0, JSON.stringify(sync.data));
  const verify = join(base, "verify");
  g(base, "clone", bare, verify);
  assert.match(readFileSync(join(verify, "MOZAK.json"), "utf8"), /Queued plan/);
});

test("pull makes a full clone, reads prefer it, and an existing foreign destination is refused", () => {
  const { inv, base, bare } = fixture();
  const dest = join(base, "full");
  const out = exec(inv, "pull", { scope: "genome-mcp", into: dest }, "owner");
  assert.equal(out.exitCode, 0, JSON.stringify(out.data));
  assert.ok(existsSync(join(dest, "big.bin")));
  assert.equal(readRemoteMeta(base, "genome-mcp").fullClone, dest);
  // Agents cannot pull.
  assert.equal((exec(inv, "pull", { scope: "genome-mcp" }, "agent").data as any).status, "not-permitted");
  // Re-pull into the same repo is fine.
  assert.equal(exec(inv, "pull", { scope: "genome-mcp", into: dest }, "owner").exitCode, 0);
  // Reads now use the full clone.
  const scopes = exec(inv, "scopes", {});
  const row = (scopes.data.scopes as any[])[0];
  assert.equal(row.source, "full-clone");
  assert.equal(realpathOf(row.root), realpathOf(dest));
  // Writes go through the full clone and push.
  const ctx = exec(inv, "context", { scope: "genome-mcp" });
  const req = { operationId: "op-3", scopeId: "genome-mcp", expected: ctx.data.snapshot, action: "propose", payload: { planId: "p3", content: content("Full plan") } };
  assert.equal(exec(inv, "propose", { scope: "genome-mcp", request: req }).exitCode, 0);
  const verify = join(base, "verify");
  g(base, "clone", bare, verify);
  assert.match(readFileSync(join(verify, "MOZAK.json"), "utf8"), /Full plan/);
  // A different directory is refused.
  const other = join(base, "other");
  mkdirSync(other);
  writeFileSync(join(other, "x"), "x");
  assert.equal((exec(inv, "pull", { scope: "genome-mcp", into: other }, "owner").data as any).status, "pull-destination-exists");
});

test("not a scope: remote without MOZAK.json fails clearly", () => {
  const base = mkdtempSync(join(scratch, "mozak-remote-")); made.push(base);
  const bare = join(base, "o.git"), seed = join(base, "s");
  g(base, "init", "--bare", "-b", "main", bare);
  mkdirSync(seed); g(seed, "init", "-b", "main"); writeFileSync(join(seed, "README.md"), "x");
  g(seed, "add", "."); g(seed, "commit", "-m", "x"); g(seed, "remote", "add", "origin", bare); g(seed, "push", "origin", "main");
  const inv = join(base, "inventory.json");
  writeFileSync(inv, JSON.stringify({ format: "mozak.local/v3", scopes: [{ id: "plain", remote: `file://${bare}` }] }));
  const out = exec(inv, "context", { scope: "plain" });
  assert.equal((out.data as any).status, "scope-uninitialized");
});

test("sync warns when the inventory dir is a git repo that does not ignore .mozak-cache", () => {
  const { inv, base } = fixture();
  g(base, "init", "-b", "main", "work");
  // Put the inventory inside a fresh git repo.
  const repo = join(base, "work");
  writeFileSync(join(repo, "inventory.json"), readFileSync(inv, "utf8"));
  const out = exec(join(repo, "inventory.json"), "sync", {});
  assert.ok((out.data.issues as any[]).some((i) => i.code === "cache-not-ignored"), JSON.stringify(out.data));
  writeFileSync(join(repo, ".gitignore"), ".mozak-cache/\n");
  const again = exec(join(repo, "inventory.json"), "sync", {});
  assert.ok(!(again.data.issues as any[]).some((i) => i.code === "cache-not-ignored"));
});
