import { createHash, randomUUID } from "node:crypto";
import { accessSync, constants, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DomainError } from "./errors.ts";
import { canonical, digest, hashBytes, validateScope, SCOPE_FORMAT, MAX_REQUEST_BYTES, MAX_SCOPE_BYTES, type FileToken, type ScopeState, type Receipt, type Specification } from "./understanding.ts";
import { applyMutation, validateMutation, specificationKey, type MutationAction, type ReviewEnvironment } from "./review.ts";
import { assertScopeFiles, type ScopeEntry } from "./scope-index.ts";
import { isGraphPath, scopeFile, scopeFileName, GRAPH_FILE, BRIDGE_FILE, LEGACY_GRAPH_FILE, LEGACY_BRIDGE_FILE } from "./scope-files.ts";
import { inspectSpecification } from "./spec-file.ts";
import { renderBridge, renderBridgeLegacy } from "./bridge.ts";
import { removeLeftoverTempFiles, replaceFileDurable, writeFileDurable, fsyncDir } from "./durable.ts";
import { ensureStorageIgnored, storageIgnoreIssues } from "./storage-hygiene.ts";
import { ANNOTATIONS_FILE, annotationsBytes, applyAnnotate, emptyAnnotations, readAnnotations, validateAnnotateRequest, type ScopeLookup } from "./annotations.ts";

export { renderBridge, renderBridgeLegacy } from "./bridge.ts";

export interface ScopeSnapshot { revision: string; graphHash: string; bridge: FileToken | null }
export type ProjectionStatus = "current" | "bridge-stale" | "bridge-conflict";
export interface ScopeIssue { code: string; message: string }
export interface ScopeRead { state: ScopeState; snapshot: ScopeSnapshot; projectionStatus: ProjectionStatus; issues: ScopeIssue[] }
export interface OperationResult {
  status: string; committed: boolean; operationId?: string; requestId?: string;
  snapshot: ScopeSnapshot | null; projectionStatus: ProjectionStatus | null;
  projectionUpdated: boolean; issues: ScopeIssue[]; result?: Receipt["result"]; replayed?: boolean;
}
/** Internal testing seam, never accepted from CLI/MCP input. */
export interface StoreOptions { lockTimeoutMs?: number; onPhase?: (phase: string) => void }
const absent = (): FileToken => ({ exists: false, sha256: null });
const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
function object(v: unknown, keys: string[], name: string): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new DomainError("invalid-input", `${name} must be an object`);
  const o = v as Record<string, unknown>;
  if (Object.keys(o).some(k => !keys.includes(k)) || keys.some(k => !own(o, k))) throw new DomainError("invalid-input", `${name} requires exactly ${keys.join(", ")}`);
  return o;
}
function text(v: unknown, name: string): string {
  if (typeof v !== "string" || !v.trim()) throw new DomainError("invalid-input", `${name} must be a nonempty string`);
  return v;
}
function token(v: unknown): FileToken {
  const o = object(v, ["exists", "sha256"], "file snapshot");
  if (typeof o.exists !== "boolean" || (o.exists ? typeof o.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(o.sha256) : o.sha256 !== null)) throw new DomainError("invalid-input", "invalid file snapshot");
  return o as unknown as FileToken;
}
function expected(v: unknown): ScopeSnapshot {
  const o = object(v, ["revision", "graphHash", "bridge"], "expected snapshot");
  text(o.revision, "revision");
  if (typeof o.graphHash !== "string" || !/^[a-f0-9]{64}$/.test(o.graphHash)) throw new DomainError("invalid-input", "invalid graph hash");
  token(o.bridge);
  return o as unknown as ScopeSnapshot;
}
function bounded(v: unknown): void {
  if (Buffer.byteLength(canonical(v)) > MAX_REQUEST_BYTES) throw new DomainError("capacity-exceeded", "request exceeds 1 MiB");
}
function file(path: string, max = MAX_SCOPE_BYTES): { token: FileToken; bytes: string | null; validUtf8: boolean } {
  try {
    const st = lstatSync(path);
    if (!st.isFile() || st.isSymbolicLink()) throw new DomainError("unsafe-path", `${path} must be a regular non-symlink file`);
    if (st.size > max) throw new DomainError("capacity-exceeded", `${path} exceeds its read limit`);
    const raw = readFileSync(path);
    if (raw.length > max) throw new DomainError("capacity-exceeded", `${path} exceeds its read limit`);
    const bytes = raw.toString("utf8");
    return { token: { exists: true, sha256: createHash("sha256").update(raw).digest("hex") }, bytes, validUtf8: raw.equals(Buffer.from(bytes, "utf8")) };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { token: absent(), bytes: null, validUtf8: true };
    throw e;
  }
}
function pathExists(path: string): boolean {
  try { lstatSync(path); return true; }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return false; throw e; }
}
const same = (a: FileToken, b: FileToken) => a.exists === b.exists && a.sha256 === b.sha256;
function decode(bytes: string, entry: ScopeEntry): ScopeState {
  let raw: unknown;
  try { raw = JSON.parse(bytes); } catch { throw new DomainError("invalid-json", "mozak.json is not valid JSON"); }
  const state = validateScope(raw);
  if (state.scope.id !== entry.id) throw new DomainError("scope-mismatch", "inventory identity does not match mozak.json");
  return state;
}
/**
 * current: bridge bytes equal today's render. stale: they equal the bridge the last write left behind, or they
 * are a byte-exact legacy projection of this graph. Only known renderer output is safe to regenerate.
 * A digest stored in the bridge itself is not proof of provenance. Other content is preserved as a conflict.
 */
