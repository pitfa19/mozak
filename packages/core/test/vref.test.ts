// V-ref verifier tests (D3 goal 2): every ref resolves via a plan or mergedPlanId or is reported; mozak.md is
// byte-identical with and without the sidecar; the unchanged 0.4.0 code path reads and writes a scope with a sidecar;
// `ready` is exact on a synthetic chain; check reports every annotation rule. Synthetic temp scopes only.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, world } from "./annotations-fixture.ts";
import { readScope, renderBridge } from "../src/scope-store.ts";
import { canonical } from "../src/understanding.ts";
import { ANNOTATIONS_FILE, readAnnotations } from "../src/annotations.ts";

after(cleanup);
type Issue = { code: string; message: string };
const ref = (planId: string, target: string, relation = "needs", extra: Record<string, unknown> = {}) => ({ kind: "ref", planId, target, relation, evidence: `Synthetic evidence for ${planId}.`, ...extra });

function mulberry32(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Owner hand edit: drop plans from mozak.json without mozak (like the hand-removed rejected plans in the real vault). */
function handRemove(root: string, planIds: string[]) {
  const path = join(root, "mozak.json");
  const state = JSON.parse(readFileSync(path, "utf8"));
  state.plans = state.plans.filter((p: { id: string }) => !planIds.includes(p.id));
  writeFileSync(path, canonical(state));
}

test("V-ref property: every ref resolves through a plan or mergedPlanId, or check reports it (16 seeded worlds)", (t) => {
  const totals = { refs: 0, plan: 0, merged: 0, reported: 0, unaccounted: 0 };
  for (let seed = 1; seed <= 16; seed++) {
    const rnd = mulberry32(seed);
    const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]!;
    const w = world(["alpha", "beta"]);
    const plans: Record<string, string[]> = { alpha: [], beta: [] };
    for (const scope of ["alpha", "beta"]) {
      const n = 3 + Math.floor(rnd() * 3);
      for (let i = 0; i < n; i++) { const id = `${scope[0]}${i}`; w.propose(scope, id, { outcomes: [{ id: "one" }, { id: "two" }] }); plans[scope].push(id); }
    }
    for (const scope of ["alpha", "beta"]) {
      const items: unknown[] = [];
      const used = new Set<string>();
      for (let k = 0; k < 5; k++) {
        const from = pick(plans[scope]);
        const toScope = pick(["alpha", "beta"]);
        const to = pick(plans[toScope]);
        if (toScope === scope && to === from) continue;
        const target = `${toScope}/${to}${rnd() < 0.3 ? `#${pick(["one", "two"])}` : ""}`;
        const relation = pick(["needs", "informs", "supersedes"]);
        const fromOutcome = rnd() < 0.3 ? pick(["one", "two"]) : undefined;
        const key = JSON.stringify([from, target, relation, fromOutcome]);
        if (used.has(key)) continue;
        used.add(key);
        items.push(ref(from, target, relation, fromOutcome ? { fromOutcome } : {}));
      }
      if (items.length) assert.equal(w.annotate(scope, items).exitCode, 0, `seed ${seed}`);
    }
    // Churn after annotating: merges fold plans away, hand edits drop plans.
    for (const scope of ["alpha", "beta"]) {
      if (rnd() < 0.6 && plans[scope].length >= 3) {
        const [target, source] = [plans[scope][0]!, plans[scope][plans[scope].length - 1]!];
        assert.equal(w.merge(scope, target, source).committed, true, `seed ${seed} merge`);
        plans[scope] = plans[scope].filter((p) => p !== source);
      }
      if (rnd() < 0.5 && plans[scope].length >= 2) {
        const gone = plans[scope][1]!;
        handRemove(w.entries[scope].root, [gone]);
        plans[scope] = plans[scope].filter((p) => p !== gone);
      }
    }
    const reported = new Map<string, Issue[]>();
    for (const scope of ["alpha", "beta"]) reported.set(scope, w.op("check", { scope }).data.issues as Issue[]);
    const graph = w.op("graph", { all: true }).data.graph as { edges: { id: string; from: string; target: string; relation: string; resolution: { status: string; via?: string; scope: string; planId: string; outcomeId?: string; mergedFrom?: string } }[] };
    for (const e of graph.edges) {
      totals.refs++;
      const r = e.resolution;
      if (r.status === "resolved") {
        const state = readScope(w.entries[r.scope]).state;
        const plan = state.plans.find((p) => p.id === r.planId);
        assert.ok(plan, `seed ${seed}: ${e.target} resolved to a live plan`);
        if (r.via === "merged") {
          assert.ok(plan!.decisions.some((d) => d.mergedPlanId === r.mergedFrom), `seed ${seed}: merged resolution names a real mergedPlanId`);
          totals.merged++;
        } else {
          if (r.outcomeId) assert.ok((plan!.accepted ?? plan!.pending)!.content.outcomes.some((o) => o.id === r.outcomeId));
          totals.plan++;
        }
      } else {
        const scope = e.from.slice(0, e.from.indexOf("/"));
        const found = reported.get(scope)!.some((i) => (i.code === "ref-dangling" || i.code === "ref-target-unavailable") && i.message.includes(e.target));
        if (found) totals.reported++; else totals.unaccounted++;
      }
    }
  }
  t.diagnostic(`V-ref property: ${JSON.stringify(totals)}`);
  assert.equal(totals.unaccounted, 0);
  assert.ok(totals.refs >= 80 && totals.merged > 0 && totals.reported > 0, JSON.stringify(totals));
});

