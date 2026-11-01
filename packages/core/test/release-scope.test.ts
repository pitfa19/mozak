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
