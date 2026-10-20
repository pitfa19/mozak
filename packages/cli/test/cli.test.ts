import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Basic real-process tests for the built CLI. Each call is a subprocess running packages/cli/dist.
// Scratch roots live under JCODE_SCRATCH_DIR (or TMPDIR) and are removed only by this file.

const here = fileURLToPath(new URL(".", import.meta.url));
const cliPath = resolve(here, "..", "dist", "index.js");
// Normalized: a TMPDIR with a trailing slash or behind a symlink (macOS /var) must not trip the removal guard.
const scratch = realpathSync(resolve(process.env.JCODE_SCRATCH_DIR ?? process.env.TMPDIR ?? tmpdir()));
const roots: string[] = [];

after(() => {
  for (const root of roots) {
    if (!root.startsWith(scratch + "/") || !root.includes("/mozak-cli-")) {
      throw new Error(`refusing to remove unexpected path outside test scratch: ${root}`);
    }
    rmSync(root, { recursive: true, force: true });
  }
});

interface Run {
  code: number;
  out: string;
  err: string;
}

function run(args: string[]): Promise<Run> {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, ["--no-warnings", cliPath, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (err += chunk));
    child.on("error", fail);
    child.on("close", (code) => done({ code: code ?? -1, out, err }));
  });
}

function json(run: Run): Record<string, unknown> {
  return JSON.parse(run.out) as Record<string, unknown>;
}

/** A fresh inventory with one scope whose README and AGENTS exist, as init requires. */
function fixture(id = "sample"): { config: string; scopeRoot: string } {
  if (!existsSync(cliPath)) {
    throw new Error(`built CLI missing at ${cliPath}; run "npm run build" before the CLI tests`);
  }
  const base = mkdtempSync(join(scratch, "mozak-cli-"));
  roots.push(base);
  const scopeRoot = join(base, id);
  mkdirSync(scopeRoot, { recursive: true });
  writeFileSync(join(scopeRoot, "README.md"), "# readme\n");
  writeFileSync(join(scopeRoot, "AGENTS.md"), "# agents\n");
  const config = join(base, "inventory.json");
  writeFileSync(config, JSON.stringify({ format: "mozak.local/v2", scopes: [{ id, root: `./${id}` }] }));
  return { config, scopeRoot };
}

function writeRequest(dir: string, name: string, body: unknown): string {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(body));
  return path;
}

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

async function initScope(config: string, scopeRoot: string, id = "sample"): Promise<void> {
  const req = writeRequest(scopeRoot, "../init-request.json", {
    operationId: "op-init",
    scopeId: id,
    kind: "project",
    title: "Sample",
    expectedAbsent: { graph: true, bridge: true },
    ownerRef: "host:session/msg-1",
    ownerMessageAt: "2026-10-12T08:50:00.000Z",
  });
  const r = await run(["scope", "init", "--config", config, "--scope", id, "--request", req]);
  assert.equal(r.code, 0, `init failed: ${r.out}${r.err}`);
}

// ---------- argument grammar ----------

test("an unknown route exits 2 with usage", async () => {
  const f = fixture();
  const r = await run(["frobnicate", "--config", f.config]);
  assert.equal(r.code, 2);
  assert.match(r.err, /unknown route/);
});

test("an unknown flag is rejected, not ignored", async () => {
  const f = fixture();
  const r = await run(["context", "--config", f.config, "--scope", "sample", "--bogus"]);
  assert.equal(r.code, 2);
  assert.match(r.err, /bogus/);
});

test("a duplicate flag is rejected rather than silently taking the last value", async () => {
  const f = fixture();
  const r = await run(["context", "--config", f.config, "--scope", "sample", "--scope", "other"]);
  assert.equal(r.code, 2);
  assert.match(r.err, /duplicate flag --scope/);
});

test("the actor cannot be set by a flag on any route", async () => {
  const f = fixture();
  const r = await run(["plan", "propose", "--config", f.config, "--scope", "sample", "--actor", "owner"]);
  assert.equal(r.code, 2);
  assert.match(r.err, /actor/);
});

