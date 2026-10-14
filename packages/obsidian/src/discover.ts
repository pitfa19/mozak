import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

export const INVENTORY_NAME = "mozak-inventory.json";

/** Walk up from `start` to the filesystem root looking for mozak-inventory.json. Null when absent. */
export function discoverInventory(start: string, exists: (p: string) => boolean = existsSync): string | null {
  let dir = resolve(start);
  for (;;) {
    const candidate = join(dir, INVENTORY_NAME);
    if (exists(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export interface InventoryChoice { path: string | null; source: "setting" | "auto" | "none" }

/** The setting wins when nonempty (a leading ~ is expanded). Otherwise auto-discover from the vault. */
export function chooseInventory(setting: string, vaultBase: string | null, exists: (p: string) => boolean = existsSync): InventoryChoice {
  const typed = setting.trim();
  if (typed) {
    const expanded = typed === "~" || typed.startsWith("~/") ? join(homedir(), typed.slice(1)) : typed;
    return { path: resolve(expanded), source: "setting" };
  }
  const found = vaultBase ? discoverInventory(vaultBase, exists) : null;
  return found ? { path: found, source: "auto" } : { path: null, source: "none" };
}
