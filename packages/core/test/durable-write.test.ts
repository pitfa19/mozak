import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { durableStats, executeOperation, initScopeState, leftoverTempFiles, loadInventory, replaceFileDurable, writeRemoteMeta } from "../src/index.ts";

const scratch = process.env.JCODE_SCRATCH_DIR ?? process.env.TMPDIR ?? tmpdir();
const made: string[] = [];
after(() => { for (const d of made) { if (!d.includes("/mozak-durable-")) throw new Error(d); rmSync(d, { recursive: true, force: true }); } });

function scope() {
  const base = mkdtempSync(join(scratch, "mozak-durable-")); made.push(base);
  const root = join(base, "s"); mkdirSync(root);
  writeFileSync(join(root, "README.md"), "# r\n"); writeFileSync(join(root, "AGENTS.md"), "# a\n");
  const inv = join(base, "inventory.json");
  writeFileSync(inv, JSON.stringify({ format: "mozak.local/v3", scopes: [{ id: "s", root: "s" }] }));
  initScopeState(loadInventory(inv).scopes[0]!, { operationId: "i", scopeId: "s", kind: "project", title: "S", expectedAbsent: { graph: true, bridge: true }, ownerRef: "host:t", ownerMessageAt: "2026-10-18T08:00:00.000Z" });
  return { base, root, inv };
}
const content = { title: "t", purpose: "p", outcomes: [{ id: "first-step", statement: "s", acceptance: "objective", criterion: "c" }], constraints: [], nonGoals: [], rationale: "r", questions: [], sources: [] };

test("every plan write flushes the file and its folder", () => {
  const { inv } = scope();
  const before = { ...durableStats };
  const ctx = executeOperation(loadInventory(inv), "context", { scope: "s" });
  const out = executeOperation(loadInventory(inv), "propose", { scope: "s", request: { operationId: "p", scopeId: "s", expected: ctx.data.snapshot, action: "propose", payload: { planId: "p1", content } } });
  assert.equal(out.exitCode, 0, JSON.stringify(out.data));
  // mozak.json, mozak.md and the lock owner file: three flushed files, and a folder flush after each.
  assert.ok(durableStats.fileSyncs - before.fileSyncs >= 3, `file syncs ${durableStats.fileSyncs - before.fileSyncs}`);
  assert.ok(durableStats.dirSyncs - before.dirSyncs >= 3, `dir syncs ${durableStats.dirSyncs - before.dirSyncs}`);
});

test("remote meta writes are durable too", () => {
  const base = mkdtempSync(join(scratch, "mozak-durable-")); made.push(base);
  const before = { ...durableStats };
  writeRemoteMeta(base, "x", { lastFetchAt: null, lastError: null, fullClone: null });
  assert.equal(durableStats.fileSyncs - before.fileSyncs, 1);
  assert.equal(durableStats.dirSyncs - before.dirSyncs, 1);
});

test("replaceFileDurable leaves no temp file and replaces atomically", () => {
  const base = mkdtempSync(join(scratch, "mozak-durable-")); made.push(base);
  const p = join(base, "mozak.json");
  writeFileSync(p, "old");
  replaceFileDurable(p, "new");
  assert.equal(readFileSync(p, "utf8"), "new");
  assert.deepEqual(readdirSync(base), ["mozak.json"]);
});

test("check reports a leftover temp file as info without failing; unrelated .tmp files are ignored", () => {
  const { root, inv } = scope();
  const stray = "mozak.json.0123abcd-0123-4567-89ab-0123456789ab.tmp";
  writeFileSync(join(root, stray), "{}");
  writeFileSync(join(root, "notes.tmp"), "mine");
  const out = executeOperation(loadInventory(inv), "check", { scope: "s" });
  assert.equal(out.exitCode, 0, JSON.stringify(out.data));
  assert.ok((out.data.issues as any[]).some((i) => i.code === "leftover-temp-file"));
  assert.deepEqual(leftoverTempFiles(root), [stray]);
  const ctx = executeOperation(loadInventory(inv), "context", { scope: "s" });
  assert.equal(executeOperation(loadInventory(inv), "propose", { scope: "s", request: { operationId: "p2", scopeId: "s", expected: ctx.data.snapshot, action: "propose", payload: { planId: "p2", content } } }).exitCode, 0);
  assert.deepEqual(leftoverTempFiles(root), []);
  assert.ok(readdirSync(root).includes("notes.tmp"), "a user's own .tmp file is never touched");
});
