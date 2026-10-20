#!/usr/bin/env node
// mozak v2 CLI. Thin transport over the shared executeOperation facade in @mozak/core.
// Strict flags: unknown and duplicate flags are rejected. No shell, no eval, request files are data.
// The actor is chosen by route here (owner for decide/init/repair, agent otherwise). No flag sets it.

import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { parseArgs } from "node:util";
import { executeOperation, loadInventory, MAX_REQUEST_BYTES, scopeForWorkingCopy, DomainError, type OperationOutput } from "@mozak/core";
import { runningVersion, upgrade } from "./upgrade.js";
import { doctor, renderDoctor } from "./doctor.js";

const OWNER_ROUTES = new Set(["decide", "init", "repair", "pull", "rename-files", "retitle", "annotate", "recover", "prune"]);
/** Read routes that may omit --scope: the scope is then found from the current folder's git origin. */
const CWD_SCOPE_ROUTES = new Set(["context", "check", "review show", "plans"]);

type Route = {
  operation: string;
  flags: readonly string[];
  requires: readonly string[];
  requestFile: boolean;
  mode?: "scope" | "all";
};

const ROUTES: Record<string, Route> = {
  "scope init": { operation: "init", flags: ["config", "scope", "request"], requires: ["config", "scope", "request"], requestFile: true },
  context: { operation: "context", flags: ["config", "scope", "brief", "plan", "json"], requires: ["config"], requestFile: false },
  plans: {
    operation: "plans",
    flags: ["config", "scope", "all", "include-rejected", "limit", "continuation", "sort", "json"],
    requires: ["config"],
    requestFile: false,
    mode: "scope",
  },
  graph: { operation: "graph", flags: ["config", "scope", "all", "json"], requires: ["config"], requestFile: false },
  ready: { operation: "ready", flags: ["config", "scope", "all", "json"], requires: ["config"], requestFile: false },
  annotate: { operation: "annotate", flags: ["config", "scope", "request"], requires: ["config", "scope", "request"], requestFile: true },
  recover: { operation: "recover", flags: ["config", "scope", "request"], requires: ["config", "scope", "request"], requestFile: true },
  "review show": { operation: "review", flags: ["config", "scope", "plan", "purpose", "outcome", "json"], requires: ["config", "plan"], requestFile: false },
  scopes: { operation: "scopes", flags: ["config", "json"], requires: ["config"], requestFile: false },
  sync: { operation: "sync", flags: ["config", "scope", "json"], requires: ["config"], requestFile: false },
  pull: { operation: "pull", flags: ["config", "scope", "into", "json"], requires: ["config", "scope"], requestFile: false },
  check: { operation: "check", flags: ["config", "scope", "history", "json"], requires: ["config"], requestFile: false },
  operation: { operation: "operation", flags: ["config", "scope", "id", "json"], requires: ["config", "scope", "id"], requestFile: false },
  "plan propose": { operation: "propose", flags: ["config", "scope", "request"], requires: ["config", "scope", "request"], requestFile: true },
  "plan revise": { operation: "revise", flags: ["config", "scope", "request"], requires: ["config", "scope", "request"], requestFile: true },
  "plan complete": { operation: "complete", flags: ["config", "scope", "request"], requires: ["config", "scope", "request"], requestFile: true },
  "plan prune": { operation: "prune", flags: ["config", "scope", "rejected", "request"], requires: ["config", "scope", "rejected", "request"], requestFile: true },
  observe: { operation: "observe", flags: ["config", "scope", "request"], requires: ["config", "scope", "request"], requestFile: true },
  "review decide": { operation: "decide", flags: ["config", "scope", "request"], requires: ["config", "scope", "request"], requestFile: true },
  "discussion save": { operation: "save-discussion", flags: ["config", "scope", "request"], requires: ["config", "scope", "request"], requestFile: true },
  "spec attach": { operation: "attach-spec", flags: ["config", "scope", "request"], requires: ["config", "scope", "request"], requestFile: true },
  "projection repair": { operation: "repair", flags: ["config", "scope", "request"], requires: ["config", "scope", "request"], requestFile: true },
  render: { operation: "render", flags: ["config", "scope", "all", "json"], requires: ["config"], requestFile: false },
  "scope retitle": { operation: "retitle", flags: ["config", "scope", "request"], requires: ["config", "scope", "request"], requestFile: true },
  "rename-files": { operation: "rename-files", flags: ["config", "scope", "all", "json"], requires: ["config"], requestFile: false },
  translate: { operation: "translate", flags: ["config", "scope", "idea", "from", "to", "assumption", "write"], requires: ["config"], requestFile: false },
  resolve: { operation: "resolve", flags: ["config", "scope", "in", "idea", "n"], requires: ["config"], requestFile: false },
  init: { operation: "legacy-init", flags: ["config", "kind", "id"], requires: ["config"], requestFile: false },
};

