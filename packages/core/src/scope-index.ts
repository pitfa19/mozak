import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync, statSync, type Stats } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { DomainError } from "./errors.ts";
import { cacheRootFor, parseRemoteSpec, readRemoteMeta, DEFAULT_REF, REF_PATTERN, type RemoteInfo } from "./remote-meta.ts";

/** Pilot-local explicit inventory. Never a global registration or a directory scan. */
export const INVENTORY_FORMAT_V2 = "mozak.local/v2" as const;
/** v3 adds optional remote scope entries. v2 inventories are still accepted unchanged. */
export const INVENTORY_FORMAT = "mozak.local/v3" as const;
export type InventoryFormat = typeof INVENTORY_FORMAT_V2 | typeof INVENTORY_FORMAT;
export const WRITE_LOCK_DIR = ".mozak-write-lock";
const GRAPH_FILE = "MOZAK.json";
const BRIDGE_FILE = "MOZAK.md";

export interface ScopeEntry {
  id: string;
  /** Canonical absolute root as observed at inventory load (or lexical path for a root not yet present). */
  root: string;
  /** Present only for a remote scope. `root` is then the cache working copy, or the full clone after `mozak pull`. */
  remote?: RemoteInfo;
}

export interface ScopeInventory {
  format: InventoryFormat;
  scopes: ScopeEntry[];
  /** SHA-256 over the normalized explicit inventory: format plus sorted id and canonical root. */
  digest: string;
}

const INVENTORY_KEYS = ["format", "scopes"] as const;
const ENTRY_KEYS = ["id", "root"] as const;
const REMOTE_ENTRY_KEYS = ["id", "remote", "ref"] as const;
const REMOTE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorCode(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "code" in err) {
    return String((err as { code: unknown }).code);
  }
  return undefined;
}

/** A path that does not exist, or whose parent is not a directory. */
function isMissing(err: unknown): boolean {
  const code = errorCode(err);
  return code === "ENOENT" || code === "ENOTDIR";
}

function invalidInventory(file: string, why: string): DomainError {
  return new DomainError("inventory-invalid", `${file}: ${why}`);
}

function assertClosedObject(
  value: Record<string, unknown>,
  allowed: readonly string[],
  where: string,
  file: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw invalidInventory(file, `unknown key "${key}" in ${where}`);
  }
  for (const key of allowed) {
    if (!(key in value)) throw invalidInventory(file, `missing "${key}" in ${where}`);
  }
}

/**
 * Canonical identity for a path. Existing paths resolve through realpath. A path that does not
 * exist yet keeps its canonical ancestor plus the remaining lexical segments, so a root that
 * appears later can still be compared by identity.
 */
function canonicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    const parent = dirname(path);
    if (parent === path) return path;
    return join(canonicalPath(parent), basename(path));
  }
}