test("V-ref: mozak.md is byte-identical with and without the sidecar", () => {
  const w = world();
  w.propose("alpha", "a"); w.propose("alpha", "b"); w.propose("alpha", "c");
  const bridge = () => readFileSync(join(w.entries.alpha.root, "mozak.md"));
  const without = bridge();
  assert.equal(w.annotate("alpha", [ref("a", "alpha/b"), ref("b", "alpha/c", "supersedes"), { kind: "deadline", planId: "c", date: "2099-01-01", evidence: "Due 2099-01-01." }]).exitCode, 0);
  assert.deepEqual(bridge(), without, "annotate leaves mozak.md untouched");
  assert.equal(w.op("render", { scope: "alpha" }).data.status, "ok");
  assert.deepEqual(bridge(), without, "render with a sidecar present writes nothing new");
  w.pass("alpha", "a", "done");
  const withSidecar = bridge();
  const read = readScope(w.entries.alpha);
  assert.equal(read.projectionStatus, "current");
  unlinkSync(join(w.entries.alpha.root, ANNOTATIONS_FILE));
  assert.deepEqual(Buffer.from(renderBridge(readScope(w.entries.alpha).state, read.snapshot.graphHash, "mozak.json")), withSidecar, "the renderer output does not depend on the sidecar");
  assert.equal(readScope(w.entries.alpha).projectionStatus, "current");
});

