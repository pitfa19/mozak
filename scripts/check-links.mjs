#!/usr/bin/env node
// Checks relative links in the repo's Markdown files: the target file must exist, and a `#anchor`
// into a Markdown file must match one of its headings (GitHub slug rules) or an HTML id.
// External links (http, https, mailto) are not fetched. Links inside code blocks and inline code are skipped.
// Run: node scripts/check-links.mjs [--json]. Exit 0 when every link resolves, 1 when any is broken.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "scratch", ".mozak-cache"]);

/** Markdown files to check: tracked and untracked-but-not-ignored when git is available, else a folder walk. */
export function markdownFiles(root) {
  try {
    const out = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "*.md"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return out.split("\0").filter((f) => f && !f.split("/").some((p) => SKIP_DIRS.has(p)) && existsSync(join(root, f))).sort();
  } catch {
    const found = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        if (SKIP_DIRS.has(name)) continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (name.endsWith(".md")) found.push(relative(root, p).split(sep).join("/"));
      }
    };
    walk(root);
    return found.sort();
  }
}

/** Text with fenced code blocks and inline code blanked out, so line numbers stay the same. */
function stripCode(text) {
  const lines = text.split("\n");
  let fence = null;
  return lines.map((line) => {
    const m = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
      return "";
    }
    if (m) { fence = m[1]; return ""; }
    return line.replace(/(`+)[^`]*?\1/g, "");
  }).join("\n");
}

/** GitHub heading slug (github-slugger rules) for one heading's text. */
export function slug(heading) {
  const text = heading
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[`*]/g, "")
    .trim()
    .toLowerCase();
  return text.replace(/[^\p{L}\p{N}\p{M}\p{Pc} -]/gu, "").replace(/ /g, "-");
}

/** Every anchor a Markdown file offers: heading slugs (with -1, -2 for repeats) and HTML id/name attributes. */
export function anchors(text) {
  const out = new Set();
  const seen = new Map();
  let fence = null;
  for (const line of text.split("\n")) {
    const f = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) { if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null; continue; }
    if (f) { fence = f[1]; continue; }
    const h = /^ {0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      const base = slug(h[1]);
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      out.add(n === 0 ? base : `${base}-${n}`);
    }
    for (const m of line.matchAll(/<a\s[^>]*(?:id|name)="([^"]+)"/g)) out.add(m[1]);
  }
  return out;
}

/** Relative link targets in one file, with line numbers. */
export function links(text) {
  const found = [];
  stripCode(text).split("\n").forEach((line, i) => {
    for (const m of line.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) found.push({ target: m[1], line: i + 1 });
    for (const m of line.matchAll(/\b(?:href|src)="([^"]+)"/g)) found.push({ target: m[1], line: i + 1 });
    for (const m of line.matchAll(/^\s*\[[^\]]+\]:\s*(\S+)/g)) found.push({ target: m[1], line: i + 1 });
  });
  return found.filter((l) => !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(l.target));
}

/** Broken relative links under root. Each entry names the file, line, target and reason. */
export function checkLinks(root) {
  const broken = [];
  const anchorCache = new Map();
  const files = markdownFiles(root);
  let checked = 0;
  for (const file of files) {
    const text = readFileSync(join(root, file), "utf8");
    for (const { target, line } of links(text)) {
      checked++;
      const [rawPath, rawAnchor] = target.split("#", 2);
      let path;
      try { path = decodeURIComponent(rawPath); } catch { path = rawPath; }
      const abs = path === "" ? join(root, file) : resolve(root, dirname(file), path);
      if (!abs.startsWith(resolve(root))) { broken.push({ file, line, target, reason: "points outside the repo" }); continue; }
      if (!existsSync(abs)) { broken.push({ file, line, target, reason: "file not found" }); continue; }
      if (rawAnchor && abs.endsWith(".md") && statSync(abs).isFile()) {
        if (!anchorCache.has(abs)) anchorCache.set(abs, anchors(readFileSync(abs, "utf8")));
        if (!anchorCache.get(abs).has(decodeURIComponent(rawAnchor).toLowerCase())) broken.push({ file, line, target, reason: "anchor not found" });
      }
    }
  }
  return { files: files.length, links: checked, broken };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const result = checkLinks(root);
  if (process.argv.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else {
    for (const b of result.broken) console.log(`${b.file}:${b.line}: ${b.target} (${b.reason})`);
    console.log(`${result.files} Markdown files, ${result.links} relative links, ${result.broken.length} broken`);
  }
  process.exitCode = result.broken.length === 0 ? 0 : 1;
}