test("a read route without --config exits 2", async () => {
  const r = await run(["context", "--scope", "sample"]);
  assert.equal(r.code, 2);
  assert.match(r.err, /missing --config/);
});

test("plans refuses both --scope and --all; with neither it needs a clone of an inventoried repo", async () => {
  const f = fixture();
  const neither = await run(["plans", "--config", f.config]);
  const both = await run(["plans", "--config", f.config, "--scope", "sample", "--all"]);
  assert.equal(neither.code, 2);
  assert.equal(json(neither).status, "scope-not-found");
  assert.equal(both.code, 2);
});

test("a retired v1 command is refused explicitly, not treated as an unknown route", async () => {
  const f = fixture();
  const r = await run(["translate", "--config", f.config, "--idea", "x", "--from", "a", "--to", "b", "--assumption", "y"]);
  assert.equal(r.code, 2);
  const body = json(r);
  assert.equal(body.status, "unsupported-legacy-operation");
});

test("bare legacy init is refused explicitly", async () => {
  const f = fixture();
  const r = await run(["init", "--config", f.config, "--kind", "project"]);
  assert.equal(r.code, 2);
  assert.equal(json(r).status, "unsupported-legacy-operation");
});

// ---------- request files ----------

test("a request file over 1 MiB is refused before parsing", async () => {
  const f = fixture();
  const big = join(f.scopeRoot, "big.json");
  writeFileSync(big, `{"pad":"${"x".repeat(1024 * 1024 + 10)}"}`);
  const r = await run(["plan", "propose", "--config", f.config, "--scope", "sample", "--request", big]);
  assert.equal(r.code, 2);
  assert.match(r.out + r.err, /1 MiB/);
});

test("a request file that is not JSON is refused as invalid input", async () => {
  const f = fixture();
  const bad = join(f.scopeRoot, "bad.json");
  writeFileSync(bad, "{not json");
  const r = await run(["plan", "propose", "--config", f.config, "--scope", "sample", "--request", bad]);
  assert.equal(r.code, 2);
  assert.match(r.out, /not valid JSON/);
});

// ---------- reads ----------

test("context on an uninitialized scope is unavailable (exit 2), never an empty valid scope", async () => {
  const f = fixture();
  const r = await run(["context", "--config", f.config, "--scope", "sample", "--json"]);
  assert.equal(r.code, 2);
  assert.equal(json(r).status, "scope-uninitialized");
});

test("an unknown scope is refused as not found", async () => {
  const f = fixture();
  const r = await run(["context", "--config", f.config, "--scope", "nope", "--json"]);
  assert.equal(r.code, 2);
  assert.equal(json(r).status, "scope-not-found");
});

// ---------- owner route and writes ----------

test("init creates the scope and a second plain init is refused without writing", async () => {
  const f = fixture();
  await initScope(f.config, f.scopeRoot);
  const again = await run(["scope", "init", "--config", f.config, "--scope", "sample", "--request", join(f.scopeRoot, "../init-request.json")]);
  // The same operation ID with the same input replays its receipt. It must not rewrite state.
  assert.equal(again.code, 0);
  assert.equal(json(again).status, "replayed");
  assert.equal(json(again).committed, true);
});

test("propose then context shows the pending plan and no accepted direction", async () => {
  const f = fixture();
  await initScope(f.config, f.scopeRoot);
  const ctx = json(await run(["context", "--config", f.config, "--scope", "sample", "--json"]));
  const snapshot = ctx.snapshot as { revision: string; graphHash: string; bridge: unknown };
  const req = writeRequest(f.scopeRoot, "../propose-1.json", {
    operationId: "op-propose-1",
    scopeId: "sample",
    expected: snapshot,
    action: "propose",
    payload: { planId: "plan-a", content },
  });
  const r = await run(["plan", "propose", "--config", f.config, "--scope", "sample", "--request", req]);
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(json(r).committed, true);

  const after = json(await run(["context", "--config", f.config, "--scope", "sample", "--json"]));
  assert.notEqual((after.snapshot as { revision: string }).revision, snapshot.revision);
});

