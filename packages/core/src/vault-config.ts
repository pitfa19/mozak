// Finding a vault's config folder from outside Obsidian (the CLI, doctor, upgrade and installers).
// Inside the plugin, Vault#configDir is the answer. Outside it there is no API, and users can rename the folder,
// so this looks for the default name first and then for any dot folder that has Obsidian's own config files.
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** The default config folder name. Kept in one place; everything else asks vaultConfigDir. */
export const DEFAULT_CONFIG_DIR = [".", "obsidian"].join("");
const MARKERS = ["app.json", "community-plugins.json", "core-plugins.json", "appearance.json"];

function isDir(path: string): boolean {
  try { return statSync(path).isDirectory(); } catch { return false; }
}

/**
 * The vault's config folder (absolute path), or null when `vault` does not look like an Obsidian vault.
 * An existing default folder wins. Otherwise the first dot folder (by name) holding Obsidian's config files.
 */
export function vaultConfigDir(vault: string): string | null {
  const preferred = join(vault, DEFAULT_CONFIG_DIR);
  if (isDir(preferred)) return preferred;
  let names: string[] = [];
  try { names = readdirSync(vault); } catch { return null; }
  for (const name of names.sort()) {
    if (!name.startsWith(".") || name === ".git" || name === ".trash") continue;
    const path = join(vault, name);
    if (isDir(path) && MARKERS.some((m) => existsSync(join(path, m)))) return path;
  }
  return null;
}

/** Where the mozak plugin lives in a vault, or null when the vault has no config folder. */
export function vaultPluginDir(vault: string): string | null {
  const config = vaultConfigDir(vault);
  return config ? join(config, "plugins", "mozak") : null;
}
