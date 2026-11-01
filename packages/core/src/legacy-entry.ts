// Legacy repo-scope entries. Before 0.6.0 an inventory entry could name a git repo instead of a folder:
// { id, remote, ref?, plans? }. mozak 0.6.0 keeps plans in vault folders only, so such an entry is no longer a working
// scope. The loader keeps it (never a whole-inventory error) as a refused entry whose root is where its plan files are
// on this machine, so `mozak scope move` can copy them into a vault. Every other route refuses it with
// legacy-repo-scope and the exact move command. Nothing here runs git or touches the network.

import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { vaultOf } from "./vault-config.ts";

export const LEGACY_KEYS = ["remote", "ref", "plans"] as const;
/** The cache folder 0.5.0 kept next to the inventory for repo scopes. */
export const LEGACY_CACHE_DIR = ".mozak-cache";

export interface LegacyLocation { root: string; refused: { code: string; message: string } }

/** True when the entry carries any key of the retired repo-scope form. */
export const isLegacyEntry = (entry: Record<string, unknown>): boolean => LEGACY_KEYS.some((k) => k in entry);

/**
 * Where a repo-mode entry's plan files are on this machine: a full clone made by 0.5.0 `mozak pull` (named in the
 * cache metadata, used only while it still holds mozak.json), else the sparse cache copy. Reads one small JSON file.
 */
function repoModeRoot(base: string, id: string): string {
  const cache = join(base, LEGACY_CACHE_DIR, id);
  try {
    const meta = JSON.parse(readFileSync(join(base, LEGACY_CACHE_DIR, `${id}.meta.json`), "utf8")) as { fullClone?: unknown };
    const clone = meta.fullClone;
    // 0.5.0 wrote an absolute path. Anything else would resolve against the current folder, so it is ignored.
    if (typeof clone === "string" && isAbsolute(clone)) {
      readFileSync(join(clone, "mozak.json"));
      return clone;
    }
  } catch { /* no metadata, or the clone is gone: the cache copy it is */ }
  return cache;
}

/**
 * The refused location of a legacy entry. `plans` (a vault-plans entry) names the folder that already holds the plans;
 * otherwise they are in the repo cache. The command suggests the plans folder itself when it is inside a vault (the
 * move then only rewrites the entry), else a vault folder the owner picks.
 */
export function legacyLocation(base: string, inventoryFile: string, id: string, entry: Record<string, unknown>, canonical: (p: string) => string): LegacyLocation {
  const plans = typeof entry.plans === "string" && entry.plans.trim() !== "" ? entry.plans : null;
  const root = canonical(plans !== null ? resolve(base, plans) : repoModeRoot(base, id));
  const target = plans !== null && vaultOf(root) !== null ? plans : "<folder in a vault>";
  const from = typeof entry.remote === "string" ? ` (remote ${entry.remote})` : "";
  return {
    root,
    refused: {
      code: "legacy-repo-scope",
      message: `scope "${id}" is a repo scope${from}, which mozak 0.6.0 no longer reads; its plans are in ${root}. Move them into a vault folder: mozak scope move --scope ${id} --to ${target} --owner-ref REF --owner-message-at ISO --reason TEXT --config ${inventoryFile}`,
    },
  };
}