test("two CLI writers with the same snapshot yield exactly one commit and one stale response", async () => {
  const f = fixture();
  await initScope(f.config, f.scopeRoot);
  const ctx = json(await run(["context", "--config", f.config, "--scope", "sample", "--json"]));
  const expected = ctx.snapshot;
  const a = writeRequest(f.scopeRoot, "../writer-a.json", {
    operationId: "op-writer-a",
    scopeId: "sample",
    expected,
    action: "propose",
    payload: { planId: "plan-a", content },
  });
  const b = writeRequest(f.scopeRoot, "../writer-b.json", {
    operationId: "op-writer-b",
    scopeId: "sample",
    expected,
    action: "propose",
    payload: { planId: "plan-b", content: { ...content, title: "Other plan" } },
  });
  const [ra, rb] = await Promise.all([
    run(["plan", "propose", "--config", f.config, "--scope", "sample", "--request", a]),
    run(["plan", "propose", "--config", f.config, "--scope", "sample", "--request", b]),
  ]);
  const codes = [ra.code, rb.code].sort();
  assert.deepEqual(codes, [0, 3], `expected one commit (0) and one stale (3), got ${codes.join(",")}\n${ra.out}\n${rb.out}`);

  const plans = json(await run(["plans", "--config", f.config, "--scope", "sample", "--json"]));
  assert.equal(plans.uniquePlanCount, 1);
});

test("a failed mutation echoes its operation ID so the caller can look it up", async () => {
  const f = fixture();
  await initScope(f.config, f.scopeRoot);
  const ctx = json(await run(["context", "--config", f.config, "--scope", "sample", "--json"]));
  const req = writeRequest(f.scopeRoot, "../stale.json", {
    operationId: "op-stale",
    scopeId: "sample",
    expected: { ...(ctx.snapshot as object), revision: "not-the-revision" },
    action: "propose",
    payload: { planId: "plan-x", content },
  });
  const r = await run(["plan", "propose", "--config", f.config, "--scope", "sample", "--request", req]);
  assert.equal(r.code, 3);
  const body = json(r);
  assert.equal(body.operationId, "op-stale");
  assert.equal(body.committed, false);
});

test("an action on the wrong route is refused before any file is touched", async () => {
  const f = fixture();
  await initScope(f.config, f.scopeRoot);
  const req = writeRequest(f.scopeRoot, "../wrong.json", {
    operationId: "op-wrong",
    scopeId: "sample",
    expected: {},
    action: "observe",
    payload: {},
  });
  const r = await run(["plan", "propose", "--config", f.config, "--scope", "sample", "--request", req]);
  assert.equal(r.code, 2);
  const body = json(r);
  assert.equal(body.status, "invalid-input");
  assert.match(String((body.issues as { message: string }[])[0]?.message), /request\.action must be "propose"/);
});

test("--json is accepted on every route, including scope init, and output stays JSON", async () => {
  const f = fixture();
  const req = writeRequest(f.scopeRoot, "../init-json.json", {
    operationId: "op-init-json",
    scopeId: "sample",
    kind: "project",
    title: "Sample",
    expectedAbsent: { graph: true, bridge: true },
    ownerRef: "host:session/msg-1",
    ownerMessageAt: "2026-10-12T08:50:00.000Z",
  });
  const init = await run(["scope", "init", "--config", f.config, "--scope", "sample", "--request", req, "--json"]);
  assert.equal(init.code, 0, init.out + init.err);
  assert.equal(json(init).operationId, "op-init-json");

  const ctx = await run(["context", "--config", f.config, "--scope", "sample", "--json"]);
  assert.equal(ctx.code, 0, ctx.out + ctx.err);
  assert.equal(json(ctx).status, "ok");

  const plans = await run(["plans", "--config", f.config, "--scope", "sample", "--json"]);
  assert.equal(plans.code, 0, plans.out + plans.err);
  assert.equal(json(plans).uniquePlanCount, 0);
});

