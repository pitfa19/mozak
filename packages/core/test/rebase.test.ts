// S1b read-set rebase (V-race cases 2 to 7 in process). Synthetic scopes in temp dirs only.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { initScopeState, readScope, mutateScope, type StoreOptions } from "../src/scope-store.ts";
import { applyMutation, outcomeStatus, reviewShow } from "../src/review.ts";
import { REBASE_GUARD_MS } from "../src/rebase.ts";
import { canonical, type ScopeState } from "../src/understanding.ts";

const scratch = process.env.JCODE_SCRATCH_DIR ?? process.env.TMPDIR;
if (!scratch) throw new Error("tests require JCODE_SCRATCH_DIR or TMPDIR");
const roots: string[] = [];
after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

// `rebase` stands for the resolved concurrency.rebase setting (see settings-rebase.test.ts for the file).
type Entry = { id: string; root: string; rebase: boolean };
const OWNER_AT = "2026-10-12T08:00:00.000Z";
const INSPECTED = "2026-10-12T08:30:00.000Z";
// Tests that are not about the guard window turn it off through the internal seam.
const NO_GUARD: StoreOptions = { rebaseGuardMs: 0 };

const content = (title = "Understand plans", outcomes = ["o1", "o2", "o3"]) => ({
  title, purpose: `Purpose for ${title}`,
  outcomes: outcomes.map(id => ({ id, statement: `Statement ${id} of ${title}`, acceptance: "objective", criterion: `Check ${id} passes` })),
  constraints: [], nonGoals: [], rationale: "Synthetic fixture", questions: [], sources: [],
});

function world(rebase: boolean | null = true): Entry {
  const root = mkdtempSync(join(scratch!, "mozak-rebase-"));
  roots.push(root);
  writeFileSync(join(root, "README.md"), "Human instructions\n");
  writeFileSync(join(root, "AGENTS.md"), "Agent instructions\n");
  const entry = { id: "sample", root, rebase: rebase === true };
  initScopeState(entry, { operationId: "init-1", scopeId: "sample", kind: "project", title: "Sample", expectedAbsent: { graph: true, bridge: true }, ownerRef: "synthetic-owner:init", ownerMessageAt: OWNER_AT });
  return entry;
}

let counter = 0;
const op = () => `op-${++counter}`;
function write(entry: Entry, action: string, payload: unknown, expected = readScope(entry).snapshot, actor: "agent" | "owner" = "agent", options: StoreOptions = NO_GUARD) {
  return mutateScope(entry, { operationId: op(), scopeId: entry.id, expected, action, payload }, actor, { rebase: entry.rebase, ...options });
}
function approve(entry: Entry, planId: string, options: StoreOptions = NO_GUARD) {
  const shown = reviewShow(readScope(entry).state, planId, "approve-direction");
  return write(entry, "approve-direction", { planId, revisionId: shown.revisionId, reviewDigest: shown.reviewDigest, ownerRef: `synthetic-owner:${op()}`, ownerMessageAt: OWNER_AT, reason: "fixture approval" }, undefined, "owner", options);
}
/** Scope with plan p1 proposed and accepted, three objective outcomes. */
function accepted(rebase: boolean | null = true): Entry {
  const entry = world(rebase);
  write(entry, "propose", { planId: "p1", content: content() });
  approve(entry, "p1");
  return entry;
}
const acceptedId = (entry: Entry, planId = "p1") => readScope(entry).state.plans.find(p => p.id === planId)!.accepted!.id;
function observation(id: string, opts: { pass?: boolean; supersedes?: string } = {}) {
  return {
    id, classification: opts.pass === false ? "unverified" : "observed", summary: `claim ${id}`,
    evidence: opts.pass === false ? [] : [{ id: `${id}-e`, locator: "test:fixture", anchor: null, version: null, inspectedAt: INSPECTED, activity: { kind: "run", description: "synthetic run" }, result: { verdict: "pass", summary: "passed" }, limitations: [] }],
    ...(opts.supersedes ? { supersedesObservationId: opts.supersedes } : {}),
  };
}
function observe(entry: Entry, id: string, outcomeId: string | null, opts: { relation?: string; pass?: boolean; supersedes?: string; planId?: string } = {}) {
  const planId = opts.planId ?? "p1";
  return {
    planId, observation: observation(id, opts),
    reasoningLinks: outcomeId === null ? [] : [{ id: `${id}-l`, relation: opts.relation ?? "supports", from: { planId, revisionId: null, kind: "observation", id }, to: { planId, revisionId: acceptedId(entry, planId), kind: "outcome", id: outcomeId }, rationale: "fixture link" }],
  };
}
function discussion(entry: Entry, planId: string, summary: string) {
  const plan = readScope(entry).state.plans.find(p => p.id === planId)!;
  return { planId, acceptedRevisionId: plan.accepted?.id ?? null, pendingRevisionId: plan.pending?.id ?? null, summary, stage: "clarifying", questions: [] };
}
const files = (entry: Entry) => ["mozak.json", "mozak.md"].map(n => readFileSync(join(entry.root, n), "utf8"));

