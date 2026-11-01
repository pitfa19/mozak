// Legacy repo-scope entries (0.6.0): an inventory entry with remote, ref or plans is no longer a working scope. It is
// listed as a failed scope with code legacy-repo-scope and the exact mozak scope move command, never a whole-inventory
// error, so other scopes keep working, scope move can read it, and every other route refuses it. Nothing touches git
// or the network for it. Synthetic temp folders only.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NOW } from "./annotations-fixture.ts";
import { executeOperation } from "../src/api.ts";
import { loadInventory, resolveScope } from "../src/scope-index.ts";
import { initScopeState } from "../src/scope-store.ts";
import { moveScope } from "../src/scope-move.ts";
import { loadScopesModel } from "../../obsidian/src/load.ts";

const made: string[] = [];
after(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });

function scope(id: string, root: string): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "README.md"), `# ${id}\n`);
  writeFileSync(join(root, "AGENTS.md"), `Agents for ${id}\n`);
  initScopeState({ id, root }, { operationId: `init-${id}`, scopeId: id, kind: "project", title: `Synthetic ${id}`, expectedAbsent: { graph: true, bridge: true }, ownerRef: "synthetic:init", ownerMessageAt: NOW });
}

/**
 * A vault inventory as the owner had it with 0.5.0: a local scope, a vault-plans entry (plans in the vault), and a
 * repo-mode entry whose plans sit in the sparse cache .mozak-cache/web. The remotes point at a file:// path that does
 * not exist, so any git call would fail loudly.
 */
function legacyWorld() {
  const base = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "mozak-legacy-"));
  made.push(base);
  mkdirSync(join(base, ".obsidian"));
  scope("home", join(base, "home"));
  scope("tool", join(base, "creations", "tool"));
  scope("web", join(base, ".mozak-cache", "web"));
  const config = join(base, "mozak-inventory.json");
  writeFileSync(config, JSON.stringify({ format: "mozak.local/v3", scopes: [
    { id: "home", root: "home" },
    { id: "tool", remote: `file://${base}/missing/tool.git`, plans: "creations/tool" },
    { id: "web", remote: `file://${base}/missing/web.git`, ref: "main", focus: [] },
  ] }, null, 2));
  return { base, config };
}

test("the loader lists legacy entries as refused with legacy-repo-scope and the exact scope move command", () => {
  const { config } = legacyWorld();
  const inv = loadInventory(config);
  assert.deepEqual(inv.scopes.map((s) => s.id), ["home", "tool", "web"]);
  assert.equal(resolveScope(inv, "home").id, "home");
  assert.throws(() => resolveScope(inv, "tool"), (e: { code: string; message: string }) =>
    e.code === "legacy-repo-scope" && e.message.includes(`mozak scope move --scope tool --to creations/tool --owner-ref REF --owner-message-at ISO --reason TEXT --config ${config}`));
  assert.throws(() => resolveScope(inv, "web"), (e: { code: string; message: string }) =>
    e.code === "legacy-repo-scope" && e.message.includes(`mozak scope move --scope web --to <folder in a vault> --owner-ref REF --owner-message-at ISO --reason TEXT --config ${config}`) && /plans are in .*\.mozak-cache\/web/.test(e.message));
});

