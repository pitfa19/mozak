// Pure helpers for remote scopes: spec parsing and the small cache metadata file. No git and no network here,
// so the inventory loader can use them. All git work lives in remote.ts.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export const CACHE_DIR = ".mozak-cache";
export const DEFAULT_REF = "main";
/** Plain branch names only. No leading dash, no "..", no whitespace or git revision syntax. */
export const REF_PATTERN = /^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;
/** A remote scope is considered fresh for this long after a successful fetch. */
export const FRESH_MS = 10 * 60 * 1000;

export interface RemoteInfo {
  /** The inventory value, for example "github:pitfa19/genome-mcp". */
  spec: string;
  /** The URL handed to git. */
  url: string;
  ref: string;
  repoName: string;
  /** Directory of the inventory file. The cache lives under it. */
  baseDir: string;
  /** Canonical sparse cache copy: <inventory dir>/.mozak-cache/<id>. */
  cacheRoot: string;
  /** Canonical full working clone created by `mozak pull`, when it still exists. Reads and writes prefer it. */
  fullClone: string | null;
}

export interface ParsedRemote { url: string; repoName: string }

const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function parseRemoteSpec(spec: string): ParsedRemote | null {
  if (spec !== spec.trim() || spec === "") return null;
  if (spec.startsWith("github:")) {
    const parts = spec.slice("github:".length).split("/");
    if (parts.length !== 2) return null;
    const [owner, repoRaw] = parts as [string, string];
    const repo = repoRaw.replace(/\.git$/, "");
    if (!SLUG.test(owner) || !SLUG.test(repo)) return null;
    return { url: `https://github.com/${owner}/${repo}.git`, repoName: repo };
  }
  const https = /^https:\/\/[A-Za-z0-9][A-Za-z0-9.-]*(:\d{1,5})?\/([A-Za-z0-9._~/-]+)$/.exec(spec);
  const file = /^file:\/\/(\/[A-Za-z0-9._~/@+-]+)$/.exec(spec);
  const match = https ?? file;
  if (!match) return null;
  const path = (https ? https[2] : file?.[1]) as string;
  if (path.split("/").includes("..")) return null;
  const last = path.split("/").filter(Boolean).pop() as string;
  const repoName = last.replace(/\.git$/, "");
  if (!SLUG.test(repoName)) return null;
  return { url: spec, repoName };
}

export function cacheRootFor(baseDir: string, id: string): string {
  return join(baseDir, CACHE_DIR, id);
}

export interface RemoteMeta {
  lastFetchAt: string | null;
  lastError: string | null;
  fullClone: string | null;
}

function metaPath(baseDir: string, id: string): string {
  return join(baseDir, CACHE_DIR, `${id}.meta.json`);
}

export function readRemoteMeta(baseDir: string, id: string): RemoteMeta {
  const empty: RemoteMeta = { lastFetchAt: null, lastError: null, fullClone: null };
  try {
    const raw = JSON.parse(readFileSync(metaPath(baseDir, id), "utf8")) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);
    return { lastFetchAt: str(raw.lastFetchAt), lastError: str(raw.lastError), fullClone: str(raw.fullClone) };
  } catch {
    return empty;
  }
}

export function writeRemoteMeta(baseDir: string, id: string, meta: RemoteMeta): void {
  mkdirSync(join(baseDir, CACHE_DIR), { recursive: true });
  const path = metaPath(baseDir, id);
  const tmp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(meta, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  renameSync(tmp, path);
}

/** Status shown next to a remote scope in every read output. */
export interface RemoteStatus {
  scope: string;
  remote: string;
  ref: string;
  /** True when the last refresh failed or is older than the freshness window and could not be renewed. */
  stale: boolean;
  lastFetchAt: string | null;
  /** Why the copy is stale, when it is. */
  error?: string;
  /** "full-clone" when reads use a clone made by `mozak pull`, otherwise "sparse-cache". */
  source: "sparse-cache" | "full-clone";
}