test("flag off: a stale observe is refused exactly as before and nothing is written", () => {
  for (const rebase of [null, false]) {
    const entry = accepted(rebase);
    const stale = readScope(entry).snapshot;
    write(entry, "observe", observe(entry, "a", "o1"));
    const before = files(entry);
    assert.throws(() => write(entry, "observe", observe(entry, "b", "o2"), stale), { code: "stale-input", message: "snapshot changed; reread before submitting a new operation: take the new snapshot from context as expected and use a new operationId" });
    assert.deepEqual(files(entry), before);
  }
});

test("flag on: a stale observe on another outcome rebases and reports from, onto and the fresh snapshot", () => {
  const entry = accepted();
  const stale = readScope(entry).snapshot;
  const first = write(entry, "observe", observe(entry, "a", "o1"));
  assert.equal(first.rebased, undefined);
  const second = write(entry, "observe", observe(entry, "b", "o2"), stale);
  assert.equal(second.status, "ok");
  assert.deepEqual(second.rebased, { from: stale.revision, onto: first.snapshot!.revision });
  assert.deepEqual(second.snapshot, readScope(entry).snapshot);
  const plan = readScope(entry).state.plans[0];
  assert.deepEqual(plan.observations.map(o => o.id), ["a", "b"]);
});

test("V-race 2: two supersedes of one observation from one snapshot give 1 commit", () => {
  const entry = accepted();
  write(entry, "observe", observe(entry, "old", null, { pass: false }));
  const snap = readScope(entry).snapshot;
  write(entry, "observe", observe(entry, "unrelated", "o3"));
  const results = ["x", "y"].map(id => { try { return write(entry, "observe", observe(entry, id, null, { supersedes: "old" }), snap).status; } catch (e) { return (e as { code: string }).code; } });
  assert.deepEqual(results, ["ok", "stale-input"]);
  const obs = readScope(entry).state.plans[0].observations;
  assert.equal(obs.filter(o => o.supersedesObservationId === "old").length, 1);
});

test("V-race 3: two discussion saves on one plan give 1 commit, while a save on another plan rebases", () => {
  const entry = accepted();
  write(entry, "propose", { planId: "p2", content: content("Other subject", ["q1"]) });
  const snap = readScope(entry).snapshot;
  const a = discussion(entry, "p1", "first summary"), b = discussion(entry, "p1", "second summary"), c = discussion(entry, "p2", "other plan");
  assert.equal(write(entry, "save-discussion", a, snap).status, "ok");
  assert.throws(() => write(entry, "save-discussion", b, snap), { code: "stale-input" });
  const other = write(entry, "save-discussion", c, snap);
  assert.ok(other.rebased);
  const state = readScope(entry).state;
  assert.equal(state.plans[0].discussion!.summary, "first summary");
  assert.equal(state.plans[1].discussion!.summary, "other plan");
});

