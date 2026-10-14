// Bundles src/main.ts (plus @mozak/core from source) into dist/plugin/{main.js,manifest.json,styles.css}.
import { build } from "esbuild";
import { builtinModules } from "node:module";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist", "plugin");
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [join(root, "src", "main.ts")],
  outfile: join(out, "main.js"),
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "es2022",
  sourcemap: process.argv.includes("--sourcemap") ? "inline" : false,
  alias: { "@mozak/core": join(root, "..", "core", "src", "index.ts") },
  external: ["obsidian", "electron", ...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
  logLevel: "info",
});
for (const f of ["manifest.json", "styles.css"]) copyFileSync(join(root, f), join(out, f));
console.log(`built ${out}`);