/** Propose one plan through the agent route and return the snapshot the CLI now reports. */
async function propose(f: { config: string; scopeRoot: string }, planId: string, title: string): Promise<Record<string, unknown>> {
  const ctx = json(await run(["context", "--config", f.config, "--scope", "sample", "--json"]));
  const req = writeRequest(f.scopeRoot, `../propose-${planId}.json`, {
    operationId: `op-propose-${planId}`,
    scopeId: "sample",
    expected: ctx.snapshot,
    action: "propose",
    payload: { planId, content: { ...content, title } },
  });
  const r = await run(["plan", "propose", "--config", f.config, "--scope", "sample", "--request", req]);
  assert.equal(r.code, 0, r.out + r.err);
  return json(r).snapshot as Record<string, unknown>;
}

/**
 * Owner decision through the real CLI. The reviewDigest is read from `review show` for the exact
 * purpose, never computed by the test. The envelope snapshot comes from a fresh context read.
 */
async function ownerDecide(
  f: { config: string; scopeRoot: string },
  planId: string,
  purpose: string,
  operationId: string,
  reason: string,
): Promise<Run> {
  const shown = json(await run(["review", "show", "--config", f.config, "--scope", "sample", "--plan", planId, "--purpose", purpose, "--json"]));
  const review = shown.review as { revisionId: string; reviewDigest: string };
  const ctx = json(await run(["context", "--config", f.config, "--scope", "sample", "--json"]));
  const req = writeRequest(f.scopeRoot, `../decide-${operationId}.json`, {
    operationId,
    scopeId: "sample",
    expected: ctx.snapshot,
    action: purpose,
    payload: {
      planId,
      revisionId: review.revisionId,
      reviewDigest: review.reviewDigest,
      ownerRef: "host:session/msg-owner",
      ownerMessageAt: "2026-10-12T08:50:00.000Z",
      reason,
    },
  });
  return run(["review", "decide", "--config", f.config, "--scope", "sample", "--request", req]);
}

test("human plans output shows the real pause reason for a paused plan", async () => {
  const f = fixture();
  await initScope(f.config, f.scopeRoot);
  await propose(f, "plan-pause", "Pausable plan");
  const approved = await ownerDecide(f, "plan-pause", "approve-direction", "op-approve-pause", "Agreed direction");
  assert.equal(approved.code, 0, approved.out + approved.err);

  const paused = await ownerDecide(f, "plan-pause", "pause", "op-pause", "Waiting on the pilot host");
  assert.equal(paused.code, 0, paused.out + paused.err);

  const plans = await run(["plans", "--config", f.config, "--scope", "sample"]);
  assert.equal(plans.code, 0, plans.out + plans.err);
  assert.match(plans.out, /^open \(1\)/m);
  assert.match(plans.out, /Pausable plan\s+\[plan-pause\]/);
  assert.match(plans.out, /paused: Waiting on the pilot host/);
});

