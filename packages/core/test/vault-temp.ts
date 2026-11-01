// Test temp folders as Obsidian vaults. Since 0.6.0 every scope root must sit inside a vault (a folder with a
// .obsidian folder at or above it), so fixtures create their temp base as a vault. Synthetic folders only.
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";

/** Give `dir` a .obsidian folder, so it and everything below it is inside a vault. Returns `dir`. */
export function makeVault(dir: string): string {
  mkdirSync(join(dir, ".obsidian"), { recursive: true });
  return dir;
}

/** mkdtempSync(prefix), made a vault. */
export function vaultTemp(prefix: string): string {
  return makeVault(mkdtempSync(prefix));
}
