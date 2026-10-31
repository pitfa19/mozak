// Owner annotations are off by default (owner decision for 0.5.0). A scope without the per-scope setting behaves like
// 0.4.7: the sidecar is never read, annotate is refused, and mozak.md does not change. Synthetic temp scopes only.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, world } from "./annotations-fixture.ts";
import { ANNOTATIONS_FILE } from "../src/annotations.ts";
import { annotationsMode, loadSettings } from "../src/settings.ts";
import { loadScopesModel } from "../../obsidian/src/load.ts";

after(cleanup);
type Issue = { code: string; message: string };
const ref = (planId: string, target: string) => ({ kind: "ref", planId, target, relation: "needs", evidence: `${planId} needs ${target} (synthetic).` });

/** Two plans in alpha, b needs a, written while annotations are on, then the setting is removed. */
function annotatedThenDefault() {
  const w = world(["alpha"], { annotations: true });
  w.propose("alpha", "a", { title: "Synthetic plan A" });
  w.propose("alpha", "b", { title: "Synthetic plan B" });
  assert.equal(w.annotate("alpha", [ref("b", "alpha/a"), { kind: "deadline", planId: "a", date: "2099-01-02", evidence: "Due 2099-01-02." }]).exitCode, 0);
  const settings = join(w.base, "mozak-settings.json");
  return { w, settings, off: () => writeFileSync(settings, JSON.stringify({ format: "mozak.settings/v1" })) };
}

test("annotationsMode: off without a per-scope setting, also with personalVaults; on only when the scope turns it on", () => {
  const w = world(["alpha", "beta"]);
  const base = loadSettings(w.inv());
  assert.deepEqual(annotationsMode(base, w.entries.alpha), { enabled: false, source: "default" });
  assert.deepEqual(annotationsMode({ ...base, personalVaults: [w.entries.alpha.root] }, w.entries.alpha), { enabled: false, source: "default" });
  assert.deepEqual(annotationsMode({ ...base, scopes: { alpha: { annotations: true } } }, w.entries.alpha), { enabled: true, source: "setting" });
  assert.deepEqual(annotationsMode({ ...base, scopes: { alpha: { annotations: true } } }, w.entries.beta), { enabled: false, source: "default" });
});

test("default scope: annotate is refused with annotations-disabled and nothing is written", () => {
  const w = world();
  w.propose("alpha", "a"); w.propose("alpha", "b");
  const out = w.annotate("alpha", [ref("b", "alpha/a")]);
  assert.equal(out.exitCode, 2);
  assert.equal(out.data.status, "annotations-disabled");
  assert.match(String((out.data.issues as Issue[])[0]?.message), /mozak-settings\.json/);
  assert.equal(w.token("alpha").exists, false);
});

test("default scope: an existing sidecar is not read by graph, ready, plans --sort deadline, check or the plugin", () => {
  const { w, off } = annotatedThenDefault();
  const on = { graph: w.op("graph", { scope: "alpha" }).data.graph as { counts: { edges: number } }, sorted: w.op("plans", { scope: "alpha", sort: "deadline" }) };
  assert.equal(on.graph.counts.edges, 1, "sanity: the sidecar is read while annotations are on");
  off();
  assert.equal((w.op("graph", { scope: "alpha" }).data.graph as { counts: { edges: number } }).counts.edges, 0);
  assert.deepEqual(w.op("graph", { scope: "alpha" }).data.annotations, { alpha: { exists: false, sha256: null } });
  const ready = w.op("ready", { scope: "alpha" }).data.ready as { ready: { planId: string }[]; blocked: unknown[] };
  assert.deepEqual(ready.ready.map((r) => r.planId).sort(), ["a", "b"]);
  assert.deepEqual(ready.blocked, []);
  const sorted = JSON.stringify(w.op("plans", { scope: "alpha", sort: "deadline" }).data);
  assert.equal(sorted.includes("2099-01-02"), false);
  writeFileSync(join(w.entries.alpha.root, ANNOTATIONS_FILE), "{ not json");
  const check = w.op("check", { scope: "alpha" });
  assert.equal((check.data.issues as Issue[]).some((i) => i.code.startsWith("annotation")), false, JSON.stringify(check.data.issues));
  const model = loadScopesModel(w.config);
  assert.deepEqual(model.scopes[0]!.plans.map((p) => p.refs ?? []), [[], []]);
});

test("an invalid settings file keeps annotations off: graph ignores the sidecar, annotate reports settings-invalid", () => {
  const { w, settings } = annotatedThenDefault();
  writeFileSync(settings, JSON.stringify({ format: "mozak.settings/v1", scopes: { alpha: { annotations: "yes" } } }));
  assert.equal((w.op("graph", { scope: "alpha" }).data.graph as { counts: { edges: number } }).counts.edges, 0);
  assert.equal(w.annotate("alpha", [ref("a", "alpha/b")]).data.status, "settings-invalid");
});

test("default scope: mozak.md is byte-identical with and without a sidecar, and render leaves it alone", () => {
  const { w, off } = annotatedThenDefault();
  off();
  const withSidecar = readFileSync(join(w.entries.alpha.root, "mozak.md"));
  assert.equal(w.op("render", { scope: "alpha" }).exitCode, 0);
  assert.deepEqual(readFileSync(join(w.entries.alpha.root, "mozak.md")), withSidecar);
  writeFileSync(join(w.entries.alpha.root, ANNOTATIONS_FILE), "{}");
  w.propose("alpha", "c", {}, false);
  const after = readFileSync(join(w.entries.alpha.root, "mozak.md"), "utf8");
  assert.equal(after.includes("2099-01-02"), false);
  assert.equal(after.includes("needs"), false);
});
