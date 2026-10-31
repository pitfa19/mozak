#!/usr/bin/env node
// Counts non-blank lines in packages/*/src, per package and in total.
// Run: node scripts/count-loc.mjs [--files] [--json]. Read only.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../", import.meta.url));
const SOURCE = /\.(ts|tsx|mts|js|mjs|css)$/;

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (SOURCE.test(e.name)) out.push(p);
  }
  return out;
}

const nonBlank = (file) => readFileSync(file, "utf8").split("\n").filter((l) => l.trim() !== "").length;

const packages = {};
const files = {};
let total = 0;
const pkgRoot = join(repo, "packages");
for (const name of readdirSync(pkgRoot).sort()) {
  const src = join(pkgRoot, name, "src");
  try { if (!statSync(src).isDirectory()) continue; } catch { continue; }
  let sum = 0;
  for (const f of walk(src).sort()) {
    const n = nonBlank(f);
    files[relative(repo, f)] = n;
    sum += n;
  }
  packages[name] = sum;
  total += sum;
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ total, packages, ...(process.argv.includes("--files") ? { files } : {}) }, null, 2));
} else {
  if (process.argv.includes("--files")) for (const [f, n] of Object.entries(files)) console.log(`${String(n).padStart(6)}  ${f}`);
  for (const [p, n] of Object.entries(packages)) console.log(`${String(n).padStart(6)}  packages/${p}/src`);
  console.log(`${String(total).padStart(6)}  total non-blank lines`);
}
