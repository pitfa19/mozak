#!/usr/bin/env node
// Copies the built mozak Obsidian plugin into <vault>/.obsidian/plugins/mozak/.
// Usage: node scripts/install-obsidian-plugin.mjs <vault-folder> [--build]
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
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
if (!existsSync(join(vaultDir, ".obsidian"))) {
  console.error(`${vaultDir} has no .obsidian folder, so it does not look like an Obsidian vault`);
  process.exit(2);
}
if (args.includes("--build") || !existsSync(join(dist, "main.js"))) {
  const r = spawnSync("npm", ["run", "build", "--workspace", "@mozak/obsidian"], { cwd: repo, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
const target = join(vaultDir, ".obsidian", "plugins", "mozak");
mkdirSync(target, { recursive: true });
for (const f of ["main.js", "manifest.json", "styles.css"]) copyFileSync(join(dist, f), join(target, f));
console.log(`installed mozak plugin to ${target}\nEnable it in Obsidian: Settings > Community plugins.`);
