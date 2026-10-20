// Child process fixture for scope-process.test.ts. Runs the REAL store operations against a real
// scope root. The only argument is a path to a JSON job file. The job is read as data, never evaluated.
//
// Job shape:
//   mode: "init" | "mutate" | "repair" | "read" | "append"
//   root, scopeId: selected scope
//   request: input object for init/mutate/repair (ignored for read/append)
//   pauseAt: phase name at which to send { type: "ready", phase } over IPC and block
//   pauseMs: finite block duration in ms, or null/absent to block until the parent SIGKILLs us
//   lockTimeoutMs: passed to the store seam
//   append: { planId, tag, count, attempts } for mode "append" (three-writer test)
//   race: RaceJob for mode "race" (V-race replay and kill -9 writers); setup: SetupJob for mode "setup"
//
// Pausing happens once per process. Readers hit "reader-between" on every attempt, so the pause is
// only taken the first time to avoid an unbounded loop in the test.
import { appendFileSync, readFileSync } from "node:fs";
import { initScopeState, mutateScope, readScope, renderProjection, repairProjection, type StoreOptions } from "../src/scope-store.ts";
import { reviewShow } from "../src/review.ts";
import { executeOperation } from "../src/api.ts";

interface AppendJob { planId: string; tag: string; count: number; attempts: number }
interface RaceJob {
  planId: string; outcomeId: string; tag: string; count: number; attempts: number;
  thinkMinMs: number; thinkMaxMs: number; seed: number;
  ackFile?: string; deadlineMs?: number;
  // Mixed workload for the kill -9 run: share of save-discussion on discussionPlanId, propose, and supersede.
  discussionPlanId?: string; discussionRate?: number; proposeRate?: number; supersedeRate?: number;
}
interface SetupJob { planId: string; outcomes: string[]; extraPlans?: string[] }
interface Job {
  mode: "init" | "mutate" | "repair" | "read" | "append" | "check" | "race" | "setup" | "render";
  root: string;
  scopeId: string;
  request?: unknown;
  pauseAt?: string;
  pauseMs?: number | null;
  lockTimeoutMs?: number;
  append?: AppendJob;
  race?: RaceJob;
  setup?: SetupJob;
}

const jobPath = process.argv[2];
if (!jobPath) {
  process.stderr.write("usage: scope-writer-child <job.json>\n");
  process.exit(64);
}
const job = JSON.parse(readFileSync(jobPath, "utf8")) as Job;
const entry = { id: job.scopeId, root: job.root };
const pauseSignal = new Int32Array(new SharedArrayBuffer(4));
let paused = false;

function announceAndBlock(phase: string): void {
  // IPC message for the parent, plus a synchronous stderr line in case the IPC write is not flushed
  // before the thread blocks. The parent treats either as the ready signal.
  if (typeof process.send === "function") process.send({ type: "ready", phase, pid: process.pid });
  process.stderr.write(`READY ${phase}\n`);
  if (job.pauseMs === undefined || job.pauseMs === null) Atomics.wait(pauseSignal, 0, 0);
  else Atomics.wait(pauseSignal, 0, 0, job.pauseMs);
}

const options: StoreOptions = {
  lockTimeoutMs: job.lockTimeoutMs,
  onPhase(phase: string) {
    if (!paused && job.pauseAt === phase) {
      paused = true;
      announceAndBlock(phase);
    }
  },
};

function mutationStatus(status: string): boolean {
  return status === "ok" || status === "replayed";
}

function runAppend(append: AppendJob): { committed: number; retries: number; failed: string[] } {
  const out = { committed: 0, retries: 0, failed: [] as string[] };
  for (let i = 0; i < append.count; i++) {
    const operationId = `obs-${append.tag}-${i}`;
    const observationId = `${append.tag}-${i}`;
    let done = false;
    for (let attempt = 0; attempt < append.attempts && !done; attempt++) {
      try {
        const snapshot = readScope(entry).snapshot;
        const input = {
          operationId,
          scopeId: entry.id,
          expected: snapshot,
          action: "observe",
          payload: {
            planId: append.planId,
            observation: { id: observationId, classification: "unverified", summary: `note ${observationId}`, evidence: [] },
            reasoningLinks: [],
          },
        };
        const result = mutateScope(entry, input, "agent", options);
        if (mutationStatus(result.status)) {
          out.committed++;
          done = true;
        }
      } catch (err) {
        const code = String((err as { code?: unknown }).code ?? "unknown");
        if (code === "stale-input" || code === "busy") {
          out.retries++;
          continue;
        }
        out.failed.push(`${observationId}:${code}`);
        break;
      }
    }
    if (!done && !out.failed.some((f) => f.startsWith(`${observationId}:`))) out.failed.push(`${observationId}:exhausted`);
  }
  return out;
}

