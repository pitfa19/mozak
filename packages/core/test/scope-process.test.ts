import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync, mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Process-level acceptance for A11 to A15. Every writer is a real child process running the real
// scope-store. The parent never imports store logic: it reads and writes state only through child
// processes (scope-writer-child.ts imports scope-store.ts). Test roots are created under
// JCODE_SCRATCH_DIR (or TMPDIR) and removed only by this file, only for those roots.

const here = fileURLToPath(new URL(".", import.meta.url));
const childPath = join(here, "scope-writer-child.ts");
// Normalized: a TMPDIR with a trailing slash or behind a symlink (macOS /var) must not trip the removal guard.
const scratch = realpathSync(resolve(process.env.JCODE_SCRATCH_DIR ?? process.env.TMPDIR ?? tmpdir()));
const createdRoots: string[] = [];
const liveChildren = new Set<ChildProcess>();

after(async () => {
  // Join every child before any test-root removal. A child still running is killed and awaited.
  for (const child of liveChildren) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
  await Promise.all(
    [...liveChildren].map(
      (c) => new Promise((r) => (c.exitCode !== null || c.signalCode !== null ? r(null) : c.once("exit", r))),
    ),
  );
  // Remove only paths this file created, and only when they sit under the scratch base.
  for (const path of createdRoots) {
    if (!path.startsWith(scratch + "/") || !path.includes("/mozak-proc-")) {
      throw new Error(`refusing to remove unexpected path outside test scratch: ${path}`);
    }
    rmSync(path, { recursive: true, force: true });
  }
});


interface Scope { id: string; root: string }

const content = {
  title: "Understand plans",
  purpose: "Keep agreed direction",
  outcomes: [{ id: "outcome", statement: "Context can be recovered", acceptance: "objective", criterion: "A new process reads the same direction" }],
  constraints: [],
  nonGoals: [],
  rationale: "Avoid repeated context interviews",
  questions: [],
  sources: [],
};

function world(name: string): { entry: Scope; initRequest: Record<string, unknown> } {
  const root = mkdtempSync(join(scratch, `mozak-proc-${name}-`));
  createdRoots.push(root);
  writeFileSync(join(root, "README.md"), "Human instructions\n");
  writeFileSync(join(root, "AGENTS.md"), "Existing agent instructions\n");
  const entry = { id: "sample", root };
  const initRequest = {
    operationId: "init-1",
    scopeId: "sample",
    kind: "project",
    title: "Sample",
    expectedAbsent: { graph: true, bridge: true },
    ownerRef: "synthetic-owner:init",
    ownerMessageAt: "2026-10-12T08:00:00.000Z",
  };
  return { entry, initRequest };
}

// Job files are written into a sibling directory owned by this test root. The scope root itself
// holds only real scope files, so snapshots and lock inspection stay clean.
function jobFile(root: string, name: string, job: Record<string, unknown>): string {
  const dir = scratchJobs(root);
  const path = join(dir, `${name}-${randomSuffix()}.json`);
  writeFileSync(path, JSON.stringify(job));
  return path;
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2);
}

function scratchJobs(root: string): string {
  const dir = `${root}.jobs`;
  if (!existsSync(dir)) {
    mkdirSync(dir);
    createdRoots.push(dir);
  }
  return dir;
}

interface ChildResult { ok: boolean; code?: string; message?: string; exitCode?: number; outcome?: any }

// Upper bound for any single child. A bad phase name or import failure must fail the test, not hang the runner.
const CHILD_TIMEOUT_MS = 20_000;

// Kill a child that overruns its bound. The exit handler then reports a timeout result instead of waiting forever.
function armTimeout(child: ChildProcess, label: string): NodeJS.Timeout {
  return setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      timedOut.add(child);
    }
    void label;
  }, CHILD_TIMEOUT_MS);
}
const timedOut = new WeakSet<ChildProcess>();

function runChild(job: Record<string, unknown>, opts: { jobName?: string } = {}): Promise<ChildResult> {
  const root = String(job.root);
  const jobPath = jobFile(root, opts.jobName ?? "job", job);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--experimental-strip-types", childPath, jobPath], {
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    liveChildren.add(child);
    const timer = armTimeout(child, opts.jobName ?? "job");
    let stdout = "";
    child.stdout!.on("data", (d) => (stdout += d));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      liveChildren.delete(child);
      if (timedOut.has(child)) return resolve({ ok: false, code: "child-timeout", exitCode: -1 });
      if (signal) return resolve({ ok: false, code: `signal-${signal}`, exitCode: -1 });
      try {
        const parsed = JSON.parse(stdout.trim().split("\n").pop()!);
        resolve({ ...parsed, exitCode: code ?? parsed.exitCode });
      } catch {
        resolve({ ok: false, code: "no-output", exitCode: code ?? -1 });
      }
    });
  });
}

// Start a child that will announce a pause phase and stay alive until the parent kills it.
// Stdout is captured from spawn so a paused child's final JSON result is never lost.
// Readiness comes from the IPC "ready" message, with the child's stderr "READY <phase>" line as a
// fallback when IPC is unavailable. Whichever arrives first resolves the wait.
const pausedOutput = new WeakMap<ChildProcess, { text: string; done: Promise<ChildResult> }>();

