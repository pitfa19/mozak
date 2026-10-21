import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, type BigIntStats } from "node:fs";
import { join } from "node:path";
import { DomainError } from "./errors.ts";

/** Hard ceiling for one specification read, in raw bytes. */
export const MAX_SPECIFICATION_BYTES = 256 * 1024;
const MAX_RELATIVE_PATH_BYTES = 1024;
const SPECIFICATION_EXTENSIONS = [".md", ".markdown"] as const;

export interface SpecificationFile {
  /** The validated scope-relative path exactly as supplied. */
  path: string;
  /** Lowercase hex SHA-256 of the actual raw file bytes. */
  sha256: string;
  byteLength: number;
  /** UTF-8 decoded text. The byte order mark, if present, is kept. */
  content: string;
}

/**
 * Internal seam for deterministic race tests. Not exported from the package index and never
 * reachable from a public payload. `afterRead` runs after the bytes are read and before the
 * post-read checks. An exception thrown by the hook is a programmer error and is not converted.
 */
export interface SpecificationReadHooks {
  /** Runs after the initial lstat and before open. Used to change the file between lstat and open. */
  beforeOpen?: () => void;
  afterRead?: () => void;
}

/**
 * Reads one Markdown specification from inside an explicitly selected scope root, as a checked
 * snapshot. The root itself must be a real directory, not a symlink. Callers obtain it through
 * the scope index, which already requires the inventoried root to equal its realpath. Ancestors
 * of the root are not checked here.
 *
 * Refused: absolute paths, `..`, `.`, empty segments, NUL, backslashes, non-Markdown names,
 * symlinks in any relative component (including the final file), non-regular files, files over
 * 256 KiB and malformed UTF-8. Change detection is best effort: it compares metadata before and
 * after one bounded read. It is not absolute confinement and does not rule out an ABA rewrite.
 *
 * Error mapping:
 * - invalid-input (exit 2): malformed relative path, a symlink on the path, or a symlinked root.
 * - unavailable-spec (exit 2): missing, unreadable, non-regular, oversized or malformed UTF-8 file.
 *   Raw filesystem errors are converted to this code, never leaked.
 * - stale-reference (exit 3): the path or file changed while it was being inspected.
 */
export function inspectSpecification(root: string, relativePath: string): SpecificationFile {
  return readSpecification(root, relativePath);
}

/** Internal entry point with the test seam. Use `inspectSpecification` in production code. */
export function readSpecification(root: string, relativePath: string, hooks: SpecificationReadHooks = {}): SpecificationFile {
  const parts = safeRelativeParts(relativePath);
  const rootStat = rootDirectory(root);
  const chain = walkDirectories(root, rootStat, parts);
  const filePath = join(chain.at(-1)!.path, parts[parts.length - 1]);
  const pathStat = regularFileStat(filePath);

  const read = readBounded(filePath, pathStat, hooks);
  const { opened, post } = read;

  // The descriptor's metadata must be stable across the read.
  if (post.size !== opened.size || post.mtimeNs !== opened.mtimeNs || post.ctimeNs !== opened.ctimeNs) {
    throw staleChanged(relativePath);
  }
  // The path must still name the same regular file, with the same metadata as the descriptor
  // after the read. This catches a rewrite or replacement between the post-read fstat and this lstat.
  const after = lstatOrStale(filePath);
  if (
    after.isSymbolicLink() || !after.isFile() ||
    after.dev !== post.dev || after.ino !== post.ino ||
    after.size !== post.size || after.mtimeNs !== post.mtimeNs || after.ctimeNs !== post.ctimeNs
  ) {
    throw staleChanged(relativePath);
  }
  // Every directory on the path must still be the same real directory object.
  for (const link of chain) {
    const current = lstatOrStale(link.path);
    if (current.isSymbolicLink() || !current.isDirectory() || current.dev !== link.st.dev || current.ino !== link.st.ino) {
      throw staleChanged(relativePath);
    }
  }
  if (BigInt(read.total) !== post.size) throw staleChanged(relativePath);

  const raw = read.buffer.subarray(0, read.total);
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw);
  } catch {
    throw new DomainError("unavailable-spec", `${relativePath} is not valid UTF-8`);
  }
  return {
    path: relativePath,
    sha256: createHash("sha256").update(raw).digest("hex"),
    byteLength: read.total,
    content,
  };
}

function safeRelativeParts(value: unknown): string[] {
  if (typeof value !== "string") throw invalid("specification path must be a string");
  if (value.length === 0) throw invalid("specification path must be nonempty");
  if (Buffer.byteLength(value, "utf8") > MAX_RELATIVE_PATH_BYTES) throw invalid("specification path is too long");
  if (value.includes("\0")) throw invalid("specification path contains NUL");
  if (value.includes("\\")) throw invalid("specification path must use / separators only");
  if (value.startsWith("/") || /^[A-Za-z]:/.test(value)) throw invalid("specification path must be relative");
  const parts = value.split("/");
  for (const part of parts) {
    if (part === "") throw invalid("specification path has an empty segment");
    if (part === "." || part === "..") throw invalid("specification path must not traverse");
  }
  const name = parts[parts.length - 1];
  const ext = SPECIFICATION_EXTENSIONS.find(e => name.endsWith(e) && name.length > e.length);
  if (!ext) throw invalid("specification must be a .md or .markdown file");
  return parts;
}