function projectStatus(state: ScopeState, graphHash: string, bridge: ReturnType<typeof file>, graphName: string): ProjectionStatus {
  if (bridge.token.exists && bridge.token.sha256 === hashBytes(renderBridge(state, graphHash, graphName))) return "current";
  if (same(bridge.token, state.storage.previousBridge)) return "bridge-stale";
  if (bridge.bytes !== null && bridge.validUtf8 && isOlderRender(state, graphHash, bridge.bytes)) return "bridge-stale";
  return "bridge-conflict";
}
/** Only byte-exact UTF-8 can be recognised as a generated render. Lossy decoding must never look current or stale. */
function isOlderRender(state: ScopeState, graphHash: string, bytes: string): boolean {
  const h = hashBytes(bytes);
  return h === hashBytes(renderBridgeLegacy(state, graphHash)) || h === hashBytes(renderBridge(state, graphHash, LEGACY_GRAPH_FILE));
}
/** True when the bridge is an unedited older render of this state. A write may replace it like a current one. */
function isLegacyBridge(entry: ScopeEntry, read: ScopeRead): boolean {
  if (!read.snapshot.bridge?.exists) return false;
  const bridge = file(scopeFile(entry.root, "bridge"), MAX_SCOPE_BYTES * 2);
  return bridge.bytes !== null && bridge.validUtf8 && same(bridge.token, read.snapshot.bridge) && isOlderRender(read.state, read.snapshot.graphHash, bridge.bytes);
}
export function readScope(entry: ScopeEntry, options: StoreOptions = {}): ScopeRead {
  assertScopeFiles(entry.root);
  for (let attempt = 0; attempt < 3; attempt++) {
    const a = file(scopeFile(entry.root, "graph"));
    if (a.bytes === null) throw new DomainError("scope-uninitialized", entry.remote ? `not a scope: ${entry.remote.spec}@${entry.remote.ref} has no mozak.json at its root` : `no mozak.json for ${entry.id}`);
    let bridge: ReturnType<typeof file> | null = null;
    let bridgeIssue: ScopeIssue | null = null;
    try { bridge = file(scopeFile(entry.root, "bridge"), MAX_SCOPE_BYTES * 2); }
    catch (e) {
      if (e instanceof DomainError && e.code === "unsafe-path") throw e;
      bridgeIssue = { code: "bridge-unavailable", message: e instanceof Error ? e.message : String(e) };
    }
    options.onPhase?.("reader-between");
    const b = file(scopeFile(entry.root, "graph"));
    if (!same(a.token, b.token)) continue;
    if (!a.validUtf8) throw new DomainError("invalid-encoding", "mozak.json must contain valid UTF-8 bytes");
    const state = decode(a.bytes, entry);
    const projectionStatus = bridge ? projectStatus(state, a.token.sha256!, bridge, scopeFileName(entry.root, "graph")) : "bridge-conflict";
    const issues: ScopeIssue[] = [...storageIgnoreIssues(entry.root), ...(bridgeIssue ? [bridgeIssue] : [])];
    if (entry.inventoryExtensionsIgnored) issues.push({ code: "inventory-x-ignored", message: "Reserved inventory x object settings are ignored by this client; they do not enable any behavior." });
    if (projectionStatus !== "current") issues.push({ code: projectionStatus, message: "Canonical context is available. Explicit projection repair or conflict review is required before further writes." });
    for (const name of ["README.md", "AGENTS.md"]) {
      try {
        const stat = lstatSync(join(entry.root, name));
        if (!stat.isFile() || stat.isSymbolicLink()) issues.push({ code: "invalid-entry-document", message: `${name} must be a regular non-symlink file` });
        else accessSync(join(entry.root, name), constants.R_OK);
      } catch (e) {
        issues.push({ code: (e as NodeJS.ErrnoException).code === "ENOENT" ? "missing-entry-document" : "unreadable-entry-document", message: `cannot inspect ${name}` });
      }
    }
    return { state, snapshot: { revision: state.storage.revision, graphHash: a.token.sha256!, bridge: bridge?.token ?? null }, projectionStatus, issues };
  }
  throw new DomainError("busy", "canonical state changed during three read attempts", 4);
}

