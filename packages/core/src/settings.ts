// mozak-settings.json: optional per-installation settings, next to the inventory file. The inventory stays closed
// (0.4.0 clients must keep loading it), so new switches live here. A 0.4.0 client never reads this file.
//
// { "format": "mozak.settings/v1",
//   "annotations": { "personalVaults": ["../obsidian"] },
//   "scopes": { "anpit": { "annotations": false } } }
//
// Only the keys this version understands are validated. Keys reserved for later slices are accepted. Any other
// key is reported by `check` as settings-unknown-key and has no effect.

import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { DomainError } from "./errors.ts";
import type { ScopeEntry, ScopeInventory } from "./scope-index.ts";

export const SETTINGS_FILE = "mozak-settings.json";
export const SETTINGS_FORMAT = "mozak.settings/v1";
const RESERVED_TOP = ["concurrency", "indexRoots"];
const KNOWN_TOP = ["format", "annotations", "scopes"];

export interface Settings {
  path: string | null;
  personalVaults: string[] | null;
  scopes: Record<string, { annotations?: boolean }>;
  issues: { code: string; message: string }[];
}

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
function realOr(path: string): string { try { return realpathSync(path); } catch { return path; } }

/** Read settings for an inventory. Absent file: defaults. Invalid file: throws settings-invalid. */
export function loadSettings(inv: ScopeInventory): Settings {
  const inventoryPath = (inv as { path?: string }).path;
  const empty: Settings = { path: null, personalVaults: null, scopes: {}, issues: [] };
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
    if (!KNOWN_TOP.includes(key) && !RESERVED_TOP.includes(key)) issues.push({ code: "settings-unknown-key", message: `${SETTINGS_FILE}: unknown key "${key}" has no effect` });
  }
  let personalVaults: string[] | null = null;
  if (raw.annotations !== undefined) {
    if (!isPlain(raw.annotations)) fail(`"annotations" must be an object`);
    const a = raw.annotations as Record<string, unknown>;
    for (const key of Object.keys(a)) if (key !== "personalVaults") issues.push({ code: "settings-unknown-key", message: `${SETTINGS_FILE}: unknown key "annotations.${key}" has no effect` });
    if (a.personalVaults !== undefined) {
      if (!Array.isArray(a.personalVaults) || a.personalVaults.some((p) => typeof p !== "string" || !p.trim())) fail(`"annotations.personalVaults" must be an array of paths`);
      personalVaults = (a.personalVaults as string[]).map((p) => realOr(resolve(dirname(path), p)));
    }
  }
  const scopes: Settings["scopes"] = {};
  if (raw.scopes !== undefined) {
    if (!isPlain(raw.scopes)) fail(`"scopes" must be an object keyed by scope id`);
    for (const [id, value] of Object.entries(raw.scopes as Record<string, unknown>)) {
      if (!isPlain(value)) fail(`scopes.${id} must be an object`);
      const v = value as Record<string, unknown>;
      for (const key of Object.keys(v)) if (key !== "annotations" && !RESERVED_TOP.includes(key)) issues.push({ code: "settings-unknown-key", message: `${SETTINGS_FILE}: unknown key "scopes.${id}.${key}" has no effect` });
      if (v.annotations !== undefined && typeof v.annotations !== "boolean") fail(`scopes.${id}.annotations must be true or false`);
      scopes[id] = v.annotations === undefined ? {} : { annotations: v.annotations as boolean };
      if (!inv.scopes.some((s) => s.id === id)) issues.push({ code: "settings-unknown-scope", message: `${SETTINGS_FILE}: scope "${id}" is not in the inventory` });
    }
  }
  return { path, personalVaults, scopes, issues };
}

export type AnnotationsMode = { enabled: true; source: "setting" | "default" } | { enabled: false; source: "setting" | "default" | "repo-mode" };

/**
 * Whether the owner may annotate a scope. Repo-mode remote scopes are always refused: their plans are committed and
 * pushed to a repository, which may be public. Otherwise an explicit per-scope setting wins. The default is on for
 * local and vault-plans scopes, narrowed to roots inside `annotations.personalVaults` when that list is set.
 */
export function annotationsMode(settings: Settings, entry: ScopeEntry): AnnotationsMode {
  if (entry.remote && entry.remote.plansMode === "repo") return { enabled: false, source: "repo-mode" };
  const explicit = settings.scopes[entry.id]?.annotations;
  if (explicit !== undefined) return explicit ? { enabled: true, source: "setting" } : { enabled: false, source: "setting" };
  if (settings.personalVaults) {
    const root = realOr(entry.root);
    const inside = settings.personalVaults.some((v) => root === v || root.startsWith(v.endsWith(sep) ? v : v + sep));
    return inside ? { enabled: true, source: "default" } : { enabled: false, source: "default" };
  }
  return { enabled: true, source: "default" };
}