test("V-race 4: a revise plus approval racing an observe refuses the observe", () => {
  const entry = accepted();
  const snap = readScope(entry).snapshot;
  const payload = observe(entry, "late", "o1");
  write(entry, "revise", { planId: "p1", pendingRevisionId: null, acceptedRevisionId: acceptedId(entry), content: { ...content(), rationale: "Changed rationale" } });
  approve(entry, "p1");
  const before = files(entry);
  assert.throws(() => write(entry, "observe", payload, snap), { code: "stale-input", message: /revise|approve-direction/ });
  assert.deepEqual(files(entry), before);
  // A revise alone (no approval) also refuses: it does not commute even when the link would still resolve.
  const entry2 = accepted();
  const snap2 = readScope(entry2).snapshot;
  const payload2 = observe(entry2, "late", "o1");
  write(entry2, "revise", { planId: "p1", pendingRevisionId: null, acceptedRevisionId: acceptedId(entry2), content: { ...content(), rationale: "Changed rationale" } });
  assert.throws(() => write(entry2, "observe", payload2, snap2), { code: "stale-input" });
});

test("V-race 5: an owner accept-outcome racing a challenge refuses the decision", () => {
  const entry = world();
  write(entry, "propose", { planId: "p1", content: { ...content(), outcomes: [{ id: "o1", statement: "Owner judged", acceptance: "owner", criterion: "Owner agrees" }] } });
  approve(entry, "p1");
  write(entry, "observe", observe(entry, "pass", "o1"));
  const snap = readScope(entry).snapshot;
  const shown = reviewShow(readScope(entry).state, "p1", "accept-outcome", "o1");
  const decision = { planId: "p1", revisionId: shown.revisionId, reviewDigest: shown.reviewDigest, outcomeId: "o1", ownerRef: "synthetic-owner:accept", ownerMessageAt: OWNER_AT, reason: "looks done" };
  write(entry, "observe", observe(entry, "challenge", "o1", { relation: "challenges" }));
  assert.throws(() => write(entry, "accept-outcome", decision, snap, "owner"), { code: "stale-input", message: /accept-outcome is never rebased/ });
  // With a fresh snapshot the old review digest is still refused, so the decision never binds an unseen challenge.
  assert.throws(() => write(entry, "accept-outcome", decision, undefined, "owner"), { code: "stale-reference" });
  const state = readScope(entry).state;
  assert.equal(state.plans[0].decisions.filter(d => d.purpose === "accept-outcome").length, 0);
  assert.equal(outcomeStatus(state, state.plans[0], "o1"), "evidence");
});

test("V-race 6: a rebased write then a second write with the returned snapshot gives no stale", () => {
  const entry = accepted();
  const snap = readScope(entry).snapshot;
  write(entry, "observe", observe(entry, "other", "o2"));
  const rebased = write(entry, "observe", observe(entry, "mine-1", "o1"), snap);
  assert.ok(rebased.rebased);
  const next = write(entry, "observe", observe(entry, "mine-2", "o1"), rebased.snapshot!);
  assert.equal(next.status, "ok");
  assert.equal(next.rebased, undefined);
});

test("observe read set: a changed outcome status, reused ids, an added link source or an unknown revision refuse", () => {
  const entry = accepted();
  const snap = readScope(entry).snapshot;
  write(entry, "observe", observe(entry, "first", "o1")); // o1 goes from todo to done
  assert.throws(() => write(entry, "observe", observe(entry, "second", "o1"), snap), { code: "stale-input", message: /changed status/ });
  assert.throws(() => write(entry, "observe", observe(entry, "first", "o2"), snap), { code: "stale-input", message: /was used/ });
  const fromAdded = observe(entry, "third", "o2");
  fromAdded.reasoningLinks[0]!.from.id = "first";
  assert.throws(() => write(entry, "observe", fromAdded, snap), { code: "stale-input", message: /was added/ });
  assert.throws(() => write(entry, "observe", observe(entry, "fourth", "o2"), { ...snap, revision: "not-a-known-revision" }), { code: "stale-input", message: /neither current nor a retained receipt/ });
  // A done outcome that stays done is not a status change.
  const snap2 = readScope(entry).snapshot;
  write(entry, "observe", observe(entry, "fifth", "o1"));
  assert.ok(write(entry, "observe", observe(entry, "sixth", "o1"), snap2).rebased);
});

