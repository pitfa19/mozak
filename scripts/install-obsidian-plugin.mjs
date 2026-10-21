#!/usr/bin/env node
// Copies the built mozak Obsidian plugin into <vault>/.obsidian/plugins/mozak/.
// Usage: node scripts/install-obsidian-plugin.mjs <vault-folder> [--build]
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(repo, "packages", "obsidian", "dist", "plugin");
const args = process.argv.slice(2);
const vault = args.find((a) => !a.startsWith("--"));
if (!vault) {
  console.error("usage: node scripts/install-obsidian-plugin.mjs <vault-folder> [--build]");
  process.exit(2);
}
const vaultDir = resolve(vault);
if (!existsSync(vaultDir) || !statSync(vaultDir).isDirectory()) {
  console.error(`not a directory: ${vaultDir}`);
  process.exit(2);
}
// Same lookup as core's vaultConfigDir (packages/core/src/vault-config.ts): the default config folder first,
// then a renamed dot folder holding Obsidian's own config files. This script runs before any build, so it
// cannot import core.
const MARKERS = ["app.json", "community-plugins.json", "core-plugins.json", "appearance.json"];
function configDir(v) {
  const preferred = join(v, ".obsidian");
  if (existsSync(preferred) && statSync(preferred).isDirectory()) return preferred;
  for (const name of readdirSync(v).sort()) {
    if (!name.startsWith(".") || name === ".git" || name === ".trash") continue;
    const p = join(v, name);
    if (statSync(p).isDirectory() && MARKERS.some((m) => existsSync(join(p, m)))) return p;
  }
  return null;
}
const config = configDir(vaultDir);
if (!config) {
  console.error(`${vaultDir} has no Obsidian config folder, so it does not look like an Obsidian vault`);
  process.exit(2);
}
if (args.includes("--build") || !existsSync(join(dist, "main.js"))) {
  const r = spawnSync("npm", ["run", "build", "--workspace", "@mozak/obsidian"], { cwd: repo, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
const target = join(config, "plugins", "mozak");
mkdirSync(target, { recursive: true });
for (const f of ["main.js", "manifest.json", "styles.css"]) copyFileSync(join(dist, f), join(target, f));
console.log(`installed mozak plugin to ${target}\nEnable it in Obsidian: Settings > Community plugins.`);
