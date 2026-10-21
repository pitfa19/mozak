// mozak MCP tool layer. Thin transport over the shared core operation seam.
// Core validation is authoritative. This layer only closes the advertised surface:
// fixed tool names, closed argument objects, a fixed agent actor and no config input.

import { executeOperation, type ScopeInventory } from "@mozak/core";
import { readFileSync } from "node:fs";

/** This package's version, reported in the MCP handshake. */
const VERSION = (() => {
  try { return (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string }).version ?? "unknown"; } catch { return "unknown"; }
})();

export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export type Execute = typeof executeOperation;

/** Runtime built once by the trusted entrypoint from its explicit --config inventory. */
export interface Runtime {
  inventory: ScopeInventory;
  execute: Execute;
}

interface PropertySpec {
  type: "string" | "boolean" | "integer" | "object";
  enum?: readonly string[];
  description: string;
}

export interface ToolDef {
  name: string;
  /** Core operation name. Every MCP call runs as the agent actor. */
  op: string;
  description: string;
  properties: Record<string, PropertySpec>;
  required: readonly string[];
  inputSchema: Record<string, unknown>;
}

const SCOPE: PropertySpec = { type: "string", description: "Scope ID from the explicit inventory." };
const REQUEST: PropertySpec = { type: "object", description: "Typed mutation envelope: operationId, scopeId, expected, action, payload." };
// Display purposes for read-only review show. Owner decisions are never dispatched from MCP.
const PURPOSES = ["approve-direction", "reject-pending", "reconsider", "pause", "resume", "accept-outcome", "approve-implementation", "revoke-implementation"] as const;

function tool(name: string, op: string, description: string, properties: Record<string, PropertySpec>, required: readonly string[]): ToolDef {
  const inputSchema = {
    type: "object",
    properties,
    required: [...required],
    additionalProperties: false,
  };
  return { name, op, description, properties, required, inputSchema };
}

export const TOOLS: ToolDef[] = [
  tool("mozak_context", "context", "Canonical understanding for one scope. Use brief for a body-free overview; plan selects one exact plan for full recovery. Combined, they return one brief plan. Reading grants no approval.", {
    scope: SCOPE,
    brief: { type: "boolean", description: "Summarize plans without content, evidence, history or execution bounds. Read full plan before work." },
    plan: { type: "string", description: "Exact plan ID; unknown IDs are refused, never widened to all plans." },
  }, ["scope"]),
  tool(
    "mozak_plans",
    "plans",
    "Plans grouped as Completed, Open, and Awaiting approval, with counts, bounded pages, and per-scope coverage.",
    {
      scope: SCOPE,
      all: { type: "boolean", description: "Read every inventoried scope instead of one." },
      includeRejected: { type: "boolean", description: "Include rejected drafts." },
      limit: { type: "integer", description: "Page size per group." },
      continuation: { type: "string", description: "Opaque continuation token from a previous page." },
      sort: { type: "string", enum: ["deadline"], description: "Order rows by owner or inferred deadline, earliest first; rows gain deadline fields." },
    },
    [],
  ),
  tool(
    "mozak_plan_graph",
    "graph",
    "Cross-plan references from owner annotations (needs, informs, supersedes) with how each target resolves: live plan, merged plan, dangling or unavailable. Plans carry their deadline. Read-only; annotations are written only by the owner.",
    { scope: SCOPE, all: { type: "boolean", description: "Every inventoried scope instead of one." } },
    [],
  ),
  tool(
    "mozak_ready",
    "ready",
    "Open plans whose needs are met, ordered by deadline, then by how many plans need them. Blocked plans list what they wait on; superseded plans are listed apart. Advisory only: needs never refuse a write.",
    { scope: SCOPE, all: { type: "boolean", description: "Every inventoried scope instead of one." } },
    [],
  ),
  tool(
    "mozak_similar",
    "similar",
    "Similar plans pooled across one scope or every scope, labelled duplicate, overlap or supersedes-candidate, with templated siblings filtered out and rejects whose reason says moved to listed apart. Lexical rules only, no stored state. Read-only: merging, rejecting or linking stays an owner decision.",
    { scope: SCOPE, all: { type: "boolean", description: "Every inventoried scope instead of one." } },
    [],
  ),
  tool(
    "mozak_scopes",
    "scopes",
    "Index of every scope in the explicit inventory: id, folder, title, kind, plan counts and which entry documents exist. Use it first to find where things are. Returns no plan text or decisions, and failed scopes are listed with their error code.",
    {},
    [],
  ),
  tool(
    "mozak_sync",
    "sync",
    "Force-refresh remote scopes (git sparse copies) from their remotes. Reads already refresh a remote scope when it is older than 10 minutes and mark it stale when offline. Optionally limit to one scope. Returns per-scope stale, lastFetchAt and error.",
    { scope: SCOPE },
    [],
  ),
  tool(
    "mozak_review_show",
    "review",
    "Accepted meaning, pending proposal, changed fields, and the review digest for one exact plan action. Reading creates no approval.",
    {
      scope: SCOPE,
      plan: { type: "string", description: "Plan ID." },
      purpose: { type: "string", enum: PURPOSES, description: "Owner action purpose to display." },
      outcome: { type: "string", description: "Outcome ID for an outcome review." },
    },
    ["scope", "plan"],
  ),
  tool("mozak_check", "check", "Schema, reference, approval-consistency, entry-document, and projection findings. Never repairs.", { scope: SCOPE }, ["scope"]),
  tool(
    "mozak_operation",
    "operation",
    "Receipt status, semantic result, and current projection state for one operation ID. Never resubmits the operation.",
    { scope: SCOPE, id: { type: "string", description: "Operation ID." } },
    ["scope", "id"],
  ),
  tool(
    "mozak_propose",
    "propose",
    "Create one pending plan. Carries no accepted content or owner decision. Refuses with duplicate-plan-candidate if a similar non-completed plan already exists unless payload.distinctFromPlanIds names it after owner confirmation.",
    { scope: SCOPE, request: REQUEST },
    ["scope", "request"],
  ),
  tool(
    "mozak_revise",
    "revise",
    "Create a new awaiting revision of an accepted plan, or replace an awaiting pending revision against its exact base. Optional payload.mergeFromPlanId folds a duplicate non-completed plan into this plan when direction is approved. Preserves accepted direction until approved.",
    { scope: SCOPE, request: REQUEST },
    ["scope", "request"],
  ),
  tool("mozak_observe", "observe", "Append classified observations, evidence, and allowed reasoning links. Protected fields are refused.", { scope: SCOPE, request: REQUEST }, ["scope", "request"]),
  // Named agent-only clarification and specification-reference tools. They carry the same mutation envelope as
  // every other mutation. Core validates the nested envelope and refuses protected fields. Neither grants authority.
  tool(
    "mozak_save_discussion",
    "save-discussion",
    "Save the advisory clarification checkpoint for one plan: questions, answers and stage, bound to current revisions. Never grants approval or edits accepted content.",
    { scope: SCOPE, request: REQUEST },
    ["scope", "request"],
  ),
  tool(
    "mozak_attach_spec",
    "attach-spec",
    "Attach a local Markdown specification file with explicit bounds to an accepted direction. Stores a descriptor only; it does not approve implementation.",
    { scope: SCOPE, request: REQUEST },
    ["scope", "request"],
  ),
  tool(
    "mozak_complete",
    "complete",
    "Record objective completion when every outcome has current evidence. Subjective outcomes need owner acceptance first.",
    { scope: SCOPE, request: REQUEST },
    ["scope", "request"],
  ),
];