test("propose rebases for a free id, refuses a taken id and keeps the duplicate check on fresh state", () => {
  const entry = world();
  const snap = readScope(entry).snapshot;
  write(entry, "propose", { planId: "a", content: content("Export quarterly revenue report") });
  assert.ok(write(entry, "propose", { planId: "b", content: content("Quite different topic entirely") }, snap).rebased);
  assert.throws(() => write(entry, "propose", { planId: "a", content: content("Zebra crossing paint") }, snap), { code: "stale-input", message: /was taken/ });
  assert.throws(() => write(entry, "propose", { planId: "c", content: content("Export quarterly revenue report") }, snap), { code: "duplicate-plan-candidate" });
});

test("never rebased: complete, revise and attach-spec keep the exact snapshot check", () => {
  const entry = accepted();
  const snap = readScope(entry).snapshot;
  write(entry, "observe", observe(entry, "n", null, { pass: false }));
  assert.throws(() => write(entry, "complete", { planId: "p1", revisionId: acceptedId(entry) }, snap), { code: "stale-input", message: /complete is never rebased/ });
  assert.throws(() => write(entry, "revise", { planId: "p1", pendingRevisionId: null, acceptedRevisionId: acceptedId(entry), content: content("Changed") }, snap), { code: "stale-input", message: /revise is never rebased/ });
  assert.throws(() => write(entry, "attach-spec", { planId: "p1", acceptedRevisionId: acceptedId(entry), path: "spec.md", bounds: { summary: "fixture", allowedPaths: [], excludedActions: [], outcomeChecks: ["o1", "o2", "o3"].map(outcomeId => ({ outcomeId, criterion: "passes" })), limitations: [] }, discussionDigest: null }, snap), { code: "stale-input", message: /attach-spec is never rebased/ });
});

test("guard window: a decision recorded just before the snapshot's receipt refuses the rebase", () => {
  const entry = accepted();
  // The approval is the latest non-rebasable receipt. A snapshot taken after one more write still sits inside the window.
  write(entry, "observe", observe(entry, "a", null, { pass: false }));
  const snap = readScope(entry).snapshot;
  write(entry, "observe", observe(entry, "b", null, { pass: false }));
  assert.throws(() => write(entry, "observe", observe(entry, "c", "o2"), snap, "agent", {}), { code: "stale-input", message: /does not commute/ });
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, REBASE_GUARD_MS + 50);
  write(entry, "observe", observe(entry, "d", null, { pass: false }));
  const later = readScope(entry).snapshot;
  write(entry, "observe", observe(entry, "d2", null, { pass: false }));
  assert.ok(write(entry, "observe", observe(entry, "e", "o2"), later, "agent", {}).rebased);
});

