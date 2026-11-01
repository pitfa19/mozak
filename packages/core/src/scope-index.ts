import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, statSync, type Stats } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { DomainError } from "./errors.ts";
import type { RemoteInfo } from "./remote-meta.ts";
import { isLegacyEntry, LEGACY_KEYS, legacyLocation } from "./legacy-entry.ts";
import { vaultOf } from "./vault-config.ts";

/** Pilot-local explicit inventory. Never a global registration or a directory scan. */
export const INVENTORY_FORMAT_V2 = "mozak.local/v2" as const;
/** v3 adds optional remote scope entries. v2 inventories are still accepted unchanged. */
export const INVENTORY_FORMAT = "mozak.local/v3" as const;
export type InventoryFormat = typeof INVENTORY_FORMAT_V2 | typeof INVENTORY_FORMAT;
export const WRITE_LOCK_DIR = ".mozak-write-lock";
import { SCOPE_FILE_NAMES } from "./scope-files.ts";

export interface ScopeEntry {
  id: string;
  /** Canonical absolute root as observed at inventory load (or lexical path for a root not yet present). */
  root: string;
  /** Present only for a remote scope. `root` is then the cache working copy, or the full clone after `mozak pull`. */
  remote?: RemoteInfo;
  /** Diagnostic only: reserved x settings were ignored at inventory or selected-entry level. */
  inventoryExtensionsIgnored?: true;
  /**
   * Set when the entry is kept in the inventory but every route refuses it (for example a root outside any vault).
   * `resolveScope` throws it. `mozak scope move` still reads the entry, so the owner can move it.
   */
  refused?: { code: string; message: string };
}

export interface ScopeInventory {
  format: InventoryFormat;
  scopes: ScopeEntry[];
  /** SHA-256 over the normalized explicit inventory: format plus sorted id and canonical root. */
  digest: string;
  /** Absolute inventory file path, set by loadInventory as a non-enumerable property. */
  readonly path?: string;
}

const INVENTORY_KEYS = ["format", "scopes"] as const;
const ENTRY_KEYS = ["id", "root"] as const;
/** Optional on every scope entry. `focus`: the owner's starred plan ids, read by the plugin and `mozak focus` only. */
const OPTIONAL_ENTRY_KEYS = ["focus"] as const;
/** A legacy entry's id named a cache folder, so it never held path characters. */
const LEGACY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorCode(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "code" in err) {
    return String(err.code);
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
  optional: readonly string[] = [],
): void {
  for (const key of Object.keys(value)) {
    if (key !== "x" && !allowed.includes(key) && !optional.includes(key)) throw invalidInventory(file, `unknown key "${key}" in ${where}`);
  }
  assertExtensionObject(value, where, file);
  for (const key of allowed) {
    if (!(key in value)) throw invalidInventory(file, `missing "${key}" in ${where}`);
  }
}

function assertExtensionObject(value: Record<string, unknown>, where: string, file: string): void {
  if ("x" in value && !isPlainObject(value.x)) throw invalidInventory(file, `"x" in ${where} must be an object`);
}

/** `focus`, when present: an array of unique nonempty plan id strings. Unknown ids are a `check` warning, not an error. */
function assertFocus(entry: Record<string, unknown>, file: string): void {
  if (!("focus" in entry)) return;
  const focus = entry.focus;
  if (!Array.isArray(focus) || focus.some((id) => typeof id !== "string" || id.trim() === "") || new Set(focus).size !== focus.length) {
    throw invalidInventory(file, `scope "${String(entry.id)}" focus must be an array of unique plan ids`);
  }
}

/**
 * Canonical identity for a path. Existing paths resolve through realpath. A path that does not
 * exist yet keeps its canonical ancestor plus the remaining lexical segments, so a root that
 * appears later can still be compared by identity.
 */
export function canonicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    const parent = dirname(path);
    if (parent === path) return path;
    return join(canonicalPath(parent), basename(path));
  }
}

