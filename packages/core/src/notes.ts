// Note-level helpers shared by locator resolution and cited-note staleness.
// Everything here is read only and derives time from git: nothing is stored.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import { foldKey } from "./fold.ts";

/** When something was last changed, derived from git. Nothing is stored, so there is no timestamp to forget to update. */
export interface Touched {
  /** Unix seconds, or null when nothing is known. */
  epoch: number | null;
  /** commit: last commit. uncommitted: working tree is newer than the last commit. none: no git history. */
  source: "commit" | "uncommitted" | "none";
}

export const NO_TOUCH: Touched = { epoch: null, source: "none" };
/** Folders never walked for notes. Dot folders are skipped too. */
export const NOTE_SKIP = new Set([".git", "node_modules", ".obsidian", "dist", "target"]);

function git(root: string, args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null; // not a repo, or git is missing
  }
}

export function gitRoot(dir: string): string | null {
  const out = git(dir, ["rev-parse", "--show-toplevel"]);
  return out ? realpathSync(out.trim()) : null;
}

/** Paths with uncommitted changes (modified or untracked), relative to the repo root. */
export function dirtyPaths(root: string): string[] {
  const out = git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  if (!out) return [];
  const parts = out.split("\0").filter(Boolean);
  const paths: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    paths.push(entry.slice(3));
    if (entry[0] === "R" || entry[0] === "C") i++; // renames carry the old path as the next field
  }
  return paths;
}

/**
 * Last change to a file or directory. A directory counts any file inside it.
 * `dirty` lets a caller pass the repo's dirty paths once instead of running git status per file.
 */
export function touched(target: string, dirty?: { root: string; paths: string[] }): Touched {
  if (!existsSync(target)) return NO_TOUCH;
  const real = realpathSync(target);
  const root = dirty?.root ?? gitRoot(statSync(real).isDirectory() ? real : join(real, ".."));
  if (!root) return NO_TOUCH;
  const rel = relative(root, real) || ".";
  const logged = git(root, ["log", "-1", "--format=%ct", "--", rel]);
  const committed = logged && logged.trim() ? Number(logged.trim()) : null;
  let newest: number | null = null;
  for (const p of dirty?.paths ?? dirtyPaths(root)) {
    if (rel !== "." && p !== rel && !p.startsWith(rel + sep) && !p.startsWith(rel + "/")) continue;
    try {
      const m = Math.floor(statSync(join(root, p)).mtimeMs / 1000);
      if (newest === null || m > newest) newest = m;
    } catch {
      /* deleted file, no mtime to read */
    }
  }
  if (newest !== null && (committed === null || newest > committed)) return { epoch: newest, source: "uncommitted" };
  return committed !== null ? { epoch: committed, source: "commit" } : NO_TOUCH;
}

/** Every .md file under dir, skipping dot folders and NOTE_SKIP. */
export function mdFiles(dir: string, out: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (NOTE_SKIP.has(e.name) || e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) mdFiles(p, out);
    else if (e.name.endsWith(".md")) out.push(p);
  }
  return out;
}

/** Note name key: the basename without .md, lowercased and folded, as Obsidian matches names case-insensitively. */
export const noteKey = (name: string) => foldKey(name.replace(/\.md$/i, "")).trim();

/** Lowercase folded note name -> every path with that name, in sorted path order. */
export type NoteIndex = Map<string, string[]>;

export function noteIndex(dirs: string[]): NoteIndex {
  const idx: NoteIndex = new Map();
  const seen = new Set<string>();
  for (const dir of dirs) {
    for (const f of mdFiles(dir).sort()) {
      if (seen.has(f)) continue;
      seen.add(f);
      const key = noteKey(basename(f));
      const list = idx.get(key);
      if (list) list.push(f);
      else idx.set(key, [f]);
    }
  }
  return idx;
}

/** Text with fenced code blocks and inline code spans blanked out, so links inside code do not count. */
export function stripCode(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of lines) {
    const m = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length && line.trim() === m[1]) fence = null;
      out.push("");
      continue;
    }
    if (m) {
      fence = m[1];
      out.push("");
      continue;
    }
    out.push(line.replace(/(`+)[^`\n]*?\1/g, ""));
  }
  return out.join("\n");
}

export interface WikiLink {
  /** Note name or path, without heading, block or alias. */
  target: string;
  /** Heading or block after #, or null. */
  anchor: string | null;
}

/** Wikilinks outside code: [[name]], [[name#heading]], [[name|alias]], ![[embed]]. Deduplicated, in text order. */
export function wikiLinks(text: string): WikiLink[] {
  const out: WikiLink[] = [];
  const seen = new Set<string>();
  for (const m of stripCode(text).matchAll(/!?\[\[([^\]\n]+?)\]\]/g)) {
    const inner = m[1].split("|")[0];
    const hash = inner.indexOf("#");
    const target = (hash >= 0 ? inner.slice(0, hash) : inner).trim();
    const anchor = hash >= 0 ? inner.slice(hash + 1).trim() || null : null;
    if (!target) continue;
    const key = `${target}\0${anchor ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ target, anchor });
  }
  return out;
}

/** Commit times (unix seconds, ascending) of every commit that changed `file`. Empty without git history. */
export function commitTimes(root: string, file: string): number[] {
  const rel = relative(root, existsSync(file) ? realpathSync(file) : file);
  const out = git(root, ["log", "--format=%ct", "--", rel]);
  return out ? out.split("\n").map((l) => Number(l.trim())).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b) : [];
}

/** Nearest folder at or above dir that holds a .git entry, without running git. Canonical path, or null. */
export function findRepoRoot(dir: string): string | null {
  let cur: string;
  try { cur = realpathSync(dir); } catch { return null; }
  for (;;) {
    if (existsSync(join(cur, ".git"))) return cur;
    const up = dirname(cur);
    if (up === cur) return null;
    cur = up;
  }
}
