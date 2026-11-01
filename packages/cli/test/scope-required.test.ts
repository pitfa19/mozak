import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { initScopeState, loadInventory } from "@mozak/core";
import { vaultTemp } from "../../core/test/vault-temp.ts";

// 0.6.0: mozak never derives a scope from the working directory's git origin, and there is no pull route.
// Run from inside a code clone, every scoped read needs --scope, and the clone is never touched.

const here = fileURLToPath(new URL(".", import.meta.url));
const cliPath = resolve(here, "..", "dist", "index.js");
const scratch = process.env.JCODE_SCRATCH_DIR ?? process.env.TMPDIR ?? tmpdir();
const roots: string[] = [];
after(() => { for (const r of roots) { if (!r.includes("/mozak-cwd-")) throw new Error(r); rmSync(r, { recursive: true, force: true }); } });

const g = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "protocol.file.allow=always", ...args], { cwd, encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });

function run(args: string[], cwd: string): Promise<{ code: number; out: string; err: string }> {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, ["--no-warnings", cliPath, ...args], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.on("error", fail);
    child.on("close", (code) => done({ code: code ?? -1, out, err }));
  });
}

function fixture() {
  assert.ok(existsSync(cliPath), "run npm run build first");
  const base = vaultTemp(join(scratch, "mozak-cwd-"));
  roots.push(base);
  const bare = join(base, "tool.git");
  const seed = join(base, "seed");
  g(base, "init", "--bare", "-b", "main", bare);
  mkdirSync(seed);
  g(seed, "init", "-b", "main");
  writeFileSync(join(seed, "index.js"), "1\n");
  g(seed, "add", "."); g(seed, "commit", "-m", "c"); g(seed, "remote", "add", "origin", bare); g(seed, "push", "origin", "main");
  const plans = join(base, "vault", "tool");
  mkdirSync(plans, { recursive: true });
  writeFileSync(join(plans, "README.md"), "# r\n");
  writeFileSync(join(plans, "AGENTS.md"), "# a\n");
  const inv = join(base, "vault", "inventory.json");
  // A 0.6.0 entry: a vault folder, with a display-only link to the code repo (never fetched, never matched to a cwd).
  writeFileSync(inv, JSON.stringify({ format: "mozak.local/v3", scopes: [{ id: "tool", root: "tool", repo: "github:someone/tool" }] }));
  initScopeState(loadInventory(inv).scopes.find((s) => s.id === "tool")!, { operationId: "i", scopeId: "tool", kind: "project", title: "Tool", expectedAbsent: { graph: true, bridge: true }, ownerRef: "host:t", ownerMessageAt: "2026-10-18T08:50:00.000Z" });
  const clone = join(base, "Downloads", "tool");
  mkdirSync(join(base, "Downloads"));
  g(join(base, "Downloads"), "clone", "-q", bare, clone);
  return { base, bare, plans, inv, clone };
}

test("inside a clone, context, check, review show and plan show need --scope, even for a scope with a repo link", async () => {
  const { inv, clone } = fixture();
  for (const args of [["context"], ["check"], ["review", "show", "--plan", "p"], ["plan", "show", "--plan", "p"]]) {
    const r = await run([...args, "--config", inv], clone);
    assert.equal(r.code, 2, `${args.join(" ")}: ${r.out}${r.err}`);
    assert.match(r.err, /missing --scope/, args.join(" "));
  }
  assert.ok(!existsSync(join(clone, "mozak.json")));
  assert.equal(g(clone, "status", "--porcelain"), "");
});

test("explicit --scope reads the vault folder from anywhere, including a clone", async () => {
  const { inv, clone, plans } = fixture();
  const r = await run(["context", "--config", inv, "--scope", "tool", "--json"], clone);
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(JSON.parse(r.out).context.scope.id, "tool");
  assert.ok(existsSync(join(plans, "mozak.json")));
  assert.equal(g(clone, "status", "--porcelain"), "");
});

test("pull is gone: an unknown route that clones nothing and leaves the plans as they were", async () => {
  const { inv, base, plans } = fixture();
  const before = readFileSync(join(plans, "mozak.json"));
  const dest = join(base, "Downloads", "fresh");
  const r = await run(["pull", "--config", inv, "--scope", "tool", "--into", dest, "--json"], base);
  assert.equal(r.code, 2, r.out + r.err);
  assert.match(r.err, /unknown route "pull/);
  assert.ok(!existsSync(dest));
  assert.deepEqual(readFileSync(join(plans, "mozak.json")), before);
});