function startPaused(job: Record<string, unknown>, jobName: string): Promise<{ child: ChildProcess; phase: string }> {
  const root = String(job.root);
  const jobPath = jobFile(root, jobName, job);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--experimental-strip-types", childPath, jobPath], {
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    liveChildren.add(child);
    const timer = armTimeout(child, jobName);
    const captured = { text: "", done: Promise.resolve({ ok: false } as ChildResult) };
    let stderrText = "";
    let settled = false;
    // The timer bounds only the readiness wait. Once the holder reports ready, it is cleared so a
    // legitimately paused holder is never killed by the readiness bound.
    const settle = (phase: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ child, phase });
    };
    child.stdout!.on("data", (d) => (captured.text += d));
    child.stderr!.on("data", (d) => {
      stderrText += d;
      const match = /^READY (\S+)$/m.exec(stderrText);
      if (match) settle(match[1]!);
    });
    captured.done = new Promise<ChildResult>((res) =>
      child.once("exit", (code, signal) => {
        clearTimeout(timer);
        liveChildren.delete(child);
        if (timedOut.has(child)) return res({ ok: false, code: "child-timeout", exitCode: -1 });
        if (signal) return res({ ok: false, code: `signal-${signal}`, exitCode: -1 });
        try {
          res({ ...JSON.parse(captured.text.trim().split("\n").pop()!), exitCode: code ?? -1 });
        } catch {
          res({ ok: false, code: "no-output", exitCode: code ?? -1 });
        }
      }),
    );
    pausedOutput.set(child, captured);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("message", (msg: any) => {
      if (msg?.type === "ready") settle(String(msg.phase));
    });
    child.once("exit", () => {
      clearTimeout(timer);
      if (!settled) reject(new Error(`child exited or timed out before reaching pause phase ${String(job.pauseAt)}`));
    });
  });
}

function pausedResult(child: ChildProcess): Promise<ChildResult> {
  const captured = pausedOutput.get(child);
  if (!captured) throw new Error("no captured output for paused child");
  return captured.done;
}

function killAndJoin(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      liveChildren.delete(child);
      return resolve();
    }
    child.once("exit", () => {
      liveChildren.delete(child);
      resolve();
    });
    child.kill("SIGKILL");
  });
}

// Read the real canonical state through a child, so the parent never imports store logic.
async function readViaChild(entry: Scope): Promise<ChildResult & { outcome: { snapshot: any; projectionStatus: string; plans: number; observationIds: string[] } }> {
  const res = await runChild({ mode: "read", root: entry.root, scopeId: entry.id }, { jobName: "read" });
  assert.equal(res.ok, true, `read failed: ${res.code} ${res.message}`);
  return res as any;
}

function lockPath(root: string): string {
  return join(root, ".mozak-write-lock");
}

function snapshotFiles(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of ["mozak.json", "mozak.md"]) {
    const p = join(root, name);
    if (existsSync(p)) out[name] = readFileSync(p, "utf8");
  }
  return out;
}

// --- Initial state helper: a real init through a child, then a real observe baseline. ---

async function initialized(name: string): Promise<{ entry: Scope; initRequest: Record<string, unknown> }> {
  const { entry, initRequest } = world(name);
  const init = await runChild({ mode: "init", root: entry.root, scopeId: entry.id, request: initRequest }, { jobName: "init" });
  assert.equal(init.ok, true, `init failed: ${init.code} ${init.message}`);
  assert.equal(init.outcome.status, "ok");
  return { entry, initRequest };
}

// Propose the unaccepted plan that observations attach to. No owner decision is needed for this.
async function withPlan(name: string): Promise<{ entry: Scope; initRequest: Record<string, unknown> }> {
  const base = await initialized(name);
  const snapshot = (await readViaChild(base.entry)).outcome.snapshot;
  const proposed = await runChild({ mode: "mutate", root: base.entry.root, scopeId: base.entry.id, request: proposeRequest(base.entry, snapshot, `propose-${name}`) }, { jobName: "propose-base" });
  assert.equal(proposed.ok, true, `base propose failed: ${proposed.code} ${proposed.message}`);
  return base;
}

function proposeRequest(entry: Scope, snapshot: any, operationId: string) {
  return { operationId, scopeId: entry.id, expected: snapshot, action: "propose", payload: { planId: "plan-1", content } };
}

function observeRequest(entry: Scope, snapshot: any, operationId: string, observationId: string) {
  return {
    operationId,
    scopeId: entry.id,
    expected: snapshot,
    action: "observe",
    payload: {
      planId: "plan-1",
      observation: { id: observationId, classification: "unverified", summary: `note ${observationId}`, evidence: [] },
      reasoningLinks: [],
    },
  };
}

// --- A13 / A14 / A15 cases. Each is a real-process crash or interleaving. ---

test("A13 dead before metadata: a holder SIGKILLed after lock mkdir leaves a fail-closed lock; canonical state is untouched", async () => {
  const { entry } = await withPlan("dead-before-meta");
  const before = snapshotFiles(entry.root);
  const { child, phase } = await startPaused(
    { mode: "mutate", root: entry.root, scopeId: entry.id, request: observeRequest(entry, (await readViaChild(entry)).outcome.snapshot, "obs-meta", "m1"), pauseAt: "after-lock-mkdir" },
    "meta",
  );
  assert.equal(phase, "after-lock-mkdir");
  await killAndJoin(child);

  assert.equal(existsSync(lockPath(entry.root)), true, "lock directory must survive the crash");
  assert.equal(existsSync(join(lockPath(entry.root), "owner.json")), false, "no owner metadata was written before the crash");
  assert.deepEqual(snapshotFiles(entry.root), before, "graph and bridge bytes unchanged");

  const blocked = await runChild({
    mode: "mutate", root: entry.root, scopeId: entry.id, lockTimeoutMs: 50,
    request: observeRequest(entry, (await readViaChild(entry)).outcome.snapshot, "obs-after-meta", "m2"),
  }, { jobName: "after-meta" });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, "recovery-required", "missing metadata must fail closed, not be stolen");
  assert.equal(existsSync(lockPath(entry.root)), true, "fail-closed writer must not remove the lock");
});