/** Trusted IO results never come from mutation payloads or canonical metadata. */
function inspectPinned(entry: ScopeEntry, spec: Specification): NonNullable<ReviewEnvironment["specifications"]>[string] {
  try {
    const inspected = inspectSpecification(entry.root, spec.path);
    return { ...inspected, health: inspected.sha256 === spec.sha256 && inspected.byteLength === spec.byteLength ? "current" : "changed" };
  } catch (e) {
    // Auxiliary failures do not hide canonical understanding or prevent stopping work.
    if (!(e instanceof DomainError)) throw e;
    return { health: "unavailable" };
  }
}

export interface ScopeViewRead extends ScopeRead { environment: ReviewEnvironment }

/** Inspect only current grants and, for an implementation review, its selected candidate.
 * Retry the entire graph/spec/graph snapshot if canonical or projection changes.
 * Direct editors remain outside the cooperative protocol: this is point-in-time health.
 */
export function readScopeView(entry: ScopeEntry, candidatePlanId?: string, options: StoreOptions = {}): ScopeViewRead {
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = readScope(entry);
    const specifications: NonNullable<ReviewEnvironment["specifications"]> = Object.create(null);
    const issues: ScopeIssue[] = [];
    for (const plan of before.state.plans) {
      const grant = plan.implementationAuthorizations.find(a => a.id === plan.implementationAuthorization);
      const ids = new Set<string>();
      if (grant) ids.add(grant.specificationId);
      if (plan.id === candidatePlanId && plan.downstreamSpec) ids.add(plan.downstreamSpec);
      for (const id of ids) {
        const spec = plan.specifications.find(s => s.id === id)!;
        const health = inspectPinned(entry, spec);
        specifications[specificationKey(plan.id, id)] = health;
        if (health.health !== "current") issues.push({ code: `specification-${health.health}`, message: `Plan ${plan.id}, specification ${id}: ${health.health}; canonical context remains available` });
      }
    }
    options.onPhase?.("view-after-specs");
    const after = readScope(entry);
    if (canonical(before.snapshot) !== canonical(after.snapshot) || before.projectionStatus !== after.projectionStatus) continue;
    let lockFree = false;
    try { lockFree = !pathExists(join(entry.root, ".mozak-write-lock")); }
    catch { /* unknown lock state cannot authorize execution */ }
    if (!lockFree) issues.push({ code: "storage-busy", message: "Scope lock is present or unavailable; execution eligibility is withheld, not reclaimed by age" });
    return { ...after, issues: [...after.issues, ...issues], environment: { storageUsable: after.projectionStatus === "current" && lockFree, specifications } };
  }
  throw new DomainError("busy", "canonical/projection state changed during three specification read attempts", 4);
}

