import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { initScopeState, mutateScope, readScope, renderProjection } from "../../core/src/scope-store.ts";
import { renderBridgeLegacy } from "../../core/src/bridge.ts";
import { executeOperation } from "../../core/src/api.ts";
import { loadInventory } from "../../core/src/scope-index.ts";

// Projection-only render route. Synthetic scopes in scratch roots only; never a real inventory.
const here = fileURLToPath(new URL(".", import.meta.url));
const cliPath = resolve(here, "..", "dist", "index.js");
const scratch = process.env.JCODE_SCRATCH_DIR ?? process.env.TMPDIR ?? tmpdir();
const roots: string[] = [];
after(() => {
  for (const root of roots) {
    if (!root.startsWith(scratch + "/") || !root.includes("/mozak-render-")) throw new Error(`refusing to remove ${root}`);
    rmSync(root, { recursive: true, force: true });
  }
});

const OWNER_MSG = "2026-10-12T08:00:00.000Z";
const content = { title: "Road", purpose: "Walk", outcomes: [{ id: "first-stop", statement: "First", acceptance: "objective", criterion: "c" }], constraints: [], nonGoals: [], rationale: "r", questions: [], sources: [] };
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");

function revisedWorld() {
  const w = world(["alpha"]);
  const entry = w.entries[0]!;
  const cli = (...args: string[]) => {
    const result = spawnSync(process.execPath, [cliPath, ...args, "--config", w.config, "--scope", entry.id, "--json"], { encoding: "utf8", timeout: 30000 });
    return { code: result.status, data: JSON.parse(result.stdout) };
  };
  assert.equal(cli("review", "decide", "--plan", "road", "--purpose", "approve-direction", "--owner-ref", "synthetic:approval", "--owner-message-at", OWNER_MSG, "--reason", "Fixture direction").code, 0);
  const read = readScope(entry);
  const request = join(w.base, "revise.json");
  writeFileSync(request, JSON.stringify({ operationId: "revise", scopeId: entry.id, expected: read.snapshot, action: "revise", payload: {
    planId: "road", pendingRevisionId: null, acceptedRevisionId: read.state.plans[0]!.accepted!.id,
    content: { title: "New road", purpose: "New walk", outcomes: [...content.outcomes, { ...content.outcomes[0], id: "second-stop" }], constraints: [{ id: "safe", text: "Stay safe" }], nonGoals: ["No detours"], rationale: "New reason", questions: [{ id: "when", text: "When?" }], sources: [{ id: "fixture", locator: "fixture://source", anchor: null, version: null, observedAt: OWNER_MSG, limitations: [] }] },
  } }));
  const revised = cli("plan", "revise", "--request", request);
  assert.equal(revised.code, 0, JSON.stringify(revised.data));
  const repair = () => {
    const path = join(w.base, "repair.json");
    writeFileSync(path, JSON.stringify({ requestId: "repair", scopeId: entry.id, expected: readScope(entry).snapshot }));
    return cli("projection", "repair", "--request", path);
  };
  return { ...w, entry, cli, repair, md: join(entry.root, "mozak.md"), graph: join(entry.root, "mozak.json") };
}

const sortedDelta = "changes constraints, non-goals, outcomes 1 → 2, purpose, questions, rationale, sources, title.";
const inputDelta = "changes title, purpose, outcomes 1 → 2, constraints, non-goals, rationale, questions, sources.";

test("CLI: revise with input-order fields leaves a current deterministic bridge", () => {
  const w = revisedWorld();
  assert.equal(w.cli("context").data.projectionStatus, "current");
  assert.ok(readFileSync(w.md, "utf8").includes(sortedDelta));
});

test("CLI: official repair recognizes old pending field order without changing review subject", () => {
  const w = revisedWorld();
  const graph = readFileSync(w.graph);
  const review = () => w.cli("review", "show", "--plan", "road", "--purpose", "approve-direction").data.review;
  const before = review();
  writeFileSync(w.md, readFileSync(w.md, "utf8").replace(sortedDelta, inputDelta));
  assert.equal(w.cli("context").data.projectionStatus, "bridge-stale");
  assert.equal(w.repair().code, 0);
  assert.ok(readFileSync(w.md, "utf8").includes(sortedDelta));
  assert.deepEqual(readFileSync(w.graph), graph);
  assert.deepEqual(review(), before);
  const repaired = readFileSync(w.md);
  assert.equal(w.repair().data.status, "already-current");
  assert.deepEqual(readFileSync(w.md), repaired);
});

