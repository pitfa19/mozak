// Lowercase plan files since 0.4: new scopes get mozak.json / mozak.md, older scopes keep MOZAK.* working,
// and `rename-files` moves an old scope to the new names without changing its plan.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, renameSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeOperation, initScopeState, loadInventory, readScope, renameScopeFiles, resolveScope, scopeFileName } from "../src/index.ts";

function scope(): { config: string; root: string; id: string } {
  const base = mkdtempSync(join(tmpdir(), "mozak-names-"));
  const root = join(base, "alpha");
  mkdirSync(root);
  writeFileSync(join(root, "README.md"), "# Alpha\n");
  writeFileSync(join(root, "AGENTS.md"), "# Agents\n");
  const config = join(base, "mozak-inventory.json");
  writeFileSync(config, JSON.stringify({ format: "mozak.local/v2", scopes: [{ id: "alpha", root: "alpha" }] }));
  const entry = resolveScope(loadInventory(config), "alpha");
  const out = initScopeState(entry, {
    operationId: "init-1", scopeId: "alpha", kind: "project", title: "Alpha",
    expectedAbsent: { graph: true, bridge: true }, ownerRef: "owner-1", ownerMessageAt: new Date().toISOString(),
  });
  assert.equal(out.status, "ok");
  return { config, root, id: "alpha" };
}

/** Make a fresh scope look like one written by a pre-0.4 version. */
function makeLegacy(root: string): void {
  for (const [from, to] of [["mozak.json", "MOZAK.json"], ["mozak.md", "MOZAK.md"]] as const) {
    renameSync(join(root, from), join(root, `${to}.tmp-case`));
    renameSync(join(root, `${to}.tmp-case`), join(root, to));
  }
  // The old renderer linked to MOZAK.json. Rewrite the link the way 0.3 wrote it.
  const md = join(root, "MOZAK.md");
  writeFileSync(md, readFileSync(md, "utf8").replaceAll("mozak.json", "MOZAK.json"));
}

test("a new scope gets lowercase mozak.json and mozak.md, and the note links to mozak.json", () => {
  const { root } = scope();
  const names = readdirSync(root);
  assert.ok(names.includes("mozak.json") && names.includes("mozak.md"), names.join(","));
  assert.ok(!names.includes("MOZAK.json") && !names.includes("MOZAK.md"));
  assert.match(readFileSync(join(root, "mozak.md"), "utf8"), /\[mozak\.json\]\(mozak\.json\)/);
});

test("a pre-0.4 scope with MOZAK.* still reads as current, and writes keep its names", () => {
  const { config, root } = scope();
  makeLegacy(root);
  const entry = resolveScope(loadInventory(config), "alpha");
  assert.equal(scopeFileName(root, "graph"), "MOZAK.json");
  const read = readScope(entry);
  assert.equal(read.projectionStatus, "current");
  const ctx = executeOperation(loadInventory(config), "context", { scope: "alpha" }, "agent");
  assert.equal(ctx.exitCode, 0, JSON.stringify(ctx.data));
});

test("rename-files moves MOZAK.* to mozak.*, keeps the plan bytes, and the note links to mozak.json", () => {
  const { config, root } = scope();
  makeLegacy(root);
  const graphBefore = readFileSync(join(root, "MOZAK.json"));
  const out = executeOperation(loadInventory(config), "rename-files", { scope: "alpha" }, "owner");
  assert.equal(out.exitCode, 0, JSON.stringify(out.data));
  const names = readdirSync(root);
  assert.ok(names.includes("mozak.json") && names.includes("mozak.md"), names.join(","));
  assert.ok(!names.includes("MOZAK.json") && !names.includes("MOZAK.md"), names.join(","));
  assert.ok(!names.some((n) => n.endsWith(".rename")), "no rename temp files left");
  assert.deepEqual(readFileSync(join(root, "mozak.json")), graphBefore, "plan bytes unchanged");
  assert.match(readFileSync(join(root, "mozak.md"), "utf8"), /\[mozak\.json\]\(mozak\.json\)/);
  assert.equal(readScope(resolveScope(loadInventory(config), "alpha")).projectionStatus, "current");
  const again = executeOperation(loadInventory(config), "rename-files", { scope: "alpha" }, "owner");
  assert.equal(again.exitCode, 0);
  assert.equal((again.data.scopes as Array<{ result: string }>)[0]!.result, "current");
});

test("rename-files is owner-only and refuses a note with hand edits", () => {
  const { config, root } = scope();
  makeLegacy(root);
  const agent = executeOperation(loadInventory(config), "rename-files", { scope: "alpha" }, "agent");
  assert.notEqual(agent.exitCode, 0);
  writeFileSync(join(root, "MOZAK.md"), readFileSync(join(root, "MOZAK.md"), "utf8") + "\nmy own note\n");
  assert.throws(() => renameScopeFiles(resolveScope(loadInventory(config), "alpha")), /hand edits/);
  assert.ok(readdirSync(root).includes("MOZAK.json"), "nothing renamed on refusal");
});

test("scope retitle is owner-only, changes only the title, and the note shows it", () => {
  const { config, root } = scope();
  const inv = loadInventory(config);
  const snap = (executeOperation(inv, "context", { scope: "alpha" }, "agent").data as { snapshot: unknown }).snapshot;
  const plansBefore = JSON.parse(readFileSync(join(root, "mozak.json"), "utf8")).plans;
  const request = { operationId: "retitle-1", scopeId: "alpha", expected: snap, title: "alpha project", ownerRef: "owner-1", ownerMessageAt: new Date().toISOString() };
  const agent = executeOperation(inv, "retitle", { scope: "alpha", request }, "agent");
  assert.notEqual(agent.exitCode, 0, "agents cannot retitle");
  const out = executeOperation(inv, "retitle", { scope: "alpha", request }, "owner");
  assert.equal(out.exitCode, 0, JSON.stringify(out.data));
  const after = JSON.parse(readFileSync(join(root, "mozak.json"), "utf8"));
  assert.equal(after.scope.title, "alpha project");
  assert.deepEqual(after.plans, plansBefore, "plans untouched");
  assert.match(readFileSync(join(root, "mozak.md"), "utf8"), /^# alpha project$/m);
  const replay = executeOperation(loadInventory(config), "retitle", { scope: "alpha", request }, "owner");
  assert.equal(replay.exitCode, 0, "same operation id replays");
});