test("scopes lists them as failed, other scopes work, and no route fetches, clones or writes cache metadata", () => {
  const { base, config } = legacyWorld();
  const inv = loadInventory(config);
  const cacheBefore = readdirSync(join(base, ".mozak-cache")).sort();
  const idx = executeOperation(inv, "scopes", {});
  assert.equal(idx.exitCode, 6);
  const rows = idx.data.scopes as { id: string; status: string; code?: string; message?: string }[];
  assert.deepEqual(rows.map((r) => [r.id, r.status, r.code ?? null]), [["home", "ok", null], ["tool", "failed", "legacy-repo-scope"], ["web", "failed", "legacy-repo-scope"]]);
  assert.match(rows[1]!.message!, /mozak scope move --scope tool --to creations\/tool/);
  assert.equal(executeOperation(inv, "context", { scope: "home" }).exitCode, 0);
  for (const id of ["tool", "web"]) {
    for (const [op, args, actor] of [["context", {}, "agent"], ["plans", {}, "agent"], ["check", {}, "agent"], ["render", {}, "agent"], ["sync", {}, "agent"]] as const) {
      const out = executeOperation(inv, op, { scope: id, ...args }, actor);
      assert.equal((out.data.issues as { code: string }[])[0]?.code, "legacy-repo-scope", `${op} ${id}: ${JSON.stringify(out.data)}`);
      assert.notEqual(out.exitCode, 0);
    }
  }
  // sync without a scope and the all-scope reads touch no remote at all; there is no pull operation.
  assert.equal(executeOperation(inv, "pull", { scope: "tool" }, "owner").data.status, "unsupported-operation");
  const sync = executeOperation(inv, "sync", {});
  assert.equal("remote" in sync.data, false);
  assert.equal(executeOperation(inv, "plans", { all: true }).exitCode, 6);
  assert.deepEqual(readdirSync(join(base, ".mozak-cache")).sort(), cacheBefore, "no meta file, no clone");
  assert.ok(!existsSync(join(base, ".mozak-cache", "web.meta.json")));
});

test("the plugin model shows a legacy entry as a failed row with the move command", () => {
  const { config } = legacyWorld();
  const model = loadScopesModel(config);
  const web = model.scopes.find((s) => s.id === "web")!;
  assert.equal(web.errorCode, "legacy-repo-scope");
  assert.match(web.errorMessage!, /mozak scope move --scope web/);
  assert.equal(model.scopes.find((s) => s.id === "home")!.errorCode, null);
});

test("local reads never fetch: a legacy entry whose origin is gone costs no network and writes no cache metadata", () => {
  const { base, config } = legacyWorld();
  const inv = loadInventory(config);
  for (const op of ["context", "check"]) assert.equal(executeOperation(inv, op, { scope: "home" }).exitCode, 0, op);
  assert.equal(executeOperation(inv, "plans", { all: true }).exitCode, 6);
  assert.ok(Array.isArray(executeOperation(inv, "sync", { local: true }).data.local));
  for (const id of ["home", "tool", "web"]) assert.ok(!existsSync(join(base, ".mozak-cache", `${id}.meta.json`)), id);
});

test("legacy entry shape stays strict, v2 has no legacy keys, and local-entry digests are unchanged", () => {
  const { base } = legacyWorld();
  const inv = join(base, "i.json");
  const load = (scopes: unknown[], format = "mozak.local/v3") => { writeFileSync(inv, JSON.stringify({ format, scopes })); return loadInventory(inv); };
  assert.throws(() => load([{ id: "a", remote: "github:o/r", root: "x" }]), /exactly one of "root" or "remote"/);
  assert.throws(() => load([{ id: "a", root: "y", plans: "x" }]), /exactly one of "root" or "remote"/);
  assert.throws(() => load([{ id: "a", remote: "github:o/r", extra: 1 }]), /unknown key "extra"/);
  assert.throws(() => load([{ id: "../a", remote: "github:o/r" }]), /must use letters, digits/);
  assert.throws(() => load([{ remote: "github:o/r" }]), /scope id must be a nonempty string/);
  assert.throws(() => load([{ id: "a", remote: "github:o/r", x: 1 }]), /"x" in scope entry must be an object/);
  assert.throws(() => load([{ id: "a", remote: "github:o/r" }], "mozak.local/v2"), /unknown key "remote"/);
  // Old remote values that 0.5.0 refused are now only a refused entry: no URL parsing, no network.
  assert.equal(load([{ id: "a", remote: "ftp://x/y", ref: "--upload-pack=x" }]).scopes[0]!.refused?.code, "legacy-repo-scope");
  // A local entry's digest is the v2 shape (format, id, canonical root), so it is the same before and after 0.6.0.
  const local = load([{ id: "home", root: "home" }]);
  const expected = createHash("sha256").update(JSON.stringify({ format: "mozak.local/v3", scopes: [{ id: "home", root: join(realpathSync(base), "home") }] }), "utf8").digest("hex");
  assert.equal(local.digest, expected);
  assert.equal(load([{ id: "home", root: "home", focus: [] }]).digest, expected, "focus never changes the digest");
  writeFileSync(inv, JSON.stringify({ format: "mozak.local/v2", scopes: [] }));
  assert.equal(loadInventory(inv).format, "mozak.local/v2");
});

