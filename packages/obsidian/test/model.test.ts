import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chooseInventory, discoverInventory } from "../src/discover.ts";
import { countsSummary, resolveOpenTarget, scopesModel, scopeViewModel } from "../src/model.ts";
import { loadScopesModel } from "../src/load.ts";

test("countsSummary omits zero parts", () => {
  assert.equal(countsSummary({ completed: 0, open: 0, awaiting: 0 }), "no plans");
  assert.equal(countsSummary({ completed: 2, open: 1, awaiting: 3 }), "1 open, 3 awaiting, 2 completed");
});

test("resolveOpenTarget separates vault files from outside files", () => {
  assert.deepEqual(resolveOpenTarget("/v/rector_award", "/v/rector_award/a/MOZAK.md"), { kind: "vault", path: "a/MOZAK.md" });
  assert.deepEqual(resolveOpenTarget("/v/rector_award", "/v/anpit/MOZAK.md"), { kind: "external", path: "/v/anpit/MOZAK.md" });
  assert.deepEqual(resolveOpenTarget("/v/a", "/v/ab/MOZAK.md"), { kind: "external", path: "/v/ab/MOZAK.md" });
});

test("failed scope becomes an error row and counts as failed", () => {
  const vm = scopeViewModel({ id: "x", root: "/nope", entryFiles: [], error: { code: "scope-root-missing", message: "gone" } });
  assert.equal(vm.status, "failed");
  assert.equal(vm.errorCode, "scope-root-missing");
  assert.equal(vm.hasMozakMd, false);
  const m = scopesModel("/inv.json", [{ id: "x", root: "/nope", entryFiles: [], error: { code: "c", message: "m" } }]);
  assert.equal(m.totals.failed, 1);
  assert.equal(m.totals.scopes, 1);
});

test("discoverInventory walks up from the vault and chooseInventory prefers the setting", () => {
  const top = mkdtempSync(join(tmpdir(), "mozak-obs-"));
  const vault = join(top, "repo", "vault");
  mkdirSync(vault, { recursive: true });
  assert.equal(discoverInventory(vault), null);
  writeFileSync(join(top, "repo", "mozak-inventory.json"), "{}");
  assert.equal(discoverInventory(vault), join(top, "repo", "mozak-inventory.json"));
  assert.deepEqual(chooseInventory("", vault), { path: join(top, "repo", "mozak-inventory.json"), source: "auto" });
  assert.deepEqual(chooseInventory("/x/inv.json", vault), { path: "/x/inv.json", source: "setting" });
  assert.deepEqual(chooseInventory("", null), { path: null, source: "none" });
});

test("loadScopesModel reads a real core inventory, one scope failing without hiding the rest", () => {
  const top = mkdtempSync(join(tmpdir(), "mozak-obs-"));
  mkdirSync(join(top, "empty"));
  writeFileSync(
    join(top, "mozak-inventory.json"),
    JSON.stringify({ format: "mozak.local/v2", scopes: [{ id: "empty", root: "empty" }, { id: "gone", root: "gone" }] }),
  );
  const m = loadScopesModel(join(top, "mozak-inventory.json"));
  assert.equal(m.scopes.length, 2);
  assert.equal(m.totals.failed, 2);
  assert.equal(m.scopes.find((s) => s.id === "gone")?.errorCode, "scope-root-missing");
  assert.equal(m.scopes.find((s) => s.id === "empty")?.errorCode, "scope-uninitialized");
});
