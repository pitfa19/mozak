import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import * as core from "../src/index.ts";

// Owner decisions for 0.5.0: the eval harness and the tend experiment stay on the unmerged Hermes branches, and the
// format-1 modules are deleted.
const repo = new URL("../../../", import.meta.url);
const tracked = (): string[] =>
  execFileSync("git", ["-C", repo.pathname, "ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean)
    .filter((path) => existsSync(new URL(path, repo)));

test("0.5.0 ships no eval harness and no tend experiment", () => {
  for (const path of ["eval", "packages/core/src/tend.ts", "skills/mozak-tend"]) {
    assert.equal(existsSync(new URL(path, repo)), false, `${path} must not ship`);
  }
  assert.deepEqual(Object.keys(core).filter((name) => /tend/i.test(name)), []);
  const scripts = Object.keys(JSON.parse(readFileSync(new URL("package.json", repo), "utf8")).scripts);
  assert.deepEqual(scripts.filter((name) => /eval/.test(name)), []);
});

test("no tracked file names the eval harness or a ~/.hermes path", () => {
  const offenders = tracked()
    .filter((path) => !path.endsWith("CHANGELOG.md") && !/\.(png|gif|mp4|webp|jpg|ico)$/.test(path) && path !== "packages/core/test/release-scope.test.ts")
    .filter((path) => /eval\/(verify|lib|test|run)|\.hermes\//.test(readFileSync(new URL(path, repo), "utf8")));
  assert.deepEqual(offenders, []);
});

test("format 1 is gone from core: no parse, check, graph, stale, translate, init, write or plan module or export", () => {
  for (const name of ["parse", "check", "graph", "stale", "translate", "init", "write", "plan"]) {
    assert.equal(existsSync(new URL(`packages/core/src/${name}.ts`, repo)), false, `${name}.ts must be removed`);
  }
  const gone = ["parseMozak", "checkScope", "buildGraph", "loadConfig", "staleReports", "renderStale", "buildPacket", "renderTranslation", "auditProject", "mozakTemplate", "readSnapshot", "hashText", "EMPTY_HASH"];
  assert.deepEqual(gone.filter((name) => name in core), []);
});

// 0.6.0: mozak keeps plans in vaults only. Repo scopes are gone: no sparse cache, no clone, no push of plans, no
// GitHub visibility check, no scope from a clone's origin, no `pull` route and no MCP `mozak_sync`.
test("0.6.0 ships no repo-scope modules, exports or routes", () => {
  for (const name of ["remote", "remote-meta", "visibility", "working-copy"]) {
    assert.equal(existsSync(new URL(`packages/core/src/${name}.ts`, repo)), false, `${name}.ts must be removed`);
  }
  // s2-sync.test.ts stays: it tests `mozak sync --local` (fast-forward of the vault repo), which 0.6.0 keeps.
  for (const name of ["remote", "vault-plans", "visibility", "s2-offline"]) {
    assert.equal(existsSync(new URL(`packages/core/test/${name}.test.ts`, repo)), false, `${name}.test.ts must be removed`);
  }
  const gone = ["syncRemote", "pullRemote", "commitAndPush", "cacheIgnoreWarning", "remoteEntries", "repoEntries", "statusOf", "parseRemoteSpec", "readRemoteMeta", "writeRemoteMeta", "scopeVisibility", "cachedVisibility", "setVisibilityChecker", "publicRepoPlansMessage", "githubSlug", "scopeForWorkingCopy", "repoKey", "FRESH_MS", "SPARSE_FILES"];
  assert.deepEqual(gone.filter((name) => name in core), []);
  assert.equal((core.OPERATIONS as readonly string[]).includes("pull"), false, "no pull operation");
  const cli = readFileSync(new URL("packages/cli/src/index.ts", repo), "utf8");
  assert.doesNotMatch(cli, /\bpull: \{ operation: "pull"/, "no pull route");
  assert.doesNotMatch(readFileSync(new URL("packages/mcp/src/server.ts", repo), "utf8"), /mozak_sync/);
});

test("no scope route reaches git fetch, git clone or the GitHub API: only local sync fetches the vault's own repo", () => {
  const src = (dir: string) => execFileSync("git", ["-C", repo.pathname, "ls-files", "-z", `packages/${dir}/src`], { encoding: "utf8" }).split("\0").filter((p) => p.endsWith(".ts"));
  const files = ["core", "cli", "mcp", "obsidian"].flatMap(src).filter((p) => existsSync(new URL(p, repo)));
  const hits = (re: RegExp) => files.filter((p) => re.test(readFileSync(new URL(p, repo), "utf8"))).sort();
  // `git fetch`: local-sync.ts fetches the vault's own upstream (mozak sync --local); upgrade.ts fetches mozak's own
  // releases. Neither is a scope's code repo.
  assert.deepEqual(hits(/["']fetch["']/), ["packages/cli/src/upgrade.ts", "packages/core/src/local-sync.ts"]);
  assert.deepEqual(hits(/["']clone["']/), []);
  // api.github.com: only the release update check (mozak's own releases).
  assert.deepEqual(hits(/api\.github\.com/), ["packages/core/src/update.ts"]);
});