// ---------- V-race 7: serial equivalence with a seeded generator (fast-check is not a dependency) ----------

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Independent oracle: is the request's read set the same in the true snapshot state and the fresh state? */
function oracleSafe(s0: ScopeState, s1: ScopeState, between: string[], action: string, p: any): boolean {
  if (!["observe", "save-discussion", "propose"].includes(action)) return false;
  if (between.some(a => !["observe", "save-discussion", "propose"].includes(a))) return false;
  const plan0 = s0.plans.find(x => x.id === p.planId), plan1 = s1.plans.find(x => x.id === p.planId);
  if (action === "propose") return !(plan1 && !plan0);
  if (!plan0 || !plan1) return false;
  if (action === "save-discussion") return canonical(plan0.discussion) === canonical(plan1.discussion);
  const ids0 = new Set(plan0.observations.map(o => o.id)), ids1 = new Set(plan1.observations.map(o => o.id));
  if (ids1.has(p.observation.id) && !ids0.has(p.observation.id)) return false;
  const supersedersOf = (s: ScopeState, planId: string, id: string) => canonical(s.plans.find(x => x.id === planId)?.observations.filter(o => o.supersedesObservationId === id).map(o => o.id) ?? []);
  if (p.observation.supersedesObservationId && supersedersOf(s0, p.planId, p.observation.supersedesObservationId) !== supersedersOf(s1, p.planId, p.observation.supersedesObservationId)) return false;
  for (const l of p.reasoningLinks) {
    const fromOld = s0.plans.find(x => x.id === l.from.planId)?.observations.some(o => o.id === l.from.id);
    const isSelf = l.from.planId === p.planId && l.from.id === p.observation.id;
    if (!isSelf && !fromOld) return false;
    if (!isSelf && supersedersOf(s0, l.from.planId, l.from.id) !== supersedersOf(s1, l.from.planId, l.from.id)) return false;
    const t0 = s0.plans.find(x => x.id === l.to.planId), t1 = s1.plans.find(x => x.id === l.to.planId);
    if (!t0 || !t1 || t0.accepted?.id !== t1.accepted?.id || t0.pending?.id !== t1.pending?.id) return false;
    if (outcomeStatus(s0, t0, l.to.id) !== outcomeStatus(s1, t1, l.to.id)) return false;
  }
  return true;
}
/** The rebased write must change the fresh state exactly as the same write changes the snapshot state. */
function sameEffect(s0: ScopeState, s1: ScopeState, after: ScopeState, action: string, p: any, now: string): boolean {
  let serial: ScopeState;
  try { serial = applyMutation(s0, action as any, p, "agent", now).state; } catch { return false; }
  const strip = (s: ScopeState, base: ScopeState) => {
    const out: unknown[] = [];
    for (const plan of s.plans) {
      const old = base.plans.find(x => x.id === plan.id);
      if (!old) { out.push(["plan", plan.id, plan.pending?.content ?? null]); continue; }
      for (const o of plan.observations) if (!old.observations.some(x => x.id === o.id)) out.push(["obs", plan.id, { ...o, recordedAt: null }]);
      for (const l of plan.reasoningLinks) if (!old.reasoningLinks.some(x => x.id === l.id)) out.push(["link", plan.id, l]);
      if (canonical(plan.discussion) !== canonical(old.discussion)) out.push(["discussion", plan.id, plan.discussion ? { summary: plan.discussion.summary, stage: plan.discussion.stage } : null]);
    }
    return canonical(out);
  };
  return strip(serial, s0) === strip(after, s1);
}

