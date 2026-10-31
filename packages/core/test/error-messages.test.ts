// Error messages that name the next step. Codes are unchanged; these tests pin the added guidance.
// Synthetic scopes in temp dirs only.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { executeOperation } from "../src/api.ts";
import { DomainError } from "../src/errors.ts";
import { loadInventory, resolveScope } from "../src/scope-index.ts";
import { initScopeState, mutateScope, readScope } from "../src/scope-store.ts";

const scratch = process.env.JCODE_SCRATCH_DIR ?? process.env.TMPDIR;
if (!scratch) throw new Error("tests require JCODE_SCRATCH_DIR or TMPDIR");
const roots: string[] = [];
after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

const OWNER_AT = "2026-10-12T08:00:00.000Z";
const content = (title: string) => ({
  title, purpose: `Purpose for ${title}`,
  outcomes: [{ id: "o1", statement: `Statement of ${title}`, acceptance: "objective", criterion: "Check passes" }],
  constraints: [], nonGoals: [], rationale: "Synthetic fixture", questions: [], sources: [],
});

/** One inventory with the given scope ids, each initialized in its own folder. */
function world(ids = ["alpha"]) {
  const base = mkdtempSync(join(scratch!, "mozak-errmsg-"));
  roots.push(base);
  const scopes = ids.map((id) => {
    const root = join(base, id);
    mkdirSync(root);
    writeFileSync(join(root, "README.md"), "Human instructions\n");
    writeFileSync(join(root, "AGENTS.md"), "Agent instructions\n");
    return { id, root };
  });
  const config = join(base, "inventory.json");
  writeFileSync(config, JSON.stringify({ format: "mozak.local/v3", scopes }));
  for (const s of scopes) initScopeState(s, { operationId: `init-${s.id}`, scopeId: s.id, kind: "project", title: s.id, expectedAbsent: { graph: true, bridge: true }, ownerRef: "synthetic-owner:init", ownerMessageAt: OWNER_AT });
  return { base, config, scopes, entry: scopes[0]! };
}
let n = 0;
const propose = (entry: { id: string; root: string }, planId: string, operationId = `op-${++n}`, expected = readScope(entry).snapshot) =>
  mutateScope(entry, { operationId, scopeId: entry.id, expected, action: "propose", payload: { planId, content: content(planId) } }, "agent");
const message = (fn: () => unknown, code: string): string => {
  try { fn(); } catch (e) { assert.ok(e instanceof DomainError, String(e)); assert.equal(e.code, code); return e.message; }
  assert.fail(`expected ${code}`);
};
const issue = (out: { data: unknown }) => (out.data as { issues: { code: string; message: string }[] }).issues[0]!;

test("scope-not-found says how to list scope ids", () => {
  const w = world();
  const inv = loadInventory(w.config);
  assert.match(message(() => resolveScope(inv, "nope"), "scope-not-found"), /^no scope "nope" in the inventory; run mozak scopes \(MCP mozak_scopes\) to list the scope ids$/);
  const sync = issue(executeOperation(inv, "sync", { scope: "nope" }));
  assert.equal(sync.code, "scope-not-found");
  assert.match(sync.message, /run mozak scopes/);
});

test("plan-not-found says how to list plan ids, for context and plans", () => {
  const w = world();
  const inv = loadInventory(w.config);
  const ctx = issue(executeOperation(inv, "context", { scope: "alpha", plan: "ghost" }));
  assert.equal(ctx.code, "plan-not-found");
  assert.match(ctx.message, /^no plan "ghost" in scope "alpha"; run mozak plans \(MCP mozak_plans\) to list the plan ids$/);
});

test("stale-input and operation-conflict say to reread and use a new operationId", () => {
  const w = world();
  const old = readScope(w.entry).snapshot;
  propose(w.entry, "p1", "same-op");
  assert.match(message(() => propose(w.entry, "p2", `op-${++n}`, old), "stale-input"), /take the new snapshot from context as expected and use a new operationId/);
  assert.match(message(() => propose(w.entry, "p3", "same-op"), "operation-conflict"), /use a new operationId for a changed request, or read the committed result with mozak operation --id$/);
});

test("invalid-json, scope-mismatch and scope-uninitialized name the fix", () => {
  const w = world(["alpha", "beta", "gamma"]);
  const [alpha, beta, gamma] = w.scopes;
  writeFileSync(join(alpha!.root, "mozak.json"), "{ not json");
  assert.match(message(() => readScope(alpha!), "invalid-json"), /restore it from git or fix the syntax by hand, then run mozak check$/);
  writeFileSync(join(beta!.root, "mozak.json"), readFileSync(join(gamma!.root, "mozak.json")));
  assert.equal(message(() => readScope(beta!), "scope-mismatch"), 'inventory id "beta" does not match scope.id "gamma" in mozak.json; fix the inventory entry or its root');
  rmSync(join(gamma!.root, "mozak.json"));
  assert.match(message(() => readScope(gamma!), "scope-uninitialized"), /^no mozak.json for gamma; check its root in the inventory, or ask the owner to run mozak scope init$/);
});

test("busy says another writer is active and to retry", () => {
  const w = world();
  const graph = join(w.entry.root, "mozak.json");
  const msg = message(() => readScope(w.entry, { onPhase: () => appendFileSync(graph, " ") }), "busy");
  assert.match(msg, /another writer is active, retry in a few seconds$/);
});

test("bridge-unavailable on a write points to check and projection repair", () => {
  const w = world();
  const before = readScope(w.entry).snapshot;
  writeFileSync(join(w.entry.root, "mozak.md"), "x".repeat(9 * 1024 * 1024));
  assert.match(message(() => propose(w.entry, "p1", `op-${++n}`, before), "bridge-unavailable"), /run mozak check to see why, and ask the owner to run mozak projection repair$/);
});

test("an oversized request says to split it", () => {
  const w = world();
  const huge = { ...content("big"), rationale: "x".repeat(1024 * 1024 + 1) };
  const msg = message(() => mutateScope(w.entry, { operationId: "big", scopeId: "alpha", expected: readScope(w.entry).snapshot, action: "propose", payload: { planId: "big", content: huge } }, "agent"), "capacity-exceeded");
  assert.equal(msg, "request exceeds 1 MiB; split it into smaller operations");
});

test("continuation-stale says to request the first page again", () => {
  const w = world(["alpha", "beta"]);
  for (const id of ["p1", "p2", "p3"]) propose(w.entry, id);
  const inv = loadInventory(w.config);
  const page = executeOperation(inv, "plans", { all: true, limit: 1 }).data as { groups: Record<string, { continuation: string | null }> };
  const token = Object.values(page.groups).find((g) => g.continuation)?.continuation;
  assert.ok(token, "a full first page yields a continuation");
  propose(w.entry, "p4");
  const changed = issue(executeOperation(inv, "plans", { continuation: token }));
  assert.equal(changed.code, "continuation-stale");
  assert.match(changed.message, /since this continuation was issued; request the first page again without a continuation$/);
});
