// S2 projection tolerance: a mozak.md that differs from the render only by CRLF line endings or trailing
// whitespace is not a bridge conflict. Synthetic temp scopes only.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, world } from "./annotations-fixture.ts";
import { readScope, normalizeProjection, renderProjection } from "../src/scope-store.ts";

after(cleanup);

function setup() {
  const w = world();
  w.propose("alpha", "first");
  const e = w.entries.alpha;
  const path = join(e.root, "mozak.md");
  return { w, e, path, render: readFileSync(path, "utf8") };
}

test("CRLF line endings in mozak.md are not a bridge conflict, and the next write restores LF", () => {
  const { w, e, path, render } = setup();
  assert.ok(render.includes("\n"));
  writeFileSync(path, render.replace(/\n/g, "\r\n"));
  const read = readScope(e);
  assert.equal(read.projectionStatus, "current");
  assert.equal(read.issues.some((i) => i.code.startsWith("bridge-")), false);
  w.propose("alpha", "second");
  const after = readFileSync(path, "utf8");
  assert.equal(after.includes("\r\n"), false);
  assert.equal(readScope(e).projectionStatus, "current");
});

test("trailing spaces, tabs and blank lines at the end are not a bridge conflict", () => {
  const { w, e, path, render } = setup();
  writeFileSync(path, `${render.split("\n").map((l, i) => (i % 2 ? `${l}  ` : `${l}\t`)).join("\n")}\n\n\n`);
  assert.equal(readScope(e).projectionStatus, "current");
  assert.equal(renderProjection(e).result, "current");
  w.pass("alpha", "first", "done");
  assert.equal(readScope(e).projectionStatus, "current");
});

test("missing final newline is tolerated, but any content edit is still a conflict", () => {
  const { e, path, render } = setup();
  writeFileSync(path, render.replace(/\n+$/, ""));
  assert.equal(readScope(e).projectionStatus, "current");
  writeFileSync(path, render.replace("Synthetic first work", "Synthetic  first work"));
  assert.equal(readScope(e).projectionStatus, "bridge-conflict", "inner whitespace is content");
  writeFileSync(path, `  ${render}`);
  assert.equal(readScope(e).projectionStatus, "bridge-conflict", "leading whitespace is content");
  writeFileSync(path, `${render}extra line\n`);
  assert.equal(readScope(e).projectionStatus, "bridge-conflict");
});

test("normalizeProjection only touches line endings and trailing whitespace", () => {
  assert.equal(normalizeProjection("a \r\nb\t\r\n\r\n"), "a\nb");
  assert.equal(normalizeProjection("  a  b  \n"), "  a  b");
  assert.equal(normalizeProjection("a\rb"), "a\rb", "a lone CR is content");
});
