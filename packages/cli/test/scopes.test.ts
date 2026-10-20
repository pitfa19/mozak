import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Real-process tests for the read-only `scopes` index. Each call is a subprocess running packages/cli/dist.
const here = fileURLToPath(new URL(".", import.meta.url));
const cliPath = resolve(here, "..", "dist", "index.js");
const scratch = process.env.JCODE_SCRATCH_DIR ?? process.env.TMPDIR ?? tmpdir();
const roots: string[] = [];

after(() => {
  for (const root of roots) {
    if (!root.startsWith(scratch + "/") || !root.includes("/mozak-scopes-")) throw new Error(`refusing to remove unexpected path: ${root}`);
    try { chmodSync(join(root, "locked"), 0o755); } catch { /* not present */ }
    rmSync(root, { recursive: true, force: true });
  }
});

interface Run { code: number; out: string; err: string }
function run(args: string[]): Promise<Run> {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, ["--no-warnings", cliPath, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.on("error", fail);
    child.on("close", (code) => done({ code: code ?? -1, out, err }));
  });
}
const json = (r: Run) => JSON.parse(r.out) as Record<string, any>;

const content = (title: string) => ({
  title, purpose: "Keep agreed direction",
  outcomes: [{ id: "o1", statement: "Context can be recovered", acceptance: "objective", criterion: "A new process reads the same direction" }],
  constraints: [], nonGoals: [], rationale: "Avoid repeated context interviews", questions: [], sources: [],
});

let seq = 0;
async function mutate(config: string, scope: string, route: string[], action: string, payload: unknown): Promise<void> {
  const ctx = json(await run(["context", "--config", config, "--scope", scope, "--json"]));
  const req = join(config, "..", `req-${++seq}.json`);
  writeFileSync(req, JSON.stringify({ operationId: `op-${seq}`, scopeId: scope, expected: ctx.snapshot, action, payload }));
  const r = await run([...route, "--config", config, "--scope", scope, "--request", req]);
  assert.equal(r.code, 0, `${action} failed: ${r.out}${r.err}`);
}

/** Inventory with: alpha (initialised, one open plan), beta (initialised, no plan), gamma (not initialised), delta (root missing). */
async function fixture() {
  if (!existsSync(cliPath)) throw new Error(`built CLI missing at ${cliPath}; run "npm run build" first`);
  const base = mkdtempSync(join(scratch, "mozak-scopes-"));
  roots.push(base);
  const entries: { id: string; root: string }[] = [];
  for (const id of ["alpha", "beta", "gamma"]) {
    const root = join(base, id);
    mkdirSync(root);
    writeFileSync(join(root, "README.md"), `# ${id}\n`);
    if (id !== "gamma") writeFileSync(join(root, "AGENTS.md"), "# agents\n");
    entries.push({ id, root });
  }
  entries.push({ id: "delta", root: join(base, "does-not-exist") });
  const config = join(base, "inventory.json");
  writeFileSync(config, JSON.stringify({ format: "mozak.local/v2", scopes: entries }));
  for (const id of ["alpha", "beta"]) {
    const req = join(base, `init-${id}.json`);
    writeFileSync(req, JSON.stringify({ operationId: `init-${id}`, scopeId: id, kind: id === "alpha" ? "project" : "topic", title: `Title of ${id}`, expectedAbsent: { graph: true, bridge: true }, ownerRef: "host:test", ownerMessageAt: "2026-10-12T08:50:00.000Z" }));
    const r = await run(["scope", "init", "--config", config, "--scope", id, "--request", req]);
    assert.equal(r.code, 0, `init failed: ${r.out}${r.err}`);
  }
  await mutate(config, "alpha", ["plan", "propose"], "propose", { planId: "p1", content: content("Alpha plan") });
  return { base, config, entries };
}

test("scopes lists every inventoried scope with id, root, title, kind and plan counts", async () => {
  const f = await fixture();
  const r = await run(["scopes", "--config", f.config, "--json"]);
  assert.equal(r.code, 6, "an unreadable scope makes coverage partial");
  const body = json(r);
  assert.equal(body.operation, "scopes");
  assert.equal(body.committed, false);
  const byId = Object.fromEntries(body.scopes.map((s: any) => [s.id, s]));
  assert.deepEqual(Object.keys(byId).sort(), ["alpha", "beta", "delta", "gamma"]);
  assert.equal(byId.alpha.root, f.entries[0].root);
  assert.equal(byId.alpha.status, "ok");
  assert.equal(byId.alpha.title, "Title of alpha");
  assert.equal(byId.alpha.kind, "project");
  assert.deepEqual(byId.alpha.plans, { completed: 0, open: 0, awaiting: 1 });
  assert.equal(byId.beta.kind, "topic");
  assert.deepEqual(byId.beta.plans, { completed: 0, open: 0, awaiting: 0 });
});

