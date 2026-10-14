import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chooseInventory, discoverInventory } from "../src/discover.ts";
import { countRemote, countsSummary, planMatches, remoteVM, resolveOpenTarget, scopesModel, scopeViewModel } from "../src/model.ts";
import { loadScopesModel } from "../src/load.ts";

test("planMatches: all shows every state, open groups in-play states, completed is exact", () => {
  const states = ["open", "awaiting", "paused", "completed", "rejected"] as const;
  const pick = (f: "all" | "open" | "completed") => states.filter((s) => planMatches({ state: s }, f));
  assert.deepEqual(pick("all"), [...states]);
  assert.deepEqual(pick("open"), ["open", "awaiting", "paused"]);
  assert.deepEqual(pick("completed"), ["completed"]);
});

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

test("remoteVM marks a copy stale when never fetched, failed, or older than ten minutes", () => {
  const now = new Date("2026-10-14T12:00:00Z");
  const iso = (minAgo: number) => new Date(now.getTime() - minAgo * 60_000).toISOString();
  assert.equal(remoteVM("github:o/r", "main", { lastFetchAt: iso(2), lastError: null }, now).stale, false);
  assert.equal(remoteVM("github:o/r", "main", { lastFetchAt: iso(11), lastError: null }, now).stale, true);
  assert.equal(remoteVM("github:o/r", "main", { lastFetchAt: null, lastError: null }, now).staleReason, "never fetched");
  assert.equal(remoteVM("github:o/r", "main", { lastFetchAt: iso(1), lastError: "offline" }, now).staleReason, "offline");
});

test("remote scopes carry their badge data through the view model and are counted", () => {
  const remote = remoteVM("github:o/r", "main", { lastFetchAt: null, lastError: null });
  const a = scopeViewModel({ id: "r", root: "/c", entryFiles: [], error: { code: "scope-root-missing", message: "x" }, remote });
  const b = scopeViewModel({ id: "l", root: "/l", entryFiles: [], error: { code: "x", message: "y" } });
  assert.equal(a.remote?.spec, "github:o/r");
  assert.equal(b.remote, null);
  assert.deepEqual(countRemote([a, b]), { remote: 1, stale: 1 });
});