const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

class ArgumentError extends Error {}

/** Closed argument check at the MCP boundary. The API runtime validates the nested envelope again. */
export function validateArguments(def: ToolDef, args: unknown): Record<string, unknown> {
  if (!isPlainObject(args)) throw new ArgumentError(`${def.name}: arguments must be an object`);
  for (const key of Object.keys(args)) {
    if (!hasOwn(def.properties, key)) throw new ArgumentError(`unknown argument "${key}" for ${def.name}`);
  }
  for (const key of def.required) {
    if (!hasOwn(args, key)) throw new ArgumentError(`${def.name}: "${key}" is required`);
  }
  for (const [key, value] of Object.entries(args)) {
    const spec = def.properties[key];
    const bad = (why: string) => new ArgumentError(`${def.name}: "${key}" ${why}`);
    switch (spec.type) {
      case "string":
        if (typeof value !== "string" || !value.trim()) throw bad("must be a nonempty string");
        break;
      case "boolean":
        if (typeof value !== "boolean") throw bad("must be a boolean");
        break;
      case "integer":
        if (!Number.isSafeInteger(value) || (value as number) < 1) throw bad("must be a positive integer");
        break;
      case "object":
        if (!isPlainObject(value)) throw bad("must be an object");
        break;
    }
    if (spec.enum && !spec.enum.includes(value as string)) throw bad(`must be one of ${spec.enum.join(", ")}`);
  }
  return args;
}

/**
 * Text of a failed tool call. It leads with a one-line `reason` and the `issues`, then the rest of the structured
 * result (for example a large `unsavedRequest`), so a host that truncates tool output still shows why.
 */
