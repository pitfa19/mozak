import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { initScopeState, loadInventory, repoKey } from "@mozak/core";

// Real-process tests: the built CLI run from inside a plain git clone finds its scope from the clone's origin,
// so an agent working in ~/Downloads/<repo> reads the same vault plans. Writes still need --scope.

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
  const base = mkdtempSync(join(scratch, "mozak-cwd-"));
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
  writeFileSync(inv, JSON.stringify({ format: "mozak.local/v3", scopes: [{ id: "tool", remote: `file://${bare}`, plans: "tool" }, { id: "other", root: "other" }] }));
  mkdirSync(join(base, "vault", "other"));
  initScopeState(loadInventory(inv).scopes.find((s) => s.id === "tool")!, { operationId: "i", scopeId: "tool", kind: "project", title: "Tool", expectedAbsent: { graph: true, bridge: true }, ownerRef: "host:t", ownerMessageAt: "2026-10-18T08:50:00.000Z" });
  const clone = join(base, "Downloads", "tool");
  mkdirSync(join(base, "Downloads"));
  g(join(base, "Downloads"), "clone", "-q", bare, clone);
  return { base, bare, plans, inv, clone };
}

test("repoKey normalizes https, ssh, scp-like, github: and file forms", () => {
  const k = "github.com/pitfa19/mozak";
  for (const u of ["github:pitfa19/mozak", "https://github.com/pitfa19/mozak.git", "https://github.com/Pitfa19/Mozak", "git@github.com:pitfa19/mozak.git", "ssh://git@github.com/pitfa19/mozak.git"]) assert.equal(repoKey(u), k, u);
  assert.equal(repoKey("file:///tmp/x/tool.git"), "file:/tmp/x/tool");
  assert.equal(repoKey("not a url"), null);
});

test("context, plans, check and review show without --scope inside a clone resolve the vault scope", async () => {
  const { inv, clone } = fixture();
  const ctx = await run(["context", "--config", inv], clone);
  assert.equal(ctx.code, 0, ctx.out + ctx.err);
  assert.equal(JSON.parse(ctx.out).context.scope.id, "tool");
  // Also from a subfolder of the clone.
  mkdirSync(join(clone, "src"));
  assert.equal((await run(["context", "--config", inv], join(clone, "src"))).code, 0);
  const plans = await run(["plans", "--config", inv, "--json"], clone);
  assert.equal(plans.code, 0, plans.out);
  assert.equal((await run(["check", "--config", inv], clone)).code, 0);
  const show = await run(["review", "show", "--config", inv, "--plan", "nope"], clone);
  assert.notEqual(JSON.parse(show.out).status, "scope-not-found");
  // The clone never receives plan files.
  assert.ok(!existsSync(join(clone, "MOZAK.json")));
  assert.equal(g(clone, "status", "--porcelain"), "");
});

test("an unrelated repo or plain folder gives scope-not-found, and writes still need --scope", async () => {
  const { inv, base, clone } = fixture();
  const stranger = join(base, "stranger");
  mkdirSync(stranger);
  g(stranger, "init", "-q", "-b", "main");
  g(stranger, "remote", "add", "origin", "https://github.com/someone/else.git");
  const r1 = await run(["context", "--config", inv], stranger);
  assert.equal(r1.code, 2);
  assert.equal(JSON.parse(r1.out).status, "scope-not-found");
  const plain = join(base, "plain");
  mkdirSync(plain);
  assert.equal(JSON.parse((await run(["context", "--config", inv], plain)).out).status, "scope-not-found");
  writeFileSync(join(base, "req.json"), "{}");
  const w = await run(["plan", "propose", "--config", inv, "--request", join(base, "req.json")], clone);
  assert.equal(w.code, 2);
  assert.match(w.err, /missing --scope/);
});

test("explicit --scope still wins inside a clone", async () => {
  const { inv, clone } = fixture();
  const r = await run(["context", "--config", inv, "--scope", "other"], clone);
  assert.notEqual(JSON.parse(r.out).context?.scope?.id, "tool");
});

test("pull --into a Downloads folder clones code only", async () => {
  const { inv, base, plans } = fixture();
  const before = readFileSync(join(plans, "MOZAK.json"));
  const dest = join(base, "Downloads", "fresh");
  const r = await run(["pull", "--config", inv, "--scope", "tool", "--into", dest, "--json"], base);
  assert.equal(r.code, 0, r.out + r.err);
  assert.ok(existsSync(join(dest, "index.js")));
  assert.ok(!existsSync(join(dest, "MOZAK.json")));
  assert.deepEqual(readFileSync(join(plans, "MOZAK.json")), before);
});