test("A13 before graph init retry: after a crash before graph publication, init retries once the lock is offline-removed", async () => {
  const { entry, initRequest } = world("before-graph-init");
  const { child, phase } = await startPaused(
    { mode: "init", root: entry.root, scopeId: entry.id, request: initRequest, pauseAt: "before-graph" },
    "init-pause",
  );
  assert.equal(phase, "before-graph");
  await killAndJoin(child);

  assert.equal(existsSync(join(entry.root, "mozak.json")), false, "no graph exists before publication");
  assert.equal(existsSync(join(entry.root, "mozak.md")), false, "no bridge exists before publication");

  // Offline recovery in a test root only, after the holder is joined.
  rmSync(lockPath(entry.root), { recursive: true, force: true });

  const retry = await runChild({ mode: "init", root: entry.root, scopeId: entry.id, request: initRequest }, { jobName: "init-retry" });
  assert.equal(retry.ok, true, `init retry failed: ${retry.code} ${retry.message}`);
  assert.equal(retry.outcome.status, "ok");
  const read = await readViaChild(entry);
  assert.equal(read.outcome.projectionStatus, "current");
  assert.equal(readFileSync(join(entry.root, "AGENTS.md"), "utf8"), "Existing agent instructions\n", "instructions preserved");
});

test("A13 post-canonical: a crash after graph publication leaves a committed graph with a stale bridge, and repair publishes it without new semantics", async () => {
  const { entry } = await initialized("post-canonical");
  const snapshot = (await readViaChild(entry)).outcome.snapshot;
  const { child, phase } = await startPaused(
    { mode: "mutate", root: entry.root, scopeId: entry.id, request: proposeRequest(entry, snapshot, "propose-pc"), pauseAt: "after-graph" },
    "post-canonical",
  );
  assert.equal(phase, "after-graph");
  const graphAfterCommit = readFileSync(join(entry.root, "mozak.json"), "utf8");
  await killAndJoin(child);

  assert.equal(readFileSync(join(entry.root, "mozak.json"), "utf8"), graphAfterCommit, "canonical graph retained after kill");
  rmSync(lockPath(entry.root), { recursive: true, force: true });

  const read = await readViaChild(entry);
  assert.equal(read.outcome.plans, 1, "the committed proposal is readable from canonical state");
  assert.equal(read.outcome.projectionStatus, "bridge-stale");

  const repair = await runChild({
    mode: "repair", root: entry.root, scopeId: entry.id,
    request: { requestId: "repair-pc", scopeId: entry.id, expected: read.outcome.snapshot },
  }, { jobName: "repair" });
  assert.equal(repair.ok, true, `repair failed: ${repair.code} ${repair.message}`);
  assert.equal(repair.outcome.projectionUpdated, true);

  const after = await readViaChild(entry);
  assert.equal(after.outcome.projectionStatus, "current");
  assert.equal(after.outcome.snapshot.revision, read.outcome.snapshot.revision, "repair creates no new canonical revision");
  assert.equal(after.outcome.plans, 1);
});

test("A13 post-bridge: a crash after bridge publication but before release recovers with a current projection and an exact replay", async () => {
  const { entry } = await initialized("post-bridge");
  const snapshot = (await readViaChild(entry)).outcome.snapshot;
  const request = proposeRequest(entry, snapshot, "propose-pb");
  const { child, phase } = await startPaused(
    { mode: "mutate", root: entry.root, scopeId: entry.id, request, pauseAt: "before-release" },
    "post-bridge",
  );
  assert.equal(phase, "before-release");
  await killAndJoin(child);

  rmSync(lockPath(entry.root), { recursive: true, force: true });

  const read = await readViaChild(entry);
  assert.equal(read.outcome.projectionStatus, "current", "bridge was published before the crash");
  assert.equal(read.outcome.plans, 1);

  const replay = await runChild({ mode: "mutate", root: entry.root, scopeId: entry.id, request }, { jobName: "replay" });
  assert.equal(replay.ok, true, `replay failed: ${replay.code} ${replay.message}`);
  assert.equal(replay.outcome.status, "replayed");
  assert.equal((await readViaChild(entry)).outcome.plans, 1, "replay creates no duplicate semantic result");
});

test("A12 slow live holder beyond the former 30-second lease cannot be stolen by a contender", async () => {
  const { entry } = await withPlan("slow-live");
  const snapshot = (await readViaChild(entry)).outcome.snapshot;
  // The real holder pauses just after taking the lock and stays alive for 40 seconds. The contender runs
  // at 31 seconds, past the former 30-second lease, while the holder is still provably live. The 9 second
  // margin keeps the holder from finishing before the contender's check. No clock hook, no faked mtime.
  const { child } = await startPaused(
    { mode: "mutate", root: entry.root, scopeId: entry.id, request: observeRequest(entry, snapshot, "obs-slow", "s1"), pauseAt: "after-lock", pauseMs: 40_000 },
    "slow-live",
  );
  try {
    await new Promise((r) => setTimeout(r, 31_000));
    const ageMs = Date.now() - statSync(lockPath(entry.root)).mtimeMs;
    assert.ok(ageMs > 30_000, `lock must be older than the former 30s lease, was ${Math.round(ageMs)}ms`);
    assert.equal(existsSync(join(lockPath(entry.root), "owner.json")), true, "live holder metadata is present");
    assert.equal(child.exitCode, null, "holder is still running when the contender checks");

    const contender = await runChild({
      mode: "mutate", root: entry.root, scopeId: entry.id, lockTimeoutMs: 100,
      request: observeRequest(entry, snapshot, "obs-contender", "c1"),
    }, { jobName: "contender" });
    assert.equal(contender.ok, false);
    assert.equal(contender.code, "busy", "a live holder older than 30 seconds is busy, never stolen by age");
    assert.equal(existsSync(join(lockPath(entry.root), "owner.json")), true, "owner metadata of the live holder is intact");
  } finally {
    // Join the holder by its own completion. Its pause ends on its own; the parent never kills it here.
    await pausedResult(child);
  }
});