const ROUTE_NAMES = Object.keys(ROUTES);
const BOOLEAN_FLAGS = new Set(["json", "include-rejected", "all", "write", "brief", "rejected"]);

class UsageError extends Error {}

function usage(): string {
  return [
    "usage: mozak <route> --config FILE [flags]",
    "  mozak scope init --scope ID --request FILE          (owner)",
    "  mozak scope retitle --scope ID --request FILE       (owner; change the scope's display title)",
    "  mozak context [--scope ID] [--brief] [--plan ID] [--json]",
    "  mozak plans [--scope ID | --all] [--include-rejected] [--limit 1..100] [--sort deadline] [--continuation TOKEN] [--json]",
    "  mozak graph (--scope ID | --all) [--json]           (cross-plan refs from owner annotations, with resolution)",
    "  mozak ready (--scope ID | --all) [--json]           (open plans whose needs are met, by deadline; blocked and superseded apart)",
    "  mozak annotate --scope ID --request FILE            (owner; refs and deadlines in mozak.annotations.json)",
    "  mozak scopes [--json]                                (read-only index of every scope: id, folder, title, plan counts)",
    "  mozak sync [--scope ID] [--json]                     (force-refresh remote scopes; reads refresh them after 10 minutes)",
    "  mozak pull --scope ID [--into PATH]                  (owner; clone the code; vault-plans scopes keep plans in the vault)",
    "  mozak review show [--scope ID] --plan ID [--purpose P] [--outcome ID] [--json]",
    "  mozak check [--scope ID] [--history N] [--json]       (--history: hand edits in the last N commits of mozak.json)",
    "  mozak operation --scope ID --id OP [--json]",
    "  mozak plan propose|revise|complete --scope ID --request FILE",
    "  mozak plan prune --rejected --scope ID --request FILE (owner; remove the listed rejected plans, refs keep resolving)",
    "  mozak observe --scope ID --request FILE",
    "  mozak discussion save --scope ID --request FILE      (agent; advisory checkpoint only)",
    "  mozak spec attach --scope ID --request FILE          (agent; descriptor only, no approval)",
    "  mozak review decide --scope ID --request FILE        (owner)",
    "  mozak projection repair --scope ID --request FILE    (owner)",
    "  mozak recover --scope ID --request FILE              (owner; remove a write lock from another host or a dead local pid)",
    "  mozak render (--scope ID | --all) [--json]           (regenerate stale mozak.md only; never mozak.json)",
    "  mozak rename-files (--scope ID | --all) [--json]     (owner; rename pre-0.4 MOZAK.json/MOZAK.md to lowercase)",
    "Maintenance (no --config needed):",
    "  mozak --version",
    "  mozak upgrade [--check] [--vault PATH ...] [--source PATH] [--prefix PATH]   (owner; newest tagged release)",
    "  mozak doctor [--fix] [--config FILE] [--json]        (check the setup; --fix only links, wrappers, plugin copies)",
    "Exit: 0 success, 2 invalid or unavailable, 3 stale/conflict/owner-review, 4 busy/recovery,",
    "      5 committed with unfinished projection or cleanup, 6 partial all-scope coverage.",
    "Config: FILE is the explicit inventory JSON. There is no default path and no directory scan.",
    '  Shape: { "format": "mozak.local/v3", "scopes": [ { "id": "name", "root": "path" } ] }',
    '  Repo scopes: { "id": "x", "remote": "github:owner/repo" } keeps plans in the repo (private repos);',
    '  add "plans": "vault/folder" to keep them in that folder instead (public repos).',
    "  Read routes run inside a clone of an inventoried repo may omit --scope; it is found from the git origin.",
    "  Relative roots resolve against the inventory file's directory. Ask the owner for the path;",
    "  first use (creating an inventory or a scope) is documented in the skill's references/bootstrap.md.",
  ].join("\n");
}

