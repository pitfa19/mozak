// Update notice. A read only ever looks at a small cache file. When that cache is older than its window, a detached
// background process asks GitHub for the release tags and rewrites it, so the answer shows from the next call.
// No credentials, a 5 second timeout, and any failure is cached for an hour and never surfaces as an error.
// MOZAK_NO_UPDATE_CHECK=1 turns all of it off. Tests replace the checker; no test touches the network.

import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { replaceFileDurable } from "./durable.ts";

export const UPDATE_REPO = "pitfa19/mozak";
export const UPDATE_TTL_MS = 24 * 60 * 60 * 1000;
export const UPDATE_FAILURE_TTL_MS = 60 * 60 * 1000;
const FORMAT = "mozak.update/v1";
const TIMEOUT_MS = 5000;

export interface UpdateCache { format: typeof FORMAT; checkedAt: string; latest: string | null; ok: boolean }
export interface UpdateNotice { installed: string; latest: string; command: string }
/** Returns the highest release version ("0.3.0"), or null when it could not find out. */
export type UpdateChecker = () => string | null;

export function updateCheckDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MOZAK_NO_UPDATE_CHECK === "1";
}

export function updateCachePath(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_STATE_HOME && env.XDG_STATE_HOME.startsWith("/") ? env.XDG_STATE_HOME : join(env.HOME || homedir(), ".local", "state");
  return join(base, "mozak", "update.json");
}

/** [major, minor, patch] for "1.2.3" or "v1.2.3", null for anything else (pre-releases are not releases). */
export function parseVersion(v: string): [number, number, number] | null {
  const m = /^v?(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) throw new Error(`not a release version: ${x ? b : a}`);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! < y[i]! ? -1 : 1;
  return 0;
}

/** Highest release among tag names like "v0.2.0"; other tags are ignored. Returned without the "v". */
export function highestRelease(tags: readonly string[]): string | null {
  let best: string | null = null;
  for (const t of tags) {
    if (!/^v\d/.test(t) || !parseVersion(t)) continue;
    const v = t.slice(1);
    if (best === null || compareVersions(v, best) > 0) best = v;
  }
  return best;
}

export function readUpdateCache(path = updateCachePath()): UpdateCache | null {
  try {
    const c = JSON.parse(readFileSync(path, "utf8")) as Partial<UpdateCache>;
    if (c.format !== FORMAT || typeof c.checkedAt !== "string" || Number.isNaN(Date.parse(c.checkedAt))) return null;
    if (typeof c.ok !== "boolean" || !(c.latest === null || (typeof c.latest === "string" && parseVersion(c.latest)))) return null;
    return c as UpdateCache;
  } catch {
    return null;
  }
}

function writeUpdateCache(cache: UpdateCache, path: string): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    replaceFileDurable(path, `${JSON.stringify(cache, null, 2)}\n`);
  } catch {
    /* an unwritable cache only means the next call checks again */
  }
}

export function cacheFresh(cache: UpdateCache | null, now: Date): boolean {
  if (!cache) return false;
  const age = now.getTime() - Date.parse(cache.checkedAt);
  return age >= 0 && age < (cache.ok ? UPDATE_TTL_MS : UPDATE_FAILURE_TTL_MS);
}

/** The notice the cache supports right now, without any network call. Null when up to date, unknown or disabled. */
export function cachedUpdateNotice(installed: string, opts: { env?: NodeJS.ProcessEnv; path?: string } = {}): UpdateNotice | null {
  const env = opts.env ?? process.env;
  if (updateCheckDisabled(env) || !parseVersion(installed)) return null;
  const cache = readUpdateCache(opts.path ?? updateCachePath(env));
  if (!cache?.latest || compareVersions(cache.latest, installed) <= 0) return null;
  return { installed, latest: cache.latest, command: "mozak upgrade" };
}