test("A11 three append writers with fresh snapshots: retries on stale or busy and lose no observations or receipts", async () => {
  // withPlan already proposes plan-1. Observations attach to that single unaccepted plan.
  const { entry } = await withPlan("three-writers");
  const baseline = await readViaChild(entry);
  const baseReceipts = baseline.outcome.receiptOperationIds;
  assert.deepEqual(baseReceipts, ["init-1", "propose-three-writers"].sort(), "baseline receipts are init and the single proposal");

  const perWriter = 4;
  const tags = ["wa", "wb", "wc"];
  const results = await Promise.all(
    tags.map((tag) =>
      runChild({
        mode: "append", root: entry.root, scopeId: entry.id, lockTimeoutMs: 5000,
        append: { planId: "plan-1", tag, count: perWriter, attempts: 200 },
      }, { jobName: `append-${tag}` }),
    ),
  );

  for (const r of results) {
    assert.equal(r.ok, true, `writer failed: ${r.code} ${r.message}`);
    assert.deepEqual(r.outcome.failed, [], "no writer gives up or gets a non-retryable error");
    assert.equal(r.outcome.committed, perWriter);
  }

  const read = await readViaChild(entry);
  const expectedObservations: string[] = [];
  const expectedReceipts: string[] = [];
  for (const tag of tags) {
    for (let i = 0; i < perWriter; i++) {
      expectedObservations.push(`${tag}-${i}`);
      expectedReceipts.push(`obs-${tag}-${i}`);
    }
  }
  assert.deepEqual(read.outcome.observationIds, expectedObservations.sort(), "every observation exactly once");
  // Every committed append leaves exactly one receipt, and no receipt is missing or duplicated.
  assert.deepEqual(read.outcome.receiptOperationIds, [...baseReceipts, ...expectedReceipts].sort(), "exactly one receipt per committed append");
  assert.equal(read.outcome.projectionStatus, "current");
});

test("token mismatch never removes an unexpected owner; contents other than owner.json block removal", async () => {
  const { entry } = await withPlan("token-mismatch");
  const snapshot = (await readViaChild(entry)).outcome.snapshot;
  // The holder pauses just before release for a bounded window, then reaches the real release check.
  const { child } = await startPaused(
    { mode: "mutate", root: entry.root, scopeId: entry.id, request: observeRequest(entry, snapshot, "obs-token", "t1"), pauseAt: "before-release", pauseMs: 3000 },
    "token",
  );
  const owner = join(lockPath(entry.root), "owner.json");
  const tampered = JSON.stringify({ token: "not-the-holder", pid: 1, processStartHint: "x", acquiredAt: "x" });
  writeFileSync(owner, tampered);
  writeFileSync(join(lockPath(entry.root), "unexpected.txt"), "keep me\n");
  const finished = await pausedResult(child);
  // The real release check refused to remove a lock it does not own, and reported the commit honestly.
  assert.equal(finished.ok, true);
  assert.equal(finished.outcome.status, "committed-lock-held", "a committed write with a refused release is reported, not success");
  assert.equal(finished.outcome.committed, true);
  assert.equal(existsSync(lockPath(entry.root)), true, "mismatched lock is not removed by the old holder");
  assert.equal(readFileSync(owner, "utf8"), tampered, "foreign owner metadata is untouched");
  assert.equal(readFileSync(join(lockPath(entry.root), "unexpected.txt"), "utf8"), "keep me\n");
  // A fresh writer treats the mismatched lock as busy rather than removing it.
  const refused = await runChild({
    mode: "mutate", root: entry.root, scopeId: entry.id, lockTimeoutMs: 50,
    request: observeRequest(entry, snapshot, "obs-token-2", "t2"),
  }, { jobName: "token-refusal" });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "busy");
  assert.equal(existsSync(join(lockPath(entry.root), "unexpected.txt")), true);
});