/** Reject duplicate flags before parseArgs, which would silently keep the last value. */
function assertNoDuplicates(argv: string[]): void {
  const seen = new Set<string>();
  for (const token of argv) {
    if (!token.startsWith("--")) continue;
    const name = token.slice(2).split("=")[0] ?? "";
    if (seen.has(name)) throw new UsageError(`duplicate flag --${name}`);
    seen.add(name);
  }
}

/** Read a request file as bytes, capped at 1 MiB, before any parsing. Never sourced or evaluated. */
function readRequestFile(path: string): unknown {
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch {
    throw new UsageError(`cannot open request file ${path}`);
  }
  try {
    const stats = fstatSync(fd);
    if (!stats.isFile()) throw new UsageError(`request must be a regular file: ${path}`);
    if (stats.size > MAX_REQUEST_BYTES) throw new UsageError(`request file exceeds 1 MiB: ${path}`);
    const buffer = Buffer.alloc(Math.min(stats.size, MAX_REQUEST_BYTES) + 1);
    let total = 0;
    for (;;) {
      const n = readSync(fd, buffer, total, buffer.length - total, null);
      if (n === 0) break;
      total += n;
      if (total > MAX_REQUEST_BYTES) throw new UsageError(`request file exceeds 1 MiB: ${path}`);
    }
    try {
      return JSON.parse(buffer.subarray(0, total).toString("utf8"));
    } catch {
      throw new UsageError(`request file is not valid JSON: ${path}`);
    }
  } finally {
    closeSync(fd);
  }
}

interface Parsed {
  route: Route;
  routeName: string;
  values: Record<string, string | boolean | undefined>;
}

function parseCommand(argv: string[]): Parsed {
  // Route is one or two leading words. Anything else is an unknown route.
  const twoWord = argv.slice(0, 2).join(" ");
  let routeName: string | undefined;
  let rest: string[];
  if (ROUTE_NAMES.includes(twoWord)) {
    routeName = twoWord;
    rest = argv.slice(2);
  } else if (ROUTE_NAMES.includes(argv[0] ?? "")) {
    routeName = argv[0];
    rest = argv.slice(1);
  } else {
    throw new UsageError(`unknown route "${argv.slice(0, 2).join(" ")}"`);
  }
  const route = ROUTES[routeName as string] as Route;

  assertNoDuplicates(rest);
  // Every route accepts --json. Each result is already a JSON envelope, so the flag is a uniform no-op.
  const allowed = [...new Set(["config", "json", ...route.flags])];
  const options: Record<string, { type: "string" | "boolean"; multiple: false }> = {};
  for (const flag of allowed) {
    options[flag] = { type: BOOLEAN_FLAGS.has(flag) ? "boolean" : "string", multiple: false };
  }

  let parsed;
  try {
    parsed = parseArgs({ args: rest, options, strict: true, allowPositionals: false });
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : String(err));
  }
  const values = parsed.values as Record<string, string | boolean | undefined>;

  for (const flag of ["config", ...route.requires]) {
    if (values[flag] === undefined) throw new UsageError(`missing --${flag}`);
  }
  for (const flag of Object.keys(values)) {
    if (values[flag] !== undefined && flag !== "config" && !allowed.includes(flag)) {
      throw new UsageError(`flag --${flag} is not valid for "${routeName}"`);
    }
  }
  // A continuation pins its own selector, so it may stand alone. Mixed selectors are refused by the facade.
  // Without --scope or --all, plans is scoped to the current clone (resolved later from its git origin).
  if (route.mode === "scope" && values.continuation === undefined) {
    const hasScope = values.scope !== undefined;
    const hasAll = values.all !== undefined;
    if (hasScope && hasAll) throw new UsageError(`plans needs at most one of --scope or --all, or --continuation alone`);
  }
  return { route, routeName: routeName as string, values };
}

/**
 * Explicit purpose label for an awaiting row. Each awaiting row is a separate owner decision, so a plan can
 * appear up to three times. The label keeps those rows unambiguous. It presents existing purposes only.
 */
const AWAITING_PURPOSE: Record<string, string> = {
  pending: "review: direction approval",
  outcome: "review: outcome acceptance",
  implementation: "review: implementation approval",
};

