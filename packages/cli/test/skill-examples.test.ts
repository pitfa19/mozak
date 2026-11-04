import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { executeOperation } from "../../core/src/api.ts";
import { loadInventory } from "../../core/src/scope-index.ts";
import { vaultTemp } from "../../core/test/vault-temp.ts";

// The skill examples are what agents copy. Each one must pass the real route it documents.
// Synthetic scope in an isolated temp folder; owner provenance is a synthetic fixture value.
const repo = fileURLToPath(new URL("../../../", import.meta.url));
const examplesDir = join(repo, "skills/mozak/examples");
const roots: string[] = [];
after(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));
const example = (name: string) => JSON.parse(readFileSync(join(examplesDir, name), "utf8")).payload;

function scope() {
  const root = vaultTemp(join(process.env.TMPDIR ?? "/tmp", "mozak-examples-")); roots.push(root);
  for (const name of ["README.md", "AGENTS.md"]) writeFileSync(join(root, name), "# Synthetic fixture\n");
  const config = join(root, "inventory.json");
  writeFileSync(config, JSON.stringify({ format: "mozak.local/v3", scopes: [{ id: "fx", root }] }));
  const inv = loadInventory(config);
  const run = (operation: string, args: object = {}, actor: "agent" | "owner" = "agent") => executeOperation(inv, operation, { scope: "fx", ...args }, actor);
  assert.equal(run("init", { request: { operationId: "init", scopeId: "fx", kind: "project", title: "Fixture", expectedAbsent: { graph: true, bridge: true }, ownerRef: "synthetic:init", ownerMessageAt: "2026-10-12T10:00:00Z" } }, "owner").exitCode, 0);
  let n = 0;
  const write = (operation: string, action: string, payload: object, actor: "agent" | "owner" = "agent") =>
    run(operation, { request: { operationId: `op-${++n}`, scopeId: "fx", expected: run("context").data.snapshot, action, payload } }, actor);
  const plan = () => (run("context", { plan: "example-plan" }).data.context as any).plans[0];
  const ok = (out: { exitCode: number; data: unknown }) => { assert.equal(out.exitCode, 0, JSON.stringify(out.data)); return out; };
  return { root, run, write, plan, ok };
}

function approved() {
  const s = scope();
  s.ok(s.write("propose", "propose", example("propose.json")));
  const review = s.run("review", { plan: "example-plan" }).data as any;
  s.ok(s.write("decide", "approve-direction", { planId: "example-plan", revisionId: review.review.revisionId, reviewDigest: review.review.reviewDigest,
    ownerRef: "synthetic:owner", ownerMessageAt: "2026-10-12T10:01:00Z", reason: "Synthetic fixture" }, "owner"));
  return s;
}

test("examples/revise.json passes the real revise route", () => {
  const s = approved();
  const payload = { ...example("revise.json"), acceptedRevisionId: s.plan().accepted.id };
  s.ok(s.write("revise", "revise", payload));
  assert.equal(s.plan().pending.content.title, payload.content.title);
});

test("examples/save-discussion.json and attach-spec.json pass their real routes", () => {
  const s = approved();
  s.ok(s.write("save-discussion", "save-discussion", { ...example("save-discussion.json"), acceptedRevisionId: s.plan().accepted.id }));
  const ids = s.plan().discussion.questions.map((q: any) => q.id);
  const later = { summary: "Decide after the deadline check.", basis: "owner", ownerRef: "synthetic:defer", ownerMessageAt: "2026-10-12T10:02:00.000Z", evidence: [] };
  const saved = example("save-discussion.json").questions.map((q: any, i: number) => q.status === "open" ? { ...q, id: ids[i], status: "deferred", answers: [later] } : { ...q, id: ids[i] });
  s.ok(s.write("save-discussion", "save-discussion", { ...example("save-discussion.json"), acceptedRevisionId: s.plan().accepted.id, stage: "ready-for-spec", questions: saved }));
  writeFileSync(join(s.root, "SPEC.md"), "# Synthetic spec\n");
  const { discussionDigest: _, ...withoutDigest } = example("attach-spec.json");
  s.ok(s.write("attach-spec", "attach-spec", { ...withoutDigest, acceptedRevisionId: s.plan().accepted.id }));
  assert.match(s.plan().specifications[0].discussionDigest, /^[0-9a-f]{64}$/, "omitted discussionDigest is computed from the current discussion");
});

test("attach-spec without discussionDigest and without a discussion records null", () => {
  const s = approved();
  writeFileSync(join(s.root, "SPEC.md"), "# Synthetic spec\n");
  const { discussionDigest: _, ...withoutDigest } = example("attach-spec.json");
  s.ok(s.write("attach-spec", "attach-spec", { ...withoutDigest, acceptedRevisionId: s.plan().accepted.id }));
  assert.equal(s.plan().specifications[0].discussionDigest, null);
});

test("allowedPaths refuse a trailing slash, an absolute path and a remote URL", () => {
  const s = approved();
  writeFileSync(join(s.root, "SPEC.md"), "# Synthetic spec\n");
  const base = example("attach-spec.json");
  for (const bad of ["applications/erasmus/", "/abs/path", "https://example.org/x"]) {
    const out = s.write("attach-spec", "attach-spec", { ...base, acceptedRevisionId: s.plan().accepted.id, bounds: { ...base.bounds, allowedPaths: [bad] } });
    assert.notEqual(out.exitCode, 0, bad);
  }
});

test("every example named in references/payloads.md exists and the installer ships every example", () => {
  const doc = readFileSync(join(repo, "skills/mozak/references/payloads.md"), "utf8");
  const named = [...new Set([...doc.matchAll(/examples\/([a-z-]+\.(?:json|md))/g)].map((m) => m[1]))];
  const files = readdirSync(examplesDir);
  for (const name of named) assert.ok(files.includes(name), `payloads.md names missing examples/${name}`);
  assert.ok(named.includes("revise.json"), "payloads.md points revise at examples/revise.json");
  const installer = readFileSync(join(repo, "scripts/install.mjs"), "utf8");
  assert.match(installer, /readdirSync\(join\(SOURCE, 'skills\/mozak\/examples'\)\)/, "installer globs the examples folder");
});