test("scopes reports an uninitialised scope and a missing root as failed with a code, never omitted", async () => {
  const f = await fixture();
  const body = json(await run(["scopes", "--config", f.config, "--json"]));
  const byId = Object.fromEntries(body.scopes.map((s: any) => [s.id, s]));
  assert.equal(byId.gamma.status, "failed");
  assert.equal(byId.gamma.code, "scope-uninitialized");
  assert.equal(byId.delta.status, "failed");
  assert.equal(byId.delta.code, "scope-root-missing");
  assert.equal(body.coverage.selected, 4);
  assert.equal(body.coverage.complete, false);
  assert.equal(body.coverage.ok, 2);
  assert.equal(body.coverage.failed, 2);
});

test("scopes lists which entry documents exist in each scope root", async () => {
  const f = await fixture();
  const body = json(await run(["scopes", "--config", f.config, "--json"]));
  const byId = Object.fromEntries(body.scopes.map((s: any) => [s.id, s]));
  assert.deepEqual(byId.alpha.entryFiles, ["AGENTS.md", "mozak.json", "mozak.md", "README.md"]);
  assert.deepEqual(byId.gamma.entryFiles, ["README.md"]);
  assert.deepEqual(byId.delta.entryFiles, []);
});

test("scopes is deterministic, sorted by id, and reports the inventory digest", async () => {
  const f = await fixture();
  const a = json(await run(["scopes", "--config", f.config, "--json"]));
  const b = json(await run(["scopes", "--config", f.config, "--json"]));
  assert.deepEqual(a.scopes.map((s: any) => s.id), ["alpha", "beta", "delta", "gamma"]);
  assert.match(a.inventory, /^[a-f0-9]{64}$/);
  assert.equal(a.inventory, b.inventory);
  assert.deepEqual(a, b);
});

test("scopes writes nothing: every file in the scope roots is byte-identical afterwards", async () => {
  const f = await fixture();
  const snapshot = () => f.entries.slice(0, 3).flatMap((e) => ["mozak.json", "mozak.md", "README.md"].map((n) => {
    try { return readFileSync(join(e.root, n), "utf8"); } catch { return "<absent>"; }
  }));
  const before = snapshot();
  await run(["scopes", "--config", f.config, "--json"]);
  assert.deepEqual(snapshot(), before);
});

test("scopes does not report plan content, observations or owner decisions", async () => {
  const f = await fixture();
  const text = (await run(["scopes", "--config", f.config, "--json"])).out;
  assert.doesNotMatch(text, /Context can be recovered/);
  assert.doesNotMatch(text, /Keep agreed direction/);
  assert.doesNotMatch(text, /host:test/);
});

test("scopes rejects any argument it does not define", async () => {
  const f = await fixture();
  for (const extra of [["--scope", "alpha"], ["--bogus"], ["--request", "x.json"]]) {
    const r = await run(["scopes", "--config", f.config, ...extra]);
    assert.equal(r.code, 2, `expected exit 2 for ${extra.join(" ")}`);
  }
});

test("scopes requires --config", async () => {
  const r = await run(["scopes"]);
  assert.equal(r.code, 2);
  assert.match(r.err, /missing --config/);
});

test("scopes exits 0 when every scope is readable", async () => {
  const f = await fixture();
  const small = join(f.base, "small.json");
  writeFileSync(small, JSON.stringify({ format: "mozak.local/v2", scopes: [f.entries[0], f.entries[1]] }));
  const r = await run(["scopes", "--config", small, "--json"]);
  assert.equal(r.code, 0);
  assert.equal(json(r).coverage.complete, true);
});

test("scopes without --json prints a readable table naming each scope and its folder", async () => {
  const f = await fixture();
  const r = await run(["scopes", "--config", f.config]);
  assert.match(r.out, /alpha/);
  assert.match(r.out, new RegExp(f.entries[0].root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(r.out, /failed/);
});

test("scopes does not follow a symlinked mozak.json out of the scope root", async () => {
  const f = await fixture();
  const { symlinkSync, rmSync: rm } = await import("node:fs");
  const link = join(f.entries[1].root, "mozak.json");
  const target = join(f.base, "outside.json");
  writeFileSync(target, readFileSync(link));
  rm(link);
  symlinkSync(target, link);
  const body = json(await run(["scopes", "--config", f.config, "--json"]));
  const beta = body.scopes.find((s: any) => s.id === "beta");
  assert.equal(beta.status, "failed");
  assert.equal(beta.code, "scope-symlink-forbidden");
});
