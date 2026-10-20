import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initScopeState, readScope, repairProjection } from "../src/scope-store.ts";
import { executeOperation } from "../src/api.ts";
import { loadInventory } from "../src/scope-index.ts";

const roots: string[] = [];
after(() => roots.forEach(root => rmSync(root, { recursive: true, force: true })));
function world(nested = false) {
  const repo = mkdtempSync(join(tmpdir(), "mozak-hygiene-")); roots.push(repo);
  execFileSync("git", ["init", "-q", repo], { timeout: 5000 });
  const root = nested ? join(repo, "topic") : repo;
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "README.md"), "Synthetic scope\n");
  writeFileSync(join(root, "AGENTS.md"), "Synthetic instructions\n");
  const entry = { id: "sample", root };
  const request = { operationId: "init", scopeId: entry.id, kind: "topic", title: "Synthetic scope", expectedAbsent: { graph: true, bridge: true }, ownerRef: "synthetic-owner", ownerMessageAt: "2026-10-20T08:00:00.000Z" };
  const config = join(repo, "inventory.json");
  writeFileSync(config, JSON.stringify({ format: "mozak.local/v3", scopes: [{ id: entry.id, root }] }));
  const check = () => {
    const result = executeOperation(loadInventory(config), "check", { scope: entry.id });
    return { ...result, data: { ...result.data, issues: result.data.issues as { code: string }[] } };
  };
  return { repo, root, entry, request, check, config };
}

for (const nested of [false, true]) {
  test(`P0.5: init and current-projection repair protect write artifacts (${nested ? "nested" : "root"} scope)`, () => {
    const { root, entry, request, check } = world(nested);
    writeFileSync(join(root, ".gitignore"), "# existing user rules\nkeep-me");
    initScopeState(entry, request);
    const ignored = [".mozak-write-lock/owner.json", "mozak.json.123.tmp", "mozak.md.123.tmp", "MOZAK.json.123.tmp", "MOZAK.md.123.tmp"];
    for (const name of ignored) assert.equal(execFileSync("git", ["check-ignore", "--no-index", "--", name], { cwd: root, encoding: "utf8", timeout: 5000 }).trim(), name);
    assert.match(readFileSync(join(root, ".gitignore"), "utf8"), /^# existing user rules\nkeep-me\n/);
    const first = readFileSync(join(root, ".gitignore"), "utf8");
    repairProjection(entry, { requestId: "current-repair", scopeId: entry.id, expected: readScope(entry).snapshot });
    assert.equal(readFileSync(join(root, ".gitignore"), "utf8"), first);
    writeFileSync(join(root, ".gitignore"), "# existing user rules\n");
    assert.ok(check().data.issues.some(i => i.code === "lock-not-ignored"));
    repairProjection(entry, { requestId: "fix-ignore", scopeId: entry.id, expected: readScope(entry).snapshot });
    assert.equal(check().data.issues.some(i => i.code === "lock-not-ignored"), false);
  });
}

test("P0.5: check reports an indexed lock even when ignored; never changes git or files", () => {
  const { root, entry, request, check } = world(); initScopeState(entry, request);
  mkdirSync(join(root, ".mozak-write-lock"));
  writeFileSync(join(root, ".mozak-write-lock", "owner.json"), "synthetic synced lock\n");
  execFileSync("git", ["add", "-f", "--", ".mozak-write-lock/owner.json"], { cwd: root, timeout: 5000 });
  const index = execFileSync("git", ["ls-files", "--stage"], { cwd: root, encoding: "utf8", timeout: 5000 });
  const result = check();
  assert.equal(result.exitCode, 3);
  assert.ok(result.data.issues.some(i => i.code === "lock-in-git"));
  assert.equal(result.data.issues.some(i => i.code === "lock-not-ignored"), false);
  assert.equal(execFileSync("git", ["ls-files", "--stage"], { cwd: root, encoding: "utf8", timeout: 5000 }), index);
  assert.equal(readFileSync(join(root, ".mozak-write-lock", "owner.json"), "utf8"), "synthetic synced lock\n");
});

for (const level of ["inventory", "entry"]) {
  test(`P0.7: check warns that reserved ${level} x settings are ignored`, () => {
    const { root, entry, request, check, config } = world(); initScopeState(entry, request);
    const before = readScope(entry).snapshot;
    const raw: { format: string; scopes: { id: string; root: string; x?: object }[]; x?: object } = { format: "mozak.local/v3", scopes: [{ id: entry.id, root }] };
    if (level === "inventory") raw.x = { future: true };
    else raw.scopes[0].x = {};
    writeFileSync(config, JSON.stringify(raw));
    const result = check();
    assert.equal(result.exitCode, 3);
    assert.ok(result.data.issues.some(i => i.code === "inventory-x-ignored"));
    assert.deepEqual(readScope(entry).snapshot, before);
  });
}

test("P0.5: init refuses a symlinked gitignore without changing its target", () => {
  const { repo, root, entry, request } = world(true);
  const target = join(repo, "outside-ignore"); writeFileSync(target, "owner content\n");
  symlinkSync(target, join(root, ".gitignore"));
  assert.throws(() => initScopeState(entry, request), { code: "unsafe-path" });
  assert.equal(readFileSync(target, "utf8"), "owner content\n");
});