/** The root must be a real directory. lstat, not stat, so a symlinked root is refused. */
function rootDirectory(root: string): BigIntStats {
  if (typeof root !== "string" || root.length === 0 || root.includes("\0")) throw invalid("scope root must be a nonempty path");
  const st = io(() => lstatSync(root, { bigint: true }), "scope root is unavailable");
  if (st.isSymbolicLink()) throw invalid("scope root must be the real directory, not a symlink");
  if (!st.isDirectory()) throw unavailable("scope root is not a directory");
  return st;
}

interface Link { path: string; st: BigIntStats }

/** Walks every relative directory component with lstat. Symlinks are refused on the path. */
function walkDirectories(root: string, rootStat: BigIntStats, parts: string[]): Link[] {
  const chain: Link[] = [{ path: root, st: rootStat }];
  let current = root;
  for (const part of parts.slice(0, -1)) {
    current = join(current, part);
    const st = lstatRequired(current);
    if (st.isSymbolicLink()) throw invalid("specification path must not contain symlinks");
    if (!st.isDirectory()) throw unavailable("specification parent is not a directory");
    chain.push({ path: current, st });
  }
  return chain;
}

function regularFileStat(path: string): BigIntStats {
  const st = lstatRequired(path);
  if (st.isSymbolicLink()) throw invalid("specification must not be a symlink");
  if (!st.isFile()) throw unavailable("specification is not a regular file");
  if (st.size > BigInt(MAX_SPECIFICATION_BYTES)) throw unavailable("specification exceeds 256 KiB");
  return st;
}

interface Read { buffer: Buffer; total: number; opened: BigIntStats; post: BigIntStats }

function readBounded(path: string, pre: BigIntStats, hooks: SpecificationReadHooks): Read {
  hooks.beforeOpen?.();
  let fd: number;
  try {
    // O_NOFOLLOW refuses a symlink in the final component. O_NONBLOCK keeps an opened FIFO from hanging.
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ELOOP") throw invalid("specification must not be a symlink");
    if (code === "ENOENT") throw staleChanged(path);
    throw unavailable("specification could not be opened");
  }
  let read: Read;
  try {
    const opened = io(() => fstatSync(fd, { bigint: true }), "specification could not be inspected");
    if (!opened.isFile()) throw unavailable("specification is not a regular file");
    // Compare the opened descriptor with the pre-open lstat, not only identity. A same-inode rewrite
    // between lstat and open changes size or ctime, so it is refused here.
    if (opened.dev !== pre.dev || opened.ino !== pre.ino || opened.size !== pre.size || opened.mtimeNs !== pre.mtimeNs || opened.ctimeNs !== pre.ctimeNs) {
      throw staleChanged(path);
    }
    if (opened.size > BigInt(MAX_SPECIFICATION_BYTES)) throw unavailable("specification exceeds 256 KiB");

    // One byte beyond the limit detects growth between the fstat and the read.
    const buffer = Buffer.alloc(MAX_SPECIFICATION_BYTES + 1);
    let total = 0;
    while (total < buffer.length) {
      const n = io(() => readSync(fd, buffer, total, buffer.length - total, total), "specification could not be read");
      if (n === 0) break;
      total += n;
    }
    if (total > MAX_SPECIFICATION_BYTES) throw unavailable("specification exceeds 256 KiB");

    // Hook runs outside the conversion below: a hook exception is a test or programmer error.
    hooks.afterRead?.();
    const post = io(() => fstatSync(fd, { bigint: true }), "specification could not be inspected");
    read = { buffer, total, opened, post };
  } finally {
    io(() => closeSync(fd), "specification could not be closed", true);
  }
  return read;
}

function lstatRequired(path: string): BigIntStats {
  try {
    return lstatSync(path, { bigint: true });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") throw unavailable("specification is missing");
    throw unavailable("specification is unreadable");
  }
}

/** Post-read lstat. Any failure here means the path changed or became unreadable during the read. */
function lstatOrStale(path: string): BigIntStats {
  try {
    return lstatSync(path, { bigint: true });
  } catch {
    throw staleChanged(path);
  }
}

/**
 * Runs one raw filesystem call and converts any non-domain failure to unavailable-spec, so no raw
 * errno reaches a caller. `quiet` ignores the failure, used only for a close that cannot change the result.
 */
function io<T>(call: () => T, message: string, quiet = false): T {
  try {
    return call();
  } catch (e) {
    if (e instanceof DomainError) throw e;
    if (quiet) return undefined as T;
    throw unavailable(message);
  }
}

function unavailable(message: string): DomainError {
  return new DomainError("unavailable-spec", message, 2);
}

function invalid(message: string): DomainError {
  return new DomainError("invalid-input", message, 2);
}

function staleChanged(path: string): DomainError {
  return new DomainError("stale-reference", `${path} changed or was replaced while it was being read`, 3);
}
