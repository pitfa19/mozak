import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Docs are public entry points. Guard the historical SPEC warning and the read-side effects disclosure.
test("SPEC is labelled historical format 1 and points to the current contract", () => {
  const spec = readFileSync(new URL("../../../SPEC.md", import.meta.url), "utf8");
  const banner = spec.split("## Purpose")[0];
  assert.match(banner, /\*\*Historical\.\*\*/);
  assert.match(banner, /format 1/);
  for (const path of ["README.md", "docs/installation.md"]) {
    assert.ok(banner.includes(`](${path})`), `missing current contract pointer: ${path}`);
  }
});

test("README discloses that reads never fetch, and names the only scope network use (sync) and the update check", () => {
  const readme = readFileSync(new URL("../../../README.md", import.meta.url), "utf8");
  const disclosure = readme.split("## Reads and the network")[1]?.split("\n## ")[0] ?? "";
  for (const term of ["No read route fetches", "mozak sync", "git fetch", "vault", "--commit", "push", "MOZAK_NO_UPDATE_CHECK=1"]) {
    assert.ok(disclosure.includes(term), `missing network disclosure: ${term}`);
  }
  // 0.6.0 removed repo scopes: no read may be described as fetching or caching repo-mode plans.
  assert.doesNotMatch(disclosure, /cache metadata|repo-mode|10 minutes/);
});
