import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { guardedWrite, hashText, readSnapshot, updateFile } from "../src/write.ts";

const fresh = () => join(mkdtempSync(join(process.env.JCODE_SCRATCH_DIR ?? tmpdir(), "mozak-retired-write-")), "MOZAK.md");
test("legacy snapshot/hash helpers remain read-only", () => {
  const file = fresh();
  assert.equal(readSnapshot(file).hash, hashText(""));
  assert.deepEqual(readdirSync(join(file, "..")), []);
  writeFileSync(file, "original\n");
  assert.equal(readSnapshot(file).text, "original\n");
});
test("retired raw Markdown writer refuses without creating files or locks", () => {
  const file = fresh();
  assert.throws(() => guardedWrite(file, "injected", hashText("")), { code: "unsupported-legacy-operation" });
  assert.deepEqual(readdirSync(join(file, "..")), []);
});
test("retired transform writer never evaluates its callback or changes existing content", () => {
  const file = fresh(); writeFileSync(file, "protected\n");
  let called = false;
  assert.throws(() => updateFile(file, () => { called = true; return "injected"; }), { code: "unsupported-legacy-operation" });
  assert.equal(called, false);
  assert.equal(readFileSync(file, "utf8"), "protected\n");
  assert.deepEqual(readdirSync(join(file, "..")), ["MOZAK.md"]);
});