const pause = (ms: number) => { if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };
function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const fixtureContent = (title: string, outcomes: string[]) => ({
  title, purpose: `Purpose ${title}`, constraints: [], nonGoals: [], rationale: "Synthetic fixture", questions: [], sources: [],
  outcomes: outcomes.map(id => ({ id, statement: `Statement ${id}`, acceptance: "objective", criterion: `Check ${id}` })),
});

/** Propose and owner-approve a plan with the given outcomes, plus optional extra unaccepted plans. */
function runSetup(setup: SetupJob): unknown {
  let n = 0;
  const write = (action: string, payload: unknown, actor: "agent" | "owner" = "agent") =>
    mutateScope(entry, { operationId: `setup-${++n}-${action}`, scopeId: entry.id, expected: readScope(entry).snapshot, action, payload }, actor, options);
  write("propose", { planId: setup.planId, content: fixtureContent(`Race fixture ${setup.planId}`, setup.outcomes) });
  const shown = reviewShow(readScope(entry).state, setup.planId, "approve-direction");
  write("approve-direction", { planId: setup.planId, revisionId: shown.revisionId, reviewDigest: shown.reviewDigest, ownerRef: "synthetic-owner:race", ownerMessageAt: "2026-10-12T08:00:00.000Z", reason: "fixture approval" }, "owner");
  for (const id of setup.extraPlans ?? []) write("propose", { planId: id, content: fixtureContent(`Topic ${id}zq`, ["d1"]) });
  // Let the owner approval age past the rebase guard window, then leave one ordinary append as the latest write.
  pause(1100);
  write("observe", { planId: setup.planId, observation: { id: "warmup", classification: "unverified", summary: "fixture warm-up", evidence: [] }, reasoningLinks: [] });
  return { status: "ok", acceptedRevisionId: readScope(entry).state.plans.find(p => p.id === setup.planId)!.accepted!.id };
}

/**
 * One agent: read, think, write, as in the A0 experiment. On stale-input or busy it rereads and retries.
 * Every attempt is timed. A commit is acknowledged in ackFile (synchronous append) right after it returns.
 */
function runRace(job: RaceJob): unknown {
  const r = random(job.seed);
  const out = { commits: 0, attempts: 0, stale: 0, busy: 0, rebased: 0, failed: [] as string[], latencies: [] as number[], kinds: {} as Record<string, number>, refusals: {} as Record<string, number> };
  const mine: string[] = [];
  const deadline = job.deadlineMs ? Date.now() + job.deadlineMs : Infinity;
  for (let i = 0; i < job.count && Date.now() < deadline; i++) {
    const pick = r();
    const kind = job.discussionPlanId && pick < (job.discussionRate ?? 0) ? "save-discussion"
      : pick < (job.discussionRate ?? 0) + (job.proposeRate ?? 0) ? "propose" : "observe";
    const operationId = `${job.tag}-${i}`;
    let done = false;
    for (let attempt = 0; attempt < job.attempts && !done && Date.now() < deadline; attempt++) {
      const read = readScope(entry);
      pause(job.thinkMinMs + Math.floor(r() * (job.thinkMaxMs - job.thinkMinMs + 1)));
      let payload: Record<string, unknown>;
      if (kind === "save-discussion") {
        const plan = read.state.plans.find(p => p.id === job.discussionPlanId)!;
        payload = { planId: plan.id, acceptedRevisionId: plan.accepted?.id ?? null, pendingRevisionId: plan.pending?.id ?? null, summary: `summary ${operationId}`, stage: "clarifying", questions: [] };
      } else if (kind === "propose") {
        payload = { planId: `np${job.tag}x${i}`, content: fixtureContent(`Item ${job.tag}x${i}q`, ["z1"]) };
      } else {
        const revisionId = read.state.plans.find(p => p.id === job.planId)!.accepted!.id;
        const supersedes = mine.length && r() < (job.supersedeRate ?? 0) ? mine[Math.floor(r() * mine.length)] : undefined;
        payload = {
          planId: job.planId,
          observation: { id: operationId, classification: "observed", summary: `check ${operationId}`, ...(supersedes ? { supersedesObservationId: supersedes } : {}), evidence: [{ id: `${operationId}-e`, locator: "test:race", anchor: null, version: null, inspectedAt: "2026-10-12T08:30:00.000Z", activity: { kind: "run", description: "synthetic run" }, result: { verdict: "pass", summary: "passed" }, limitations: [] }] },
          reasoningLinks: [{ id: `${operationId}-l`, relation: "supports", from: { planId: job.planId, revisionId: null, kind: "observation", id: operationId }, to: { planId: job.planId, revisionId, kind: "outcome", id: job.outcomeId }, rationale: "race support" }],
        };
      }
      out.attempts++;
      const started = performance.now();
      try {
        const result = mutateScope(entry, { operationId, scopeId: entry.id, expected: read.snapshot, action: kind, payload }, "agent", options);
        out.latencies.push(Math.round((performance.now() - started) * 10) / 10);
        if (mutationStatus(result.status)) {
          done = true; out.commits++; out.kinds[kind] = (out.kinds[kind] ?? 0) + 1;
          if (result.rebased) out.rebased++;
          if (kind === "observe") mine.push(operationId);
          if (job.ackFile) appendFileSync(job.ackFile, `${operationId}\t${kind}\t${kind === "propose" ? `np${job.tag}x${i}` : operationId}\n`);
        }
      } catch (err) {
        const code = String((err as { code?: unknown }).code ?? "unknown");
        if (code === "stale-input") {
          out.stale++;
          const why = String((err as Error).message).replace(/"[^"]*"/g, "X");
          out.refusals[why] = (out.refusals[why] ?? 0) + 1;
          continue;
        }
        if (code === "busy") { out.busy++; continue; }
        out.failed.push(`${operationId}:${code}`);
        break;
      }
    }
  }
  return out;
}

