#!/usr/bin/env node
// mozak v2 CLI. Thin transport over the shared executeOperation facade in @mozak/core.
// Strict flags: unknown and duplicate flags are rejected. No shell, no eval, request files are data.
// The actor is chosen by route here (owner for decide/init/repair, agent otherwise). No flag sets it.

import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { parseArgs } from "node:util";
import { decideWithFlags, deleteWithFlags, observePayload, observeWithFlags, planShow, executeOperation, loadInventory, MAX_REQUEST_BYTES, gitCommitScope, focusChange, focusList, renderFocus, renderMove, scopeLinkOutput, scopeMoveOutput, type OperationOutput, type ScopeInventory } from "@mozak/core";
import { runningVersion, upgrade } from "./upgrade.js";
import { doctor, renderDoctor } from "./doctor.js";

const OWNER_ROUTES = new Set(["decide", "init", "repair", "rename-files", "retitle", "delete", "annotate", "recover", "prune", "plans-md"]);

/** Flag forms that replace hand-written request files. Owner provenance is always explicit. */
const DECIDE_FLAGS = ["plan", "purpose", "outcome", "spec", "owner-ref", "owner-message-at", "reason", "dry-run"] as const;
const DELETE_FLAGS = ["plans", "owner-ref", "owner-message-at", "reason", "allow-completed", "dry-run"] as const;
const OBSERVE_FLAGS = ["payload", "plan", "outcome", "summary", "locator", "verdict", "activity", "activity-kind", "relation", "classification", "anchor", "version", "limitation", "dry-run"] as const;
const FLAG_REQUIRED: Record<string, readonly string[]> = {
  decide: ["plan", "purpose", "owner-ref", "owner-message-at", "reason"],
  delete: ["plans", "owner-ref", "owner-message-at", "reason"],
  observe: ["plan", "summary"],
};

type Route = {
  operation: string;
  flags: readonly string[];
  requires: readonly string[];
  requestFile: boolean;
  mode?: "scope" | "all";
};