/** Human-readable plans view. JSON output is unchanged and remains the machine contract. */
interface HumanRow {
  planId: string;
  rowKind: string;
  title?: string;
  outcome?: string;
  date?: string;
  paused?: boolean;
  reason?: string;
  continuation?: string;
  deadline?: string | null;
  deadlineStatus?: string;
}
interface RemoteInfoRow { scope: string; remote: string; ref: string; stale: boolean; lastFetchAt: string | null; error?: string; source: string }
function remoteLines(remote: RemoteInfoRow[] | undefined): string[] {
  return (remote ?? []).map((r) => `remote ${r.scope}: ${r.remote}@${r.ref}${r.stale ? ` STALE (cached copy, ${r.error ?? "fetch failed"})` : ""}${r.lastFetchAt ? `, last fetch ${r.lastFetchAt}` : ""}`);
}
function renderPlansHuman(data: {
  remote?: RemoteInfoRow[];
  status: string;
  uniquePlanCount?: number;
  reviewItemCount?: number;
  groups?: Record<string, { count: number; rows: HumanRow[]; hasMore: boolean; continuation: string | null }>;
  issues?: { code: string; message: string; scope?: string }[];
}): string {
  const lines: string[] = [`status: ${data.status}`, `plans: ${data.uniquePlanCount ?? 0}, review items: ${data.reviewItemCount ?? 0}`];
  // Fixed order, then rejected only if the facade returned it (it does so only with --include-rejected).
  const order = ["completed", "open", "awaiting", "rejected"];
  for (const group of order) {
    const g = data.groups?.[group];
    if (!g) continue;
    lines.push("", `${group} (${g.count})${g.count === 0 ? " none" : ""}`);
    for (const row of g.rows) {
      const title = row.title ?? row.planId;
      lines.push(`  - ${title}  [${row.planId}]`);
      if (group === "awaiting" && AWAITING_PURPOSE[row.rowKind]) lines.push(`      ${AWAITING_PURPOSE[row.rowKind]}`);
      if (row.outcome) lines.push(`      outcome: ${row.outcome}`);
      if (row.date) lines.push(`      date: ${row.date}`);
      if (row.deadline) lines.push(`      deadline: ${row.deadline} (${row.deadlineStatus})`);
      else if (row.deadlineStatus === "candidates") lines.push("      deadline: several dates, owner picks one");
      if (row.paused) lines.push(`      paused${row.reason ? `: ${row.reason}` : ""}`);
      else if (row.reason) lines.push(`      reason: ${row.reason}`);
    }
    if (g.hasMore && g.continuation) lines.push(`  more: --continuation ${g.continuation}`);
  }
  for (const issue of data.issues ?? []) lines.push(`issue ${issue.scope ? `[${issue.scope}] ` : ""}${issue.code}: ${issue.message}`);
  lines.push(...remoteLines(data.remote));
  return `${lines.join("\n")}\n`;
}

