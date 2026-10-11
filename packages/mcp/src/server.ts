import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  buildGraph,
  buildPacket,
  checkScope,
  guardedWrite,
  loadConfig,
  parseMozak,
  readSnapshot,
  renderText,
  setPlan,
  StaleWriteError,
  LockTimeoutError,
  type LocalConfig,
} from "@mozak/core";

export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

const ok = (text: string): ToolResult => ({ content: [{ type: "text", text }] });
const fail = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: true });

export function defaultConfigPath(): string {
  return resolve(process.env.MOZAK_CONFIG ?? join(homedir(), ".config", "mozak", "config.json"));
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: Record<string, unknown>, cfg: LocalConfig) => ToolResult;
}

const str = (v: unknown, name: string): string => {
  if (typeof v !== "string" || !v) throw new Error(`"${name}" is required and must be a string`);
  return v;
};

function scopeDir(cfg: LocalConfig, id: string): string {
  const node = buildGraph(cfg).nodes.find((n) => n.id === id);
  if (!node) throw new Error(`scope "${id}" not found under the configured roots`);
  return node.dir;
}

export const TOOLS: ToolDef[] = [
  {
    name: "mozak_graph",
    description: "List every scope (project or topic) and how they link. Start here to see what exists.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: (_a, cfg) => ok(renderText(buildGraph(cfg))),
  },
  {
    name: "mozak_read",
    description: "Read a scope's MOZAK.md. Returns the text and a base_hash. Quote that hash when you write the plan back.",
    inputSchema: { type: "object", properties: { scope: { type: "string" } }, required: ["scope"], additionalProperties: false },
    run: (a, cfg) => {
      const file = join(scopeDir(cfg, str(a.scope, "scope")), "MOZAK.md");
      const snap = readSnapshot(file);
      return ok(JSON.stringify({ base_hash: snap.hash, text: snap.text }, null, 2));
    },
  },
  {
    name: "mozak_check",
    description: "Validate a scope: three root files, MOZAK.md structure, links, and open translation assumptions.",
    inputSchema: { type: "object", properties: { scope: { type: "string" } }, required: ["scope"], additionalProperties: false },
    run: (a, cfg) => {
      const r = checkScope(scopeDir(cfg, str(a.scope, "scope")));
      return r.ok ? ok("ok") : fail(r.issues.map((i) => `${i.code}${i.line ? `:${i.line}` : ""}: ${i.message}`).join("\n"));
    },
  },
  {
    name: "mozak_set_plan",
    description:
      "Replace the Plan section of a scope's MOZAK.md. This is the only write agents may make. Requires the base_hash from mozak_read. If the file changed since, the write is refused as stale: read again, reapply your change, retry. Links and Translations cannot be changed here, those are proposals for the owner.",
    inputSchema: {
      type: "object",
      properties: { scope: { type: "string" }, plan: { type: "string", description: "New body of the Plan section, no ## headings" }, base_hash: { type: "string" } },
      required: ["scope", "plan", "base_hash"],
      additionalProperties: false,
    },
    run: (a, cfg) => {
      const file = join(scopeDir(cfg, str(a.scope, "scope")), "MOZAK.md");
      const base = str(a.base_hash, "base_hash");
      const current = readSnapshot(file);
      if (current.hash !== base) return fail(`stale: MOZAK.md changed since you read it. Call mozak_read again, reapply your edit, then retry.`);
      try {
        const next = setPlan(current.text, typeof a.plan === "string" ? a.plan : "");
        const hash = guardedWrite(file, next, base);
        return ok(JSON.stringify({ written: true, new_hash: hash }));
      } catch (e) {
        if (e instanceof StaleWriteError) return fail("stale: another writer got in first. Call mozak_read again, reapply your edit, then retry.");
        if (e instanceof LockTimeoutError) return fail("busy: another writer holds the lock. Retry in a moment.");
        throw e;
      }
    },
  },
  {
    name: "mozak_translation_packet",
    description:
      "Build the work packet for moving an idea from one scope to another. Read only, writes nothing. Lists both plans, existing links, and the assumptions to re-derive in the target. The owner decides what gets written to Translations.",
    inputSchema: {
      type: "object",
      properties: { idea: { type: "string" }, from: { type: "string" }, to: { type: "string" }, assumptions: { type: "array", items: { type: "string" } } },
      required: ["idea", "from", "to", "assumptions"],
      additionalProperties: false,
    },
    run: (a, cfg) => {
      const from = str(a.from, "from");
      const to = str(a.to, "to");
      const assumptions = Array.isArray(a.assumptions) ? a.assumptions.filter((x): x is string => typeof x === "string") : [];
      const src = parseMozak(readFileSync(join(scopeDir(cfg, from), "MOZAK.md"), "utf8"));
      const tgt = parseMozak(readFileSync(join(scopeDir(cfg, to), "MOZAK.md"), "utf8"));
      return ok(JSON.stringify(buildPacket(src, tgt, { title: str(a.idea, "idea"), source: from, target: to, assumptions }), null, 2));
    },
  },
];

export function loadCfg(path = defaultConfigPath()): LocalConfig {
  if (!existsSync(path)) throw new Error(`no config at ${path}. Create it with {"roots": ["/path/to/vault", "/path/to/repos"]} or set MOZAK_CONFIG`);
  return loadConfig(path);
}

interface Rpc {
  jsonrpc: "2.0";
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

/** Handle one JSON-RPC message. Returns the response, or null for notifications. */
export function handle(msg: Rpc, getCfg: () => LocalConfig): Record<string, unknown> | null {
  const reply = (result: unknown) => ({ jsonrpc: "2.0", id: msg.id, result });
  const error = (code: number, message: string) => ({ jsonrpc: "2.0", id: msg.id, error: { code, message } });
  if (msg.id === undefined) return null; // notification
  switch (msg.method) {
    case "initialize":
      return reply({
        protocolVersion: (msg.params?.protocolVersion as string) ?? "2024-11-05",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "mozak", version: "0.0.0" },
      });
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === msg.params?.name);
      if (!tool) return error(-32602, `unknown tool "${String(msg.params?.name)}"`);
      try {
        return reply(tool.run((msg.params?.arguments as Record<string, unknown>) ?? {}, getCfg()));
      } catch (e) {
        return reply(fail((e as Error).message));
      }
    }
    default:
      return error(-32601, `method not found: ${msg.method}`);
  }
}
