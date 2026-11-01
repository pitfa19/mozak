// mozak-settings.json: optional per-installation settings, next to the inventory file. The inventory stays closed
// (0.4.0 clients must keep loading it), so new switches live here. A 0.4.0 client never reads this file.
//
// { "format": "mozak.settings/v1",
//   "annotations": { "personalVaults": ["../obsidian"] },   (accepted, no effect since 0.5.0)
//   "concurrency": { "rebase": false },
//   "indexRoots": [ { "path": "../vault/personal", "private": true }, { "path": "../vault/research" } ],
//   "scopes": { "anpit": { "annotations": true, "concurrency": { "rebase": true } } },
//   "usageLog": false }
//
// One file per installation, never inside a scope folder: a scope folder can be a public repo.
//
// Only the keys this version understands are validated. Any other key is reported by `check` as
// settings-unknown-key and has no effect.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DomainError } from "./errors.ts";
import { realOrSelf } from "./paths.ts";
import type { ScopeEntry, ScopeInventory } from "./scope-index.ts";

export const SETTINGS_FILE = "mozak-settings.json";
export const SETTINGS_FORMAT = "mozak.settings/v1";
const KNOWN_TOP = ["format", "annotations", "concurrency", "indexRoots", "scopes", "usageLog"];
const KNOWN_SCOPE = ["annotations", "concurrency"];

export interface ConcurrencySettings { rebase?: boolean }
/** A folder that locator resolution searches. private: results carry path and title only, unless a call asks for more. */
export interface IndexRoot { path: string; private: boolean }
export interface Settings {
  path: string | null;
  personalVaults: string[] | null;
  concurrency: ConcurrencySettings;
  /** null or absent: roots are derived from the inventory (locators.ts defaultIndexRoots). */
  indexRoots?: IndexRoot[] | null;
  scopes: Record<string, { annotations?: boolean; concurrency?: ConcurrencySettings }>;
  /** Counts-only usage log next to the inventory. Default off. */
  usageLog: boolean;
  issues: { code: string; message: string }[];
}

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Read settings for an inventory. Absent file: defaults. Invalid file: throws settings-invalid. */
export function loadSettings(inv: ScopeInventory): Settings {
  const inventoryPath = (inv as { path?: string }).path;
  const empty: Settings = { path: null, personalVaults: null, concurrency: {}, indexRoots: null, scopes: {}, usageLog: false, issues: [] };
  if (!inventoryPath) return empty;
  const path = join(dirname(inventoryPath), SETTINGS_FILE);
  let text: string;
  try { text = readFileSync(path, "utf8"); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return empty; throw new DomainError("settings-invalid", `${path}: cannot read settings`, 2); }
  const fail = (why: string): never => { throw new DomainError("settings-invalid", `${path}: ${why}`, 2); };
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return fail("not valid JSON"); }
  if (!isPlain(raw)) return fail("settings must be a JSON object");
  if (raw.format !== SETTINGS_FORMAT) fail(`format must be "${SETTINGS_FORMAT}"`);
  const issues: Settings["issues"] = [];
  for (const key of Object.keys(raw)) {
    if (!KNOWN_TOP.includes(key)) issues.push({ code: "settings-unknown-key", message: `${SETTINGS_FILE}: unknown key "${key}" has no effect` });
  }
  const concurrencyOf = (value: unknown, at: string): ConcurrencySettings => {
    if (!isPlain(value)) return fail(`"${at}" must be an object`);
    for (const key of Object.keys(value)) if (key !== "rebase") issues.push({ code: "settings-unknown-key", message: `${SETTINGS_FILE}: unknown key "${at}.${key}" has no effect` });
    if (value.rebase !== undefined && typeof value.rebase !== "boolean") fail(`${at}.rebase must be true or false`);
    return value.rebase === undefined ? {} : { rebase: value.rebase as boolean };
  };
  const concurrency = raw.concurrency === undefined ? {} : concurrencyOf(raw.concurrency, "concurrency");
  let personalVaults: string[] | null = null;
  if (raw.annotations !== undefined) {
    if (!isPlain(raw.annotations)) fail(`"annotations" must be an object`);
    const a = raw.annotations as Record<string, unknown>;
    for (const key of Object.keys(a)) if (key !== "personalVaults") issues.push({ code: "settings-unknown-key", message: `${SETTINGS_FILE}: unknown key "annotations.${key}" has no effect` });
    if (a.personalVaults !== undefined) {
      if (!Array.isArray(a.personalVaults) || a.personalVaults.some((p) => typeof p !== "string" || !p.trim())) fail(`"annotations.personalVaults" must be an array of paths`);
      personalVaults = (a.personalVaults as string[]).map((p) => realOrSelf(resolve(dirname(path), p)));
    }
  }
  let indexRoots: IndexRoot[] | null = null;
  if (raw.indexRoots !== undefined) {
    if (!Array.isArray(raw.indexRoots)) fail(`"indexRoots" must be an array of { "path": ..., "private": true or false }`);
    indexRoots = (raw.indexRoots as unknown[]).map((item, i) => {
      if (!isPlain(item)) return fail(`indexRoots[${i}] must be an object`);
      for (const key of Object.keys(item)) if (key !== "path" && key !== "private") issues.push({ code: "settings-unknown-key", message: `${SETTINGS_FILE}: unknown key "indexRoots[${i}].${key}" has no effect` });
      if (typeof item.path !== "string" || !item.path.trim()) fail(`indexRoots[${i}].path must be a non-empty path`);
      if (item.private !== undefined && typeof item.private !== "boolean") fail(`indexRoots[${i}].private must be true or false`);
      return { path: realOrSelf(resolve(dirname(path), item.path as string)), private: item.private === true };
    });
  }
  const scopes: Settings["scopes"] = {};
  if (raw.scopes !== undefined) {
    if (!isPlain(raw.scopes)) fail(`"scopes" must be an object keyed by scope id`);
    for (const [id, value] of Object.entries(raw.scopes as Record<string, unknown>)) {
      if (!isPlain(value)) fail(`scopes.${id} must be an object`);
      const v = value as Record<string, unknown>;
      for (const key of Object.keys(v)) if (!KNOWN_SCOPE.includes(key)) issues.push({ code: "settings-unknown-key", message: `${SETTINGS_FILE}: unknown key "scopes.${id}.${key}" has no effect` });
      if (v.annotations !== undefined && typeof v.annotations !== "boolean") fail(`scopes.${id}.annotations must be true or false`);
      scopes[id] = {
        ...(v.annotations === undefined ? {} : { annotations: v.annotations as boolean }),
        ...(v.concurrency === undefined ? {} : { concurrency: concurrencyOf(v.concurrency, `scopes.${id}.concurrency`) }),
      };
      if (!inv.scopes.some((s) => s.id === id)) issues.push({ code: "settings-unknown-scope", message: `${SETTINGS_FILE}: scope "${id}" is not in the inventory` });
    }
  }
  return { path, personalVaults, concurrency, indexRoots, scopes, usageLog: usageLogOf(raw.usageLog, fail), issues };
}