test("A13 existing scope before-graph crash: graph and bridge bytes are preserved, and the original valid snapshot retries after joined offline recovery", async () => {
  // An existing, valid scope with a proposed plan. A later observe crashes before graph publication.
  const { entry } = await withPlan("existing-before-graph");
  const validSnapshot = (await readViaChild(entry)).outcome.snapshot;
  const graphBefore = readFileSync(join(entry.root, "mozak.json"), "utf8");
  const bridgeBefore = readFileSync(join(entry.root, "mozak.md"), "utf8");
  const request = observeRequest(entry, validSnapshot, "obs-existing-bg", "eb1");

  const { child, phase } = await startPaused(
    { mode: "mutate", root: entry.root, scopeId: entry.id, request, pauseAt: "before-graph" },
    "existing-before-graph",
  );
  assert.equal(phase, "before-graph");
  await killAndJoin(child);

  // The crash left canonical and projection bytes exactly as they were before the attempt.
  assert.equal(readFileSync(join(entry.root, "mozak.json"), "utf8"), graphBefore, "graph bytes preserved");
  assert.equal(readFileSync(join(entry.root, "mozak.md"), "utf8"), bridgeBefore, "bridge bytes preserved");

  // Before offline recovery, a fresh writer is refused as busy and changes nothing.
  const blocked = await runChild({
    mode: "mutate", root: entry.root, scopeId: entry.id, lockTimeoutMs: 50, request,
  }, { jobName: "existing-blocked" });
  assert.equal(blocked.ok, false);
  // The holder wrote owner metadata before pausing, so the lock is reported busy, not stolen by age.
  assert.equal(blocked.code, "busy", "a crashed holder with owner metadata still blocks until offline recovery");
  assert.equal(readFileSync(join(entry.root, "mozak.json"), "utf8"), graphBefore, "blocked writer changes no canonical bytes");

  // Offline recovery in this test root only, after the holder is joined.
  rmSync(lockPath(entry.root), { recursive: true, force: true });

  // The original valid snapshot is retried. It was not stale, because nothing committed.
  const retry = await runChild({ mode: "mutate", root: entry.root, scopeId: entry.id, request }, { jobName: "existing-retry" });
  assert.equal(retry.ok, true, `retry failed: ${retry.code} ${retry.message}`);
  assert.equal(retry.outcome.status, "ok", "retry with the original snapshot commits once");
  const read = await readViaChild(entry);
  assert.ok(read.outcome.observationIds.includes("eb1"));
  assert.equal(read.outcome.projectionStatus, "current");
});

test("A14 interrupted projection blocks later semantic writes, and reusing an operation ID with changed input is refused", async () => {
  const { entry } = await withPlan("a14-projection");
  const snapshot = (await readViaChild(entry)).outcome.snapshot;
  // A real holder commits the graph, then is SIGKILLed before the bridge is published.
  const { child, phase } = await startPaused(
    { mode: "mutate", root: entry.root, scopeId: entry.id, request: observeRequest(entry, snapshot, "obs-a14-1", "p1"), pauseAt: "after-graph" },
    "a14-interrupt",
  );
  assert.equal(phase, "after-graph");
  await killAndJoin(child);
  rmSync(lockPath(entry.root), { recursive: true, force: true });

  const interrupted = await readViaChild(entry);
  assert.equal(interrupted.outcome.projectionStatus, "bridge-stale", "the committed graph has a stale bridge");
  assert.ok(interrupted.outcome.observationIds.includes("p1"), "the committed observation is durable");

  // A later semantic write is refused while the projection is incomplete. It must not commit.
  const blocked = await runChild({
    mode: "mutate", root: entry.root, scopeId: entry.id,
    request: observeRequest(entry, interrupted.outcome.snapshot, "obs-a14-2", "p2"),
  }, { jobName: "a14-blocked" });
  assert.equal(blocked.ok, false, "a later semantic write is refused while projection is incomplete");
  assert.equal(blocked.code, "bridge-stale");
  assert.equal(blocked.exitCode, 3, "refusal is a projection-state refusal without a commit");
  assert.equal((await readViaChild(entry)).outcome.observationIds.includes("p2"), false, "the refused observation is not committed");

  // Reusing the operation ID of the committed write with changed input is refused, never replayed.
  const reused = await runChild({
    mode: "mutate", root: entry.root, scopeId: entry.id,
    request: observeRequest(entry, interrupted.outcome.snapshot, "obs-a14-1", "p1-changed"),
  }, { jobName: "a14-reuse" });
  assert.equal(reused.ok, false);
  assert.equal(reused.code, "operation-conflict");
});

test("release successor interleaving: a successor cannot acquire until the prior holder finishes release work", async () => {
  const { entry } = await withPlan("release-successor");
  const snapshot = (await readViaChild(entry)).outcome.snapshot;
  // A long bounded pause keeps the holder inside its release window while the contender runs.
  const holder = await startPaused(
    { mode: "mutate", root: entry.root, scopeId: entry.id, request: observeRequest(entry, snapshot, "obs-rel-a", "ra"), pauseAt: "before-release", pauseMs: 3000 },
    "release-holder",
  );
  // While the holder is paused just before release, a contender must not acquire.
  const early = await runChild({
    mode: "mutate", root: entry.root, scopeId: entry.id, lockTimeoutMs: 100,
    request: observeRequest(entry, snapshot, "obs-rel-b", "rb"),
  }, { jobName: "successor-early" });
  assert.equal(early.ok, false);
  assert.equal(early.code, "busy", "successor is refused while the holder is still releasing");

  await new Promise<void>((resolve) => holder.child.once("exit", () => resolve()));
  liveChildren.delete(holder.child);
  assert.equal(existsSync(lockPath(entry.root)), false, "holder removed its lock during release");

  const successor = await runChild({
    mode: "mutate", root: entry.root, scopeId: entry.id, lockTimeoutMs: 2000,
    request: observeRequest(entry, (await readViaChild(entry)).outcome.snapshot, "obs-rel-c", "rc"),
  }, { jobName: "successor-late" });
  assert.equal(successor.ok, true, `successor failed: ${successor.code} ${successor.message}`);
  const ids = (await readViaChild(entry)).outcome.observationIds;
  assert.ok(ids.includes("ra") && ids.includes("rc"), "both committed observations are present");
});

