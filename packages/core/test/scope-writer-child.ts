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
//
// Pausing happens once per process. Readers hit "reader-between" on every attempt, so the pause is
// only taken the first time to avoid an unbounded loop in the test.
import { readFileSync } from "node:fs";
import { initScopeState, mutateScope, readScope, repairProjection, type StoreOptions } from "../src/scope-store.ts";

interface AppendJob { planId: string; tag: string; count: number; attempts: number }
interface Job {
  mode: "init" | "mutate" | "repair" | "read" | "append";
  root: string;
  scopeId: string;
  request?: unknown;
  pauseAt?: string;
  pauseMs?: number | null;
  lockTimeoutMs?: number;
  append?: AppendJob;
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
      observationIds: read.state.plans.flatMap((p) => p.observations.map((o) => o.id)).sort(),
      // Receipts are keyed by unique operation ID. Expose the IDs so the parent can count them.
      receiptOperationIds: Object.keys(read.state.receipts).sort(),
    };
  } else if (job.mode === "append") {
    if (!job.append) throw new Error("append mode requires an append job");
    outcome = runAppend(job.append);
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
