import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Docs are public entry points. Guard the legacy warning and the read-side effects disclosure.
test("SPEC labels format 1 as legacy and points to the current contract", () => {
  const spec = readFileSync(new URL("../../../SPEC.md", import.meta.url), "utf8");
  assert.match(spec.split("## Purpose")[0], /Legacy format 1/);
  for (const path of ["docs/installation.md", "docs/implementation-package-1-plan-state-review.md", "docs/implementation-package-2-conversation-and-handoff.md", "docs/implementation-package-3-portable-workspace.md"]) {
    assert.ok(spec.split("## Purpose")[0].includes(path), `missing current contract pointer: ${path}`);
  }
});

test("README discloses that reads can fetch, cache and push repo-mode plans", () => {
  const readme = readFileSync(new URL("../../../README.md", import.meta.url), "utf8");
  const disclosure = readme.split("## Reads and the network")[1]?.split("\n## ")[0] ?? "";
  for (const term of ["git fetch", "cache", "push", "vault", "MOZAK_NO_UPDATE_CHECK=1"]) {
    assert.ok(disclosure.includes(term), `missing read-side effect disclosure: ${term}`);
  }
});