test("CLI: pending-order compatibility never repairs hand edits", () => {
  const w = revisedWorld();
  const original = readFileSync(w.md, "utf8").replace(sortedDelta, inputDelta);
  const graph = readFileSync(w.graph);
  for (const edited of [original + "\nMy note\n", original.replace("outcomes 1 → 2", "outcomes 1 → 9"), original.replace("changes title, purpose", "changes title, title"), original.replace("The roadmap below", "My roadmap below")]) {
    writeFileSync(w.md, edited);
    assert.equal(w.repair().code, 3);
    assert.equal(readFileSync(w.md, "utf8"), edited);
    assert.deepEqual(readFileSync(w.graph), graph);
  }
});

function world(ids = ["alpha", "beta"]) {
  const base = mkdtempSync(join(scratch, "mozak-render-"));
  roots.push(base);
  for (const id of ids) {
    mkdirSync(join(base, id));
    writeFileSync(join(base, id, "README.md"), "# r\n");
    writeFileSync(join(base, id, "AGENTS.md"), "# a\n");
  }
  const config = join(base, "inventory.json");
  writeFileSync(config, JSON.stringify({ format: "mozak.local/v3", scopes: ids.map((id) => ({ id, root: id })) }));
  const entries = ids.map((id) => ({ id, root: join(base, id) }));
  for (const entry of entries) {
    initScopeState(entry, { operationId: `init-${entry.id}`, scopeId: entry.id, kind: "project", title: entry.id, expectedAbsent: { graph: true, bridge: true }, ownerRef: "synthetic-owner:init", ownerMessageAt: OWNER_MSG });
    mutateScope(entry, { operationId: `p-${entry.id}`, scopeId: entry.id, expected: readScope(entry).snapshot, action: "propose", payload: { planId: "road", content } }, "agent");
  }
  return { base, config, entries };
}
/** Simulate a scope last written by the pre-roadmap CLI. */
function makeLegacy(entry: { id: string; root: string }) {
  const read = readScope(entry);
  writeFileSync(join(entry.root, "mozak.md"), renderBridgeLegacy(read.state, read.snapshot.graphHash));
}

test("legacy-format bridge reads as stale, not conflict", () => {
  const { entries } = world(["alpha"]);
  makeLegacy(entries[0]!);
  assert.equal(readScope(entries[0]!).projectionStatus, "bridge-stale");
});

test("a self-asserted body digest never authorizes overwriting unknown text", () => {
  const { entries } = world(["alpha"]);
  const entry = entries[0]!;
  const md = join(entry.root, "mozak.md");
  const body = "\n# Older layout\n";
  const graph = readScope(entry).snapshot.graphHash;
  const older = `---\nformat: 3\nid: "alpha"\nkind: project\ngraph_sha256: ${graph}\nprojection_sha256: ${createHash("sha256").update(body).digest("hex")}\n---\n${body}`;
  writeFileSync(md, older);
  assert.equal(readScope(entry).projectionStatus, "bridge-conflict");
  assert.equal(renderProjection(entry).result, "conflict");
  assert.equal(readFileSync(md, "utf8"), older);
  assert.throws(() => mutateScope(entry, { operationId: "p3", scopeId: entry.id, expected: readScope(entry).snapshot, action: "propose", payload: { planId: "road-3", content } }, "agent"), { code: "bridge-conflict" });
});

test("render reports a failed cleanup even if the projection was already published", () => {
  const { entries } = world(["alpha"]);
  const entry = entries[0]!;
  makeLegacy(entry);
  const json = sha(join(entry.root, "mozak.json"));
  const result = renderProjection(entry, { onPhase(phase) {
    if (phase === "before-release") throw new Error("injected release failure");
  } });
  assert.equal(result.result, "failed");
  assert.equal(result.outcome.status, "projection-updated-lock-held");
  assert.equal(result.outcome.projectionUpdated, true);
  assert.equal(result.outcome.committed, false);
  assert.equal(result.outcome.projectionStatus, "current");
  assert.equal(sha(join(entry.root, "mozak.json")), json);
});

test("direct render refuses remote scopes before touching their cache", () => {
  const { config, entries } = world(["alpha"]);
  writeFileSync(config, JSON.stringify({ format: "mozak.local/v3", scopes: [{ id: "alpha", remote: "github:example/sample", ref: "main" }] }));
  const remote = loadInventory(config).scopes[0]!;
  const entry = { ...entries[0]!, remote: remote.remote };
  makeLegacy(entries[0]!);
  const before = sha(join(entry.root, "mozak.md"));
  assert.throws(() => renderProjection(entry), { code: "remote-render-refused" });
  assert.equal(sha(join(entry.root, "mozak.md")), before);
  const out = executeOperation(loadInventory(config), "render", { all: true }, "agent");
  assert.equal(out.exitCode, 0);
  assert.equal((out.data.scopes as { result: string }[])[0]!.result, "remote-skipped");
});

