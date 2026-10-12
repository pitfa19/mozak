import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, statSync, type Stats } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { DomainError } from "./errors.ts";

/** Pilot-local explicit inventory. Never a global registration or a directory scan. */
export const INVENTORY_FORMAT = "mozak.local/v2" as const;
export const WRITE_LOCK_DIR = ".mozak-write-lock";
const GRAPH_FILE = "MOZAK.json";
const BRIDGE_FILE = "MOZAK.md";

export interface ScopeEntry {
  id: string;
  /** Canonical absolute root as observed at inventory load (or lexical path for a root not yet present). */
  root: string;
}

export interface ScopeInventory {
  format: typeof INVENTORY_FORMAT;
  scopes: ScopeEntry[];
  /** SHA-256 over the normalized explicit inventory: format plus sorted id and canonical root. */
  digest: string;
}

const INVENTORY_KEYS = ["format", "scopes"] as const;
const ENTRY_KEYS = ["id", "root"] as const;

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
    scopes: scopes.map((scope) => ({ id: scope.id, root: scope.root })),
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
  if (raw.format !== INVENTORY_FORMAT) {
    throw invalidInventory(file, `format must be "${INVENTORY_FORMAT}"`);
  }
  if (!Array.isArray(raw.scopes)) throw invalidInventory(file, `"scopes" must be an array`);

  const base = dirname(file);
  const seenIds = new Set<string>();
  const seenRoots = new Map<string, string>();
  const scopes: ScopeEntry[] = [];

  for (const entry of raw.scopes) {
    if (!isPlainObject(entry)) throw invalidInventory(file, "each scope must be an object");
    assertClosedObject(entry, ENTRY_KEYS, "scope entry", file);

    const id = entry.id;
    const root = entry.root;
    if (typeof id !== "string" || id.trim() === "") {
      throw invalidInventory(file, "scope id must be a nonempty string");
    }
    if (typeof root !== "string" || root.trim() === "") {
      throw invalidInventory(file, `scope "${id}" root must be a nonempty string`);
    }

    if (seenIds.has(id)) {
      throw new DomainError("inventory-duplicate-id", `${file}: duplicate scope id "${id}"`);
    }
    seenIds.add(id);

    const canonical = canonicalPath(resolve(base, root));
    const prior = seenRoots.get(canonical);
    if (prior !== undefined) {
      throw new DomainError(
        "inventory-duplicate-root",
        `${file}: scopes "${prior}" and "${id}" resolve to the same root ${canonical}`,
      );
    }
    seenRoots.set(canonical, id);
    scopes.push({ id, root: canonical });
  }

  scopes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { format: INVENTORY_FORMAT, scopes, digest: digestOf(INVENTORY_FORMAT, scopes) };
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
      throw new DomainError("scope-root-missing", `scope "${id}" root is missing: ${entry.root}`);
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
  return { id: entry.id, root: real };
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
