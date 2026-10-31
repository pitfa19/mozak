import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, NOW, world } from "./annotations-fixture.ts";
import { readScope, mutateScope } from "../src/scope-store.ts";
import { itemDigest, proposeItems, readAnnotations, validateItem, ANNOTATIONS_FILE } from "../src/annotations.ts";
import { leftoverTempFiles } from "../src/durable.ts";
import { annotationsMode } from "../src/settings.ts";
import { executeOperation } from "../src/api.ts";

after(cleanup);

const ref = (planId: string, target: string, relation = "needs", extra: Record<string, unknown> = {}) => ({ kind: "ref", planId, target, relation, evidence: `${planId} ${relation} ${target} (synthetic sentence).`, ...extra });
type Issue = { code: string; message: string };

test("annotate writes only the sidecar: mozak.json and mozak.md stay byte-identical and the graph snapshot is unchanged", () => {
  const w = world();
  w.propose("alpha", "a"); w.propose("alpha", "b");
  const before = w.bytes("alpha");
  const snapshot = readScope(w.entries.alpha).snapshot;
  const out = w.annotate("alpha", [ref("a", "alpha/b"), { kind: "deadline", planId: "b", date: "2099-03-01", evidence: "Synthetic due 2099-03-01." }]);
  assert.equal(out.exitCode, 0, JSON.stringify(out.data));
  assert.equal(out.data.status, "ok");
  assert.deepEqual(w.bytes("alpha"), before);
  assert.deepEqual(readScope(w.entries.alpha).snapshot, snapshot);
  const doc = readAnnotations(w.entries.alpha.root, "alpha").doc!;
  assert.equal(doc.plans.a.refs.length, 1);
  assert.equal(doc.plans.a.refs[0].provenance.ownerRef, "synthetic:owner-message");
  assert.equal(doc.plans.b.deadline!.date, "2099-03-01");
  assert.deepEqual((out.data.annotations as { exists: boolean }).exists, true);
  // Only the sidecar appeared; no temp file is left behind.
  assert.deepEqual(readdirSync(w.entries.alpha.root).filter((n) => n.startsWith("mozak")).sort(), ["mozak.annotations.json", "mozak.json", "mozak.md"]);
});

test("an agent snapshot taken before an annotation still writes: annotations never make agents stale", () => {
  const w = world();
  w.propose("alpha", "a"); w.propose("alpha", "b");
  const snapshot = readScope(w.entries.alpha).snapshot;
  assert.equal(w.annotate("alpha", [ref("a", "alpha/b")]).exitCode, 0);
  const result = mutateScope(w.entries.alpha, { operationId: "agent-after-annotate", scopeId: "alpha", expected: snapshot, action: "propose", payload: { planId: "c", content: { title: "Unrelated synthetic c", purpose: "p", outcomes: [{ id: "o", statement: "s", acceptance: "objective", criterion: "c" }], constraints: [], nonGoals: [], rationale: "r", questions: [], sources: [] } } }, "agent");
  assert.equal(result.committed, true);
});

test("annotate CAS: a stale sidecar token is refused with nothing written; replay returns the receipt; reuse with other input conflicts", () => {
  const w = world();
  w.propose("alpha", "a"); w.propose("alpha", "b"); w.propose("alpha", "c");
  const stale = w.token("alpha");
  assert.equal(w.annotate("alpha", [ref("a", "alpha/b")]).exitCode, 0);
  const sidecar = readFileSync(join(w.entries.alpha.root, ANNOTATIONS_FILE));
  const refused = w.annotate("alpha", [ref("a", "alpha/c")], { expectedAnnotations: stale });
  assert.equal(refused.exitCode, 3);
  assert.equal(refused.data.status, "stale-input");
  assert.deepEqual(readFileSync(join(w.entries.alpha.root, ANNOTATIONS_FILE)), sidecar);
  const request = { operationId: "fixed-op", scopeId: "alpha", expectedAnnotations: w.token("alpha"), ownerRef: "synthetic:owner", ownerMessageAt: NOW, items: [ref("a", "alpha/c")] };
  const exec = (r: unknown) => executeOperation(w.inv(), "annotate", { scope: "alpha", request: r }, "owner");
  assert.equal(exec(request).exitCode, 0);
  const again = exec(request);
  assert.equal(again.exitCode, 0);
  assert.equal(again.data.status, "replayed");
  const conflict = exec({ ...request, items: [ref("b", "alpha/c")] });
  assert.equal(conflict.exitCode, 3);
  assert.equal(conflict.data.status, "operation-conflict");
});

test("annotate is owner-only and agent attempts touch nothing", () => {
  const w = world();
  w.propose("alpha", "a"); w.propose("alpha", "b");
  const out = w.annotate("alpha", [ref("a", "alpha/b")], {}, "agent");
  assert.equal(out.exitCode, 2);
  assert.equal(out.data.status, "not-permitted");
  assert.equal(w.token("alpha").exists, false);
});