function digestOf(format: string, scopes: ScopeEntry[]): string {
  // Format plus sorted id and canonical root: the exact v2 shape, so existing digests do not change.
  const canonical = JSON.stringify({ format, scopes: scopes.map((scope) => ({ id: scope.id, root: scope.root })) });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function readInventoryJson(file: string): Record<string, unknown> {
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
  if (!Array.isArray(raw.scopes)) throw invalidInventory(file, `"scopes" must be an array`);
  return raw;
}

/** A retired repo-scope entry (v3 only): closed keys, no root, an id that named a cache folder. */
function legacyEntry(entry: Record<string, unknown>, file: string, base: string): ScopeEntry {
  for (const key of Object.keys(entry)) {
    if (key === "root") throw invalidInventory(file, `scope entry must have exactly one of "root" or "remote"`);
    if (key !== "x" && key !== "id" && !(LEGACY_KEYS as readonly string[]).includes(key) && !(OPTIONAL_ENTRY_KEYS as readonly string[]).includes(key)) {
      throw invalidInventory(file, `unknown key "${key}" in scope entry`);
    }
  }
  assertExtensionObject(entry, "scope entry", file);
  const id = entryId(entry, file);
  if (!LEGACY_ID_PATTERN.test(id)) throw invalidInventory(file, `scope id "${id}" must use letters, digits, ".", "_" or "-"`);
  const { root, refused } = legacyLocation(base, file, id, entry, canonicalPath);
  return { id, root, refused };
}

function entryId(entry: Record<string, unknown>, file: string): string {
  const id = entry.id;
  if (typeof id !== "string" || id.trim() === "") throw invalidInventory(file, "scope id must be a nonempty string");
  return id;
}

/** A working scope entry: { id, root } plus optional keys. The vault rule marks a root outside a vault as refused. */
function localEntry(entry: Record<string, unknown>, file: string, base: string): ScopeEntry {
  assertClosedObject(entry, ENTRY_KEYS, "scope entry", file, OPTIONAL_ENTRY_KEYS);
  const id = entryId(entry, file);
  const rawRoot = entry.root;
  if (typeof rawRoot !== "string" || rawRoot.trim() === "") throw invalidInventory(file, `scope "${id}" root must be a nonempty string`);
  const root = canonicalPath(resolve(base, rawRoot));
  const refused = vaultRule(id, root);
  return refused ? { id, root, refused } : { id, root };
}

/** Each id and each canonical root appears once. */
function assertUnique(scope: ScopeEntry, seen: { ids: Set<string>; roots: Map<string, string> }, file: string): void {
  if (seen.ids.has(scope.id)) throw new DomainError("inventory-duplicate-id", `${file}: duplicate scope id "${scope.id}"`);
  seen.ids.add(scope.id);
  const prior = seen.roots.get(scope.root);
  if (prior !== undefined) {
    throw new DomainError("inventory-duplicate-root", `${file}: scopes "${prior}" and "${scope.id}" resolve to the same root ${scope.root}`);
  }
  seen.roots.set(scope.root, scope.id);
}

/**
 * Read and validate an explicit local inventory. Relative roots resolve against the config
 * directory. Missing or unreadable roots are retained so that only the selected scope fails later.
 * Entries outside a vault and retired repo-scope entries are kept but refused (see `refused`).
 */
export function loadInventory(configPath: string): ScopeInventory {
  const file = resolve(configPath);
  const raw = readInventoryJson(file);
  const format = raw.format as InventoryFormat;
  const base = dirname(file);
  const seen = { ids: new Set<string>(), roots: new Map<string, string>() };
  const scopes: ScopeEntry[] = [];

  for (const entry of raw.scopes as unknown[]) {
    if (!isPlainObject(entry)) throw invalidInventory(file, "each scope must be an object");
    const scope = format === INVENTORY_FORMAT && isLegacyEntry(entry) ? legacyEntry(entry, file, base) : localEntry(entry, file, base);
    assertFocus(entry, file);
    assertUnique(scope, seen, file);
    if ("x" in raw || "x" in entry) scope.inventoryExtensionsIgnored = true;
    scopes.push(scope);
  }

  // Ids are unique (assertUnique), so ordering by "is a before b" is total. Code-point order, not locale order.
  scopes.sort((a, b) => (a.id < b.id ? -1 : 1));
  const inventory: ScopeInventory = { format, scopes, digest: digestOf(format, scopes) };
  // Not enumerable: the loaded inventory compares and serializes exactly as before. Used to find mozak-settings.json.
  Object.defineProperty(inventory, "path", { value: file, enumerable: false });
  return inventory;
}

/**
 * The vault rule: a scope root must sit at or below a folder that has a .obsidian folder. An entry that breaks it is
 * kept (so other scopes keep working and `scope move` can read it) and refused by every route.
 */
function vaultRule(id: string, root: string): ScopeEntry["refused"] | undefined {
  if (vaultOf(root) !== null) return undefined;
  return {
    code: "scope-outside-vault",
    message: `scope "${id}" is not inside an Obsidian vault (${root} has no folder with .obsidian above it). mozak keeps plans in vaults only: run mozak scope move --scope ${id} --to <folder in a vault> --owner-ref REF --owner-message-at ISO --reason TEXT`,
  };
}

/** The one entry with this id, unless it is missing, listed twice or refused (outside a vault, legacy). */
function selectEntry(inv: ScopeInventory, id: string): ScopeEntry {
  const matches = inv.scopes.filter((scope) => scope.id === id);
  if (matches.length === 0) {
    throw new DomainError("scope-not-found", `no scope "${id}" in the inventory; run mozak scopes (MCP mozak_scopes) to list the scope ids`);
  }
  if (matches.length > 1) throw new DomainError("scope-ambiguous", `scope "${id}" is listed more than once`);
  const entry = matches[0]!;
  if (entry.refused) throw new DomainError(entry.refused.code, entry.refused.message);
  return entry;
}

/**
 * Select exactly one inventoried scope and verify its root is still the same directory that was
 * recorded at load. Reads only; nothing is created or modified.
 */
export function resolveScope(inv: ScopeInventory, id: string): ScopeEntry {
  const entry = selectEntry(inv, id);

  let real: string;
  let stats: Stats;
  try {
    real = realpathSync(entry.root);
    stats = statSync(real);
  } catch (err) {
    if (isMissing(err)) {
      const hint = entry.remote ? (entry.remote.plansMode === "vault" ? " (vault plans folder missing)" : " (remote scope not fetched yet: run `mozak sync`)") : "";
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
  return { ...entry, root: real };
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

  for (const name of SCOPE_FILE_NAMES) {
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
