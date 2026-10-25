import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { executeOperation } from "../../core/src/api.ts";
import { loadInventory } from "../../core/src/scope-index.ts";

// --commit on write routes: a local scope inside a git repo with an upstream gets its
// mozak.json and mozak.md committed and pushed. Without --commit the output says "not committed".
const roots: string[] = [];
after(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));
const cliPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const OWNER = ["--owner-ref", "synthetic:owner-msg", "--owner-message-at", "2026-10-12T10:01:00Z", "--reason", "Synthetic fixture only"];
const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid" };
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env, encoding: "utf8" }).trim();

function fixture(withUpstream: boolean) {
  const base = mkdtempSync(join(process.env.TMPDIR ?? "/tmp", "mozak-commit-")); roots.push(base);
  const origin = join(base, "origin.git");
  const repo = join(base, "repo");
  git(base, "init", "--quiet", "--bare", "-b", "main", origin);
  git(base, "init", "--quiet", "-b", "main", repo);
  const root = join(repo, "plans");
  execFileSync("mkdir", ["-p", root]);
  for (const name of ["README.md", "AGENTS.md"]) writeFileSync(join(root, name), "# Synthetic fixture\n");
  const config = join(base, "inventory.json");
  writeFileSync(config, JSON.stringify({ format: "mozak.local/v3", scopes: [{ id: "fx", root }] }));
  const inv = loadInventory(config);
  const run = (operation: string, args: object = {}, actor: "agent" | "owner" = "agent") => executeOperation(inv, operation, { scope: "fx", ...args }, actor);
  assert.equal(run("init", { request: { operationId: "init", scopeId: "fx", kind: "project", title: "Fixture", expectedAbsent: { graph: true, bridge: true }, ownerRef: "synthetic:init", ownerMessageAt: "2026-10-12T10:00:00Z" } }, "owner").exitCode, 0);
  const content = { title: "Alpha", purpose: "p", rationale: "r", constraints: [], nonGoals: [], questions: [], sources: [], outcomes: [{ id: "o1", statement: "s", acceptance: "objective", criterion: "c" }] };
  assert.equal(run("propose", { request: { operationId: "op-1", scopeId: "fx", expected: run("context").data.snapshot, action: "propose", payload: { planId: "alpha", content } } }).exitCode, 0);
  git(repo, "add", "-A");
  git(repo, "commit", "--quiet", "-m", "seed");
  if (withUpstream) { git(repo, "remote", "add", "origin", origin); git(repo, "push", "--quiet", "-u", "origin", "main"); }
  const cli = (...args: string[]) => {
    const r = spawnSync(process.execPath, [cliPath, ...args, "--config", config], { encoding: "utf8", timeout: 30000, env });
    return { code: r.status, out: r.stdout, err: r.stderr };
  };
  return { repo, origin, cli };
}

test("without --commit a local write says written, not committed, and leaves git dirty", () => {
  const w = fixture(true);
  const r = w.cli("review", "decide", "--scope", "fx", "--plan", "alpha", "--purpose", "approve-direction", ...OWNER);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /not committed to git; add --commit/);
  assert.match(git(w.repo, "status", "--porcelain"), /plans\/mozak\.json/);
});

test("--commit commits the scope files and pushes to the upstream", () => {
  const w = fixture(true);
  const decide = w.cli("review", "decide", "--scope", "fx", "--plan", "alpha", "--purpose", "approve-direction", ...OWNER, "--commit");
  assert.equal(decide.code, 0, decide.out + decide.err);
  assert.match(decide.out, /committed to git and pushed to origin\/main/);
  const obs = w.cli("observe", "--scope", "fx", "--plan", "alpha", "--outcome", "o1", "--summary", "passes", "--locator", "fixture://x", "--commit", "--json");
  assert.equal(obs.code, 0, obs.out + obs.err);
  const d = JSON.parse(obs.out);
  assert.equal(d.git.committed, true);
  assert.equal(d.git.pushed, true);
  assert.equal(git(w.repo, "status", "--porcelain"), "", "nothing left modified");
  assert.equal(git(w.repo, "rev-parse", "HEAD"), git(w.origin, "rev-parse", "main"), "origin has the commit");
  assert.match(git(w.repo, "log", "-1", "--format=%s"), /^mozak: observe fx$/);
});

test("--commit without an upstream commits locally and says not pushed", () => {
  const w = fixture(false);
  const r = w.cli("review", "decide", "--scope", "fx", "--plan", "alpha", "--purpose", "approve-direction", ...OWNER, "--commit");
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /committed to git \(no upstream, not pushed\)/);
  assert.equal(git(w.repo, "status", "--porcelain"), "");
});

test("--commit stops on a pull --rebase conflict without forcing", () => {
  const w = fixture(true);
  // Someone else changes mozak.json on the remote first.
  const other = join(w.repo, "..", "other");
  git(join(w.repo, ".."), "clone", "--quiet", w.origin, other);
  writeFileSync(join(other, "plans", "mozak.json"), "{\"conflict\":true}\n");
  git(other, "commit", "--quiet", "-am", "remote edit");
  git(other, "push", "--quiet");
  const remoteHead = git(w.origin, "rev-parse", "main");
  const r = w.cli("review", "decide", "--scope", "fx", "--plan", "alpha", "--purpose", "approve-direction", ...OWNER, "--commit");
  assert.equal(r.code, 5, r.out + r.err);
  assert.match(r.out, /conflict/);
  assert.equal(git(w.origin, "rev-parse", "main"), remoteHead, "remote untouched");
  assert.equal(git(w.repo, "status", "--porcelain"), "", "rebase aborted, local commit kept");
});