test("V-ref: the unchanged 0.4.0 core (main) reads and writes a scope that has a sidecar", async (t) => {
  let hasMain = true;
  try { execFileSync("git", ["rev-parse", "--verify", "-q", "main^{commit}"], { stdio: "ignore", timeout: 5000 }); } catch { hasMain = false; }
  if (!hasMain) { t.skip("branch main is not available in this checkout"); return; }
  const version = JSON.parse(execFileSync("git", ["show", "main:package.json"], { encoding: "utf8", timeout: 5000 })).version;
  const dir = mkdtempSync(join(process.env.TMPDIR!, "mozak-main-core-"));
  try {
    execFileSync("sh", ["-c", `git archive main packages/core/src | tar -x -C "${dir}"`], { timeout: 20000 });
    const old = await import(join(dir, "packages/core/src/index.ts"));
    const w = world();
    w.propose("alpha", "a"); w.propose("alpha", "b");
    assert.equal(w.annotate("alpha", [ref("a", "alpha/b")]).exitCode, 0);
    const sidecar = readFileSync(join(w.entries.alpha.root, ANNOTATIONS_FILE));
    const inv = old.loadInventory(w.config);
    const ctx = old.executeOperation(inv, "context", { scope: "alpha" });
    assert.equal(ctx.exitCode, 0, `main ${version} context`);
    assert.equal(old.executeOperation(inv, "check", { scope: "alpha" }).exitCode, 0, `main ${version} check is clean`);
    const plans = old.executeOperation(inv, "plans", { scope: "alpha" });
    assert.equal(plans.exitCode, 0);
    const write = old.executeOperation(inv, "propose", { scope: "alpha", request: { operationId: "old-client-write", scopeId: "alpha", expected: ctx.data.snapshot, action: "propose", payload: { planId: "c", content: { title: "Old client synthetic plan", purpose: "p", outcomes: [{ id: "o", statement: "s", acceptance: "objective", criterion: "c" }], constraints: [], nonGoals: [], rationale: "r", questions: [], sources: [] } } } });
    assert.equal(write.exitCode, 0, JSON.stringify(write.data));
    assert.deepEqual(readFileSync(join(w.entries.alpha.root, ANNOTATIONS_FILE)), sidecar, "old client leaves the sidecar alone");
    assert.equal(readScope(w.entries.alpha).projectionStatus, "current");
    assert.equal(readAnnotations(w.entries.alpha.root, "alpha").doc!.plans.a.refs.length, 1);
    t.diagnostic(`old client: main core ${version} context, check, plans and propose ok with a sidecar present`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("V-ref: ready is exact on a synthetic chain", () => {
  const w = world();
  w.propose("alpha", "a"); w.propose("alpha", "b"); w.propose("alpha", "c", { outcomes: [{ id: "first" }, { id: "second" }] });
  w.propose("alpha", "d"); w.propose("alpha", "e", { outcomes: [{ id: "x" }, { id: "y" }] });
  w.propose("alpha", "f"); w.propose("alpha", "g");
  assert.equal(w.annotate("alpha", [
    ref("a", "alpha/b"), ref("b", "alpha/c"), ref("d", "alpha/c#second"),
    ref("e", "alpha/c", "needs", { fromOutcome: "y" }), ref("f", "alpha/g", "supersedes"), ref("g", "alpha/a", "informs"),
  ]).exitCode, 0);
  const ready = () => {
    const r = w.op("ready", { scope: "alpha" }).data.ready as { ready: { planId: string }[]; blocked: { planId: string }[]; superseded: { planId: string; by: string[] }[] };
    return { ready: r.ready.map((x) => x.planId).sort(), blocked: r.blocked.map((x) => x.planId).sort(), superseded: r.superseded.map((x) => `${x.planId}<${x.by.join(",")}`) };
  };
  assert.deepEqual(ready(), { ready: ["c", "e", "f"], blocked: ["a", "b", "d"], superseded: ["g<alpha/f"] });
  w.pass("alpha", "c", "first");
  w.pass("alpha", "e", "x");
  assert.deepEqual(ready(), { ready: ["c", "f"], blocked: ["a", "b", "d", "e"], superseded: ["g<alpha/f"] });
  w.pass("alpha", "c", "second");
  assert.deepEqual(ready(), { ready: ["c", "d", "f"], blocked: ["a", "b", "e"], superseded: ["g<alpha/f"] });
  w.complete("alpha", "c");
  assert.deepEqual(ready(), { ready: ["b", "d", "e", "f"], blocked: ["a"], superseded: ["g<alpha/f"] });
  w.complete("alpha", "b");
  assert.deepEqual(ready(), { ready: ["a", "d", "e", "f"], blocked: [], superseded: ["g<alpha/f"] });
});

test("ready orders by owner or inferred deadline, then by how many plans need a plan", () => {
  const w = world();
  w.propose("alpha", "late", { purpose: "Ship the synthetic report by 2099-09-01." });
  w.propose("alpha", "soon");
  w.propose("alpha", "free");
  w.propose("alpha", "hub");
  w.propose("alpha", "user1"); w.propose("alpha", "user2");
  assert.equal(w.annotate("alpha", [{ kind: "deadline", planId: "soon", date: "2099-02-01", evidence: "Owner said 1 Feb 2099." }, ref("user1", "alpha/hub"), ref("user2", "alpha/hub")]).exitCode, 0);
  const r = w.op("ready", { scope: "alpha" }).data.ready as { ready: { planId: string; deadline: string | null; deadlineStatus: string }[] };
  assert.deepEqual(r.ready.map((x) => [x.planId, x.deadline, x.deadlineStatus]), [["soon", "2099-02-01", "owner"], ["late", "2099-09-01", "inferred"], ["hub", null, "none"], ["free", null, "none"]]);
});

test("refs to a merged plan resolve through mergedPlanId", () => {
  const w = world();
  w.propose("alpha", "x"); w.propose("alpha", "y"); w.propose("alpha", "z");
  assert.equal(w.annotate("alpha", [ref("x", "alpha/y")]).exitCode, 0);
  w.merge("alpha", "z", "y");
  const edge = (w.op("graph", { scope: "alpha" }).data.graph as { edges: { resolution: unknown }[] }).edges[0];
  assert.deepEqual(edge.resolution, { status: "resolved", via: "merged", scope: "alpha", planId: "z", mergedFrom: "y" });
  assert.equal((w.op("check", { scope: "alpha" }).data.issues as Issue[]).some((i) => i.code === "ref-dangling"), false);
});

test("check reports dangling refs, needs cycles, needs to rejected or completed plans, superseded open plans and next actions", () => {
  const w = world(["alpha", "beta"]);
  for (const id of ["a", "b", "c", "done", "old", "new", "gone"]) w.propose("alpha", id);
  w.propose("alpha", "draft", {}, false);
  w.propose("beta", "remote-peer");
  assert.equal(w.annotate("alpha", [
    ref("a", "alpha/b"), ref("b", "alpha/a"), ref("c", "alpha/draft"), ref("c", "alpha/done"),
    ref("new", "alpha/old", "supersedes"), ref("a", "alpha/gone", "informs"), ref("a", "beta/remote-peer", "informs"),
  ]).exitCode, 0);
  w.reject("alpha", "draft");
  w.complete("alpha", "done");
  handRemove(w.entries.alpha.root, ["gone"]);
  handRemove(w.entries.beta.root, ["remote-peer"]);
  const check = w.op("check", { scope: "alpha" });
  assert.equal(check.exitCode, 3);
  const codes = (check.data.issues as Issue[]).filter((i) => !["bridge-conflict", "bridge-stale"].includes(i.code));
  const by = (code: string) => codes.filter((i) => i.code === code).map((i) => i.message);
  assert.equal(by("ref-dangling").length, 2);
  assert.ok(by("ref-dangling").some((m) => m.includes("alpha/gone")) && by("ref-dangling").some((m) => m.includes("beta/remote-peer")));
  assert.deepEqual(by("needs-cycle"), ["needs cycle: alpha/a -> alpha/b -> alpha/a"]);
  assert.equal(by("needs-closed-target").length, 2);
  assert.ok(by("needs-closed-target").some((m) => m.includes("rejected")) && by("needs-closed-target").some((m) => m.includes("completed")));
  assert.equal(by("superseded-open").length, 1);
  assert.equal(by("superseded-next-action").length, 1);
  assert.match(by("superseded-next-action")[0]!, /alpha\/old is superseded by alpha\/new/);
});

test("graph lists nodes, edges and counts across scopes", () => {
  const w = world(["alpha", "beta"]);
  w.propose("alpha", "a"); w.propose("beta", "b", { outcomes: [{ id: "k" }] });
  assert.equal(w.annotate("alpha", [ref("a", "beta/b#k", "informs")]).exitCode, 0);
  const one = w.op("graph", { scope: "alpha" });
  assert.equal(one.exitCode, 0);
  const g = one.data.graph as { nodes: { id: string }[]; edges: { from: string; to: string }[]; counts: Record<string, number> };
  assert.deepEqual(g.nodes.map((n) => n.id), ["alpha/a", "beta/b"]);
  assert.deepEqual(g.edges.map((e) => [e.from, e.to]), [["alpha/a", "beta/b"]]);
  assert.deepEqual(g.counts, { nodes: 2, edges: 1, dangling: 0, unavailable: 0 });
  assert.equal(w.op("graph", {}).exitCode, 2);
});