test("loaded inventory: entries sorted by id, x flagged per entry, the file path kept but not serialized, remote named in the message", () => {
  const { base } = legacyWorld();
  const inv = join(base, "i.json");
  writeFileSync(inv, JSON.stringify({ format: "mozak.local/v3", scopes: [{ id: "web", ref: "main" }, { id: "home", root: "home", x: {} }, { id: "tool", remote: "github:o/tool", plans: "creations/tool" }] }));
  const loaded = loadInventory(inv);
  assert.deepEqual(loaded.scopes.map((s) => s.id), ["home", "tool", "web"]);
  assert.deepEqual(loaded.scopes.map((s) => s.inventoryExtensionsIgnored === true), [true, false, false]);
  assert.equal(loaded.path, inv);
  assert.equal(JSON.stringify(loaded).includes("\"path\""), false);
  assert.match(loaded.scopes[1]!.refused!.message, /is a repo scope \(remote github:o\/tool\)/);
  assert.match(loaded.scopes[2]!.refused!.message, /^scope "web" is a repo scope, which mozak/);
  // A metadata file naming an empty or relative clone path falls back to the cache, even when that path holds plans.
  writeFileSync(join(base, ".mozak-cache", "web.meta.json"), JSON.stringify({ fullClone: "" }));
  assert.equal(loadInventory(inv).scopes[2]!.root, join(realpathSync(base), ".mozak-cache", "web"));
  const cwd = process.cwd();
  try {
    process.chdir(base);
    writeFileSync(join(base, ".mozak-cache", "web.meta.json"), JSON.stringify({ fullClone: "home" }));
    assert.equal(loadInventory(inv).scopes[2]!.root, join(realpathSync(base), ".mozak-cache", "web"));
  } finally { process.chdir(cwd); }
});

test("a repo-mode entry reads the plans from a 0.5.0 full clone while it still holds them, else from the cache", () => {
  const { base, config } = legacyWorld();
  const clone = join(base, "Downloads", "web");
  scope("web", clone);
  writeFileSync(join(base, ".mozak-cache", "web.meta.json"), JSON.stringify({ lastFetchAt: null, lastError: null, fullClone: clone }));
  assert.equal(loadInventory(config).scopes.find((s) => s.id === "web")!.root, realpathSync(clone));
  rmSync(join(clone, "mozak.json"));
  assert.equal(loadInventory(config).scopes.find((s) => s.id === "web")!.root, join(realpathSync(base), ".mozak-cache", "web"));
  writeFileSync(join(base, ".mozak-cache", "web.meta.json"), "{ broken");
  assert.equal(loadInventory(config).scopes.find((s) => s.id === "web")!.root, join(realpathSync(base), ".mozak-cache", "web"));
});

test("scope move reads both legacy kinds and the moved scopes then work", () => {
  const { config } = legacyWorld();
  const owner = { ownerRef: "synthetic:owner", ownerMessageAt: NOW, reason: "vault-only" };
  assert.equal(moveScope(config, { scope: "tool", to: "creations/tool", ...owner }).inPlace, true);
  assert.equal(moveScope(config, { scope: "web", to: "projects/web", ...owner }).files.length, 4);
  const inv = loadInventory(config);
  assert.equal(executeOperation(inv, "scopes", {}).exitCode, 0);
  for (const id of ["home", "tool", "web"]) assert.equal(executeOperation(inv, "check", { scope: id }).exitCode, 0, id);
});