/** Human-readable scope index. JSON output is unchanged and remains the machine contract. */
interface IndexRow {
  id: string;
  root: string;
  status: string;
  code?: string;
  message?: string;
  title?: string;
  kind?: string;
  plans?: { completed: number; open: number; awaiting: number };
  entryFiles: string[];
  remote?: string;
  ref?: string;
  stale?: boolean;
  staleReason?: string;
  lastFetchAt?: string | null;
}
function renderScopesHuman(data: { coverage?: { selected: number; ok: number; failed: number }; scopes?: IndexRow[] }): string {
  const c = data.coverage;
  const lines: string[] = [`scopes: ${c?.selected ?? 0} (ok ${c?.ok ?? 0}, failed ${c?.failed ?? 0})`, ""];
  for (const s of data.scopes ?? []) {
    if (s.status === "ok") {
      const p = s.plans ?? { completed: 0, open: 0, awaiting: 0 };
      lines.push(`${s.id}  [${s.kind}]  ${s.title}${s.remote ? "  [remote" + (s.stale ? ", STALE" : "") + "]" : ""}`);
      if (s.remote) lines.push(`    remote: ${s.remote}@${s.ref}${s.stale ? ` (cached copy, ${s.staleReason ?? "fetch failed"})` : ""}`);
      lines.push(`    folder: ${s.root}`);
      lines.push(`    plans: ${p.completed} completed, ${p.open} open, ${p.awaiting} awaiting`);
      lines.push(`    files: ${s.entryFiles.join(", ") || "none"}`);
    } else {
      lines.push(`${s.id}  failed (${s.code})${s.remote ? "  [remote" + (s.stale ? ", STALE" : "") + "]" : ""}`);
      lines.push(`    folder: ${s.root}`);
      lines.push(`    ${s.message}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function renderSyncHuman(data: { remote?: RemoteInfoRow[]; issues?: { code: string; message: string }[] }): string {
  const rows = data.remote ?? [];
  if (rows.length === 0) return "no remote scopes in the inventory\n";
  const warn = (data.issues ?? []).filter((i) => i.code === "cache-not-ignored").map((i) => `warning: ${i.message}`);
  return `${[...remoteLines(rows), ...warn].join("\n")}\n`;
}

function printEnvelope(output: OperationOutput, json: boolean, routeName: string): void {
  if (!json && routeName === "sync") {
    process.stdout.write(renderSyncHuman(output.data as Parameters<typeof renderSyncHuman>[0]));
    return;
  }
  if (!json && routeName === "scopes") {
    process.stdout.write(renderScopesHuman(output.data as Parameters<typeof renderScopesHuman>[0]));
    return;
  }
  if (json || routeName !== "plans") {
    process.stdout.write(`${JSON.stringify(output.data, null, 2)}\n`);
    return;
  }
  process.stdout.write(renderPlansHuman(output.data as Parameters<typeof renderPlansHuman>[0]));
}

/** upgrade and doctor work on the installation, not on scopes, so they have their own flags and no --config rule. */
function maintenance(name: "upgrade" | "doctor", argv: string[]): number {
  let values: Record<string, string | boolean | string[] | undefined>;
  try {
    assertNoDuplicates(name === "upgrade" ? argv.filter((a) => a !== "--vault" && !a.startsWith("--vault=")) : argv);
    values = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: name === "upgrade"
        ? { prefix: { type: "string" }, source: { type: "string" }, vault: { type: "string", multiple: true }, check: { type: "boolean" }, json: { type: "boolean" } }
        : { config: { type: "string" }, prefix: { type: "string" }, fix: { type: "boolean" }, json: { type: "boolean" } },
    }).values as typeof values;
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n${usage()}\n`);
    return 2;
  }
  if (name === "upgrade") {
    const out = upgrade({
      ...(values.prefix !== undefined ? { prefix: values.prefix as string } : {}),
      ...(values.source !== undefined ? { source: values.source as string } : {}),
      vaults: (values.vault as string[] | undefined) ?? [],
      check: values.check === true,
    });
    process.stdout.write(`${JSON.stringify(out.data, null, 2)}\n`);
    return out.exitCode;
  }
  const out = doctor({
    fix: values.fix === true,
    ...(values.config !== undefined ? { config: values.config as string } : {}),
    ...(values.prefix !== undefined ? { prefix: values.prefix as string } : {}),
  });
  process.stdout.write(values.json === true ? `${JSON.stringify(out.data, null, 2)}\n` : renderDoctor(out.data));
  return out.exitCode;
}

function run(argv: string[]): number {
  if (argv[0] === "--version" || argv[0] === "-v") {
    if (argv.length > 1) { process.stderr.write("--version takes no arguments\n"); return 2; }
    process.stdout.write(`${runningVersion()}\n`);
    return 0;
  }
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(`mozak ${runningVersion()}\n${usage()}\n`);
    return 0;
  }
  if (argv[0] === "upgrade" || argv[0] === "doctor") return maintenance(argv[0], argv.slice(1));

  let parsed: Parsed;
  try {
    parsed = parseCommand(argv);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${message}\n${usage()}\n`);
    return 2;
  }

  const { route, routeName, values } = parsed;
  const configPath = values.config as string;

  let inventory;
  try {
    inventory = loadInventory(configPath);
  } catch (err) {
    const code = typeof (err as { code?: unknown }).code === "string" ? (err as { code: string }).code : "inventory-unavailable";
    const message = err instanceof Error ? err.message : String(err);
    process.stdout.write(`${JSON.stringify({ status: code, committed: false, snapshot: null, projectionStatus: null, projectionUpdated: false, issues: [{ code, message }] }, null, 2)}\n`);
    return 2;
  }

  const cwdScope = CWD_SCOPE_ROUTES.has(routeName) && values.scope === undefined && values.all === undefined && values.continuation === undefined;
  if (cwdScope) {
    try {
      values.scope = scopeForWorkingCopy(inventory, process.cwd()).id;
    } catch (err) {
      if (!(err instanceof DomainError)) throw err;
      process.stdout.write(`${JSON.stringify({ status: err.code, committed: false, snapshot: null, projectionStatus: null, projectionUpdated: false, issues: [{ code: err.code, message: err.message }] }, null, 2)}\n`);
      return err.exitCode;
    }
  }

  let args: Record<string, unknown>;
  if (route.operation === "plans") {
    args =
      values.continuation !== undefined
        ? {
            // Only what the user typed is forwarded. The facade refuses any selector or filter beside a token.
            continuation: values.continuation,
            ...(values.scope !== undefined ? { scope: values.scope } : {}),
            ...(values.all !== undefined ? { all: true } : {}),
            ...(values["include-rejected"] ? { includeRejected: true } : {}),
            ...(values.limit !== undefined ? { limit: Number(values.limit) } : {}),
          }
        : {
            ...(values.scope !== undefined ? { scope: values.scope } : { all: true }),
            ...(values["include-rejected"] ? { includeRejected: true } : {}),
            ...(values.limit !== undefined ? { limit: Number(values.limit) } : {}),
            ...(values.sort !== undefined ? { sort: values.sort } : {}),
          };
    if (values.limit !== undefined && !/^[0-9]+$/.test(String(values.limit))) {
      process.stderr.write("limit must be an integer from 1 to 100\n");
      return 2;
    }
  } else if (route.operation === "scopes") {
    args = {};
  } else if (route.operation === "graph" || route.operation === "ready") {
    if ((values.scope === undefined) === (values.all === undefined)) {
      process.stderr.write(`${route.operation} needs exactly one of --scope or --all\n${usage()}\n`);
      return 2;
    }
    args = values.all ? { all: true } : { scope: values.scope };
  } else if (route.operation === "sync") {
    args = values.scope !== undefined ? { scope: values.scope } : {};
  } else if (route.operation === "render" || route.operation === "rename-files") {
    if ((values.scope === undefined) === (values.all === undefined)) {
      process.stderr.write(`${route.operation} needs exactly one of --scope or --all\n${usage()}\n`);
      return 2;
    }
    args = values.all ? { all: true } : { scope: values.scope };
  } else if (route.operation === "pull") {
    args = { scope: values.scope, ...(values.into !== undefined ? { into: values.into } : {}) };
  } else if (route.operation === "review") {
    args = { scope: values.scope, plan: values.plan, ...(values.purpose !== undefined ? { purpose: values.purpose } : {}), ...(values.outcome !== undefined ? { outcome: values.outcome } : {}) };
  } else if (route.operation === "context") {
    args = { scope: values.scope, ...(values.brief !== undefined ? { brief: values.brief } : {}), ...(values.plan !== undefined ? { plan: values.plan } : {}) };
  } else if (route.operation === "operation") {
    args = { scope: values.scope, id: values.id };
  } else if (route.operation === "check") {
    if (values.history !== undefined && !/^[0-9]+$/.test(String(values.history))) {
      process.stderr.write("history must be an integer from 1 to 500\n");
      return 2;
    }
    args = { scope: values.scope, ...(values.history !== undefined ? { history: Number(values.history) } : {}) };
  } else if (route.requestFile) {
    try {
      args = { scope: values.scope, request: readRequestFile(values.request as string) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stdout.write(`${JSON.stringify({ status: "invalid-input", committed: false, snapshot: null, projectionStatus: null, projectionUpdated: false, issues: [{ code: "invalid-input", message }] }, null, 2)}\n`);
      return 2;
    }
  } else {
    args = { scope: values.scope };
  }

  const actor = OWNER_ROUTES.has(route.operation) ? "owner" : "agent";
  const output = executeOperation(inventory, route.operation, args, actor);
  printEnvelope(output, values.json === true || (routeName !== "plans" && routeName !== "scopes" && routeName !== "sync"), routeName);
  return output.exitCode;
}

try {
  process.exitCode = run(process.argv.slice(2));
} catch (err) {
  // Unexpected failures are reported, never dressed up as a domain result.
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`internal error: ${message}\n`);
  process.exitCode = 1;
}
