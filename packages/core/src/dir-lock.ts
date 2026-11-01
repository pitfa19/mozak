// One exclusive write lock: a directory created with mkdir, holding owner.json. Used for scope roots
// (.mozak-write-lock) and for the inventory file (.mozak-inventory-lock next to it).

import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, readdirSync, rmdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { DomainError } from "./errors.ts";
import { canonical } from "./understanding.ts";
import { fsyncDir, writeFileDurable } from "./durable.ts";
import { lockHost } from "./lock-recover.ts";

export interface LockOptions { lockTimeoutMs?: number; onPhase?: (phase: string) => void }

const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Take the lock directory `lock`, waiting up to lockTimeoutMs (default 1 s). `what` names it in the busy message.
 * Returns the release function. Age and timeout never prove the owner dead: a held lock is reported, not reclaimed.
 */
export function acquireDirLock(lock: string, what: string, options: LockOptions = {}): () => void {
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
      try { const owner = JSON.parse(readFileSync(ownerPath, "utf8")) as { token?: unknown; pid?: unknown }; known = typeof owner.token === "string" && Number.isInteger(owner.pid); } catch { /* diagnostic only */ }
      throw new DomainError(known ? "busy" : "recovery-required", known ? `${what} lock is held; age and timeout do not prove owner death` : "lock metadata unavailable; wait or establish offline quiescence before recovery", 4);
    }
    sleep(10);
  }
  // A failure here intentionally leaves the lock behind for offline recovery.
  options.onPhase?.("after-lock-mkdir");
  // host lets `recover` tell a lock that arrived by sync (another host) from one a local process may still hold.
  writeFileDurable(ownerPath, canonical({ token: ownerToken, pid: process.pid, host: lockHost(), processStartHint: new Date(Date.now() - process.uptime() * 1000).toISOString(), acquiredAt: new Date().toISOString() }));
  fsyncDir(lock);
  return () => {
    const owner = JSON.parse(readFileSync(ownerPath, "utf8")) as { token?: unknown };
    if (owner.token !== ownerToken || readdirSync(lock).some(n => n !== "owner.json")) throw new DomainError("lock-ownership-conflict", "lock ownership changed or unexpected contents found; not removing it", 4);
    unlinkSync(ownerPath);
    rmdirSync(lock); // No work belonging to the old transaction follows this removal.
  };
}
