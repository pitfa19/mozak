import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Optional per-scope settings file next to mozak.json. Absent means every default. */
export const SETTINGS_FILE = "mozak-settings.json";
const MAX_SETTINGS_BYTES = 64 * 1024;

export interface ScopeSettings { concurrency: { rebase: boolean } }

export const DEFAULT_SETTINGS: ScopeSettings = Object.freeze({ concurrency: Object.freeze({ rebase: false }) }) as ScopeSettings;

/**
 * Read mozak-settings.json from a scope root. Unknown keys are ignored. A missing, oversized, symlinked or
 * malformed file, or a value of the wrong type, gives the default. A setting only turns on with an exact `true`.
 */
export function readScopeSettings(root: string): ScopeSettings {
  let raw: unknown;
  try {
    const path = join(root, SETTINGS_FILE);
    const st = lstatSync(path);
    if (!st.isFile() || st.isSymbolicLink() || st.size > MAX_SETTINGS_BYTES) return DEFAULT_SETTINGS;
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return DEFAULT_SETTINGS;
  }
  const concurrency = isObject(raw) ? raw.concurrency : undefined;
  return { concurrency: { rebase: isObject(concurrency) && concurrency.rebase === true } };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