test("V-race 7: seeded random histories with stale snapshots are serially equivalent (0 unsafe rebases)", () => {
  const seeds = Number(process.env.MOZAK_VRACE_SEEDS ?? 3), steps = Number(process.env.MOZAK_VRACE_STEPS ?? 60);
  let rebasedCount = 0, unsafe = 0, falseRefusals = 0, total = 0, notEquivalent = 0, refused = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const r = rng(seed);
    const entry = accepted();
    write(entry, "propose", { planId: "p2", content: content("Second unrelated subject", ["q1", "q2"]) });
    approve(entry, "p2");
    const history: { snap: ReturnType<typeof readScope>["snapshot"]; state: ScopeState; action: string }[] = [];
    const push = (action: string) => { const read = readScope(entry); history.push({ snap: read.snapshot, state: read.state, action }); };
    push("start");
    let n = 0;
    for (let i = 0; i < steps; i++) {
      const back = Math.min(history.length - 1, Math.floor(r() * 4));
      const at = history[history.length - 1 - back]!;
      const s0 = at.state;
      const between = history.slice(history.length - back).map(h => h.action);
      const pick = r();
      const planId = r() < 0.6 ? "p1" : "p2";
      const plan0 = s0.plans.find(p => p.id === planId)!;
      const outcomes = plan0.accepted?.content.outcomes.map(o => o.id) ?? [];
      let action: string, payload: any, actor: "agent" | "owner" = "agent";
      if (pick < 0.55 && plan0.accepted) {
        action = "observe";
        const id = r() < 0.1 && plan0.observations.length ? plan0.observations[Math.floor(r() * plan0.observations.length)]!.id : `o-${seed}-${++n}`;
        const supersedes = r() < 0.25 && plan0.observations.length ? plan0.observations[Math.floor(r() * plan0.observations.length)]!.id : undefined;
        const target = outcomes[Math.floor(r() * outcomes.length)]!;
        const relation = r() < 0.15 ? "challenges" : "supports";
        payload = { planId, observation: observation(id, { pass: r() < 0.7, supersedes }), reasoningLinks: r() < 0.8 ? [{ id: `${id}-l`, relation, from: { planId, revisionId: null, kind: "observation", id }, to: { planId, revisionId: plan0.accepted.id, kind: "outcome", id: target }, rationale: "random" }] : [] };
      } else if (pick < 0.75) {
        action = "save-discussion";
        payload = { planId, acceptedRevisionId: plan0.accepted?.id ?? null, pendingRevisionId: plan0.pending?.id ?? null, summary: `summary ${seed}-${++n}`, stage: "clarifying", questions: [] };
      } else if (pick < 0.9) {
        action = "propose";
        const words = ["kiwi", "lantern", "quartz", "harbor", "violet", "meadow", "copper", "glacier", "ember", "saffron"];
        const title = Array.from({ length: 4 }, () => words[Math.floor(r() * words.length)]).join(" ") + ` ${seed}-${++n}`;
        payload = { planId: r() < 0.2 && s0.plans.length > 2 ? s0.plans[s0.plans.length - 1]!.id : `np-${seed}-${n}`, content: content(title, ["z1"]) };
      } else if (pick < 0.95 && plan0.accepted) {
        action = "revise";
        payload = { planId, pendingRevisionId: plan0.pending?.id ?? null, acceptedRevisionId: plan0.accepted.id, content: content(`Revised ${seed}-${++n}`, outcomes) };
      } else {
        const challenged = outcomes.find(o => outcomeStatus(s0, plan0, o) === "evidence");
        if (!challenged) { i--; continue; }
        action = "accept-outcome"; actor = "owner";
        const shown = reviewShow(s0, planId, "accept-outcome", challenged);
        payload = { planId, revisionId: shown.revisionId, reviewDigest: shown.reviewDigest, outcomeId: challenged, ownerRef: `synthetic-owner:${seed}-${++n}`, ownerMessageAt: OWNER_AT, reason: "random acceptance" };
      }
      const s1 = readScope(entry).state;
      const safe = back === 0 ? null : oracleSafe(s0, s1, between, action, payload);
      total++;
      let res: ReturnType<typeof mutateScope> | undefined, code = "";
      try { res = write(entry, action, payload, at.snap, actor); } catch (e) { code = (e as { code: string }).code; }
      if (res) {
        push(action);
        if (res.rebased) {
          rebasedCount++;
          if (safe !== true) unsafe++;
          const after = readScope(entry).state;
          if (!sameEffect(s0, s1, after, action, payload, after.storage.updatedAt)) notEquivalent++;
        }
      } else if (code === "stale-input") { refused++; if (safe === true) falseRefusals++; }
    }
  }
  console.log(`V-race 7: seeds=${seeds} steps/seed=${steps} writes=${total} rebased=${rebasedCount} unsafe=${unsafe} notEquivalent=${notEquivalent} staleRefused=${refused} conservativeRefusals=${falseRefusals}`);
  assert.equal(unsafe, 0);
  assert.equal(notEquivalent, 0);
  assert.ok(rebasedCount > 0, "the generator exercises the rebase path");
});

test("V-race 8: P0.6 with rebase on: a rebased write still refuses when mozak.json or mozak.md changes before its rename", () => {
  for (const name of ["mozak.json", "mozak.md"]) {
    const entry = accepted();
    const snap = readScope(entry).snapshot;
    write(entry, "observe", observe(entry, "other", "o2"));
    const changed = name === "mozak.json" ? `${readFileSync(join(entry.root, name), "utf8")}\n` : "External bridge edit\n";
    const graphBefore = readFileSync(join(entry.root, "mozak.json"), "utf8");
    assert.throws(() => mutateScope(entry, { operationId: op(), scopeId: entry.id, expected: snap, action: "observe", payload: observe(entry, "mine", "o1") }, "agent", { ...NO_GUARD, rebase: true, onPhase(p) {
      if (p === "before-graph") writeFileSync(join(entry.root, name), changed);
    } }), { code: "graph-changed-during-write" });
    assert.equal(readFileSync(join(entry.root, name), "utf8"), changed);
    if (name === "mozak.md") assert.equal(readFileSync(join(entry.root, "mozak.json"), "utf8"), graphBefore);
  }
});
