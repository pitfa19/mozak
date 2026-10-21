// The sidebar sync button: remote scopes plus a fast-forward of every vault repo that holds a local scope.
// Local bare repos in temp dirs only, never GitHub.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initScopeState } from "@mozak/core";
import { syncAll, syncSummary } from "../src/load.ts";

const scratch = process.env.JCODE_SCRATCH_DIR ?? process.env.TMPDIR ?? tmpdir();
const made: string[] = [];
after(() => { for (const d of made) { if (!d.includes("/mozak-obs-sync-")) throw new Error(d); rmSync(d, { recursive: true, force: true }); } });
const g = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "-c", "protocol.file.allow=always", ...args], { cwd, encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }).trim();

test("syncSummary names pulled, ahead and diverged vaults and stale remotes", () => {
  assert.equal(syncSummary([], []), "Nothing to sync.");
  assert.equal(syncSummary([], [{ repo: "/v/obsidian", scopes: ["a"], status: "fast-forwarded" }, { repo: "/v/anpit", scopes: ["b"], status: "up-to-date" }]), "2 of 2 vaults synced (1 pulled).");
  assert.equal(syncSummary([], [{ repo: "/v/anpit", scopes: ["b"], status: "ahead" }]), "1 of 1 vault synced, anpit has unpushed commits.");
  assert.equal(
    syncSummary([{ scope: "r", stale: true, error: "offline" }, { scope: "s", stale: false }], [{ repo: "/v/obsidian", scopes: ["a"], status: "not-fast-forward" }]),
    "0 of 1 vault synced. not synced: obsidian: local and remote diverged, pull by hand. 1 of 2 remote scopes could not sync (using cached copy): r: offline.",
  );
});

test("syncAll fast-forwards a vault repo that holds a local scope", () => {
  const base = mkdtempSync(join(scratch, "mozak-obs-sync-"));
  made.push(base);
  const bare = join(base, "vault.git");
  const seed = join(base, "seed");
  g(base, "init", "--bare", "-b", "main", bare);
  mkdirSync(join(seed, "notes", "s1"), { recursive: true });
  g(seed, "init", "-b", "main");
  writeFileSync(join(seed, "notes", "s1", "README.md"), "# r\n");
  writeFileSync(join(seed, "notes", "s1", "AGENTS.md"), "# a\n");
  initScopeState({ id: "s1", root: join(seed, "notes", "s1") }, { operationId: "init-s1", scopeId: "s1", kind: "project", title: "s1", expectedAbsent: { graph: true, bridge: true }, ownerRef: "host:t", ownerMessageAt: "2026-10-12T08:50:00.000Z" });
  g(seed, "add", "."); g(seed, "commit", "-q", "-m", "seed"); g(seed, "remote", "add", "origin", bare); g(seed, "push", "-q", "-u", "origin", "main");
  const mine = join(base, "mine");
  g(base, "clone", "-q", bare, mine);
  const inv = join(base, "inventory.json");
  writeFileSync(inv, JSON.stringify({ format: "mozak.local/v3", scopes: [{ id: "s1", root: join(mine, "notes", "s1") }] }));
  // Another machine pushes a note.
  writeFileSync(join(seed, "new-note.md"), "from another machine\n");
  g(seed, "add", "."); g(seed, "commit", "-q", "-m", "note"); g(seed, "push", "-q");
  const first = syncAll(inv);
  assert.equal(first.ok, true, first.message);
  assert.equal(first.message, "1 of 1 vault synced (1 pulled).");
  assert.equal(g(mine, "rev-parse", "HEAD"), g(seed, "rev-parse", "HEAD"));
  assert.deepEqual(syncAll(inv), { ok: true, message: "1 of 1 vault synced." });
});