function digestOf(format: string, scopes: ScopeEntry[]): string {
  const canonical = JSON.stringify({
    format,
    // Local entries keep the exact v2 shape, so existing digests do not change.
    scopes: scopes.map((scope) =>
      scope.remote ? { id: scope.id, root: scope.root, remote: scope.remote.spec, ref: scope.remote.ref } : { id: scope.id, root: scope.root },
    ),
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * Read and validate an explicit local inventory. Relative roots resolve against the config
 * directory. Missing or unreadable roots are retained so that only the selected scope fails later.
 */
export function loadInventory(configPath: string): ScopeInventory {
  const file = resolve(configPath);

  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (err) {
    throw new DomainError("inventory-unreadable", `${file}: cannot read inventory (${errorCode(err) ?? "unknown"})`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw invalidInventory(file, "inventory is not valid JSON");
  }

  if (!isPlainObject(raw)) throw invalidInventory(file, "inventory must be a JSON object");
  assertClosedObject(raw, INVENTORY_KEYS, "inventory", file);
  if (raw.format !== INVENTORY_FORMAT && raw.format !== INVENTORY_FORMAT_V2) {
    throw invalidInventory(file, `format must be "${INVENTORY_FORMAT}" or "${INVENTORY_FORMAT_V2}"`);
  }
  const format: InventoryFormat = raw.format;
  if (!Array.isArray(raw.scopes)) throw invalidInventory(file, `"scopes" must be an array`);

  const base = dirname(file);
  const seenIds = new Set<string>();
  const seenRoots = new Map<string, string>();
  const scopes: ScopeEntry[] = [];

  for (const entry of raw.scopes) {
    if (!isPlainObject(entry)) throw invalidInventory(file, "each scope must be an object");
    const isRemote = format === INVENTORY_FORMAT && "remote" in entry;
    if (isRemote) {
      // Exactly one of root or remote. The ref is optional and defaults to main. The object stays closed.
      for (const key of Object.keys(entry)) {
        if (!(REMOTE_ENTRY_KEYS as readonly string[]).includes(key)) {
          throw invalidInventory(file, key === "root" ? `scope entry must have exactly one of "root" or "remote"` : `unknown key "${key}" in scope entry`);
        }
      }
      if (!("id" in entry)) throw invalidInventory(file, `missing "id" in scope entry`);
    } else {
      assertClosedObject(entry, ENTRY_KEYS, "scope entry", file);
    }

    const id = entry.id;
    if (typeof id !== "string" || id.trim() === "") {
      throw invalidInventory(file, "scope id must be a nonempty string");
    }
    let root: string;
    let remote: RemoteInfo | undefined;
    if (isRemote) {
      if (!REMOTE_ID_PATTERN.test(id)) {
        throw invalidInventory(file, `remote scope id "${id}" must use letters, digits, ".", "_" or "-" (it names a cache folder)`);
      }
      if (typeof entry.remote !== "string") throw invalidInventory(file, `scope "${id}" remote must be a string`);
      const ref = entry.ref === undefined ? DEFAULT_REF : entry.ref;
      if (typeof ref !== "string" || !REF_PATTERN.test(ref)) {
        throw invalidInventory(file, `scope "${id}" ref must be a plain branch name`);
      }
      const parsed = parseRemoteSpec(entry.remote);
      if (!parsed) {
        throw invalidInventory(file, `scope "${id}" remote must look like "github:owner/repo", an https:// URL or an absolute file:// URL`);
      }
      const cacheRoot = canonicalPath(cacheRootFor(base, id));
      const meta = readRemoteMeta(base, id);
      const fullClone = meta.fullClone !== null && existsSync(join(meta.fullClone, ".git")) && existsSync(join(meta.fullClone, "MOZAK.json")) ? canonicalPath(meta.fullClone) : null;
      root = fullClone ?? cacheRoot;
      remote = { spec: entry.remote, url: parsed.url, ref, repoName: parsed.repoName, baseDir: base, cacheRoot, fullClone };
    } else {
      const rawRoot = entry.root;
      if (typeof rawRoot !== "string" || rawRoot.trim() === "") {
        throw invalidInventory(file, `scope "${id}" root must be a nonempty string`);
      }
      root = canonicalPath(resolve(base, rawRoot));
    }

    if (seenIds.has(id)) {
      throw new DomainError("inventory-duplicate-id", `${file}: duplicate scope id "${id}"`);
    }
    seenIds.add(id);

    const canonical = root;
    const prior = seenRoots.get(canonical);
    if (prior !== undefined) {
      throw new DomainError(
        "inventory-duplicate-root",
        `${file}: scopes "${prior}" and "${id}" resolve to the same root ${canonical}`,
      );
    }
    seenRoots.set(canonical, id);
    scopes.push(remote ? { id, root: canonical, remote } : { id, root: canonical });
  }

  scopes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { format, scopes, digest: digestOf(format, scopes) };
}

/**
 * Select exactly one inventoried scope and verify its root is still the same directory that was
 * recorded at load. Reads only; nothing is created or modified.
 */
export function resolveScope(inv: ScopeInventory, id: string): ScopeEntry {
  const matches = inv.scopes.filter((scope) => scope.id === id);
  if (matches.length === 0) {
    throw new DomainError("scope-not-found", `no scope "${id}" in the inventory`);
  }
  const entry = matches[0];
  if (matches.length > 1 || entry === undefined) {
    throw new DomainError("scope-ambiguous", `scope "${id}" is listed more than once`);
  }

  let real: string;
  let stats: Stats;
  try {
    real = realpathSync(entry.root);
    stats = statSync(real);
  } catch (err) {
    if (isMissing(err)) {
      const hint = entry.remote ? " (remote scope not fetched yet: run `mozak sync`)" : "";
      throw new DomainError("scope-root-missing", `scope "${id}" root is missing: ${entry.root}${hint}`);
    }
    throw new DomainError("scope-root-unreadable", `scope "${id}" root is unreadable: ${entry.root}`);
  }

  if (!stats.isDirectory()) {
    throw new DomainError("scope-root-not-directory", `scope "${id}" root is not a directory: ${entry.root}`);
  }
  if (real !== entry.root) {
    throw new DomainError(
      "scope-root-identity-changed",
      `scope "${id}" root now resolves to ${real}, not the inventoried ${entry.root}`,
    );
  }
  return entry.remote ? { id: entry.id, root: real, remote: entry.remote } : { id: entry.id, root: real };
}

function lstatOrNull(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch (err) {
    if (isMissing(err)) return null;
    throw new DomainError("scope-file-unreadable", `cannot inspect ${path}`);
  }
}

/**
 * Reject unsafe local state before any scope operation uses it. Missing graph, bridge, and lock
 * paths are allowed here. Symlinks are forbidden for all three. Writes nothing.
 */
export function assertScopeFiles(root: string): void {
  let stats: Stats;
  try {
    stats = statSync(root);
  } catch (err) {
    if (isMissing(err)) throw new DomainError("scope-root-missing", `scope root is missing: ${root}`);
    throw new DomainError("scope-root-unreadable", `scope root is unreadable: ${root}`);
  }
  if (!stats.isDirectory()) {
    throw new DomainError("scope-root-not-directory", `scope root is not a directory: ${root}`);
  }

  for (const name of [GRAPH_FILE, BRIDGE_FILE]) {
    const entry = lstatOrNull(join(root, name));
    if (entry === null) continue;
    if (entry.isSymbolicLink()) {
      throw new DomainError("scope-symlink-forbidden", `${name} must not be a symlink in ${root}`);
    }
    if (!entry.isFile()) {
      throw new DomainError("scope-file-not-regular", `${name} must be a regular file in ${root}`);
    }
  }

  const lock = lstatOrNull(join(root, WRITE_LOCK_DIR));
  if (lock === null) return;
  if (lock.isSymbolicLink()) {
    throw new DomainError("scope-symlink-forbidden", `${WRITE_LOCK_DIR} must not be a symlink in ${root}`);
  }
  if (!lock.isDirectory()) {
    throw new DomainError("scope-lock-not-directory", `${WRITE_LOCK_DIR} must be a directory in ${root}`);
  }
}
