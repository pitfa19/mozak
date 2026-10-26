import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

// npm test preloads scripts/test-git-isolation.mjs. Without it a developer's global git config
// (for example a core.hooksPath pre-push guard) made 20 remote and vault tests fail on one laptop.
test("tests run git with a private global config, not the developer's", () => {
  const global = process.env.GIT_CONFIG_GLOBAL ?? "";
  assert.ok(global.includes("mozak-test-gitconfig-"), `GIT_CONFIG_GLOBAL is ${global || "unset"}`);
  assert.notEqual(global, join(homedir(), ".gitconfig"));
  assert.equal(process.env.GIT_CONFIG_NOSYSTEM, "1");
  const hooks = (() => { try { return execFileSync("git", ["config", "--global", "core.hooksPath"], { encoding: "utf8" }).trim(); } catch { return ""; } })();
  assert.equal(hooks, "");
  assert.equal(execFileSync("git", ["config", "--global", "user.email"], { encoding: "utf8" }).trim(), "mozak-test@example.invalid");
});