const ROUTES: Record<string, Route> = {
  "scope init": { operation: "init", flags: ["config", "scope", "request"], requires: ["config", "scope", "request"], requestFile: true },
  context: { operation: "context", flags: ["config", "scope", "brief", "plan", "json"], requires: ["config", "scope"], requestFile: false },
  plans: {
    operation: "plans",
    flags: ["config", "scope", "all", "include-rejected", "limit", "continuation", "sort", "json"],
    requires: ["config"],
    requestFile: false,
    mode: "scope",
  },
  graph: { operation: "graph", flags: ["config", "scope", "all", "json"], requires: ["config"], requestFile: false },
  ready: { operation: "ready", flags: ["config", "scope", "all", "json"], requires: ["config"], requestFile: false },
  similar: { operation: "similar", flags: ["config", "scope", "all", "json"], requires: ["config"], requestFile: false },
  locators: { operation: "locators", flags: ["config", "scope", "all", "plan", "include-private", "json"], requires: ["config"], requestFile: false },
  "plans-md": { operation: "plans-md", flags: ["config", "print", "json"], requires: ["config"], requestFile: false },
  annotate: { operation: "annotate", flags: ["config", "scope", "request"], requires: ["config", "scope", "request"], requestFile: true },
  recover: { operation: "recover", flags: ["config", "scope", "request"], requires: ["config", "scope", "request"], requestFile: true },
  "review show": { operation: "review", flags: ["config", "scope", "plan", "purpose", "outcome", "json"], requires: ["config", "scope", "plan"], requestFile: false },
  scopes: { operation: "scopes", flags: ["config", "json"], requires: ["config"], requestFile: false },
  sync: { operation: "sync", flags: ["config", "scope", "local", "json"], requires: ["config"], requestFile: false },
  check: { operation: "check", flags: ["config", "scope", "history", "json"], requires: ["config", "scope"], requestFile: false },
  operation: { operation: "operation", flags: ["config", "scope", "id", "json"], requires: ["config", "scope", "id"], requestFile: false },
  "plan propose": { operation: "propose", flags: ["config", "scope", "request"], requires: ["config", "scope", "request"], requestFile: true },
  "plan revise": { operation: "revise", flags: ["config", "scope", "request"], requires: ["config", "scope", "request"], requestFile: true },
  "plan complete": { operation: "complete", flags: ["config", "scope", "request"], requires: ["config", "scope", "request"], requestFile: true },
  "plan delete": { operation: "delete", flags: ["config", "scope", "request", ...DELETE_FLAGS], requires: ["config", "scope"], requestFile: true },
  "plan show": { operation: "plan-show", flags: ["config", "scope", "plan", "json"], requires: ["config", "scope", "plan"], requestFile: false },
  "focus list": { operation: "focus-list", flags: ["config", "scope", "json"], requires: ["config"], requestFile: false },
  "focus add": { operation: "focus-add", flags: ["config", "scope", "plan", "json"], requires: ["config", "scope", "plan"], requestFile: false },
  "focus remove": { operation: "focus-remove", flags: ["config", "scope", "plan", "json"], requires: ["config", "scope", "plan"], requestFile: false },
  "scope move": { operation: "scope-move", flags: ["config", "scope", "to", "drop", "repo", "dry-run", "owner-ref", "owner-message-at", "reason", "json"], requires: ["config", "scope", "owner-ref", "owner-message-at", "reason"], requestFile: false },
  "scope link": { operation: "scope-link", flags: ["config", "scope", "repo", "clear", "json"], requires: ["config", "scope"], requestFile: false },
  observe: { operation: "observe", flags: ["config", "scope", "request", ...OBSERVE_FLAGS], requires: ["config", "scope"], requestFile: true },
  "review decide": { operation: "decide", flags: ["config", "scope", "request", ...DECIDE_FLAGS], requires: ["config", "scope"], requestFile: true },
  "plan prune": { operation: "prune", flags: ["config", "scope", "rejected", "request"], requires: ["config", "scope", "rejected", "request"], requestFile: true },
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
const BOOLEAN_FLAGS = new Set(["json", "include-rejected", "all", "write", "brief", "dry-run", "allow-completed", "commit", "rejected", "local", "print", "include-private", "drop", "clear"]);

class UsageError extends Error {}

function usage(): string {
  return [
    "usage: mozak [--config FILE] <route> [--config FILE] [flags]   (--config defaults to $MOZAK_CONFIG; <route> --help lists its flags)",
    "  mozak scope init --scope ID --request FILE          (owner)",
    "  mozak scope retitle --scope ID --request FILE       (owner; change the scope's display title)",
    "  mozak scope move --scope ID (--to PATH [--repo SPEC] | --drop) --owner-ref REF --owner-message-at ISO --reason TEXT [--dry-run] [--json]",
    "                                                       (owner; copy the scope's files into a vault folder, verify them,",
    "                                                        point its inventory entry there; old files stay. --drop: 0-plan entry only)",
    "  mozak scope link --scope ID (--repo SPEC | --clear) [--json]",
    "                                                       (owner; display-only repo link, github:owner/repo or https URL; never fetched)",
    "  mozak context --scope ID [--brief] [--plan ID] [--json]",
    "  mozak plans [--scope ID | --all] [--include-rejected] [--limit 1..100] [--sort deadline] [--continuation TOKEN] [--json]",
    "  mozak graph (--scope ID | --all) [--json]           (cross-plan refs from owner annotations, with resolution)",
    "  mozak ready (--scope ID | --all) [--json]           (open plans whose needs are met, by deadline; blocked and superseded apart)",
    "  mozak similar (--scope ID | --all) [--json]         (similar plans: duplicate, overlap, supersedes-candidate; rejects moved to another scope)",
    "  mozak locators (--scope ID | --all) [--plan ID] [--include-private] [--json]",
    "                                                       (where each source and evidence locator points on this machine)",
    "  mozak plans-md [--print] [--json]                    (owner; write plans.md with plan titles and states at each repo root; --print only shows it)",
    "  mozak annotate --scope ID --request FILE            (owner; refs and deadlines in mozak.annotations.json)",
    "  mozak scopes [--json]                                (read-only index of every scope: id, folder, title, plan counts)",
    "  mozak sync [--scope ID] [--json]                    (fetch, then fast-forward each vault repo under the scope locks; never pushes)",
    "  mozak review show --scope ID --plan ID [--purpose P] [--outcome ID] [--json]",
    "  mozak check --scope ID [--history N] [--json]        (--history: hand edits in the last N commits of mozak.json)",
    "  mozak operation --scope ID --id OP [--json]",
    "  mozak plan show --scope ID --plan ID [--json]        (compact: lifecycle, eligibility, grants, outcomes, spec, next action)",
    "  mozak focus list [--scope ID] [--json]               (the owner's starred plans per scope, from the inventory)",
    "  mozak focus add|remove --scope ID --plan ID          (owner; star or unstar a plan; edits only the inventory's focus list)",
    "  mozak plan propose|revise|complete --scope ID --request FILE",
    "  mozak plan delete --scope ID --plans A,B --owner-ref REF --owner-message-at ISO --reason TEXT [--allow-completed] [--dry-run] [--json]",
    "                                                       (owner; or --request FILE; receipt keeps the record)",
    "  mozak observe --scope ID --plan ID --summary TEXT --locator WHERE [--outcome ID] [--verdict pass|fail|not-assessed]",
    "        [--activity TEXT] [--activity-kind read|run] [--relation supports|challenges] [--classification observed|inferred|unverified]",
    "        [--anchor A] [--version V] [--limitation TEXT] [--dry-run] [--json]",
    "  mozak observe --scope ID --payload FILE [--dry-run]   (payload of examples/observe.json; fresh snapshot, retries stale-input; or --request FILE)",
    "  mozak plan prune --rejected --scope ID --request FILE (owner; remove the listed rejected plans, refs keep resolving)",
    "  mozak discussion save --scope ID --request FILE      (agent; advisory checkpoint only)",
    "  mozak spec attach --scope ID --request FILE          (agent; descriptor only, no approval)",
    "  mozak review decide --scope ID --plan ID --purpose P [--outcome ID] [--spec SPEC] --owner-ref REF",
    "        --owner-message-at ISO --reason TEXT [--dry-run] [--json]   (owner; reads the fresh subject itself; or --request FILE)",
    "  mozak projection repair --scope ID --request FILE    (owner)",
    "  mozak recover --scope ID --request FILE              (owner; remove a write lock from another host or a dead local pid)",
    "  mozak render (--scope ID | --all) [--json]           (regenerate stale mozak.md only; never mozak.json)",
    "  mozak rename-files (--scope ID | --all) [--json]     (owner; rename pre-0.4 MOZAK.json/MOZAK.md to lowercase)",
    "Maintenance (no --config needed):",
    "  mozak --version",
    "  mozak upgrade [--check] [--vault PATH ...] [--source PATH] [--prefix PATH]   (owner; newest tagged release)",
    "  mozak doctor [--fix] [--config FILE] [--json]        (check the setup; --fix only links, wrappers, plugin copies)",
    "Writes (every --request/flag write route) accept --commit: commit the scope's mozak.json and mozak.md in the",
    "  containing git repo, then pull --rebase and push when it has an upstream (never forces; stops on conflict).",
    "  Without it the status says \"written ... not committed to git\".",
    "Exit: 0 success, 2 invalid or unavailable, 3 stale/conflict/owner-review, 4 busy/recovery,",
    "      5 committed with unfinished projection or cleanup, 6 partial all-scope coverage.",
    "Config: FILE is the explicit inventory JSON. There is no default path and no directory scan.",
    '  Shape: { "format": "mozak.local/v3", "scopes": [ { "id": "name", "root": "path", "repo": "github:owner/repo" } ] }',
    "  Every root is a folder inside an Obsidian vault (a folder with .obsidian at or above it). repo is optional and",
    "  display-only. An entry with remote, ref or plans is a pre-0.6 repo scope: move it with mozak scope move.",
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

/** Route name at the start of argv: two words first, then one. Undefined for an unknown route. */
function routeOf(argv: string[]): string | undefined {
  const twoWord = argv.slice(0, 2).join(" ");
  if (ROUTE_NAMES.includes(twoWord)) return twoWord;
  return ROUTE_NAMES.includes(argv[0] ?? "") ? argv[0] : undefined;
}

/** Route names a usage line documents: `  mozak plan propose|revise --x` gives plan propose and plan revise. */
function usageNames(line: string): string[] {
  const [, first, second = ""] = line.trim().split(/\s+/);
  return [first, ...second.split("|").map((w) => `${first} ${w}`)];
}

/** `mozak <route> --help`: that route's flags, the required ones, and the matching usage lines. */
function routeHelp(routeName: string): string {
  const route = ROUTES[routeName];
  const flags = [...new Set(["config", ...route.flags, ...(route.requestFile ? ["commit"] : []), "json"])];
  const shown = flags.map((f) => (BOOLEAN_FLAGS.has(f) || f === "commit" ? `--${f}` : `--${f} VALUE`));
  const lines = usage().split("\n").filter((l) => usageNames(l).includes(routeName));
  return [`mozak ${routeName}`, `flags: ${shown.join(" ")}`, `required: ${["config", ...route.requires.filter((f) => f !== "config")].map((f) => `--${f}`).join(" ")}`,
    "--config defaults to $MOZAK_CONFIG when set.", ...lines].join("\n");
}

function parseCommand(argv: string[]): Parsed {
  // Route is one or two leading words. Anything else is an unknown route.
  const routeName = routeOf(argv);
  if (routeName === undefined) throw new UsageError(`unknown route "${argv.slice(0, 2).join(" ")}"`);
  const rest = argv.slice(routeName.split(" ").length);
  const route = ROUTES[routeName];

  assertNoDuplicates(rest);
  // Every route accepts --json. Each result is already a JSON envelope, so the flag is a uniform no-op.
  const allowed = [...new Set(["config", "json", ...route.flags, ...(route.requestFile ? ["commit"] : [])])];
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
  if (values.config === undefined && process.env.MOZAK_CONFIG) values.config = process.env.MOZAK_CONFIG;

  for (const flag of ["config", ...route.requires]) {
    if (values[flag] === undefined) throw new UsageError(`missing --${flag}`);
  }
  for (const flag of Object.keys(values)) {
    if (values[flag] !== undefined && flag !== "config" && !allowed.includes(flag)) {
      throw new UsageError(`flag --${flag} is not valid for "${routeName}"`);
    }
  }
  // A continuation pins its own selector, so it may stand alone. Mixed selectors are refused by the facade.
  // Without --scope or --all, plans lists every scope (the same as --all).
  if (route.mode === "scope" && values.continuation === undefined) {
    const hasScope = values.scope !== undefined;
    const hasAll = values.all !== undefined;
    if (hasScope && hasAll) throw new UsageError(`plans needs at most one of --scope or --all, or --continuation alone`);
  }
  return { route, routeName, values };
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
function renderPlansHuman(data: {
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
  repo?: string;
}
function renderScopesHuman(data: { coverage?: { selected: number; ok: number; failed: number }; scopes?: IndexRow[] }): string {
  const c = data.coverage;
  const lines: string[] = [`scopes: ${c?.selected ?? 0} (ok ${c?.ok ?? 0}, failed ${c?.failed ?? 0})`, ""];
  for (const s of data.scopes ?? []) {
    if (s.status === "ok") {
      const p = s.plans ?? { completed: 0, open: 0, awaiting: 0 };
      lines.push(`${s.id}  [${s.kind}]  ${s.title}`);
      lines.push(`    folder: ${s.root}`);
      if (s.repo) lines.push(`    repo: ${s.repo}`);
      lines.push(`    plans: ${p.completed} completed, ${p.open} open, ${p.awaiting} awaiting`);
      lines.push(`    files: ${s.entryFiles.join(", ") || "none"}`);
    } else {
      lines.push(`${s.id}  failed (${s.code})`);
      lines.push(`    folder: ${s.root}`);
      lines.push(`    ${s.message}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

interface LocalSyncInfoRow { repo: string | null; scopes: string[]; status: string; from?: string; to?: string; error?: string }
function renderSyncHuman(data: { local?: LocalSyncInfoRow[] }): string {
  const local = (data.local ?? []).map((r) => `${r.repo ?? r.scopes.join(", ")}: ${r.status}${r.from && r.to && r.from !== r.to ? ` ${r.from.slice(0, 8)}..${r.to.slice(0, 8)}` : ""}${r.error ? ` (${r.error})` : ""}`);
  return local.length === 0 ? "no scopes to sync\n" : `${local.join("\n")}\n`;
}

function flagForm(inventory: ReturnType<typeof loadInventory>, operation: string, v: Record<string, string | boolean | undefined>) {
  const opt = (k: string) => (v[k] === undefined ? {} : { [camel(k)]: v[k] });
  if (operation === "decide") {
    return decideWithFlags(inventory, { scope: v.scope, plan: v.plan, purpose: v.purpose, ownerRef: v["owner-ref"], ownerMessageAt: v["owner-message-at"], reason: v.reason, ...opt("outcome"), ...opt("spec"), ...(v["dry-run"] ? { dryRun: true } : {}) });
  }
  if (operation === "delete") {
    const plans = String(v.plans).split(",").map((s) => s.trim()).filter(Boolean);
    return deleteWithFlags(inventory, { scope: v.scope, plans, ownerRef: v["owner-ref"], ownerMessageAt: v["owner-message-at"], reason: v.reason, ...(v["allow-completed"] ? { allowCompleted: true } : {}), ...(v["dry-run"] ? { dryRun: true } : {}) });
  }
  return observeWithFlags(inventory, {
    scope: v.scope, plan: v.plan, summary: v.summary,
    ...opt("outcome"), ...opt("locator"), ...opt("verdict"), ...opt("activity"), ...opt("activity-kind"), ...opt("relation"), ...opt("classification"), ...opt("anchor"), ...opt("version"),
    ...(v.limitation !== undefined ? { limitations: [v.limitation] } : {}), ...(v["dry-run"] ? { dryRun: true } : {}),
  });
}
const camel = (k: string) => k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

/**
 * "committed" in the envelope means the scope transaction reached mozak.json and mozak.md on disk.
 * Git is a separate step: the scope files are committed to git only with --commit. Say which one happened.
 */
function committedLabel(d: Record<string, any>): string {
  if (d.git) return d.git.committed || d.git.pushed ? `written, ${d.git.message}` : `written, ${d.git.message.replace(/^written, /, "")}`;
  return "written to mozak.json and mozak.md, not committed to git; add --commit to commit and push";
}

/** After a successful write with --commit, commit the scope files in their git repo and push. */
function withGitCommit(out: OperationOutput, scope: unknown, inventory: ReturnType<typeof loadInventory>, operation: string, enabled: boolean): OperationOutput {
  const d = out.data as Record<string, any>;
  if (!enabled || !d.committed || d.status === "dry-run") return out;
  const entry = inventory.scopes.find((e) => e.id === scope);
  if (!entry) return out;
  const git = gitCommitScope(entry.root, `mozak: ${operation} ${entry.id}`);
  const issues = git.error ? [...(d.issues ?? []), { code: `git-${git.error}`, message: git.message }] : d.issues;
  return { exitCode: git.error && out.exitCode === 0 ? 5 : out.exitCode, data: { ...d, git, ...(issues ? { issues } : {}) } };
}

/** Short human summary of a flag-form write. --json prints the full envelope instead. */
function renderFlagResult(d: Record<string, any>, configPath: string): string {
  const lines: string[] = [`status: ${d.status}${d.committed ? ` (${committedLabel(d)})` : ""}${d.attempts > 1 ? `, attempts ${d.attempts}` : ""}`];
  if (d.subject) lines.push(`subject: ${d.subject.question}`, `  revision ${d.subject.revisionId}${d.subject.outcomeId ? `, outcome ${d.subject.outcomeId}` : ""}${d.subject.specificationId ? `, spec ${d.subject.specificationId}` : ""}`);
  if (d.subject?.approvalAvailable === false) lines.push(`  approval not available: ${(d.subject.approvalReasons ?? []).join(", ")}`);
  if (d.operationId) lines.push(`operationId: ${d.operationId}`);
  if (d.observationId) lines.push(`observationId: ${d.observationId}`);
  if (d.status === "dry-run") lines.push("dry run: nothing written. Rerun without --dry-run to submit (or --json to see the request).");
  for (const i of d.issues ?? []) lines.push(`issue ${i.code}: ${i.message}`);
  for (const w of d.warnings ?? []) {
    lines.push(`warning ${w.code}: ${w.message}`);
    if (w.command) lines.push(`  next: ${String(w.command).replace("INVENTORY", configPath)}`);
  }
  return `${lines.join("\n")}\n`;
}

function renderPlanShow(d: Record<string, any>): string {
  if (d.status !== "ok") return `${JSON.stringify(d, null, 2)}\n`;
  const p = d.plan;
  const lines = [
    `${p.title ?? p.planId}  [${p.planId}]`,
    `lifecycle: ${p.lifecycle}   accepted: ${p.accepted?.id ?? "none"}   pending: ${p.pending ? `${p.pending.id} (${p.pending.reviewState})` : "none"}`,
    `executionEligible: ${p.executionEligible}${p.reasons.length ? `  reasons: ${p.reasons.join(", ")}` : ""}`,
    `implementationAuthorized: ${p.implementationAuthorized}${p.authorizationId ? ` (${p.authorizationId})` : ""}   authorizations: ${p.authorizations.length}`,
    `spec: ${p.specification ? `${p.specification.path} [${p.specification.id}, ${p.specification.health}${p.specification.candidate ? ", candidate" : ""}]` : "none"}`,
    "outcomes:",
    ...p.outcomes.map((o: any) => `  ${o.id} [${o.acceptance}] ${o.status}  supports ${o.supports}, challenges ${o.challenges}${o.acceptance === "owner" ? `, owner accepted: ${o.ownerAccepted ? "yes" : "no"}` : ""}`),
    `observations: ${p.observations}   discussion: ${p.discussionStatus}${p.reviewIssues.length ? `   review issues: ${p.reviewIssues.map((i: any) => `${i.code}:${i.outcomeId}`).join(", ")}` : ""}`,
    `next: ${p.permittedNextAction}`,
  ];
  for (const i of d.issues ?? []) lines.push(`issue ${i.code}: ${i.message}`);
  return `${lines.join("\n")}\n`;
}

function printEnvelope(output: OperationOutput, json: boolean, routeName: string): void {
  // plans-md --print without --json shows the files themselves, each under a comment line naming its path.
  if (!json && routeName === "plans-md" && Array.isArray(output.data.files) && output.data.files.every((f) => typeof (f as { content?: unknown }).content === "string")) {
    const files = output.data.files as { path: string; content: string }[];
    process.stdout.write(files.map((f) => `<!-- ${f.path} -->\n${f.content}`).join("\n"));
    return;
  }
  if (!json && routeName === "sync") {
    process.stdout.write(renderSyncHuman(output.data));
    return;
  }
  if (!json && routeName === "scopes") {
    process.stdout.write(renderScopesHuman(output.data));
    return;
  }
  if (json || routeName !== "plans") {
    process.stdout.write(`${JSON.stringify(output.data, null, 2)}\n`);
    return;
  }
  process.stdout.write(renderPlansHuman(output.data as Parameters<typeof renderPlansHuman>[0]));
}

/**
 * `mozak focus list|add|remove`. The focus list lives in the inventory file, not in plan state, so these routes call
 * core's readFocus and setFocus directly instead of the scope operation facade. add and remove are owner routes:
 * agents read focus through `focus list` or MCP `mozak_focus` only.
 */
function focusRoute(configPath: string, inventory: ScopeInventory, operation: string, values: Record<string, string | boolean | undefined>): number {
  const scope = values.scope as string | undefined;
  const out = operation === "focus-list"
    ? focusList(inventory, { scope })
    : focusChange(configPath, { scope: scope!, plan: values.plan as string, action: operation === "focus-add" ? "add" : "remove" });
  process.stdout.write(operation === "focus-list" && values.json !== true && out.exitCode === 0
    ? renderFocus(out.data.focus as Record<string, string[]>)
    : `${JSON.stringify(out.data, null, 2)}\n`);
  return out.exitCode;
}

/**
 * `mozak scope move`: an owner route on the inventory file, like focus, so it calls core's moveScope directly instead of
 * the scope operation facade. MCP never exposes it.
 */
function moveRoute(configPath: string, values: Record<string, string | boolean | undefined>): number {
  const out = scopeMoveOutput(configPath, {
    scope: values.scope, ...(values.to !== undefined ? { to: values.to } : {}), ...(values.drop ? { drop: true } : {}), ...(values["dry-run"] ? { dryRun: true } : {}),
    ...(values.repo !== undefined ? { repo: values.repo } : {}),
    ownerRef: values["owner-ref"], ownerMessageAt: values["owner-message-at"], reason: values.reason,
  });
  process.stdout.write(values.json === true ? `${JSON.stringify(out.data, null, 2)}\n` : renderMove(out.data));
  return out.exitCode;
}

/** `mozak scope link`: owner route on the inventory file. Sets or clears the display-only repo link. Not in MCP. */
function linkRoute(configPath: string, values: Record<string, string | boolean | undefined>): number {
  const out = scopeLinkOutput(configPath, { scope: values.scope, ...(values.repo !== undefined ? { repo: values.repo } : {}), ...(values.clear ? { clear: true } : {}) });
  const d = out.data as Record<string, any>;
  process.stdout.write(values.json === true || d.status !== "ok" ? `${JSON.stringify(d, null, 2)}\n` : `${d.scope}: ${d.repo === null ? "no repo link" : `repo ${d.repo}`}${d.changed ? "" : " (unchanged)"}\n`);
  return out.exitCode;
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
  // Move only a leading config option behind the complete route. Leave validation,
  // including duplicate and missing values, to the normal route parser.
  if (argv[0] === "--config" || argv[0]?.startsWith("--config=")) {
    const count = argv[0] === "--config" ? 2 : 1;
    const prefix = argv.slice(0, count);
    const remaining = argv.slice(count);
    const routeLength = ROUTE_NAMES.includes(remaining.slice(0, 2).join(" ")) ? 2 : 1;
    argv = [...remaining.slice(0, routeLength), ...prefix, ...remaining.slice(routeLength)];
  }
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
  const helpRoute = routeOf(argv);
  if (helpRoute && argv.some((a) => a === "--help" || a === "-h")) {
    process.stdout.write(`${routeHelp(helpRoute)}\n`);
    return 0;
  }

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

  if (route.operation.startsWith("focus-")) return focusRoute(configPath, inventory, route.operation, values);
  if (route.operation === "scope-move") return moveRoute(configPath, values);
  if (route.operation === "scope-link") return linkRoute(configPath, values);

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
  } else if (route.operation === "graph" || route.operation === "ready" || route.operation === "similar") {
    if ((values.scope === undefined) === (values.all === undefined)) {
      process.stderr.write(`${route.operation} needs exactly one of --scope or --all\n${usage()}\n`);
      return 2;
    }
    args = values.all ? { all: true } : { scope: values.scope };
  } else if (route.operation === "locators") {
    if ((values.scope === undefined) === (values.all === undefined)) {
      process.stderr.write(`locators needs exactly one of --scope or --all\n${usage()}\n`);
      return 2;
    }
    args = { ...(values.all ? { all: true } : { scope: values.scope }), ...(values.plan !== undefined ? { plan: values.plan } : {}), ...(values["include-private"] ? { includePrivate: true } : {}) };
  } else if (route.operation === "plans-md") {
    args = values.print ? { print: true } : {};
  } else if (route.operation === "sync") {
    args = { ...(values.scope !== undefined ? { scope: values.scope } : {}), ...(values.local ? { local: true } : {}) };
  } else if (route.operation === "render" || route.operation === "rename-files") {
    if ((values.scope === undefined) === (values.all === undefined)) {
      process.stderr.write(`${route.operation} needs exactly one of --scope or --all\n${usage()}\n`);
      return 2;
    }
    args = values.all ? { all: true } : { scope: values.scope };
  } else if (route.operation === "review") {
    args = { scope: values.scope, plan: values.plan, ...(values.purpose !== undefined ? { purpose: values.purpose } : {}), ...(values.outcome !== undefined ? { outcome: values.outcome } : {}) };
  } else if (route.operation === "context") {
    args = { scope: values.scope, ...(values.brief !== undefined ? { brief: values.brief } : {}), ...(values.plan !== undefined ? { plan: values.plan } : {}) };
  } else if (route.operation === "operation") {
    args = { scope: values.scope, id: values.id };
  } else if (route.operation === "plan-show") {
    const out = planShow(inventory, { scope: values.scope, plan: values.plan });
    // Compact JSON on purpose: this read exists to stay small (about 3 KB even with 20 outcomes).
    process.stdout.write(values.json === true ? `${JSON.stringify(out.data)}\n` : renderPlanShow(out.data));
    return out.exitCode;
  } else if (route.operation === "observe" && values.payload !== undefined) {
    const others = Object.keys(values).filter((k) => values[k] !== undefined && !["config", "scope", "payload", "json", "dry-run", "commit"].includes(k));
    if (others.length) {
      process.stderr.write(`--payload cannot be combined with --${others[0]}\n`);
      return 2;
    }
    let payload: unknown;
    try { payload = readRequestFile(values.payload as string); } catch (err) {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      return 2;
    }
    const out = withGitCommit(observePayload(inventory, values.scope as string, payload, values["dry-run"] === true), values.scope, inventory, "observe", values.commit === true);
    process.stdout.write(values.json === true ? `${JSON.stringify(out.data, null, 2)}\n` : renderFlagResult(out.data, configPath));
    return out.exitCode;
  } else if (route.requestFile && values.request === undefined && FLAG_REQUIRED[route.operation]) {
    for (const flag of FLAG_REQUIRED[route.operation]) {
      if (values[flag] === undefined) {
        process.stderr.write(`missing --${flag} (or pass --request FILE)\n${usage()}\n`);
        return 2;
      }
    }
    const out = withGitCommit(flagForm(inventory, route.operation, values), values.scope, inventory, route.operation, values.commit === true);
    const text = values.json === true ? `${JSON.stringify(out.data, null, 2)}\n` : renderFlagResult(out.data, configPath);
    process.stdout.write(text);
    return out.exitCode;
  } else if (route.operation === "check") {
    if (values.history !== undefined && !/^[0-9]+$/.test(String(values.history))) {
      process.stderr.write("history must be an integer from 1 to 500\n");
      return 2;
    }
    args = { scope: values.scope, ...(values.history !== undefined ? { history: Number(values.history) } : {}) };
  } else if (route.requestFile) {
    // `plan prune` requires --rejected next to --request: it names the kind of plan pruned, it is not a payload field.
    const flagged = Object.keys(values).filter((k) => values[k] !== undefined && !["config", "scope", "request", "json", "commit", "rejected"].includes(k));
    if (flagged.length) {
      process.stderr.write(`--request cannot be combined with --${flagged[0]}\n`);
      return 2;
    }
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
  const raw = executeOperation(inventory, route.operation, args, actor);
  const output = route.requestFile ? withGitCommit(raw, values.scope, inventory, route.operation, values.commit === true) : raw;
  if (route.requestFile && (output.data as Record<string, any>).committed && !values.commit) {
    process.stderr.write(`note: ${committedLabel(output.data as Record<string, any>)}\n`);
  }
  printEnvelope(output, values.json === true || (routeName !== "plans" && routeName !== "scopes" && routeName !== "sync" && routeName !== "plans-md"), routeName);
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
