// S2 usage log and monthly aggregates. Synthetic temp dirs only; never writes to a real vault.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { cleanup, world } from "./annotations-fixture.ts";
import { aggregateUsage, appendUsage, monthOf, readUsageLines, usageDir, usageHost, usageLine, usageLogPath, writeUsageAggregate, type UsageLine } from "../src/usage.ts";
import { executeOperation } from "../src/api.ts";
import { readScope } from "../src/scope-store.ts";

after(cleanup);

test("every operation appends one counts-only line next to the inventory, never request or plan text", () => {
  const w = world();
  w.propose("alpha", "secret-plan-id", { title: "TOP SECRET TITLE", purpose: "PRIVATE PURPOSE" });
  const inv = w.inv();
  executeOperation(inv, "context", { scope: "alpha" });
  executeOperation(inv, "plans", { all: true });
  executeOperation(inv, "observe", { scope: "alpha", request: { operationId: "x", scopeId: "alpha", expected: { ...readScope(w.entries.alpha).snapshot, revision: "old" }, action: "observe", payload: { planId: "secret-plan-id" } } });
  const base = w.base;
  const month = monthOf(new Date());
  const lines = readUsageLines(base, month);
  assert.equal(lines.length, 3);
  assert.deepEqual(lines.map((l) => [l.op, l.scope, l.exit]), [["context", "alpha", 0], ["plans", "all", 0], ["observe", "alpha", lines[2]!.exit]]);
  for (const l of lines) {
    assert.deepEqual(Object.keys(l).filter((k) => !["v", "ts", "host", "actor", "op", "scope", "exit", "status", "ms", "bytes", "committed", "rebased"].includes(k)), []);
    assert.ok(l.bytes > 0);
  }
  const raw = readFileSync(usageLogPath(base, month), "utf8");
  for (const secret of ["TOP SECRET TITLE", "PRIVATE PURPOSE", "secret-plan-id", "operationId"]) assert.equal(raw.includes(secret), false, secret);
  // The folder ignores itself, so a cache inside a vault is never committed.
  assert.equal(readFileSync(join(usageDir(base), ".gitignore"), "utf8"), "*\n");
  execFileSync("git", ["init", "-q", base]);
  assert.equal(execFileSync("git", ["status", "--porcelain", "--untracked-files=all", "--", ".mozak-cache"], { cwd: base, encoding: "utf8" }), "");
});

test("MOZAK_USAGE_LOG=0 turns the log off; inventories without a file path never log", () => {
  const w = world();
  const before = process.env.MOZAK_USAGE_LOG;
  process.env.MOZAK_USAGE_LOG = "0";
  try { executeOperation(w.inv(), "context", { scope: "alpha" }); } finally { if (before === undefined) delete process.env.MOZAK_USAGE_LOG; else process.env.MOZAK_USAGE_LOG = before; }
  assert.equal(existsSync(usageDir(w.base)), false);
  const inv = w.inv();
  const plain = { format: inv.format, scopes: inv.scopes, digest: inv.digest };
  executeOperation(plain, "context", { scope: "alpha" });
  assert.equal(existsSync(usageDir(w.base)), false);
});

test("aggregateUsage counts per operation, exit and status, stale refusals and writes, without scope ids", () => {
  const mk = (op: string, exit: number, status: string, ms: number, extra: Partial<UsageLine> = {}): UsageLine => ({ v: 1, ts: "2026-10-03T10:00:00.000Z", host: "h", actor: "agent", op, scope: "private-scope", exit, status, ms, bytes: 100, ...extra });
  const lines = [mk("observe", 0, "ok", 40, { committed: true }), mk("observe", 3, "stale-input", 5), mk("observe", 0, "ok", 60, { committed: true, rebased: true }), mk("context", 0, "ok", 10, { actor: "owner" }), { ...mk("context", 0, "ok", 1), ts: "2026-09-30T23:59:59.000Z" }];
  const agg = aggregateUsage(lines, "h", "2026-10");
  assert.equal(agg.calls, 4);
  assert.equal(agg.writes, 2);
  assert.equal(agg.staleRefusals, 1);
  assert.equal(agg.rebased, 1);
  assert.deepEqual(agg.byActor, { agent: 3, owner: 1 });
  assert.deepEqual(Object.keys(agg.byOperation), ["context", "observe"]);
  assert.deepEqual(agg.byOperation.observe, { calls: 3, exits: { 0: 2, 3: 1 }, statuses: { ok: 2, "stale-input": 1 }, msP50: 40, msP95: 60, bytesTotal: 300 });
  assert.equal(JSON.stringify(agg).includes("private-scope"), false);
});

test("writeUsageAggregate writes <host>-<yyyy-mm>.json and refuses scope or index roots", () => {
  const w = world();
  const line = usageLine("context", { scope: "alpha" }, "agent", { status: "ok" }, 0, 3, new Date("2026-10-05T00:00:00Z"));
  assert.equal(appendUsage(w.base, line), true);
  const agg = aggregateUsage(readUsageLines(w.base, "2026-10"), usageHost(), "2026-10");
  assert.equal(agg.calls, 1);
  const vault = join(w.base, "personal-vault");
  mkdirSync(vault);
  const target = join(vault, ".mozak-usage");
  const path = writeUsageAggregate(target, agg, [w.entries.alpha.root]);
  assert.ok(path.endsWith(`/.mozak-usage/${usageHost()}-2026-10.json`), path);
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), agg);
  assert.deepEqual(readdirSync(target), [`${usageHost()}-2026-10.json`]);
  // Rewriting the same month replaces the file.
  writeUsageAggregate(target, { ...agg, calls: 2 }, []);
  assert.equal(JSON.parse(readFileSync(path, "utf8")).calls, 2);
  assert.throws(() => writeUsageAggregate(join(w.entries.alpha.root, ".mozak-usage"), agg, [w.entries.alpha.root]), { code: "usage-target-refused" });
  assert.throws(() => writeUsageAggregate(w.base, agg, [w.entries.alpha.root]), { code: "usage-target-refused" }, "a folder that contains a scope is refused too");
  assert.throws(() => writeUsageAggregate(target, { ...agg, month: "2026-1" }, []), { code: "invalid-input" });
});

test("a not-yet-created aggregate below a symlinked scope is refused", () => {
  const w = world();
  const alias = join(w.base, "scope-alias");
  symlinkSync(w.entries.alpha.root, alias, "dir");
  const agg = aggregateUsage([], "synthetic", "2026-10");
  assert.throws(() => writeUsageAggregate(join(alias, "new", ".mozak-usage"), agg, [w.entries.alpha.root]), { code: "usage-target-refused" });
  assert.equal(existsSync(join(w.entries.alpha.root, "new")), false);
});

test("a torn last line is skipped when reading the log", () => {
  const w = world();
  const line = usageLine("check", { scope: "alpha" }, "agent", { status: "ok" }, 0, 1, new Date("2026-11-01T00:00:00Z"));
  appendUsage(w.base, line);
  execFileSync("sh", ["-c", `printf '{"v":1,"ts":"2026-11' >> "${usageLogPath(w.base, "2026-11")}"`]);
  assert.equal(readUsageLines(w.base, "2026-11").length, 1);
});
