// Write-lock inspection and owner recovery (S2). A lock is never stolen because it is old. The owner route
// `recover` removes one named lock only when its owner cannot still be writing on this machine: the lock names
// another host (it can only have arrived by sync), or it names this host and a pid that is no longer running.

import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { lstatSync, readFileSync, readdirSync, renameSync, rmdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { DomainError } from "./errors.ts";
import { fsyncDir } from "./durable.ts";
import { WRITE_LOCK_DIR } from "./scope-index.ts";
import { MAX_REQUEST_BYTES, canonical } from "./understanding.ts";

export type LockVerdict = "absent" | "other-host" | "dead-local-pid" | "live-local-pid" | "host-unknown" | "metadata-unavailable";
export interface LockInfo {
  present: boolean;
  token: string | null;
  host: string | null;
  pid: number | null;
  acquiredAt: string | null;
  /** Entries in the lock folder other than owner.json. A lock with extra entries is never removed. */
  extraEntries: string[];
  verdict: LockVerdict;
}
/** Testing seams. Never accepted from CLI or MCP input. */
export interface LockProbe { hostname?: () => string; isAlive?: (pid: number) => boolean }

/** The host name recorded in owner.json. */
export function lockHost(): string { return hostname(); }

export function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; }
}

function readOwner(dir: string): Record<string, unknown> | null {
  try {
    const raw = JSON.parse(readFileSync(join(dir, "owner.json"), "utf8"));
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
  } catch { return null; }
}

function describe(dir: string, probe: LockProbe): LockInfo {
  const empty: LockInfo = { present: false, token: null, host: null, pid: null, acquiredAt: null, extraEntries: [], verdict: "absent" };
  try {
    const st = lstatSync(dir);
    if (st.isSymbolicLink() || !st.isDirectory()) throw new DomainError("unsafe-path", "lock path is not a regular directory", 2);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return empty;
    throw e;
  }
  let names: string[] = [];
  try { names = readdirSync(dir); } catch { /* reported as metadata-unavailable below */ }
  const owner = readOwner(dir);
  const token = typeof owner?.token === "string" ? owner.token : null;
  const pid = Number.isInteger(owner?.pid) ? owner!.pid as number : null;
  const host = typeof owner?.host === "string" && owner.host !== "" ? owner.host : null;
  const acquiredAt = typeof owner?.acquiredAt === "string" ? owner.acquiredAt : null;
  let verdict: LockVerdict;
  if (token === null || pid === null) verdict = "metadata-unavailable";
  else if (host === null) verdict = "host-unknown";
  else if (host !== (probe.hostname ?? lockHost)()) verdict = "other-host";
  else verdict = (probe.isAlive ?? pidAlive)(pid) ? "live-local-pid" : "dead-local-pid";
  return { present: true, token, host, pid, acquiredAt, extraEntries: names.filter((n) => n !== "owner.json").sort(), verdict };
}

/** Read-only view of the scope write lock. */
export function inspectLock(root: string, probe: LockProbe = {}): LockInfo {
  return describe(join(root, WRITE_LOCK_DIR), probe);
}

export interface RecoverRequest { requestId: string; scopeId: string; lock: { token: string; host: string; pid: number }; ownerRef: string; ownerMessageAt: string }
export interface RecoverResult { status: "ok" | "already-clear"; recovered: LockInfo | null; reason: LockVerdict | null }

function invalid(message: string): DomainError { return new DomainError("invalid-input", message, 2); }
function exact(v: unknown, keys: string[], name: string): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw invalid(`${name} must be an object`);
  const o = v as Record<string, unknown>;
  if (Object.keys(o).some((k) => !keys.includes(k)) || keys.some((k) => !Object.hasOwn(o, k))) throw invalid(`${name} requires exactly ${keys.join(", ")}`);
  return o;
}
function text(v: unknown, name: string): string {
  if (typeof v !== "string" || !v.trim()) throw invalid(`${name} must be a nonempty string`);
  return v;
}

export function validateRecoverRequest(input: unknown): RecoverRequest {
  if (Buffer.byteLength(canonical(input)) > MAX_REQUEST_BYTES) throw new DomainError("capacity-exceeded", "request exceeds 1 MiB");
  const r = exact(input, ["requestId", "scopeId", "lock", "ownerRef", "ownerMessageAt"], "recover request");
  text(r.requestId, "requestId"); text(r.scopeId, "scopeId"); text(r.ownerRef, "ownerRef"); text(r.ownerMessageAt, "ownerMessageAt");
  const lock = exact(r.lock, ["token", "host", "pid"], "lock");
  text(lock.token, "lock.token"); text(lock.host, "lock.host");
  if (!Number.isInteger(lock.pid)) throw invalid("lock.pid must be an integer");
  return r as unknown as RecoverRequest;
}

/**
 * Owner-only: remove the write lock named in the request. The request must repeat the token, host and pid that
 * `check` reported, so the owner approves exactly one lock. Refused when the lock changed, holds anything but
 * owner.json, names no host (a pre-S2 lock), or names this host and a pid that is still running.
 * The lock folder is first renamed atomically, so two recoveries or a racing writer never both act on it.
 */
export function recoverLock(entry: { id: string; root: string }, input: unknown, probe: LockProbe = {}): RecoverResult {
  const request = validateRecoverRequest(input);
  if (request.scopeId !== entry.id) throw new DomainError("scope-mismatch", "request scope differs from selected scope");
  const lockDir = join(entry.root, WRITE_LOCK_DIR);
  const info = describe(lockDir, probe);
  if (!info.present) return { status: "already-clear", recovered: null, reason: null };
  if (info.token !== request.lock.token || info.host !== request.lock.host || info.pid !== request.lock.pid) {
    throw new DomainError("lock-changed", "the lock differs from the one named in the request; run check again and show the owner the current lock", 3);
  }
  if (info.extraEntries.length) throw new DomainError("lock-unexpected-contents", `lock folder holds ${info.extraEntries.join(", ")} besides owner.json; inspect it by hand`, 3);
  if (info.verdict === "live-local-pid") throw new DomainError("lock-owner-alive", `pid ${info.pid} on this host is still running; wait for it to finish`, 4);
  if (info.verdict === "host-unknown") throw new DomainError("lock-host-unknown", "the lock records no host (written by an older mozak); remove it by hand after making sure no writer runs anywhere", 3);
  if (info.verdict === "metadata-unavailable") throw new DomainError("recovery-required", "lock metadata unavailable; remove it by hand after making sure no writer runs anywhere", 4);
  const moved = join(entry.root, `${WRITE_LOCK_DIR}.recover-${randomUUID()}`);
  try { renameSync(lockDir, moved); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { status: "already-clear", recovered: null, reason: null };
    throw e;
  }
  const after = describe(moved, probe);
  if (after.token !== info.token || after.extraEntries.length) {
    // Someone replaced the lock between inspection and rename. Put it back untouched.
    try { renameSync(moved, lockDir); }
    catch { throw new DomainError("recovery-required", `lock changed during recovery and could not be restored; it is at ${moved}`, 4); }
    throw new DomainError("lock-changed", "the lock changed during recovery; it was restored untouched", 3);
  }
  unlinkSync(join(moved, "owner.json"));
  rmdirSync(moved);
  fsyncDir(entry.root);
  return { status: "ok", recovered: info, reason: info.verdict };
}