function acquire(root: string, options: StoreOptions): () => void {
  const lock = join(root, ".mozak-write-lock");
  const ownerPath = join(lock, "owner.json");
  const ownerToken = randomUUID();
  const deadline = Date.now() + (options.lockTimeoutMs ?? 1000);
  for (;;) {
    try { mkdirSync(lock, { mode: 0o700 }); break; }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
    try {
      const st = lstatSync(lock);
      if (st.isSymbolicLink() || !st.isDirectory()) throw new DomainError("unsafe-path", "lock path is not a regular directory");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw e;
    }
    if (Date.now() >= deadline) {
      let known = false;
      try { const owner = JSON.parse(readFileSync(ownerPath, "utf8")); known = typeof owner.token === "string" && Number.isInteger(owner.pid); } catch { /* diagnostic only */ }
      throw new DomainError(known ? "busy" : "recovery-required", known ? "scope lock is held; age and timeout do not prove owner death" : "lock metadata unavailable; wait or establish offline quiescence before recovery", 4);
    }
    sleep(10);
  }
  // A failure here intentionally leaves the lock behind for offline recovery.
  options.onPhase?.("after-lock-mkdir");
  writeFileDurable(ownerPath, canonical({ token: ownerToken, pid: process.pid, processStartHint: new Date(Date.now() - process.uptime() * 1000).toISOString(), acquiredAt: new Date().toISOString() }));
  fsyncDir(lock);
  return () => {
    const owner = JSON.parse(readFileSync(ownerPath, "utf8"));
    if (owner.token !== ownerToken || readdirSync(lock).some(n => n !== "owner.json")) throw new DomainError("lock-ownership-conflict", "lock ownership changed or unexpected contents found; not removing it", 4);
    unlinkSync(ownerPath);
    rmdirSync(lock); // No work belonging to the old transaction follows this removal.
  };
}
interface Transaction {
  committed: boolean; projectionUpdated: boolean; state?: ScopeState; result?: Receipt["result"];
  temporary: string[]; operationId?: string; requestId?: string;
}
function outcome(entry: ScopeEntry, tx: Transaction, status: string, issues: ScopeIssue[] = []): OperationResult {
  let read: ScopeRead | null = null;
  try { read = readScope(entry); } catch { /* committed state is still reported even when readback fails */ }
  return { status, committed: tx.committed, ...(tx.operationId ? { operationId: tx.operationId } : {}), ...(tx.requestId ? { requestId: tx.requestId } : {}), snapshot: read?.snapshot ?? null, projectionStatus: read?.projectionStatus ?? null, projectionUpdated: tx.projectionUpdated, issues, ...(tx.result ? { result: tx.result } : {}) };
}
function transaction(entry: ScopeEntry, options: StoreOptions, tx: Transaction, work: () => OperationResult): OperationResult {
  assertScopeFiles(entry.root);
  const release = acquire(entry.root, options);
  let result: OperationResult | undefined;
  let failure: unknown;
  try { options.onPhase?.("after-lock"); removeLeftoverTempFiles(entry.root); result = work(); } catch (e) { failure = e; }
  let cleanupError: unknown;
  for (const path of tx.temporary) { try { unlinkSync(path); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") cleanupError = e; } }
  // Capture our result while we still own the lock. A successor may commit immediately
  // after release, so neither readback nor cleanup belonging to this transaction follows it.
  if (!result && (tx.committed || tx.projectionUpdated)) result = outcome(entry, tx, "incomplete");
  let releaseError: unknown;
  try { options.onPhase?.("before-release"); release(); } catch (e) { releaseError = e; }
  if (releaseError || cleanupError || failure) {
    const err = releaseError ?? cleanupError ?? failure;
    const message = err instanceof Error ? err.message : String(err);
    if (tx.committed || tx.projectionUpdated) {
      const status = releaseError ? (tx.committed ? "committed-lock-held" : "projection-updated-lock-held") : tx.projectionUpdated ? "committed-cleanup-incomplete" : "committed-bridge-stale";
      return { ...result!, status, issues: [...result!.issues, ...(err instanceof DomainError ? [{ code: err.code, message }] : []), { code: status, message }] };
    }
    if (releaseError) throw new DomainError("recovery-required", `${message}; original failure: ${failure instanceof Error ? failure.message : "none"}`, 4);
    throw failure ?? cleanupError;
  }
  return result!;
}
function publish(path: string, bytes: string, tx: Transaction, options: StoreOptions = {}, beforeRename?: () => void): void {
  replaceFileDurable(path, bytes, (temporary) => tx.temporary.push(temporary), () => {
    options.onPhase?.(`temp-written:${isGraphPath(path) ? "graph" : "bridge"}`);
    beforeRename?.();
  });
}
function publishGraph(entry: ScopeEntry, state: ScopeState, previousGraph: FileToken, previousBridge: FileToken, tx: Transaction, options: StoreOptions): OperationResult {
  state.storage.previousBridge = previousBridge;
  validateScope(state);
  const bytes = canonical(state);
  if (Buffer.byteLength(bytes) > MAX_SCOPE_BYTES) throw new DomainError("capacity-exceeded", "canonical state would exceed 4 MiB");
  const graphPath = scopeFile(entry.root, "graph");
  const bridgePath = scopeFile(entry.root, "bridge");
  const recheck = (graph: FileToken) => {
    if (!same(file(graphPath).token, graph) || !same(file(bridgePath, MAX_SCOPE_BYTES * 2).token, previousBridge)) {
      throw new DomainError("graph-changed-during-write", "canonical graph or bridge changed during publication; external bytes preserved", 3);
    }
  };
  options.onPhase?.("before-graph");
  // Rehash after the temp file is flushed, immediately before rename. Direct editors do not
  // honor our lock: a microsecond-scale check/rename TOCTOU window still remains.
  publish(graphPath, bytes, tx, options, () => recheck(previousGraph));
  tx.committed = true; tx.state = state;
  options.onPhase?.("after-graph");
  publish(bridgePath, renderBridge(state, hashBytes(bytes), scopeFileName(entry.root, "graph")), tx, options, () => recheck({ exists: true, sha256: hashBytes(bytes) }));
  tx.projectionUpdated = true;
  options.onPhase?.("after-bridge");
  return outcome(entry, tx, "ok");
}
function receipt(read: ScopeRead, operationId: string, requestDigest: string, tx: Transaction, entry: ScopeEntry): OperationResult | null {
  if (!own(read.state.receipts, operationId)) return null;
  const record = read.state.receipts[operationId];
  if (record.requestDigest !== requestDigest) throw new DomainError("operation-conflict", "operation ID was already used with different input", 3);
  tx.committed = true; tx.result = record.result;
  return { ...outcome(entry, tx, "replayed"), replayed: true };
}
function match(read: ScopeRead, snapshot: ScopeSnapshot, bridge = true): void {
  if (bridge && (!read.snapshot.bridge || !snapshot.bridge)) throw new DomainError("bridge-unavailable", "a trustworthy bridge snapshot is required before writing", 3);
  if (read.snapshot.revision !== snapshot.revision || read.snapshot.graphHash !== snapshot.graphHash || (bridge && !same(read.snapshot.bridge!, snapshot.bridge!))) throw new DomainError("stale-input", "snapshot changed; reread before submitting a new operation", 3);
}
function identity(entry: ScopeEntry, input: Record<string, unknown>): void {
  if (text(input.scopeId, "scopeId") !== entry.id) throw new DomainError("scope-mismatch", "request scope differs from selected scope");
}
export function initScopeState(entry: ScopeEntry, input: unknown, options: StoreOptions = {}): OperationResult {
  bounded(input);
  const r = object(input, ["operationId", "scopeId", "kind", "title", "expectedAbsent", "ownerRef", "ownerMessageAt"], "init request");
  identity(entry, r); const operationId = text(r.operationId, "operationId");
  if (r.kind !== "project" && r.kind !== "topic") throw new DomainError("invalid-input", "kind must be project or topic");
  text(r.title, "title"); text(r.ownerRef, "ownerRef"); text(r.ownerMessageAt, "ownerMessageAt");
  const missing = object(r.expectedAbsent, ["graph", "bridge"], "expectedAbsent");
  if (missing.graph !== true || missing.bridge !== true) throw new DomainError("invalid-input", "init requires absent graph and bridge");
  const tx: Transaction = { operationId, committed: false, projectionUpdated: false, temporary: [] };
  return transaction(entry, options, tx, () => {
    if (file(scopeFile(entry.root, "graph")).token.exists) {
      const prior = receipt(readScope(entry), operationId, digest(input), tx, entry);
      if (prior) return prior;
      throw new DomainError("already-exists", "existing canonical graph cannot be initialized again", 3);
    }
    if (file(scopeFile(entry.root, "bridge")).token.exists || pathExists(join(entry.root, ".mozak"))) throw new DomainError("conversion-required", "existing bridge or legacy state requires separately approved conversion", 3);
    for (const name of ["README.md", "AGENTS.md"]) if (!file(join(entry.root, name)).token.exists) throw new DomainError("missing-entry-document", `create/review ${name} explicitly before init`);
    ensureStorageIgnored(entry.root);
    const now = new Date().toISOString(); const revision = randomUUID();
    const result = { action: "init", ids: [entry.id] };
    const state: ScopeState = { format: SCOPE_FORMAT, scope: { id: entry.id, kind: r.kind as "project" | "topic", title: r.title as string, createdAt: now, initialization: { operationId, ownerRef: r.ownerRef as string, ownerMessageAt: r.ownerMessageAt as string, recordedAt: now } }, storage: { revision, updatedAt: now, previousBridge: absent() }, plans: [], connections: [], receipts: { [operationId]: { requestDigest: digest(input), storageRevision: revision, recordedAt: now, result } } };
    tx.result = result;
    return publishGraph(entry, state, absent(), absent(), tx, options);
  });
}
export function mutateScope(entry: ScopeEntry, input: unknown, actor: "agent" | "owner", options: StoreOptions = {}): OperationResult {
  bounded(input);
  const r = object(input, ["operationId", "scopeId", "expected", "action", "payload"], "mutation request");
  identity(entry, r); const operationId = text(r.operationId, "operationId"); const snapshot = expected(r.expected);
  validateMutation(r.action, r.payload, actor);
  const tx: Transaction = { operationId, committed: false, projectionUpdated: false, temporary: [] };
  return transaction(entry, options, tx, () => {
    const read = readScope(entry);
    const replay = receipt(read, operationId, digest(input), tx, entry);
    if (replay) return replay;
    match(read, snapshot);
    if (read.projectionStatus !== "current" && !isLegacyBridge(entry, read)) throw new DomainError(read.projectionStatus, "projection requires explicit repair or conflict resolution before new writes", 3);
    const now = new Date().toISOString();
    const environment: ReviewEnvironment = { storageUsable: true, specifications: Object.create(null) };
    const payload = r.payload as Record<string, unknown>;
    if (r.action === "attach-spec") environment.attachment = inspectSpecification(entry.root, payload.path as string);
    if (r.action === "approve-implementation") {
      const plan = read.state.plans.find(p => p.id === payload.planId);
      const spec = plan?.specifications.find(s => s.id === payload.specificationId && s.id === plan.downstreamSpec);
      if (!spec || !plan) throw new DomainError("stale-reference", "implementation approval must name the current candidate", 3);
      environment.specifications![specificationKey(plan.id, spec.id)] = inspectPinned(entry, spec);
    }
    options.onPhase?.("after-spec-inspection");
    const next = applyMutation(read.state, r.action as MutationAction, r.payload, actor, now, environment);
    next.state.storage = { revision: randomUUID(), updatedAt: now, previousBridge: read.snapshot.bridge! };
    Object.defineProperty(next.state.receipts, operationId, { value: { requestDigest: digest(input), storageRevision: next.state.storage.revision, recordedAt: now, result: next.result }, enumerable: true, writable: true, configurable: true });
    tx.result = next.result;
    return publishGraph(entry, next.state, { exists: true, sha256: read.snapshot.graphHash }, read.snapshot.bridge!, tx, options);
  });
}
export type RenderResult = "rendered" | "current" | "conflict" | "failed";
/**
 * Regenerate a stale mozak.md from canonical state. Agent-safe: never opens mozak.json for writing, never
 * overwrites a conflicting bridge (that stays an owner repair), and runs inside the scope lock.
 */
export function renderProjection(entry: ScopeEntry, options: StoreOptions = {}): { result: RenderResult; outcome: OperationResult } {
  if (entry.remote && entry.remote.plansMode === "repo") throw new DomainError("remote-render-refused", "render only regenerates local projections", 2);
  let result: RenderResult = "current";
  const tx: Transaction = { committed: false, projectionUpdated: false, temporary: [] };
  const out = transaction(entry, options, tx, () => {
    const read = readScope(entry);
    if (read.projectionStatus === "current") return outcome(entry, tx, "already-current");
    if (read.projectionStatus === "bridge-conflict") { result = "conflict"; return outcome(entry, tx, "bridge-conflict", [{ code: "bridge-conflict", message: "mozak.md differs from every known render; preserved for owner review (projection repair)" }]); }
    options.onPhase?.("before-render");
    const again = readScope(entry);
    if (canonical(again.snapshot) !== canonical(read.snapshot)) throw new DomainError("stale-input", "scope changed while rendering; rerun render", 3);
    publish(scopeFile(entry.root, "bridge"), renderBridge(again.state, again.snapshot.graphHash, scopeFileName(entry.root, "graph")), tx);
    tx.projectionUpdated = true; result = "rendered";
    return outcome(entry, tx, "ok");
  });
  if (!["ok", "already-current", "bridge-conflict"].includes(out.status)) result = "failed";
  return { result, outcome: out };
}
export type RenameResult = "renamed" | "current" | "failed";
/**
 * Owner-only: change the scope's display title. Same snapshot check, lock, receipt and projection as every other
 * write. Plans, decisions and approvals are untouched. The receipt and git history record the change.
 */
export function retitleScope(entry: ScopeEntry, input: unknown, options: StoreOptions = {}): OperationResult {
  bounded(input);
  const r = object(input, ["operationId", "scopeId", "expected", "title", "ownerRef", "ownerMessageAt"], "retitle request");
  identity(entry, r); const operationId = text(r.operationId, "operationId"); const snapshot = expected(r.expected);
  const title = text(r.title, "title").trim(); text(r.ownerRef, "ownerRef"); text(r.ownerMessageAt, "ownerMessageAt");
  if (title.length > 200 || /[\r\n]/.test(title)) throw new DomainError("invalid-input", "title must be one line of at most 200 characters");
  const tx: Transaction = { operationId, committed: false, projectionUpdated: false, temporary: [] };
  return transaction(entry, options, tx, () => {
    const read = readScope(entry);
    const replay = receipt(read, operationId, digest(input), tx, entry);
    if (replay) return replay;
    match(read, snapshot);
    if (read.projectionStatus !== "current" && !isLegacyBridge(entry, read)) throw new DomainError(read.projectionStatus, "projection requires explicit repair or conflict resolution before new writes", 3);
    const now = new Date().toISOString();
    const state = structuredClone(read.state);
    state.scope.title = title;
    const result = { action: "retitle", ids: [entry.id] };
    state.storage = { revision: randomUUID(), updatedAt: now, previousBridge: read.snapshot.bridge! };
    Object.defineProperty(state.receipts, operationId, { value: { requestDigest: digest(input), storageRevision: state.storage.revision, recordedAt: now, result }, enumerable: true, writable: true, configurable: true });
    tx.result = result as Receipt["result"];
    return publishGraph(entry, state, { exists: true, sha256: read.snapshot.graphHash }, read.snapshot.bridge!, tx, options);
  });
}
/**
 * Rename a pre-0.4 scope's MOZAK.json and MOZAK.md to mozak.json and mozak.md, then re-render the note so its link
 * names the new file. Runs inside the scope lock. Refuses when the note is a conflict (hand edits are owner review)
 * or when both names exist. Bytes of mozak.json are unchanged, so snapshots and approvals stay valid.
 * The rename goes through a temporary name, which also works on case-insensitive disks.
 */
export function renameScopeFiles(entry: ScopeEntry, options: StoreOptions = {}): { result: RenameResult; outcome: OperationResult } {
  if (entry.remote && entry.remote.plansMode === "repo") throw new DomainError("remote-rename-refused", "rename only local or vault-plans scopes; a repo scope is renamed in its own clone", 2);
  let result: RenameResult = "current";
  const tx: Transaction = { committed: false, projectionUpdated: false, temporary: [] };
  const out = transaction(entry, options, tx, () => {
    const graphName = scopeFileName(entry.root, "graph");
    const bridgeName = scopeFileName(entry.root, "bridge");
    if (graphName === GRAPH_FILE && bridgeName === BRIDGE_FILE) return outcome(entry, tx, "already-current");
    const names = readdirSync(entry.root);
    if ((names.includes(GRAPH_FILE) && names.includes(LEGACY_GRAPH_FILE)) || (names.includes(BRIDGE_FILE) && names.includes(LEGACY_BRIDGE_FILE))) {
      throw new DomainError("rename-conflict", "both uppercase and lowercase plan files exist; keep one by hand", 3);
    }
    const read = readScope(entry);
    if (read.projectionStatus === "bridge-conflict") throw new DomainError("bridge-conflict", "mozak.md has hand edits; review them before renaming", 3);
    const move = (from: string, to: string) => {
      if (from === to) return;
      const via = join(entry.root, `.${to}.${randomUUID()}.rename`);
      renameSync(join(entry.root, from), via);
      renameSync(via, join(entry.root, to));
    };
    move(graphName, GRAPH_FILE);
    if (pathExists(join(entry.root, bridgeName))) move(bridgeName, BRIDGE_FILE);
    fsyncDir(entry.root);
    const again = readScope(entry);
    publish(join(entry.root, BRIDGE_FILE), renderBridge(again.state, again.snapshot.graphHash, GRAPH_FILE), tx);
    tx.projectionUpdated = true; result = "renamed";
    return outcome(entry, tx, "ok");
  });
  if (!["ok", "already-current"].includes(out.status)) result = "failed";
  return { result, outcome: out };
}
export function repairProjection(entry: ScopeEntry, input: unknown, options: StoreOptions = {}): OperationResult {
  bounded(input);
  const r = object(input, ["requestId", "scopeId", "expected"], "repair request");
  identity(entry, r); const requestId = text(r.requestId, "requestId"); const snapshot = expected(r.expected);
  const tx: Transaction = { requestId, committed: false, projectionUpdated: false, temporary: [] };
  return transaction(entry, options, tx, () => {
    const read = readScope(entry); match(read, snapshot, false);
    if (read.projectionStatus === "current") {
      ensureStorageIgnored(entry.root);
      return outcome(entry, tx, "already-current");
    }
    match(read, snapshot);
    if (read.projectionStatus === "bridge-conflict") throw new DomainError("bridge-conflict", "manual bridge conflict preserved; automatic repair refused", 3);
    options.onPhase?.("before-repair");
    const current = readScope(entry); match(current, snapshot);
    ensureStorageIgnored(entry.root);
    publish(scopeFile(entry.root, "bridge"), renderBridge(current.state, current.snapshot.graphHash, scopeFileName(entry.root, "graph")), tx);
    tx.projectionUpdated = true;
    return outcome(entry, tx, "ok");
  });
}

export interface AnnotateOutcome extends OperationResult { annotations: FileToken | null }
/**
 * Owner-only: apply owner-approved annotation items to mozak.annotations.json. Runs under the scope lock, writes one
 * temp file and one rename, and never touches mozak.json or mozak.md. The CAS input is only the sidecar token the
 * owner reviewed: graph writes by agents neither need nor change it, and an annotation never makes an agent stale.
 * A retried identical request replays its receipt before the CAS check. `lookup` resolves targets in other scopes.
 */
export function annotateScope(entry: ScopeEntry, input: unknown, lookup: ScopeLookup, options: StoreOptions = {}): AnnotateOutcome {
  bounded(input);
  const { request, items } = validateAnnotateRequest(input);
  identity(entry, request as unknown as Record<string, unknown>);
  const tx: Transaction = { operationId: request.operationId, committed: false, projectionUpdated: false, temporary: [] };
  let token: FileToken | null = null;
  const out = transaction(entry, options, tx, () => {
    const read = readScope(entry);
    const side = readAnnotations(entry.root, entry.id);
    if (side.issues.length) throw new DomainError(side.issues[0]!.code, `${side.issues[0]!.message}; repair the sidecar by hand before annotating`, 3);
    const requestDigest = digest(input);
    const base = { operationId: request.operationId, snapshot: read.snapshot, projectionStatus: read.projectionStatus, projectionUpdated: false, issues: [] as ScopeIssue[] };
    if (side.doc && own(side.doc.receipts, request.operationId)) {
      const prior = side.doc.receipts[request.operationId]!;
      if (prior.requestDigest !== requestDigest) throw new DomainError("operation-conflict", "operation ID was already used with different input", 3);
      tx.committed = true; tx.result = prior.result; token = side.token;
      return { ...base, status: "replayed", committed: true, replayed: true, result: prior.result };
    }
    if (!same(side.token, request.expectedAnnotations)) throw new DomainError("stale-input", "mozak.annotations.json changed; reread it and show the items again", 3);
    const now = new Date().toISOString();
    const revision = randomUUID();
    const current = side.doc ?? emptyAnnotations(entry.id, now);
    const local: ScopeLookup = (id) => (id === entry.id ? read.state : lookup(id));
    const applied = applyAnnotate(current, read.state, items, request, local, now, revision);
    const result = { action: "annotate" as const, ids: applied.ids };
    Object.defineProperty(applied.doc.receipts, request.operationId, { value: { requestDigest, revision, recordedAt: now, result }, enumerable: true, writable: true, configurable: true });
    const bytes = annotationsBytes(applied.doc);
    const path = join(entry.root, ANNOTATIONS_FILE);
    options.onPhase?.("before-annotations");
    replaceFileDurable(path, bytes, (temporary) => tx.temporary.push(temporary), () => {
      options.onPhase?.("temp-written:annotations");
      if (!same(readAnnotations(entry.root).token, side.token)) throw new DomainError("annotations-changed-during-write", "mozak.annotations.json changed during the write; external bytes preserved", 3);
    });
    tx.committed = true; tx.result = result;
    token = { exists: true, sha256: hashBytes(bytes) };
    return { ...base, status: "ok", committed: true, result };
  });
  return { ...out, annotations: token };
}
