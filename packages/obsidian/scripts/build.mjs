// Bundles src/main.ts (plus @mozak/core from source) into dist/plugin/{main.js,manifest.json,styles.css}.
import { build } from "esbuild";
import { builtinModules } from "node:module";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist", "plugin");
mkdirSync(out, { recursive: true });

// The plugin never checks GitHub for releases or spawns processes for it: only the installed CLI does, and the plugin
// only reads the CLI's cache (cachedUpdateNotice). That code is unreachable in the bundle, but a reviewer's scanner
// cannot tell, so it is removed here. The build fails if update.ts changes shape and the strip no longer applies.
const stripUpdateRefresh = {
  name: "strip-update-refresh",
  setup(b) {
    b.onLoad({ filter: /[\\/]core[\\/]src[\\/]update\.ts$/ }, (args) => {
      const src = readFileSync(args.path, "utf8");
      const script = /const REFRESH_SCRIPT = `[\s\S]*?\n`;\n/;
      const spawner = /function backgroundRefresh\(path: string\): void \{[\s\S]*?\n\}\n/;
      if (!script.test(src) || !spawner.test(src)) throw new Error("strip-update-refresh: update.ts changed shape; update the plugin build");
      const contents = src
        .replace(script, "")
        .replace(spawner, "function backgroundRefresh(_path: string): void { /* plugin bundle: never refreshes */ }\n")
        .replace(/^import \{ spawn \} from "node:child_process";\n/m, "");
      return { contents, loader: "ts" };
    });
  },
};

await build({
  // Reproducible bytes: the Obsidian directory rebuilds from the repo root and compares main.js with the
  // release asset. A fixed working directory and no path comments make the output independent of where
  // the build is started from (repo root, this package, or the test that rebuilds the bundle).
  absWorkingDir: join(root, "..", ".."),
  legalComments: "none",
  entryPoints: [join(root, "src", "main.ts")],
  outfile: join(out, "main.js"),
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "es2022",
  sourcemap: process.argv.includes("--sourcemap") ? "inline" : false,
  alias: { "@mozak/core": join(root, "..", "core", "src", "index.ts") },
  external: ["obsidian", "electron", ...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
  plugins: [stripUpdateRefresh],
  logLevel: "info",
});
for (const f of ["manifest.json", "styles.css"]) copyFileSync(join(root, f), join(out, f));
console.log(`built ${out}`);