/** `usageLog`: absent is off, otherwise it must be a boolean. */
function usageLogOf(value: unknown, fail: (why: string) => never): boolean {
  if (value === undefined) return false;
  return typeof value === "boolean" ? value : fail(`"usageLog" must be true or false`);
}

/**
 * Experimental read-set rebase for one scope (S1b). A per-scope `scopes.<id>.concurrency.rebase` wins over the
 * top-level `concurrency.rebase`. Default off. An unreadable or invalid settings file keeps it off; `check`
 * reports the file.
 */
export function rebaseEnabled(inv: ScopeInventory, scopeId: string): boolean {
  let settings: Settings;
  try { settings = loadSettings(inv); }
  catch (e) { if (e instanceof DomainError) return false; throw e; }
  return (settings.scopes[scopeId]?.concurrency?.rebase ?? settings.concurrency.rebase) === true;
}

/** The `usageLog` setting. An unreadable or invalid settings file keeps it off; `check` reports the file. */
export function usageLogSetting(inv: ScopeInventory): boolean {
  try { return loadSettings(inv).usageLog; }
  catch (e) { if (e instanceof DomainError) return false; throw e; }
}

/** A mozak-settings.json inside a scope folder is never read. Returns its path when one exists, for `check`. */
export function ignoredScopeSettingsFile(inv: ScopeInventory, entry: ScopeEntry): string | null {
  const local = join(entry.root, SETTINGS_FILE);
  if (!existsSync(local)) return null;
  const inventoryPath = (inv as { path?: string }).path;
  if (inventoryPath && realOrSelf(join(dirname(inventoryPath), SETTINGS_FILE)) === realOrSelf(local)) return null;
  return local;
}

export type AnnotationsMode = { enabled: true; source: "setting" } | { enabled: false; source: "setting" | "default" };

/**
 * Whether owner annotations are on for a scope. Off by default (0.5.0): a scope without `scopes.<id>.annotations: true`
 * behaves like 0.4.7, its sidecar is never read and `annotate` is refused. `annotations.personalVaults` is still
 * accepted for older settings files and has no effect.
 */
export function annotationsMode(settings: Settings, entry: ScopeEntry): AnnotationsMode {
  const explicit = settings.scopes[entry.id]?.annotations;
  if (explicit === true) return { enabled: true, source: "setting" };
  return { enabled: false, source: explicit === false ? "setting" : "default" };
}

/** annotationsMode for one scope of an inventory. An unreadable or invalid settings file keeps annotations off. */
export function annotationsEnabled(inv: ScopeInventory, entry: ScopeEntry): boolean {
  try { return annotationsMode(loadSettings(inv), entry).enabled; }
  catch (e) { if (e instanceof DomainError) return false; throw e; }
}