test("a hand-edited bridge stays a conflict and render refuses to overwrite it", () => {
  const { entries } = world(["alpha"]);
  const md = join(entries[0]!.root, "mozak.md");
  writeFileSync(md, readFileSync(md, "utf8") + "\nmy own note\n");
  const before = readFileSync(md);
  assert.equal(readScope(entries[0]!).projectionStatus, "bridge-conflict");
  assert.equal(renderProjection(entries[0]!).result, "conflict");
  assert.deepEqual(readFileSync(md), before);
});

test("render rewrites a stale bridge, skips a current one, and never changes mozak.json", () => {
  const { entries } = world(["alpha"]);
  const entry = entries[0]!;
  makeLegacy(entry);
  const json = sha(join(entry.root, "mozak.json"));
  const r1 = renderProjection(entry);
  assert.equal(r1.result, "rendered");
  assert.equal(readScope(entry).projectionStatus, "current");
  assert.ok(readFileSync(join(entry.root, "mozak.md"), "utf8").includes("```mermaid"));
  assert.equal(renderProjection(entry).result, "current");
  assert.equal(sha(join(entry.root, "mozak.json")), json);
  assert.equal(existsSync(join(entry.root, ".mozak-write-lock")), false);
});

test("a write over a legacy bridge succeeds and leaves a current new-format bridge", () => {
  const { entries } = world(["alpha"]);
  const entry = entries[0]!;
  makeLegacy(entry);
  const result = mutateScope(entry, { operationId: "p2", scopeId: entry.id, expected: readScope(entry).snapshot, action: "propose", payload: { planId: "road-2", content } }, "agent");
  assert.equal(result.status, "ok");
  assert.equal(readScope(entry).projectionStatus, "current");
});

test("facade render --all reports per scope and is partial when one scope conflicts", () => {
  const { config, entries } = world(["alpha", "beta"]);
  makeLegacy(entries[0]!);
  const md = join(entries[1]!.root, "mozak.md");
  writeFileSync(md, "hand edit\n");
  const jsons = entries.map((e) => sha(join(e.root, "mozak.json")));
  const out = executeOperation(loadInventory(config), "render", { all: true }, "agent");
  assert.equal(out.exitCode, 6);
  const rows = (out.data.scopes as { scope: string; result: string }[]).map((r) => `${r.scope}:${r.result}`);
  assert.deepEqual(rows, ["alpha:rendered", "beta:conflict"]);
  assert.equal(readFileSync(md, "utf8"), "hand edit\n");
  assert.deepEqual(entries.map((e) => sha(join(e.root, "mozak.json"))), jsons);
});

test("facade render refuses ambiguous selection", () => {
  const { config } = world(["alpha"]);
  const inv = loadInventory(config);
  assert.equal(executeOperation(inv, "render", {}, "agent").exitCode, 2);
  assert.equal(executeOperation(inv, "render", { all: true, scope: "alpha" }, "agent").exitCode, 2);
});

test("CLI: mozak render --scope and --all, exit codes and JSON envelope", { skip: !existsSync(cliPath) && "build the CLI first" }, () => {
  const { config, entries } = world(["alpha", "beta"]);
  makeLegacy(entries[0]!);
  const one = spawnSync(process.execPath, ["--no-warnings", cliPath, "render", "--config", config, "--scope", "alpha", "--json"], { encoding: "utf8" });
  assert.equal(one.status, 0, one.stderr);
  assert.equal(JSON.parse(one.stdout).scopes[0].result, "rendered");
  const all = spawnSync(process.execPath, ["--no-warnings", cliPath, "render", "--config", config, "--all"], { encoding: "utf8" });
  assert.equal(all.status, 0, all.stderr);
  assert.deepEqual(JSON.parse(all.stdout).scopes.map((r: { result: string }) => r.result), ["current", "current"]);
  const bad = spawnSync(process.execPath, ["--no-warnings", cliPath, "render", "--config", config], { encoding: "utf8" });
  assert.equal(bad.status, 2);
  const help = spawnSync(process.execPath, ["--no-warnings", cliPath, "--help"], { encoding: "utf8" });
  assert.match(help.stdout, /mozak render \(--scope ID \| --all\)/);
});
