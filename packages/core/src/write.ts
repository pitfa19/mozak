import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";

export class StaleWriteError extends Error {
  readonly code = "stale-write";
  readonly path: string;
  readonly expected: string;
  readonly actual: string;
  constructor(path: string, expected: string, actual: string) {
    super(`stale write refused for ${path}: base ${expected.slice(0, 8)} but file is now ${actual.slice(0, 8)}`);
    this.path = path;
    this.expected = expected;
    this.actual = actual;
  }
}

export class LockTimeoutError extends Error {
  readonly code = "lock-timeout";
  readonly path: string;
  constructor(path: string) {
    super(`could not acquire lock for ${path}`);
    this.path = path;
  }
}

export const EMPTY_HASH = hashText("");

export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export interface Snapshot {
  text: string;
  hash: string;
}

/** Read a file and the hash an agent must quote when it writes back. A missing file hashes as empty. */
export function readSnapshot(path: string): Snapshot {
  const text = existsSync(path) ? readFileSync(path, "utf8") : "";
  return { text, hash: hashText(text) };
}

const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export interface LockOptions {
  timeoutMs?: number;
  /** A lock older than this is assumed abandoned by a crashed process. */
  staleMs?: number;
}

function acquire(lockPath: string, path: string, { timeoutMs = 5000, staleMs = 30000 }: LockOptions): void {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const fd = openSync(lockPath, "wx");
      writeFileSync(fd, `${process.pid}\n`);
      closeSync(fd);
      return;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    try {
      if (Date.now() - statSync(lockPath).mtimeMs > staleMs) {
        unlinkSync(lockPath);
        continue;
      }
    } catch {
      continue; // lock vanished between checks, try again
    }
    if (Date.now() > deadline) throw new LockTimeoutError(path);
    sleep(5 + Math.floor(Math.random() * 15));
  }
}

/**
 * Compare and swap write. Takes a lock, refuses if the file no longer matches
 * baseHash, otherwise writes a temp file and atomically renames it into place.
 * Returns the new hash.
 */
export function guardedWrite(path: string, newText: string, baseHash: string, opts: LockOptions = {}): string {
  const lockPath = `${path}.lock`;
  acquire(lockPath, path, opts);
  try {
    const current = readSnapshot(path);
    if (current.hash !== baseHash) throw new StaleWriteError(path, baseHash, current.hash);
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, newText);
    renameSync(tmp, path);
    return hashText(newText);
  } finally {
    try {
      unlinkSync(lockPath);
    } catch {
      /* already gone */
    }
  }
}

/**
 * Read, transform, write with compare and swap, and retry when another writer got in first.
 * The transform is re-run on the fresh content each attempt, so no edit is lost.
 */
export function updateFile(path: string, transform: (text: string) => string, opts: LockOptions & { retries?: number } = {}): string {
  const retries = opts.retries ?? 50;
  for (let attempt = 0; ; attempt++) {
    const snap = readSnapshot(path);
    try {
      return guardedWrite(path, transform(snap.text), snap.hash, opts);
    } catch (e) {
      if (!(e instanceof StaleWriteError) || attempt >= retries) throw e;
    }
  }
}
