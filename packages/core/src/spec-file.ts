import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, statSync, type BigIntStats } from "node:fs";
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
 * post-read checks, so a test can mutate the tree at exactly that point.
 */
export interface SpecificationReadHooks {
  afterRead?: () => void;
}

/**
 * Reads one Markdown specification from inside a scope root with a checked snapshot.
 *
 * Refused: absolute paths, `..`, `.`, empty segments, NUL, backslashes, non-Markdown names,
 * symlinks in any relative component (including the final file), non-regular files, files over
 * 256 KiB and malformed UTF-8. Detects replacement or change during the read where possible.
 * This is a best-effort local check. It is not absolute confinement and it does not rule out an
 * ABA rewrite between checks.
 *
 * Error mapping:
 * - invalid-input (exit 2): malformed relative path, or a symlink on the path.
 * - unavailable-spec (exit 2): missing, non-regular, oversized or malformed UTF-8 file.
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
  const filePath = join(chain.at(-1)!.path, parts[parts.length - 1]!);
  const pathStat = regularFileStat(filePath);

  const bytes = readBounded(filePath, pathStat, hooks);
  const post = bytes.post;

  // Post-read checks: the file itself, then every directory on the path must still be the same object.
  const after = lstatOrStale(filePath);
  if (after.isSymbolicLink() || !after.isFile() || after.dev !== pathStat.dev || after.ino !== pathStat.ino) {
    throw staleChanged(relativePath);
  }
  if (post.size !== pathStat.size || post.mtimeNs !== pathStat.mtimeNs || post.ctimeNs !== pathStat.ctimeNs || post.ino !== pathStat.ino || post.dev !== pathStat.dev) {
    throw staleChanged(relativePath);
  }
  for (const link of chain) {
    const current = link.path === root ? statOrStale(link.path) : lstatOrStale(link.path);
    if (current.dev !== link.st.dev || current.ino !== link.st.ino || !current.isDirectory()) {
      throw staleChanged(relativePath);
    }
  }
  if (BigInt(bytes.total) !== post.size) throw staleChanged(relativePath);

  const raw = bytes.buffer.subarray(0, bytes.total);
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw);
  } catch {
    throw new DomainError("unavailable-spec", `${relativePath} is not valid UTF-8`);
  }
  return {
    path: relativePath,
    sha256: createHash("sha256").update(raw).digest("hex"),
    byteLength: bytes.total,
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
  const name = parts[parts.length - 1]!;
  const ext = SPECIFICATION_EXTENSIONS.find(e => name.endsWith(e) && name.length > e.length);
  if (!ext) throw invalid("specification must be a .md or .markdown file");
  return parts;
}

function rootDirectory(root: string): BigIntStats {
  if (typeof root !== "string" || root.length === 0 || root.includes("\0")) throw invalid("scope root must be a nonempty path");
  let st: BigIntStats;
  try {
    st = statSync(root, { bigint: true });
  } catch {
    throw new DomainError("unavailable-spec", "scope root is unavailable");
  }
  if (!st.isDirectory()) throw new DomainError("unavailable-spec", "scope root is not a directory");
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
    if (!st.isDirectory()) throw new DomainError("unavailable-spec", "specification parent is not a directory");
    chain.push({ path: current, st });
  }
  return chain;
}

function regularFileStat(path: string): BigIntStats {
  const st = lstatRequired(path);
  if (st.isSymbolicLink()) throw invalid("specification must not be a symlink");
  if (!st.isFile()) throw new DomainError("unavailable-spec", "specification is not a regular file");
  if (st.size > BigInt(MAX_SPECIFICATION_BYTES)) throw new DomainError("unavailable-spec", "specification exceeds 256 KiB");
  return st;
}

interface Read { buffer: Buffer; total: number; post: BigIntStats }

function readBounded(path: string, pre: BigIntStats, hooks: SpecificationReadHooks): Read {
  let fd: number;
  try {
    // O_NOFOLLOW refuses a symlink in the final component. O_NONBLOCK keeps an opened FIFO from hanging.
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ELOOP") throw invalid("specification must not be a symlink");
    if (code === "ENOENT") throw staleChanged(path);
    throw new DomainError("unavailable-spec", "specification could not be opened");
  }
  try {
    const opened = fstatSync(fd, { bigint: true });
    if (!opened.isFile()) throw new DomainError("unavailable-spec", "specification is not a regular file");
    if (opened.dev !== pre.dev || opened.ino !== pre.ino) throw staleChanged(path);
    if (opened.size > BigInt(MAX_SPECIFICATION_BYTES)) throw new DomainError("unavailable-spec", "specification exceeds 256 KiB");

    // One byte beyond the limit detects growth between the fstat and the read.
    const buffer = Buffer.alloc(MAX_SPECIFICATION_BYTES + 1);
    let total = 0;
    while (total < buffer.length) {
      const n = readSync(fd, buffer, total, buffer.length - total, total);
      if (n === 0) break;
      total += n;
    }
    if (total > MAX_SPECIFICATION_BYTES) throw new DomainError("unavailable-spec", "specification exceeds 256 KiB");

    hooks.afterRead?.();
    const post = fstatSync(fd, { bigint: true });
    return { buffer, total, post };
  } finally {
    try { closeSync(fd); } catch { /* the descriptor is already unusable */ }
  }
}

function lstatRequired(path: string): BigIntStats {
  try {
    return lstatSync(path, { bigint: true });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") throw new DomainError("unavailable-spec", "specification is missing");
    throw new DomainError("unavailable-spec", "specification is unreadable");
  }
}

function lstatOrStale(path: string): BigIntStats {
  try {
    return lstatSync(path, { bigint: true });
  } catch {
    throw staleChanged(path);
  }
}

function statOrStale(path: string): BigIntStats {
  try {
    return statSync(path, { bigint: true });
  } catch {
    throw staleChanged(path);
  }
}

function invalid(message: string): DomainError {
  return new DomainError("invalid-input", message, 2);
}

function staleChanged(path: string): DomainError {
  return new DomainError("stale-reference", `${path} changed or was replaced while it was being read`, 3);
}
