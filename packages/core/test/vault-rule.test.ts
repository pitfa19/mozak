// The vault rule (0.6.0): every scope root must sit at or below a folder with a .obsidian folder. The loader keeps an
// entry outside a vault but marks it refused (code scope-outside-vault, naming mozak scope move): it never fails the
// whole inventory, every route that reads or writes the scope refuses it, and scopes and doctor list it as failed.
// Synthetic temp folders only.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { content, NOW } from "./annotations-fixture.ts";
import { executeOperation } from "../src/api.ts";
import { loadInventory, resolveScope } from "../src/scope-index.ts";
import { initScopeState, readScope } from "../src/scope-store.ts";
import { vaultOf } from "../src/vault-config.ts";
import { moveScope } from "../src/scope-move.ts";

const made: string[] = [];
after(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });

function scope(id: string, root: string): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "README.md"), `# ${id}\n`);
  writeFileSync(join(root, "AGENTS.md"), `Agents for ${id}\n`);
  initScopeState({ id, root }, { operationId: `init-${id}`, scopeId: id, kind: "project", title: `Synthetic ${id}`, expectedAbsent: { graph: true, bridge: true }, ownerRef: "synthetic:init", ownerMessageAt: NOW });
}

/** base/vault (a vault) holds "inside"; base/code/outside is outside any vault. */
function setup() {
  const base = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "mozak-vaultrule-"));
  made.push(base);
  mkdirSync(join(base, "vault", ".obsidian"), { recursive: true });
  scope("inside", join(base, "vault", "notes", "inside"));
  scope("outside", join(base, "code", "outside"));
  const config = join(base, "inventory.json");
  writeFileSync(config, JSON.stringify({ format: "mozak.local/v3", scopes: [{ id: "inside", root: "vault/notes/inside" }, { id: "outside", root: "code/outside" }] }));
  return { base, config };
}

test("vaultOf finds the nearest folder with .obsidian at or above a path, even one that does not exist yet", () => {
  const { base } = setup();
  assert.equal(vaultOf(join(base, "vault", "notes", "inside")), join(base, "vault"));
  assert.equal(vaultOf(join(base, "vault")), join(base, "vault"));
  assert.equal(vaultOf(join(base, "vault", "not", "yet")), join(base, "vault"));
  assert.equal(vaultOf(join(base, "code", "outside")), null);
  // A file named .obsidian is not a vault.
  writeFileSync(join(base, "code", ".obsidian"), "");
  assert.equal(vaultOf(join(base, "code", "outside")), null);
});

test("the loader keeps an entry outside a vault but refuses it with scope-outside-vault naming scope move", () => {
  const { config } = setup();
  const inv = loadInventory(config);
  assert.deepEqual(inv.scopes.map((s) => s.id), ["inside", "outside"], "never a whole-inventory error");
  assert.equal(resolveScope(inv, "inside").id, "inside");
  assert.throws(() => resolveScope(inv, "outside"), (e: { code: string; message: string }) =>
    e.code === "scope-outside-vault" && /not inside an Obsidian vault/.test(e.message) && /mozak scope move --scope outside --to /.test(e.message));
});

test("every route refuses a scope outside a vault; all-scope reads report it as failed coverage", () => {
  const { config } = setup();
  const inv = loadInventory(config);
  for (const [op, args] of [["context", { scope: "outside" }], ["plans", { scope: "outside" }], ["check", { scope: "outside" }], ["review", { scope: "outside", plan: "p" }], ["render", { scope: "outside" }]] as const) {
    const out = executeOperation(inv, op, args);
    assert.notEqual(out.exitCode, 0, op);
    assert.equal((out.data.issues as { code: string }[])[0]!.code, "scope-outside-vault", op);
  }
  const ctx = executeOperation(inv, "context", { scope: "inside" });
  const req = { operationId: "op-1", scopeId: "outside", expected: ctx.data.snapshot, action: "propose", payload: { planId: "p1", content: content("p1") } };
  assert.equal((executeOperation(inv, "propose", { scope: "outside", request: req }).data.issues as { code: string }[])[0]!.code, "scope-outside-vault");
  const idx = executeOperation(inv, "scopes", {});
  assert.equal(idx.exitCode, 6);
  const rows = idx.data.scopes as { id: string; status: string; code?: string }[];
  assert.deepEqual(rows.map((r) => [r.id, r.status, r.code ?? null]), [["inside", "ok", null], ["outside", "failed", "scope-outside-vault"]]);
  const all = executeOperation(inv, "plans", { all: true });
  assert.equal(all.exitCode, 6);
  assert.equal(executeOperation(inv, "render", { all: true }).exitCode, 6);
});

test("scope move reads a refused entry and the moved scope then works", () => {
  const { config, base } = setup();
  const out = moveScope(config, { scope: "outside", to: "vault/notes/outside", ownerRef: "synthetic:owner", ownerMessageAt: NOW, reason: "into the vault" });
  assert.equal(out.status, "ok");
  const inv = loadInventory(config);
  assert.equal(resolveScope(inv, "outside").root.endsWith(join("vault", "notes", "outside")), true);
  assert.equal(executeOperation(inv, "check", { scope: "outside" }).exitCode, 0);
  assert.equal(readScope({ id: "outside", root: join(base, "code", "outside") }).state.scope.id, "outside", "old files stay");
});