test("A15 offline-only recovery: a test root's stale lock is removed only after every child is joined", async () => {
  const { entry } = await withPlan("offline-recovery");
  const snapshot = (await readViaChild(entry)).outcome.snapshot;
  const { child } = await startPaused(
    { mode: "mutate", root: entry.root, scopeId: entry.id, request: observeRequest(entry, snapshot, "obs-off", "o1"), pauseAt: "after-lock", pauseMs: null },
    "offline",
  );
  await killAndJoin(child);
  assert.equal(liveChildren.has(child), false, "holder joined before any removal");
  rmSync(lockPath(entry.root), { recursive: true, force: true });
  assert.equal(existsSync(lockPath(entry.root)), false);
  const next = await runChild({
    mode: "mutate", root: entry.root, scopeId: entry.id,
    request: observeRequest(entry, (await readViaChild(entry)).outcome.snapshot, "obs-off-2", "o2"),
  }, { jobName: "offline-next" });
  assert.equal(next.ok, true, `post-recovery write failed: ${next.code} ${next.message}`);
});


// ---------- prelaunch-hardening: crash-safe writes ----------

// Every kill point a write passes through. `state` is what a reader must then see, and `temps` how many
// flushed temp files the dead writer left behind.
const CRASH_POINTS = [
  { phase: "before-graph", state: "old", temps: 0 },
  { phase: "temp-written:graph", state: "old", temps: 1 },
  { phase: "after-graph", state: "new-stale-bridge", temps: 0 },
  { phase: "temp-written:bridge", state: "new-stale-bridge", temps: 1 },
  { phase: "after-bridge", state: "new", temps: 0 },
] as const;

for (const { phase, state, temps: expectedTemps } of CRASH_POINTS) {
  test(`crash mid-write (${phase}): the scope reads as ${state === "old" ? "old" : "new"} (a stale bridge repairs), check passes, and the next write removes temp files`, async () => {
    const job = `crash-${phase.replace(":", "-")}`;
    const { entry } = await withPlan(job);
    const before = await readViaChild(entry);
    const { child, phase: reached } = await startPaused(
      { mode: "mutate", root: entry.root, scopeId: entry.id, request: observeRequest(entry, before.outcome.snapshot, `obs-${job}`, "c1"), pauseAt: phase },
      job,
    );
    assert.equal(reached, phase);
    await killAndJoin(child);
    // An offline operator removes the dead holder's lock, as docs/installation.md describes.
    rmSync(lockPath(entry.root), { recursive: true, force: true });

    const temps = readdirSync(entry.root).filter((n) => /^mozak\.(json|md)\.[0-9a-f-]{36}\.tmp$/.test(n));
    assert.equal(temps.length, expectedTemps, "flushed temp files left by the dead writer");
    // A temp file is complete: it was flushed before the crash point.
    if (phase === "temp-written:graph") assert.doesNotThrow(() => JSON.parse(readFileSync(join(entry.root, temps[0]!), "utf8")));

    // check right after the crash, before any repair: the only finding allowed is the repairable stale bridge,
    // and each leftover temp file is an info issue.
    const checked = await runChild({ mode: "check", root: entry.root, scopeId: entry.id }, { jobName: `${job}-check` });
    assert.equal(checked.ok, true, `check after crash: ${checked.code} ${checked.message}`);
    const codes = (checked.outcome.issues as Array<{ code: string }>).map((i) => i.code);
    const allowed = state === "new-stale-bridge" ? ["bridge-stale", "leftover-temp-file"] : ["leftover-temp-file"];
    assert.deepEqual(codes.filter((c) => !allowed.includes(c)), [], `check issues: ${JSON.stringify(checked.outcome.issues)}`);
    assert.equal(checked.outcome.status, state === "new-stale-bridge" ? "findings" : "ok");
    assert.equal(codes.filter((c) => c === "leftover-temp-file").length, expectedTemps, "check reports each leftover temp file");

    const after = await readViaChild(entry);
    assert.equal(after.ok, true, `scope must read after the crash: ${after.code} ${after.message}`);
    if (state === "old") {
      assert.deepEqual(after.outcome.observationIds, before.outcome.observationIds, "graph rename never happened: old state");
      assert.equal(after.outcome.projectionStatus, "current");
    } else {
      assert.ok(after.outcome.observationIds.includes("c1"), "graph committed: new state");
      if (state === "new") assert.equal(after.outcome.projectionStatus, "current");
      else {
        assert.equal(after.outcome.projectionStatus, "bridge-stale", "bridge rename never happened: repairable stale bridge");
        const repaired = await runChild({ mode: "repair", root: entry.root, scopeId: entry.id, request: { requestId: `${job}-repair`, scopeId: entry.id, expected: after.outcome.snapshot } }, { jobName: `${job}-repair` });
        assert.equal(repaired.ok, true, `repair after crash: ${repaired.code} ${repaired.message}`);
        const rechecked = await runChild({ mode: "check", root: entry.root, scopeId: entry.id }, { jobName: `${job}-recheck` });
        assert.equal(rechecked.outcome.status, "ok", `check after repair: ${JSON.stringify(rechecked.outcome.issues)}`);
        assert.equal(rechecked.outcome.exitCode, 0);
      }
    }

    // The next write takes the lock and removes leftover temp files before doing its work.
    const next = await runChild({
      mode: "mutate", root: entry.root, scopeId: entry.id,
      request: observeRequest(entry, (await readViaChild(entry)).outcome.snapshot, `obs-${job}-next`, "c2"),
    }, { jobName: `${job}-next` });
    assert.equal(next.ok, true, `write after crash: ${next.code} ${next.message}`);
    assert.deepEqual(readdirSync(entry.root).filter((n) => n.endsWith(".tmp")), [], "leftover temp files removed");
  });
}