try {
  let outcome: unknown;
  if (job.mode === "init") {
    outcome = initScopeState(entry, job.request, options);
  } else if (job.mode === "mutate") {
    outcome = mutateScope(entry, job.request, "agent", options);
  } else if (job.mode === "repair") {
    outcome = repairProjection(entry, job.request, options);
  } else if (job.mode === "read") {
    const read = readScope(entry, options);
    outcome = {
      status: "read",
      snapshot: read.snapshot,
      projectionStatus: read.projectionStatus,
      plans: read.state.plans.length,
      planIds: read.state.plans.map((p) => p.id).sort(),
      discussions: Object.fromEntries(read.state.plans.filter((p) => p.discussion).map((p) => [p.id, p.discussion!.summary])),
      observationIds: read.state.plans.flatMap((p) => p.observations.map((o) => o.id)).sort(),
      // Receipts are keyed by unique operation ID. Expose the IDs so the parent can count them.
      receiptOperationIds: Object.keys(read.state.receipts).sort(),
    };
  } else if (job.mode === "append") {
    if (!job.append) throw new Error("append mode requires an append job");
    outcome = runAppend(job.append);
  } else if (job.mode === "race") {
    if (!job.race) throw new Error("race mode requires a race job");
    outcome = runRace(job.race);
  } else if (job.mode === "setup") {
    if (!job.setup) throw new Error("setup mode requires a setup job");
    outcome = runSetup(job.setup);
  } else if (job.mode === "render") {
    const { result, outcome: out } = renderProjection(entry, options);
    outcome = { status: out.status, result };
  } else if (job.mode === "check") {
    // The real public check route, as `mozak check` runs it.
    const out = executeOperation({ format: "mozak.local/v3", scopes: [entry], digest: "" } as Parameters<typeof executeOperation>[0], "check", { scope: entry.id }, "agent");
    outcome = { status: out.data.status, exitCode: out.exitCode, issues: out.data.issues };
  } else {
    throw new Error(`unknown mode ${String(job.mode)}`);
  }
  process.stdout.write(JSON.stringify({ ok: true, outcome }) + "\n");
  process.exitCode = 0;
} catch (err) {
  const e = err as { code?: unknown; message?: unknown; exitCode?: unknown };
  process.stdout.write(
    JSON.stringify({
      ok: false,
      code: typeof e.code === "string" ? e.code : "unknown",
      message: String(e.message ?? err),
      exitCode: typeof e.exitCode === "number" ? e.exitCode : 1,
    }) + "\n",
  );
  process.exitCode = typeof e.exitCode === "number" ? e.exitCode : 1;
}
