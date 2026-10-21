#!/usr/bin/env node
// Builds the self-contained npm package `mozak` into npm-package/: one bundled CLI (dist/cli.js), one bundled MCP
// server (dist/mcp.js), the skill template, README and LICENSE. No runtime dependencies and no install scripts.
// Publish with: npm publish ./npm-package --access public
import { build } from "esbuild";
import { builtinModules } from "node:module";
import { chmodSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(repo, "npm-package");
const root = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
const version = root.version;

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "dist"), { recursive: true });
mkdirSync(join(out, "bin"), { recursive: true });

const common = {
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node24",
  external: [...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
  alias: { "@mozak/core": join(repo, "packages", "core", "src", "index.ts") },
  legalComments: "none",
  logLevel: "warning",
};
await build({ ...common, entryPoints: [join(repo, "packages", "cli", "src", "index.ts")], outfile: join(out, "dist", "cli.js") });
await build({ ...common, entryPoints: [join(repo, "packages", "mcp", "src", "index.ts")], outfile: join(out, "dist", "mcp.js") });

// Marker that tells the bundled code it runs from the npm package (npmInstall in core/src/update.ts).
writeFileSync(join(out, "dist", "mozak-npm.json"), `${JSON.stringify({ format: "mozak.npm/v1", version }, null, 2)}\n`);

// Bin wrappers. The MCP entrypoint starts only when argv[1] names its own file, so the wrapper sets that slot,
// exactly as the portable installer's wrappers do. User arguments pass through unchanged.
for (const [bin, entry] of [["mozak", "cli"], ["mozak-mcp", "mcp"]]) {
  const path = join(out, "bin", `${bin}.js`);
  writeFileSync(path, `#!/usr/bin/env node\nconst entry = new URL(${JSON.stringify(`../dist/${entry}.js`)}, import.meta.url);\nprocess.argv[1] = entry.href.slice("file://".length);\nawait import(entry.href);\n`);
  chmodSync(path, 0o755);
}

// The skill ships as a template. `mozak doctor --fix` renders it with this package's absolute CLI path.
cpSync(join(repo, "skills", "mozak"), join(out, "skills-template", "mozak"), { recursive: true });
cpSync(join(repo, "LICENSE"), join(out, "LICENSE"));
cpSync(join(repo, "README.md"), join(out, "README.md"));

const pkg = {
  name: "mozak",
  version,
  description: "One shared, owner-approved plan per project for coding agents, stored as plain files, with an Obsidian view.",
  type: "module",
  bin: { mozak: "bin/mozak.js", "mozak-mcp": "bin/mozak-mcp.js" },
  files: ["bin", "dist", "skills-template", "README.md", "LICENSE"],
  engines: { node: ">=24.11.0" },
  os: ["darwin", "linux"],
  license: "MIT",
  author: "pitfa19",
  homepage: "https://github.com/pitfa19/mozak#readme",
  repository: { type: "git", url: "git+https://github.com/pitfa19/mozak.git" },
  bugs: { url: "https://github.com/pitfa19/mozak/issues" },
  keywords: ["obsidian", "mcp", "ai-agents", "coding-agents", "claude-code", "codex", "planning", "agents-md"],
};
writeFileSync(join(out, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`built ${out} (mozak ${version})`);
