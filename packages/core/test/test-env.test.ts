import { test } from "node:test";
import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";

// The --import preload decides where tests write. An agent's JCODE_SCRATCH_DIR must not silently replace the
// TMPDIR under test (release gates run three TMPDIR settings); MOZAK_TEST_SCRATCH opts in explicitly.
test("tests ignore JCODE_SCRATCH_DIR unless MOZAK_TEST_SCRATCH is set", () => {
  assert.equal(process.env.JCODE_SCRATCH_DIR, process.env.MOZAK_TEST_SCRATCH);
});

test("TMPDIR is canonical (realpath), like CI", () => {
  assert.ok(process.env.TMPDIR, "TMPDIR is set");
  assert.equal(process.env.TMPDIR, realpathSync(process.env.TMPDIR!));
  assert.equal(tmpdir(), process.env.TMPDIR);
});