// ---------- V-race (S1b read-set rebase). Synthetic scopes, real child processes. ----------

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function raceWorld(name: string, rebase: boolean, outcomes: string[], extraPlans: string[] = []): Promise<Scope> {
  const { entry } = await initialized(name);
  if (rebase) writeFileSync(join(entry.root, "mozak-settings.json"), JSON.stringify({ concurrency: { rebase: true } }));
  const setup = await runChild({ mode: "setup", root: entry.root, scopeId: entry.id, setup: { planId: "demo", outcomes, extraPlans } }, { jobName: "setup" });
  assert.equal(setup.ok, true, `setup failed: ${setup.code} ${setup.message}`);
  return entry;
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

test("V-race 1: A0 replay, 3 agents on 3 outcomes of one plan: under 5% wasted attempts with rebase on, 0 lost writes either way", async () => {
  const perAgent = Number(process.env.MOZAK_VRACE_A0_COUNT ?? 10);
  const summary: Record<string, { commits: number; attempts: number; wasted: number; lost: number; rebased: number; p95: number }> = {};
  for (const rebase of [false, true]) {
    const entry = await raceWorld(`a0-${rebase ? "on" : "off"}`, rebase, ["o1", "o2", "o3"]);
    const tags = ["ra", "rb", "rc"];
    const results = await Promise.all(tags.map((tag, k) => runChild({
      mode: "race", root: entry.root, scopeId: entry.id, lockTimeoutMs: 5000,
      race: { planId: "demo", outcomeId: `o${k + 1}`, tag, count: perAgent, attempts: 500, thinkMinMs: 20, thinkMaxMs: 50, seed: 11 + k },
    }, { jobName: `race-${tag}` })));
    let commits = 0, attempts = 0, rebased = 0;
    const latencies: number[] = [];
    for (const r of results) {
      assert.equal(r.ok, true, `agent failed: ${r.code} ${r.message}`);
      console.log(`V-race 1 flag ${rebase ? "on" : "off"} agent: stale ${r.outcome.stale}, busy ${r.outcome.busy}, refusals ${JSON.stringify(r.outcome.refusals)}`);
      assert.deepEqual(r.outcome.failed, []);
      commits += r.outcome.commits; attempts += r.outcome.attempts; rebased += r.outcome.rebased; latencies.push(...r.outcome.latencies);
    }
    const read = await readViaChild(entry);
    const present = new Set(read.outcome.observationIds);
    const expected = tags.flatMap((tag) => Array.from({ length: perAgent }, (_, i) => `${tag}-${i}`));
    const lost = expected.filter((id) => !present.has(id)).length;
    summary[rebase ? "on" : "off"] = { commits, attempts, wasted: attempts - commits, lost, rebased, p95: percentile(latencies, 95) };
    assert.equal(commits, tags.length * perAgent);
    assert.equal(lost, 0, "no committed observation is lost");
    assert.equal(read.outcome.projectionStatus, "current");
  }
  const fmt = (k: string) => { const s = summary[k]!; return `flag ${k}: ${s.wasted} of ${s.attempts} attempts wasted (${((100 * s.wasted) / s.attempts).toFixed(1)}%), commits ${s.commits}, rebased ${s.rebased}, lost ${s.lost}, commit p95 ${s.p95} ms`; };
  console.log(`V-race 1 (3 agents x ${perAgent}, think 20-50 ms): ${fmt("off")}; ${fmt("on")}`);
  assert.ok(summary.on!.wasted / summary.on!.attempts < 0.05, "rebase keeps wasted attempts under 5%");
});

test("V-race 9: 8 writers with kill -9 and rebase on: commit p95 under 300 ms and 0 violations", async () => {
  const target = Number(process.env.MOZAK_VRACE_KILL_OPS ?? 60);
  // Agents think between writes; real LLM turns are 5-60 s. One commit costs about 45 ms here (six fsyncs), so
  // 8 writers with no think time queue on the lock for more than 300 ms by arithmetic alone.
  const [THINK_MIN, THINK_MAX] = (process.env.MOZAK_VRACE_THINK ?? "1000-2000").split("-").map(Number) as [number, number];
  const writers = 8;
  const entry = await raceWorld("kill9", true, Array.from({ length: writers }, (_, k) => `o${k + 1}`), Array.from({ length: writers }, (_, k) => `d${k + 1}`));
  const jobs = scratchJobs(entry.root);
  let attempts = 0, commits = 0, stale = 0, busy = 0, rebasedTotal = 0, kills = 0, holderKills = 0, locksLeft = 0, renders = 0, round = 0;
  const violations: string[] = [];
  const latencies: number[] = [];
  let seed = 100;
  while (attempts < target) {
    round++;
    const ackFiles = Array.from({ length: writers }, (_, k) => join(jobs, `ack-r${round}-w${k + 1}.tsv`));
    for (const f of ackFiles) writeFileSync(f, "");
    const running = Array.from({ length: writers }, (_, k) => {
      const job = { mode: "race", root: entry.root, scopeId: entry.id, lockTimeoutMs: 2000, race: {
        planId: "demo", outcomeId: `o${k + 1}`, tag: `r${round}w${k + 1}`, count: 100000, attempts: 50, thinkMinMs: THINK_MIN, thinkMaxMs: THINK_MAX, seed: seed++,
        ackFile: ackFiles[k], deadlineMs: 4000, discussionPlanId: `d${k + 1}`, discussionRate: 0.15, proposeRate: 0.1, supersedeRate: 0.2,
      } };
      const path = jobFile(entry.root, `kill-r${round}-w${k + 1}`, job);
      const child = spawn(process.execPath, ["--experimental-strip-types", childPath, path], { stdio: ["ignore", "pipe", "pipe", "ipc"] });
      liveChildren.add(child);
      let stdout = "";
      child.stdout!.on("data", (d) => (stdout += d));
      const done = new Promise<ChildResult>((res) => child.once("exit", (code, signal) => {
        liveChildren.delete(child);
        if (signal) return res({ ok: false, code: `signal-${signal}`, exitCode: -1 });
        try { res({ ...JSON.parse(stdout.trim().split("\n").pop()!), exitCode: code ?? -1 }); } catch { res({ ok: false, code: "no-output", exitCode: code ?? -1 }); }
      }));
      return { child, done };
    });
    await pause(400 + Math.floor(Math.random() * 1600));
    // Odd rounds kill whichever writer holds the scope lock (mid-write crash), even rounds a random writer.
    let victim = running[Math.floor(Math.random() * writers)]!;
    if (round % 2 === 1) {
      const until = Date.now() + 3000;
      let holder: (typeof running)[number] | undefined;
      while (!holder && Date.now() < until) {
        try { const pid = JSON.parse(readFileSync(join(lockPath(entry.root), "owner.json"), "utf8")).pid; holder = running.find((r) => r.child.pid === pid); } catch { /* no holder yet */ }
        if (!holder) await pause(1);
      }
      if (holder) { victim = holder; holderKills++; }
    }
    victim.child.kill("SIGKILL"); kills++;
    const results = await Promise.all(running.map((r) => r.done));
    // Offline recovery, only after every writer of this round has been joined.
    if (existsSync(lockPath(entry.root))) { rmSync(lockPath(entry.root), { recursive: true, force: true }); locksLeft++; }
    for (const r of results) {
      if (r.code === "signal-SIGKILL") continue;
      if (!r.ok) { violations.push(`round ${round}: writer error ${r.code} ${r.message}`); continue; }
      if (r.outcome.failed.length) violations.push(`round ${round}: ${r.outcome.failed.join(",")}`);
      attempts += r.outcome.attempts; commits += r.outcome.commits; stale += r.outcome.stale; busy += r.outcome.busy; rebasedTotal += r.outcome.rebased;
      latencies.push(...r.outcome.latencies);
    }
    let read = await readViaChild(entry);
    if (read.outcome.projectionStatus !== "current") {
      const rendered = await runChild({ mode: "render", root: entry.root, scopeId: entry.id }, { jobName: "render" });
      if (!rendered.ok || rendered.outcome.result !== "rendered") violations.push(`round ${round}: render ${rendered.code ?? rendered.outcome?.result}`);
      renders++;
      read = await readViaChild(entry);
    }
    if (read.outcome.projectionStatus !== "current") violations.push(`round ${round}: projection ${read.outcome.projectionStatus}`);
    const observations = new Set(read.outcome.observationIds);
    const plans = new Set((read.outcome as any).planIds as string[]);
    const receipts = new Set((read.outcome as any).receiptOperationIds as string[]);
    const discussions = (read.outcome as any).discussions as Record<string, string>;
    for (const [k, file] of ackFiles.entries()) {
      const acks = readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => line.split("\t") as [string, string, string]);
      for (const [opId, kind, id] of acks) {
        if (!receipts.has(opId)) violations.push(`round ${round}: acked ${opId} has no receipt`);
        if (kind === "observe" && !observations.has(id)) violations.push(`round ${round}: acked observation ${id} lost`);
        if (kind === "propose" && !plans.has(id)) violations.push(`round ${round}: acked plan ${id} lost`);
      }
      const lastDiscussion = acks.filter((a) => a[1] === "save-discussion").pop();
      if (lastDiscussion) {
        const current = discussions[`d${k + 1}`] ?? "";
        const index = (s: string) => Number(s.split("-").pop());
        if (!current.startsWith(`summary r${round}w${k + 1}-`) || index(current) < index(lastDiscussion[0])) violations.push(`round ${round}: discussion d${k + 1} lost ${lastDiscussion[0]} (now ${current})`);
      }
    }
    const checked = await runChild({ mode: "check", root: entry.root, scopeId: entry.id }, { jobName: "kill-check" });
    if (!checked.ok || checked.outcome.status !== "ok") violations.push(`round ${round}: check ${checked.code ?? checked.outcome.status} ${JSON.stringify(checked.outcome?.issues ?? [])}`);
  }
  const p95 = percentile(latencies, 95);
  console.log(`V-race 9 (8 writers, think ${THINK_MIN}-${THINK_MAX} ms, rebase on): rounds ${round}, kill -9 ${kills} (${holderKills} while holding the lock), write attempts ${attempts} by joined writers, commits ${commits}, stale ${stale}, busy ${busy}, rebased ${rebasedTotal}, locks left by killed writers ${locksLeft}, renders ${renders}, commit p50 ${percentile(latencies, 50)} ms, p95 ${p95} ms, max ${percentile(latencies, 100)} ms, violations ${violations.length}`);
  assert.deepEqual(violations, []);
  assert.ok(p95 < 300, `commit p95 ${p95} ms`);
});
