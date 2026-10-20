// Durable file writes. A plan write must survive a crash of mozak and a power loss: the new bytes are flushed to
// disk before the rename makes them visible, and the folder is flushed after it so the rename itself is on disk.
// Without this, a power cut right after a write can leave an empty or truncated mozak.json.

import { closeSync, fsyncSync, openSync, readdirSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

/** Test seam: count fsync calls by kind. Never used for control flow. */
export const durableStats = { fileSyncs: 0, dirSyncs: 0 };

/** Flush a folder so a rename inside it is durable. Best effort where the filesystem cannot do it. */
export function fsyncDir(dir: string): void {
  let fd: number | undefined;
  try {
    fd = openSync(dir, "r");
    fsyncSync(fd);
    durableStats.dirSyncs++;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    // Some platforms and filesystems refuse fsync on a directory. The file itself is already flushed.
    if (code !== "EINVAL" && code !== "EISDIR" && code !== "EPERM" && code !== "ENOTSUP" && code !== "EBADF") throw e;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Write bytes to a new file and flush them. `flag` "wx" refuses an existing path. */
export function writeFileDurable(path: string, data: string | Uint8Array, mode = 0o600): void {
  const fd = openSync(path, "wx", mode);
  try {
    const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
    let off = 0;
    while (off < buf.length) off += writeSync(fd, buf, off, buf.length - off);
    fsyncSync(fd);
    durableStats.fileSyncs++;
  } finally {
    closeSync(fd);
  }
}

/**
 * Replace `path` atomically and durably: write a flushed temp file next to it, rename it into place, flush the
 * folder. `temporary` receives the temp path before anything is written, so callers can clean it up on failure.
 */
export function replaceFileDurable(path: string, data: string | Uint8Array, onTemporary?: (temp: string) => void, afterTempWritten?: () => void): void {
  const temporary = `${path}.${randomUUID()}.tmp`;
  onTemporary?.(temporary);
  writeFileDurable(temporary, data);
  afterTempWritten?.();
  renameSync(temporary, path);
  fsyncDir(dirname(path));
}

/** Names of temp files an interrupted write of a plan file (either name case) can leave behind in a scope folder. */
const LEFTOVER = /^(?:mozak|MOZAK)\.(json|md)\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/;

export function leftoverTempFiles(root: string): string[] {
  try {
    return readdirSync(root).filter((n) => LEFTOVER.test(n)).sort();
  } catch {
    return [];
  }
}

/** Remove leftover temp files. Call only while holding the scope lock, so no live writer owns them. */
export function removeLeftoverTempFiles(root: string): string[] {
  const removed: string[] = [];
  for (const name of leftoverTempFiles(root)) {
    try { unlinkSync(`${root}/${name}`); removed.push(name); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  }
  return removed;
}
