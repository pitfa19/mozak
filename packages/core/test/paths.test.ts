import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { foldKey, foldText } from "../src/fold.ts";
import { isWithin, realOrSelf } from "../src/paths.ts";
import { noteKey } from "../src/notes.ts";

test("realOrSelf resolves a symlink and returns a missing path unchanged", () => {
  const root = realOrSelf(mkdtempSync(join(tmpdir(), "mozak-paths-")));
  mkdirSync(join(root, "real"));
  symlinkSync(join(root, "real"), join(root, "link"));
  assert.equal(realOrSelf(join(root, "link")), join(root, "real"));
  assert.equal(realOrSelf(join(root, "missing", "x")), join(root, "missing", "x"));
  assert.equal(realOrSelf("relative/missing"), "relative/missing");
});

test("isWithin accepts the folder itself and children, and refuses siblings, parents and look-alike prefixes", () => {
  assert.equal(isWithin("/a/b", "/a/b"), true);
  assert.equal(isWithin("/a/b/c/d.md", "/a/b"), true);
  assert.equal(isWithin("/a", "/a/b"), false);
  assert.equal(isWithin("/a/bc", "/a/b"), false);
  assert.equal(isWithin("/x/b", "/a/b"), false);
});

test("core folding folds every Croatian letter", () => {
  const sample = "čćšžđ ČĆŠŽĐ Đurđevac Šibenik žaba abc ÄÖ";
  assert.equal(foldText(sample), "ccszd CCSZD Durdevac Sibenik zaba abc ÄÖ");
  assert.equal(foldKey("Đurđevac"), "durdevac");
});

test("noteKey folds, lowercases, drops .md and trims", () => {
  assert.equal(noteKey(" Šuma Đaka.md"), "suma daka");
  assert.equal(noteKey("Plan.MD"), "plan");
});