export function errorText(data: unknown): string {
  if (!isPlainObject(data)) return JSON.stringify(data, null, 2);
  const issues = Array.isArray(data.issues) ? data.issues : [];
  const first = issues.find(isPlainObject);
  const line = (v: unknown) => String(v).replace(/\s+/g, " ").trim();
  const reason = typeof data.reason === "string" ? data.reason : first
    ? `${line(first.code)}: ${line(first.message)}${issues.length > 1 ? ` (and ${issues.length - 1} more)` : ""}`
    : line(data.status ?? "error");
  const { issues: _issues, reason: _reason, ...rest } = data;
  return JSON.stringify({ reason, issues, ...rest }, null, 2);
}
const fail = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: true });

interface Rpc {
  jsonrpc: "2.0";
  id?: number | string | null;
  method?: string;
  params?: unknown;
}

type Reply = Record<string, unknown>;

const errorReply = (id: unknown, code: number, message: string): Reply => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

/** Standard MCP request metadata. The only extra tools/call param accepted, and never forwarded. */
const ALLOWED_CALL_PARAM_KEYS = ["name", "arguments", "_meta"] as const;

/**
 * Runtime envelope check before any dispatch. The static type is a claim, not a check:
 * version, id, method and params shape are all verified here.
 */
export function envelopeError(msg: unknown): { id: unknown; code: number; message: string } | null {
  if (!isPlainObject(msg) || (Object.getPrototypeOf(msg) !== Object.prototype && Object.getPrototypeOf(msg) !== null)) {
    return { id: null, code: -32600, message: "invalid request: message must be a plain object" };
  }
  const id = hasOwn(msg, "id") ? msg.id : undefined;
  const safeId = typeof id === "string" || typeof id === "number" || id === null ? id : null;
  if (!hasOwn(msg, "jsonrpc") || msg.jsonrpc !== "2.0") return { id: safeId, code: -32600, message: "invalid request: jsonrpc must be \"2.0\"" };
  if (id !== undefined && !(typeof id === "string" || id === null || (typeof id === "number" && Number.isFinite(id)))) {
    return { id: null, code: -32600, message: "invalid request: id must be a string, a finite number, or null" };
  }
  if (!hasOwn(msg, "method") || typeof msg.method !== "string" || msg.method.length === 0) {
    return { id: safeId, code: -32600, message: "invalid request: method must be a nonempty string" };
  }
  return null;
}

/** Handle one JSON-RPC message. Returns the reply, or null for notifications. Never throws. */
export function handle(msg: unknown, rt: Runtime): Reply | null {
  const envelope = envelopeError(msg);
  if (envelope) {
    // Silent drop only for a genuine notification: own jsonrpc 2.0, no id. Anything else malformed gets an error reply.
    const isNotification = isPlainObject(msg) && !hasOwn(msg, "id") && hasOwn(msg, "jsonrpc") && msg.jsonrpc === "2.0";
    return isNotification ? null : errorReply(envelope.id, envelope.code, envelope.message);
  }
  const m = msg as Rpc;
  if (m.id === undefined) return null; // well-formed notification
  const reply = (result: unknown): Reply => ({ jsonrpc: "2.0", id: m.id, result });
  try {
    switch (m.method) {
      case "initialize": {
        const params = isPlainObject(m.params) ? m.params : {};
        return reply({
          protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : "2024-11-05",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "mozak", version: VERSION },
        });
      }
      case "ping":
        return reply({});
      case "tools/list":
        return reply({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
      case "tools/call": {
        const params = m.params;
        if (!isPlainObject(params)) return errorReply(m.id, -32602, "params must be an object");
        for (const key of Object.keys(params)) {
          if (!(ALLOWED_CALL_PARAM_KEYS as readonly string[]).includes(key)) return errorReply(m.id, -32602, `unknown tools/call param "${key}"`);
        }
        if (hasOwn(params, "_meta") && !isPlainObject(params._meta)) return errorReply(m.id, -32602, "_meta must be an object");
        if (typeof params.name !== "string") return errorReply(m.id, -32602, "tool name must be a string");
        const def = TOOLS.find((t) => t.name === params.name);
        if (!def) return errorReply(m.id, -32602, `unknown tool "${params.name}"`);
        let args: Record<string, unknown>;
        try {
          args = validateArguments(def, params.arguments ?? {});
        } catch (e) {
          return reply(fail((e as Error).message));
        }
        try {
          const { exitCode, data } = rt.execute(rt.inventory, def.op, args, "agent");
          // Full structured result is kept. A nonzero exit is an error, but never replaces committed state with a generic message.
          const result: ToolResult = { content: [{ type: "text", text: exitCode === 0 ? JSON.stringify(data, null, 2) : errorText(data) }] };
          if (exitCode !== 0) result.isError = true;
          return reply(result);
        } catch (e) {
          return reply(fail(`internal error: ${(e as Error).message}`));
        }
      }
      default:
        return errorReply(m.id, -32601, `method not found: ${String(m.method)}`);
    }
  } catch (e) {
    return errorReply(m.id, -32603, `internal error: ${(e as Error).message}`);
  }
}