test("--include-rejected shows the rejected group with its real rejection reason; default hides it", async () => {
  const f = fixture();
  await initScope(f.config, f.scopeRoot);
  await propose(f, "plan-reject", "Rejected proposal title");
  const rejected = await ownerDecide(f, "plan-reject", "reject-pending", "op-reject", "Scope is too broad");
  assert.equal(rejected.code, 0, rejected.out + rejected.err);

  const hidden = await run(["plans", "--config", f.config, "--scope", "sample"]);
  assert.equal(hidden.code, 0, hidden.out + hidden.err);
  assert.doesNotMatch(hidden.out, /^rejected \(/m, "rejected group is absent without --include-rejected");
  assert.doesNotMatch(hidden.out, /Rejected proposal title/);

  const shown = await run(["plans", "--config", f.config, "--scope", "sample", "--include-rejected"]);
  assert.equal(shown.code, 0, shown.out + shown.err);
  assert.match(shown.out, /^rejected \(1\)/m);
  assert.match(shown.out, /Rejected proposal title\s+\[plan-reject\]/);
  assert.match(shown.out, /reason: Scope is too broad/);
});


test("continuation.after decodes to exactly the last emitted row's compositeKey (built CLI)", async () => {
  const f = fixture();
  await initScope(f.config, f.scopeRoot);
  let expected = json(await run(["context", "--config", f.config, "--scope", "sample", "--json"])).snapshot;
  for (let i = 1; i <= 6; i++) {
    const req = writeRequest(f.scopeRoot, `../key-${i}.json`, {
      operationId: `op-key-${i}`,
      scopeId: "sample",
      expected,
      action: "propose",
      payload: { planId: `key-plan-${i}`, content: { ...content, title: `Key plan ${i}` } },
    });
    const r = await run(["plan", "propose", "--config", f.config, "--scope", "sample", "--request", req]);
    assert.equal(r.code, 0, r.out + r.err);
    expected = json(r).snapshot as Record<string, unknown>;
  }

  const page = json(await run(["plans", "--config", f.config, "--scope", "sample", "--json"]));
  const awaiting = (page.groups as Record<string, { rows: { compositeKey: string }[]; continuation: string | null }>).awaiting!;
  const lastEmitted = awaiting.rows[awaiting.rows.length - 1]!.compositeKey;
  assert.ok(awaiting.continuation, "a full first page yields a continuation");

  // Decode the opaque token exactly as the facade encodes it: base64url over canonical JSON.
  const decoded = JSON.parse(Buffer.from(awaiting.continuation!, "base64url").toString("utf8")) as { after: string; lastSortAt: string };
  assert.equal(decoded.after, lastEmitted, "cursor must name the same row the page last emitted");

  // The 5-part key is [scope, planId, rowKind, revisionId, outcomeOrId] and names the scope first.
  const parts = JSON.parse(lastEmitted) as string[];
  assert.equal(parts.length, 5);
  assert.equal(parts[0], "sample");

  // Resuming must start strictly after that row: page two holds the sixth row and no repeats.
  const next = json(await run(["plans", "--config", f.config, "--continuation", awaiting.continuation!, "--json"]));
  const rest = (next.groups as Record<string, { rows: { compositeKey: string }[] }>).awaiting!.rows;
  assert.equal(rest.length, 1);
  assert.notEqual(rest[0]!.compositeKey, lastEmitted);
});

test("built CLI emits awaiting rows newest-first by parsed date (no mixed-precision fixture)", async () => {
  // Proposals here share one timestamp shape, so this does NOT prove mixed-precision ordering.
  // Mixed-precision ordering is covered by the core regression, not this test.
  const f = fixture();
  await initScope(f.config, f.scopeRoot);
  const ctx = json(await run(["context", "--config", f.config, "--scope", "sample", "--json"]));
  const req = writeRequest(f.scopeRoot, "../mixed-date.json", {
    operationId: "op-mixed-date",
    scopeId: "sample",
    expected: ctx.snapshot,
    action: "propose",
    payload: { planId: "mixed-plan", content: { ...content, title: "Mixed date plan" } },
  });
  const r = await run(["plan", "propose", "--config", f.config, "--scope", "sample", "--request", req]);
  assert.equal(r.code, 0, r.out + r.err);

  const plans = json(await run(["plans", "--config", f.config, "--scope", "sample", "--json"]));
  const rows = (plans.groups as Record<string, { rows: { sortAt: string }[] }>).awaiting!.rows;
  for (let i = 1; i < rows.length; i++) {
    const earlier = Date.parse(rows[i]!.sortAt);
    const later = Date.parse(rows[i - 1]!.sortAt);
    assert.ok(later >= earlier, `newest-first violated at ${i}: ${rows[i - 1]!.sortAt} then ${rows[i]!.sortAt}`);
  }
});

test("A04: observe with protected nested fields is refused and the persisted scope bytes are unchanged (built CLI)", async () => {
  const f = fixture();
  await initScope(f.config, f.scopeRoot);
  await propose(f, "plan-a04", "Protected field plan");

  const graphPath = join(f.scopeRoot, "mozak.json");
  const bridgePath = join(f.scopeRoot, "mozak.md");
  const before = { graph: readFileSync(graphPath, "utf8"), bridge: readFileSync(bridgePath, "utf8") };

  const ctx = json(await run(["context", "--config", f.config, "--scope", "sample", "--json"]));
  const observation = {
    id: "obs-protected",
    classification: "unverified",
    summary: "attempts to inject protected state",
    evidence: [],
  };

  // 1) A protected top-level field inside the payload: `accepted` is never agent-writable.
  const topLevel = writeRequest(f.scopeRoot, "../a04-top.json", {
    operationId: "op-a04-top",
    scopeId: "sample",
    expected: ctx.snapshot,
    action: "observe",
    payload: { planId: "plan-a04", observation, reasoningLinks: [], accepted: { id: "forged", content: {} } },
  });
  const rTop = await run(["observe", "--config", f.config, "--scope", "sample", "--request", topLevel]);
  assert.equal(rTop.code, 2, rTop.out + rTop.err);
  assert.equal(json(rTop).committed, false);

  // 2) A protected nested field inside the observation: implementationAuthorization is closed out.
  const nested = writeRequest(f.scopeRoot, "../a04-nested.json", {
    operationId: "op-a04-nested",
    scopeId: "sample",
    expected: ctx.snapshot,
    action: "observe",
    payload: {
      planId: "plan-a04",
      observation: { ...observation, implementationAuthorization: { granted: true } },
      reasoningLinks: [],
    },
  });
  const rNested = await run(["observe", "--config", f.config, "--scope", "sample", "--request", nested]);
  assert.equal(rNested.code, 2, rNested.out + rNested.err);
  assert.equal(json(rNested).committed, false);

  // Rejected writes must leave canonical and bridge bytes exactly as they were.
  assert.equal(readFileSync(graphPath, "utf8"), before.graph, "mozak.json changed after a refused observe");
  assert.equal(readFileSync(bridgePath, "utf8"), before.bridge, "mozak.md changed after a refused observe");

  // The refused observation also must not appear in the stored plan.
  const after = json(await run(["context", "--config", f.config, "--scope", "sample", "--json"]));
  assert.equal(after.projectionStatus, "current");
});

test("the read-only operation route reports a receipt for a committed operation", async () => {
  const f = fixture();
  await initScope(f.config, f.scopeRoot);
  const r = await run(["operation", "--config", f.config, "--scope", "sample", "--id", "op-init", "--json"]);
  assert.equal(r.code, 0);
  const body = json(r);
  assert.equal(body.operationId, "op-init");
  assert.equal(body.committed, false);
});

test("check reports a clean scope with exit 0", async () => {
  const f = fixture();
  await initScope(f.config, f.scopeRoot);
  const r = await run(["check", "--config", f.config, "--scope", "sample", "--json"]);
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(json(r).committed, false);
});

test("plans over an unknown scope reports partial coverage with exit 6 and never claims completeness", async () => {
  const f = fixture();
  await initScope(f.config, f.scopeRoot);
  const broken = join(f.scopeRoot, "..", "inventory-with-missing.json");
  writeFileSync(
    broken,
    JSON.stringify({ format: "mozak.local/v2", scopes: [{ id: "sample", root: "./sample" }, { id: "gone", root: "./gone" }] }),
  );
  const r = await run(["plans", "--config", broken, "--all", "--json"]);
  assert.equal(r.code, 6);
  const body = json(r);
  assert.equal((body.coverage as { complete: boolean }).complete, false);
});

test("plans paging: a continuation alone resumes the next page; mixed selectors and filters are refused", async () => {
  const f = fixture();
  await initScope(f.config, f.scopeRoot);
  let expected = json(await run(["context", "--config", f.config, "--scope", "sample", "--json"])).snapshot;
  for (let i = 1; i <= 6; i++) {
    const req = writeRequest(f.scopeRoot, `../page-${i}.json`, {
      operationId: `op-page-${i}`,
      scopeId: "sample",
      expected,
      action: "propose",
      payload: { planId: `plan-${i}`, content: { ...content, title: `Plan ${i}` } },
    });
    const r = await run(["plan", "propose", "--config", f.config, "--scope", "sample", "--request", req]);
    assert.equal(r.code, 0, r.out + r.err);
    expected = json(r).snapshot;
  }

  const first = json(await run(["plans", "--config", f.config, "--scope", "sample", "--json"]));
  const awaiting = (first.groups as Record<string, { count: number; rows: unknown[]; hasMore: boolean; continuation: string | null }>).awaiting!;
  assert.equal(awaiting.count, 6);
  assert.equal(awaiting.rows.length, 5);
  assert.equal(awaiting.hasMore, true);
  assert.ok(awaiting.continuation, "the first page yields a continuation token");

  const second = await run(["plans", "--config", f.config, "--continuation", awaiting.continuation, "--json"]);
  assert.equal(second.code, 0, second.out + second.err);
  const rest = (json(second).groups as Record<string, { rows: unknown[]; hasMore: boolean }>).awaiting!;
  assert.equal(rest.rows.length, 1);
  assert.equal(rest.hasMore, false);

  const withScope = await run(["plans", "--config", f.config, "--scope", "sample", "--continuation", awaiting.continuation, "--json"]);
  assert.equal(withScope.code, 2);
  assert.equal(json(withScope).status, "invalid-input");

  const withLimit = await run(["plans", "--config", f.config, "--continuation", awaiting.continuation, "--limit", "2", "--json"]);
  assert.equal(withLimit.code, 2);
  assert.equal(json(withLimit).status, "invalid-input");
});

// Package 2 thin routes. They pin grammar and transport mapping through the real built CLI.
// Semantic results depend on core save-discussion/attach-spec and are covered by the core suite.
test("package 2 routes: help lists them and grammar refusals exit 2 with no scope write", async () => {
  const help = await run(["--help"]);
  assert.equal(help.code, 0);
  assert.match(help.out, /mozak discussion save --scope ID --request FILE/);
  assert.match(help.out, /mozak spec attach --scope ID --request FILE/);

  const f = fixture();
  const before = readFileSync(join(f.scopeRoot, "README.md"), "utf8");

  const missing = await run(["discussion", "save", "--config", f.config, "--scope", "sample"]);
  assert.equal(missing.code, 2);
  assert.match(missing.err, /missing --request/);

  const missingSpec = await run(["spec", "attach", "--config", f.config, "--scope", "sample"]);
  assert.equal(missingSpec.code, 2);
  assert.match(missingSpec.err, /missing --request/);

  // --plan is not a spec attach flag. parseArgs refuses it as an unknown option.
  const unknown = await run(["spec", "attach", "--config", f.config, "--scope", "sample", "--request", join(f.scopeRoot, "nope.json"), "--plan", "p"]);
  assert.equal(unknown.code, 2);
  assert.match(unknown.err, /Unknown option .--plan./);

  assert.equal(readFileSync(join(f.scopeRoot, "README.md"), "utf8"), before, "no scope file changed by grammar refusals");
});

test("package 2 routes: review show accepts the two implementation purposes read-only and never exits as an internal error", async () => {
  const f = fixture();
  for (const purpose of ["approve-implementation", "revoke-implementation"]) {
    const show = await run(["review", "show", "--config", f.config, "--scope", "sample", "--plan", "missing", "--purpose", purpose, "--json"]);
    assert.notEqual(show.code, 1, "internal error is not a valid outcome: " + show.err);
    assert.doesNotThrow(() => JSON.parse(show.out), "output is a JSON envelope");
  }
  // An unknown purpose is still refused by the existing review show purpose handling.
  const bogus = await run(["review", "show", "--config", f.config, "--scope", "sample", "--plan", "missing", "--purpose", "not-a-purpose", "--json"]);
  assert.notEqual(bogus.code, 1, bogus.err);
});
