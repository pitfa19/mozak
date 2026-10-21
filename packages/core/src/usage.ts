// S2 usage log (Goal 5, local part). One JSON line per operation in <inventory dir>/.mozak-cache/usage/, holding
// counts and codes only: operation, actor, scope id, exit code, status code, duration and output size. Never request
// bodies, prompts, plan text or ids of plans. The monthly aggregate is counts only, one file per host and month.
// Logging never changes an operation's result: every failure here is swallowed.

import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { DomainError } from "./errors.ts";
import { replaceFileDurable } from "./durable.ts";
import { CACHE_DIR } from "./remote-meta.ts";

export const USAGE_DIR = "usage";
export const USAGE_FORMAT = "mozak.usage/v1" as const;
export const AGGREGATE_FORMAT = "mozak.usage-aggregate/v1" as const;

export interface UsageLine {
  v: 1; ts: string; host: string; actor: string; op: string;
  /** Selected scope id, "all" for all-scope reads, or null. */
  scope: string | null;
  exit: number; status: string; ms: number; bytes: number;
  committed?: boolean; rebased?: boolean;
}

/** Host name made safe for a file name. */
export function usageHost(name = hostname()): string {
  return name.replace(/[^A-Za-z0-9._-]/g, "-").replace(/^[.-]+/, "").slice(0, 64) || "host";
}
export const monthOf = (d: Date) => d.toISOString().slice(0, 7);
export function usageDir(baseDir: string): string { return join(baseDir, CACHE_DIR, USAGE_DIR); }
export function usageLogPath(baseDir: string, month: string, host = usageHost()): string { return join(usageDir(baseDir), `${host}-${month}.jsonl`); }

/** Off when MOZAK_USAGE_LOG is "0" or "off". */
export function usageLogEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.MOZAK_USAGE_LOG ?? "").trim().toLowerCase();
  return v !== "0" && v !== "off" && v !== "false";
}

/** Append one line. Creates the folder with a `*` .gitignore so a cache inside a vault is never committed. */
export function appendUsage(baseDir: string, line: UsageLine): boolean {
  try {
    const dir = usageDir(baseDir);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      writeFileSync(join(dir, ".gitignore"), "*\n", { mode: 0o600 });
    }
    appendFileSync(usageLogPath(baseDir, line.ts.slice(0, 7), line.host), `${JSON.stringify(line)}\n`, { mode: 0o600 });
    return true;
  } catch { return false; }
}

/** Build the line for one finished operation. Only fixed fields of the result envelope are read. */
export function usageLine(operation: string, args: unknown, actor: string, data: Record<string, unknown>, exitCode: number, ms: number, now = new Date()): UsageLine {
  const a = args && typeof args === "object" && !Array.isArray(args) ? args as Record<string, unknown> : {};
  const scope = typeof a.scope === "string" ? a.scope : a.all === true ? "all" : null;
  let bytes = 0;
  try { bytes = Buffer.byteLength(JSON.stringify(data)); } catch { /* size unknown */ }
  return {
    v: 1, ts: now.toISOString(), host: usageHost(), actor, op: operation, scope, exit: exitCode,
    status: typeof data.status === "string" ? data.status : "unknown", ms: Math.max(0, Math.round(ms)), bytes,
    ...(data.committed === true ? { committed: true } : {}), ...(data.rebased ? { rebased: true } : {}),
  };
}

export function readUsageLines(baseDir: string, month: string, host = usageHost()): UsageLine[] {
  let text = "";
  try { text = readFileSync(usageLogPath(baseDir, month, host), "utf8"); } catch { return []; }
  const out: UsageLine[] = [];
  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    try {
      const l = JSON.parse(raw) as UsageLine;
      if (l && l.v === 1 && typeof l.op === "string" && typeof l.ts === "string" && l.ts.startsWith(month)) out.push(l);
    } catch { /* a torn last line from a crash is skipped */ }
  }
  return out;
}

export interface UsageAggregate {
  format: typeof AGGREGATE_FORMAT; host: string; month: string;
  calls: number; writes: number; staleRefusals: number; rebased: number;
  byOperation: Record<string, { calls: number; exits: Record<string, number>; statuses: Record<string, number>; msP50: number; msP95: number; bytesTotal: number }>;
  byActor: Record<string, number>;
}

const pct = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]! : 0);
const bump = (o: Record<string, number>, k: string) => { o[k] = (o[k] ?? 0) + 1; };

/** Counts only: no scope ids, no timestamps finer than the month. */
export function aggregateUsage(lines: UsageLine[], host: string, month: string): UsageAggregate {
  const agg: UsageAggregate = { format: AGGREGATE_FORMAT, host, month, calls: 0, writes: 0, staleRefusals: 0, rebased: 0, byOperation: {}, byActor: {} };
  const ms = new Map<string, number[]>();
  for (const l of lines) {
    if (!l.ts.startsWith(month)) continue;
    agg.calls++;
    if (l.committed) agg.writes++;
    if (l.status === "stale-input") agg.staleRefusals++;
    if (l.rebased) agg.rebased++;
    bump(agg.byActor, l.actor);
    const op = (agg.byOperation[l.op] ??= { calls: 0, exits: {}, statuses: {}, msP50: 0, msP95: 0, bytesTotal: 0 });
    op.calls++; bump(op.exits, String(l.exit)); bump(op.statuses, l.status); op.bytesTotal += l.bytes || 0;
    ms.set(l.op, [...(ms.get(l.op) ?? []), l.ms || 0]);
  }
  for (const [op, list] of ms) { const s = list.sort((x, y) => x - y); agg.byOperation[op]!.msP50 = pct(s, 50); agg.byOperation[op]!.msP95 = pct(s, 95); }
  // Stable key order so the file diffs cleanly month to month.
  agg.byOperation = Object.fromEntries(Object.entries(agg.byOperation).sort(([x], [y]) => (x < y ? -1 : 1)));
  return agg;
}

function realish(p: string): string { try { return realpathSync(p); } catch { return resolve(p); } }
const within = (child: string, parent: string) => { const r = relative(parent, child); return r === "" || (!r.startsWith("..") && !isAbsolute(r)); };

/**
 * Write `<targetDir>/<host>-<yyyy-mm>.json`. The design puts it at the personal vault root in `.mozak-usage/`, outside
 * every scope and index root and never in a shared vault: callers pass those roots as `forbiddenRoots`.
 */
export function writeUsageAggregate(targetDir: string, agg: UsageAggregate, forbiddenRoots: string[] = []): string {
  if (!/^\d{4}-\d{2}$/.test(agg.month)) throw new DomainError("invalid-input", "month must be yyyy-mm", 2);
  const dir = realish(targetDir);
  for (const root of forbiddenRoots) {
    const r = realish(root);
    if (within(dir, r) || within(r, dir)) throw new DomainError("usage-target-refused", `aggregates must live outside every scope and index root; ${targetDir} overlaps ${root}`, 2);
  }
  mkdirSync(dir, { recursive: true });
  const st = lstatSync(dir);
  if (!st.isDirectory() || st.isSymbolicLink()) throw new DomainError("unsafe-path", `${targetDir} must be a regular folder`, 2);
  const path = join(dir, `${usageHost(agg.host)}-${agg.month}.json`);
  if (dirname(path) !== dir) throw new DomainError("unsafe-path", "aggregate path escapes its folder", 2);
  replaceFileDurable(path, `${JSON.stringify(agg, null, 2)}\n`);
  return path;
}