test("annotate refuses dangling targets, self references, unknown outcomes, digest mismatches and batches over 7", () => {
  const w = world(["alpha", "beta"]);
  w.propose("alpha", "a", { outcomes: [{ id: "first" }] }); w.propose("alpha", "b");
  const cases: [unknown[], string][] = [
    [[ref("a", "alpha/missing")], "ref-dangling"],
    [[ref("a", "beta/missing")], "ref-dangling"],
    [[ref("a", "gamma/b")], "ref-dangling"],
    [[ref("a", "alpha/b#nope")], "ref-dangling"],
    [[ref("a", "alpha/a")], "invalid-input"],
    [[ref("a", "alpha/b", "needs", { fromOutcome: "nope" })], "stale-reference"],
    [[ref("ghost", "alpha/b")], "stale-reference"],
    [[ref("a", "alpha/b", "blocks")], "invalid-input"],
    [[{ ...ref("a", "alpha/b"), itemDigest: "0".repeat(64) }], "item-digest-mismatch"],
    [Array.from({ length: 8 }, () => ref("a", "alpha/b")), "invalid-input"],
    [[{ kind: "deadline", planId: "a", date: "2026-02-30", evidence: "x" }], "invalid-input"],
  ];
  for (const [items, code] of cases) {
    const out = w.annotate("alpha", items);
    assert.equal(out.data.status, code, JSON.stringify(items));
    assert.equal(w.token("alpha").exists, false);
  }
  const item = validateItem(ref("a", "alpha/b#done"));
  assert.equal(w.annotate("alpha", [{ ...item, itemDigest: itemDigest(item) }]).exitCode, 0);
  assert.equal(w.annotate("alpha", [ref("a", "alpha/b#done")]).data.status, "duplicate-ref");
});

test("proposals carry one digest per item, at most seven, and never write", () => {
  const items = proposeItems([ref("a", "alpha/b"), { kind: "deadline", planId: "a", date: "2099-01-01", evidence: "Due 2099-01-01." }]).items;
  assert.equal(items.length, 2);
  assert.match(items[0].itemDigest, /^[a-f0-9]{64}$/);
  assert.notEqual(items[0].itemDigest, items[1].itemDigest);
  assert.throws(() => proposeItems(Array.from({ length: 8 }, () => ref("a", "alpha/b"))), { code: "invalid-input" });
});

test("settings: per-scope switch, personal-vault default, repo-mode refusal", () => {
  const w = world(["alpha", "beta"], { settings: { format: "mozak.settings/v1", scopes: { beta: { annotations: false } } } });
  w.propose("beta", "a"); w.propose("beta", "b");
  const out = w.annotate("beta", [ref("a", "beta/b")]);
  assert.equal(out.data.status, "annotations-disabled");
  assert.equal(w.token("beta").exists, false);
  const settings = { path: null, personalVaults: [w.entries.alpha.root], scopes: {}, issues: [] };
  assert.deepEqual(annotationsMode(settings, w.entries.alpha), { enabled: true, source: "default" });
  assert.deepEqual(annotationsMode(settings, w.entries.beta), { enabled: false, source: "default" });
  const repo = { id: "r", root: w.entries.alpha.root, remote: { spec: "github:o/r", url: "", ref: "main", repoName: "r", baseDir: w.base, cacheRoot: "", fullClone: null, plansMode: "repo" as const } };
  assert.deepEqual(annotationsMode({ ...settings, scopes: { r: { annotations: true } } }, repo), { enabled: false, source: "repo-mode" });
  const vault = { ...repo, remote: { ...repo.remote, plansMode: "vault" as const } };
  assert.deepEqual(annotationsMode({ path: null, personalVaults: null, scopes: {}, issues: [] }, vault), { enabled: true, source: "default" });
});

test("settings: invalid file refuses annotate; unknown keys are check findings", () => {
  const w = world(["alpha"], { settings: { format: "mozak.settings/v1", scopes: { alpha: { annotations: "yes" } } } });
  w.propose("alpha", "a"); w.propose("alpha", "b");
  assert.equal(w.annotate("alpha", [ref("a", "alpha/b")]).data.status, "settings-invalid");
  writeFileSync(join(w.base, "mozak-settings.json"), JSON.stringify({ format: "mozak.settings/v1", typo: 1, concurrency: { rebase: false } }));
  const check = w.op("check", { scope: "alpha" });
  const codes = (check.data.issues as Issue[]).map((i) => i.code);
  assert.deepEqual(codes.filter((c) => c.startsWith("settings")), ["settings-unknown-key"]);
});

test("P0.5 extended: annotation temp files are ignored by git, reported by check and removed by the next write", () => {
  const w = world(["alpha"], { git: true });
  w.propose("alpha", "a");
  const ignore = readFileSync(join(w.entries.alpha.root, ".gitignore"), "utf8");
  assert.match(ignore, /^mozak\.annotations\.json\.\*\.tmp$/m);
  const stray = "mozak.annotations.json.0f8fad5b-d9cb-469f-a165-70867728950e.tmp";
  assert.equal(execFileSync("git", ["check-ignore", "--no-index", "--", stray], { cwd: w.entries.alpha.root, encoding: "utf8", timeout: 5000 }).trim(), stray);
  writeFileSync(join(w.entries.alpha.root, stray), "partial");
  assert.deepEqual(leftoverTempFiles(w.entries.alpha.root), [stray]);
  assert.ok((w.op("check", { scope: "alpha" }).data.issues as Issue[]).some((i) => i.code === "leftover-temp-file" && i.message.includes(stray)));
  w.propose("alpha", "b", {}, false);
  assert.deepEqual(leftoverTempFiles(w.entries.alpha.root), []);
});

test("a broken sidecar is reported by check and blocks annotate, but never hides plans", () => {
  const w = world();
  w.propose("alpha", "a"); w.propose("alpha", "b");
  writeFileSync(join(w.entries.alpha.root, ANNOTATIONS_FILE), "{ not json");
  const check = w.op("check", { scope: "alpha" });
  assert.equal(check.exitCode, 3);
  assert.ok((check.data.issues as Issue[]).some((i) => i.code === "annotations-invalid"));
  assert.equal((w.op("context", { scope: "alpha" }).data.context as { plans: unknown[] }).plans.length, 2);
  assert.equal(w.annotate("alpha", [ref("a", "alpha/b")]).data.status, "annotations-invalid");
});
