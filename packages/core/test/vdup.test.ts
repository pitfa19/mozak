// V-dup on the public synthetic mirror (D3 goal 1). Runs on every commit; scripts/verify-dup.ts runs the same gates.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonical } from "../src/understanding.ts";
import { buildMirror, MUTATION_COUNT, verifyMirror } from "./vdup-fixture.ts";

test("V-dup mirror: exact copies caught, 60 mutations, templates clean, supersession labelled, precision >= 0.95", () => {
  assert.equal(MUTATION_COUNT, 60);
  const m = buildMirror();
  try {
    const r = verifyMirror(m);
    assert.deepEqual(r.failures, []);
    assert.equal(r.metrics.exactCopiesInScopeRefused, 12);
    assert.equal(r.metrics.exactCopiesCrossScopeLabelled, 12);
    assert.equal(r.metrics.templatedDuplicates, 0);
    assert.ok(r.metrics.precision >= 0.95, `precision ${r.metrics.precision}`);
    assert.ok(r.ok);
  } finally {
    m.cleanup();
  }
});

test("V-dup mirror fails loudly when the supersession pair is gone", () => {
  const m = buildMirror();
  try {
    const path = join(m.base, "relay-bridge", "mozak.json");
    const state = JSON.parse(readFileSync(path, "utf8"));
    state.plans = [];
    writeFileSync(path, canonical(state));
    const r = verifyMirror(m);
    assert.equal(r.ok, false);
    assert.deepEqual(r.failures, ["sync-bridge-v2 over calendar-relay-v1 is missing, expected supersedes-candidate"]);
  } finally {
    m.cleanup();
  }
});
