// Gap 7: one mozak-settings.json per installation, next to the inventory. concurrency.rebase lives there,
// per scope under scopes.<id>.concurrency.rebase with a top-level default. Synthetic temp scopes only.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { world, cleanup } from "./annotations-fixture.ts";
import { readScope } from "../src/scope-store.ts";
import { loadSettings, rebaseEnabled, SETTINGS_FILE } from "../src/settings.ts";
import { REBASE_GUARD_MS } from "../src/rebase.ts";

after(cleanup);
type Issue = { code: string; message: string };
const FORMAT = "mozak.settings/v1";
const pause = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

test("settings: concurrency.rebase is read next to the inventory, per scope over the top-level default", () => {
  const w = world(["alpha", "beta"]);
  assert.equal(rebaseEnabled(w.inv(), "alpha"), false, "absent file keeps rebase off");
  const put = (value: unknown) => writeFileSync(join(w.base, SETTINGS_FILE), typeof value === "string" ? value : JSON.stringify(value));
  put({ format: FORMAT, concurrency: { rebase: true } });
  assert.equal(rebaseEnabled(w.inv(), "alpha"), true);
  assert.equal(rebaseEnabled(w.inv(), "beta"), true);
  put({ format: FORMAT, concurrency: { rebase: true }, scopes: { beta: { concurrency: { rebase: false } } } });
  assert.equal(rebaseEnabled(w.inv(), "alpha"), true);
  assert.equal(rebaseEnabled(w.inv(), "beta"), false);
  put({ format: FORMAT, scopes: { beta: { concurrency: { rebase: true } } } });
  assert.equal(rebaseEnabled(w.inv(), "alpha"), false);
  assert.equal(rebaseEnabled(w.inv(), "beta"), true);
  assert.deepEqual(loadSettings(w.inv()).scopes.beta, { concurrency: { rebase: true } });
  for (const bad of ["{", JSON.stringify({ format: FORMAT, concurrency: { rebase: "yes" } }), JSON.stringify({ format: FORMAT, concurrency: true }),
    JSON.stringify({ format: FORMAT, scopes: { alpha: { concurrency: { rebase: 1 } } } }), JSON.stringify({ concurrency: { rebase: true } })]) {
    put(bad);
    assert.equal(rebaseEnabled(w.inv(), "alpha"), false, bad);
    assert.throws(() => loadSettings(w.inv()), { code: "settings-invalid" }, bad);
  }
});

test("settings: an invalid value is a check finding and an unknown concurrency key is settings-unknown-key", () => {
  const w = world(["alpha"], { settings: { format: FORMAT, concurrency: { rebase: "yes" } } });
  let codes = (w.op("check", { scope: "alpha" }).data.issues as Issue[]).map(i => i.code);
  assert.ok(codes.includes("settings-invalid"), codes.join(","));
  writeFileSync(join(w.base, SETTINGS_FILE), JSON.stringify({ format: FORMAT, concurrency: { rebase: false, typo: 1 }, scopes: { alpha: { concurrency: { other: 2 } } } }));
  codes = (w.op("check", { scope: "alpha" }).data.issues as Issue[]).map(i => i.code);
  assert.deepEqual(codes.filter(c => c.startsWith("settings")), ["settings-unknown-key", "settings-unknown-key"]);
});

function staleObserve(w: ReturnType<typeof world>) {
  w.propose("alpha", "p1", { outcomes: [{ id: "o1" }, { id: "o2" }] });
  pause(REBASE_GUARD_MS + 100); // let init and the owner approval age past the rebase guard window
  w.pass("alpha", "p1", "o1");
  const stale = readScope(w.entries.alpha).snapshot;
  w.pass("alpha", "p1", "o1");
  const p = w.plan("alpha", "p1");
  const id = "late-obs";
  const evidence = { id: `${id}-e`, locator: "synthetic.ts", anchor: null, version: null, inspectedAt: "2026-10-20T09:00:00.000Z", activity: { kind: "run", description: "synthetic" }, result: { verdict: "pass", summary: "passed" }, limitations: [] };
  const payload = { planId: "p1", observation: { id, classification: "observed", summary: id, evidence: [evidence] }, reasoningLinks: [{ id: `${id}-link`, relation: "supports", from: { planId: "p1", revisionId: null, kind: "observation", id }, to: { planId: "p1", revisionId: p.accepted!.id, kind: "outcome", id: "o2" }, rationale: "synthetic" }] };
  return w.op("observe", { scope: "alpha", request: { operationId: "stale-observe", scopeId: "alpha", expected: stale, action: "observe", payload } });
}

test("settings: the write route rebases a stale observe only when the inventory-adjacent file turns it on", () => {
  const on = world(["alpha"], { settings: { format: FORMAT, scopes: { alpha: { concurrency: { rebase: true } } } } });
  const rebased = staleObserve(on);
  assert.equal(rebased.exitCode, 0, JSON.stringify(rebased.data));
  assert.ok((rebased.data as { rebased?: unknown }).rebased);

  const off = world(["alpha"], { settings: { format: FORMAT, concurrency: { rebase: true }, scopes: { alpha: { concurrency: { rebase: false } } } } });
  const refused = staleObserve(off);
  assert.equal(refused.exitCode, 3);
  assert.equal((refused.data as { status: string }).status, "stale-input");
});

test("settings: a mozak-settings.json in the scope folder is ignored and check warns settings-scope-file-deprecated", () => {
  const w = world(["alpha"]);
  writeFileSync(join(w.entries.alpha.root, SETTINGS_FILE), JSON.stringify({ concurrency: { rebase: true } }));
  const issues = w.op("check", { scope: "alpha" }).data.issues as Issue[];
  const warning = issues.find(i => i.code === "settings-scope-file-deprecated");
  assert.ok(warning, issues.map(i => i.code).join(","));
  assert.match(warning!.message, /scopes\.alpha\.concurrency/);
  assert.equal(rebaseEnabled(w.inv(), "alpha"), false);
  assert.equal(staleObserve(w).exitCode, 3);
});