// Script run by the detached refresher. Plain JavaScript with fetch, so it needs nothing but node.
const REFRESH_SCRIPT = `
const { mkdirSync, writeFileSync, renameSync } = require("node:fs");
const { dirname } = require("node:path");
const path = process.env.MOZAK_UPDATE_CACHE;
const write = (latest, ok) => {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = path + "." + process.pid + ".tmp";
    writeFileSync(tmp, JSON.stringify({ format: "${FORMAT}", checkedAt: new Date().toISOString(), latest, ok }, null, 2) + "\\n");
    renameSync(tmp, path);
  } catch {}
};
fetch("https://api.github.com/repos/${UPDATE_REPO}/tags?per_page=100", { headers: { accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(${TIMEOUT_MS}) })
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
  .then((tags) => {
    let best = null;
    for (const t of tags) {
      const m = /^v(0|[1-9]\\d{0,8})\\.(0|[1-9]\\d{0,8})\\.(0|[1-9]\\d{0,8})$/.exec(t && t.name);
      if (!m) continue;
      const v = [Number(m[1]), Number(m[2]), Number(m[3])];
      if (!best || v[0] > best[0] || (v[0] === best[0] && (v[1] > best[1] || (v[1] === best[1] && v[2] > best[2])))) best = v;
    }
    write(best ? best.join(".") : null, true);
  })
  .catch(() => {});
`;

/** Default checker: starts a detached node process and returns at once. Its answer lands in the cache. */
function backgroundRefresh(path: string): void {
  try {
    const child = spawn(process.execPath, ["-e", REFRESH_SCRIPT], {
      detached: true,
      stdio: "ignore",
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", MOZAK_UPDATE_CACHE: path },
    });
    child.on("error", () => {});
    child.unref();
  } catch {
    /* never an error for the caller */
  }
}

let checker: UpdateChecker | null = null;

/** Test seam: run this synchronous checker instead of the background refresh. Returns a restore function. */
export function setUpdateChecker(next: UpdateChecker | null): () => void {
  const prior = checker;
  checker = next;
  return () => { checker = prior; };
}

/**
 * Starts a refresh when the cache is past its window. Never waits on the network: the default refresh is a detached
 * process. The cache's checkedAt is moved forward first, so concurrent reads do not start a second check.
 */
export function refreshUpdateCacheIfStale(opts: { env?: NodeJS.ProcessEnv; path?: string; now?: Date } = {}): "disabled" | "fresh" | "started" {
  const env = opts.env ?? process.env;
  if (updateCheckDisabled(env)) return "disabled";
  const path = opts.path ?? updateCachePath(env);
  const now = opts.now ?? new Date();
  const cache = readUpdateCache(path);
  if (cacheFresh(cache, now)) return "fresh";
  // Pending marker: keep the last known answer, retry within the failure window if the refresh never lands.
  writeUpdateCache({ format: FORMAT, checkedAt: now.toISOString(), latest: cache?.latest ?? null, ok: false }, path);
  if (checker) {
    let latest: string | null = null;
    try { latest = checker(); } catch { latest = null; }
    // A failure leaves the pending marker: last known answer, retried after the failure window.
    if (latest !== null && parseVersion(latest) !== null) {
      writeUpdateCache({ format: FORMAT, checkedAt: now.toISOString(), latest: latest.replace(/^v/, ""), ok: true }, path);
    }
  } else {
    backgroundRefresh(path);
  }
  return "started";
}

export interface InstalledInfo { prefix: string; version: string; source: string | null }

/**
 * The installation this code runs from: PREFIX/node_modules/@mozak/core/dist/*.js sits four levels under PREFIX,
 * whose installation.json names the version and source checkout. Null when not running from an installation
 * (a source checkout, a test run, or the plugin bundle), so those never check for updates.
 */
export function installedVersion(moduleUrl: string | undefined = import.meta.url): InstalledInfo | null {
  try {
    if (!moduleUrl?.startsWith("file:")) return null;
    const prefixUrl = new URL("../../../../", moduleUrl);
    const m = JSON.parse(readFileSync(new URL("installation.json", prefixUrl), "utf8")) as { format?: unknown; version?: unknown; source?: unknown };
    if (m.format !== "mozak.installation/v1" || typeof m.version !== "string" || !parseVersion(m.version)) return null;
    return { prefix: fileURLToPath(prefixUrl).replace(/\/$/, ""), version: m.version, source: typeof m.source === "string" ? m.source : null };
  } catch {
    return null;
  }
}
