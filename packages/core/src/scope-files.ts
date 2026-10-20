// The two plan files of a scope. Since 0.4 they are lowercase (mozak.json, mozak.md). Scopes made by
// older versions keep the uppercase names until renamed, so every reader accepts both, and writes go to
// whichever name the scope already has. A new scope always gets the lowercase names.
import { readdirSync } from "node:fs";
import { basename, join } from "node:path";

export const GRAPH_FILE = "mozak.json";
export const BRIDGE_FILE = "mozak.md";
export const LEGACY_GRAPH_FILE = "MOZAK.json";
export const LEGACY_BRIDGE_FILE = "MOZAK.md";
/** Every name a plan file may have, current names first. */
export const SCOPE_FILE_NAMES = [GRAPH_FILE, BRIDGE_FILE, LEGACY_GRAPH_FILE, LEGACY_BRIDGE_FILE] as const;

export type ScopeFileKind = "graph" | "bridge";

/**
 * Exact-case file name in `root`: the lowercase name when present, else the pre-0.4 uppercase name when present,
 * else the lowercase name for a file that does not exist yet. Listing the folder gives the real case, even on a
 * case-insensitive disk.
 */
export function scopeFileName(root: string, kind: ScopeFileKind): string {
  const [current, legacy] = kind === "graph" ? [GRAPH_FILE, LEGACY_GRAPH_FILE] : [BRIDGE_FILE, LEGACY_BRIDGE_FILE];
  let names: string[];
  try { names = readdirSync(root); } catch { return current; }
  if (names.includes(current)) return current;
  if (names.includes(legacy)) return legacy;
  return current;
}

export function scopeFile(root: string, kind: ScopeFileKind): string {
  return join(root, scopeFileName(root, kind));
}

export const isGraphFileName = (name: string): boolean => name === GRAPH_FILE || name === LEGACY_GRAPH_FILE;
export const isBridgeFileName = (name: string): boolean => name === BRIDGE_FILE || name === LEGACY_BRIDGE_FILE;
export const isGraphPath = (path: string): boolean => isGraphFileName(basename(path));
