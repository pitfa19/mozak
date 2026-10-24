#!/usr/bin/env node
// mozak MCP stdio entrypoint. A trusted launcher must pass exactly one --config FILE.
// No environment variable, default path or per-tool config is consulted.

import { resolve } from "node:path";
import { executeOperation, loadInventory, MAX_REQUEST_BYTES } from "@mozak/core";
import { handle, type Runtime } from "./server.ts";

const USAGE = "usage: mozak-mcp --config FILE [--owner-decisions]";

function fatal(message: string): never {
  process.stderr.write(`mozak-mcp: ${message}\n${USAGE}\n`);
  process.exit(2);
}

/** Exactly one `--config FILE` (or `--config=FILE`, the form MCP registries use). Duplicates, unknown flags and a missing value are refused. */
export function parseArgs(argv: string[]): { configPath: string; ownerDecisions: boolean } {
  let configPath: string | undefined;
  let ownerDecisions = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    let value: string | undefined;
    if (arg === "--owner-decisions") {
      if (ownerDecisions) fatal("--owner-decisions may be given only once");
      ownerDecisions = true;
      continue;
    }
    if (arg.startsWith("--config=")) {
      value = arg.slice("--config=".length);
      if (value === "") fatal("--config requires a FILE");
    } else if (arg === "--config") {
      value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) fatal("--config requires a FILE");
      i++;
    } else {
      fatal(`unknown argument "${arg}"`);
    }
    if (configPath !== undefined) fatal("--config may be given only once");
    configPath = resolve(value);
  }
  if (configPath === undefined) fatal("--config FILE is required");
  return { configPath, ownerDecisions };
}

const strictUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function send(reply: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(reply) + "\n");
}

/**
 * Newline-delimited reader with a hard per-line byte bound. An oversized line is discarded
 * as it streams in, so memory never grows past the bound, and it gets one error reply.
 */
export function readLines(onLine: (line: Buffer) => void, onOversized: () => void): (chunk: Buffer) => void {
  let pending: Buffer[] = [];
  let pendingBytes = 0;
  let discarding = false;
  return (chunk: Buffer) => {
    let start = 0;
    for (;;) {
      const nl = chunk.indexOf(0x0a, start);
      const segment = chunk.subarray(start, nl === -1 ? chunk.length : nl);
      if (!discarding) {
        pendingBytes += segment.length;
        if (pendingBytes > MAX_REQUEST_BYTES) {
          pending = [];
          pendingBytes = 0;
          discarding = true;
        } else {
          pending.push(Buffer.from(segment));
        }
      }
      if (nl === -1) break;
      if (discarding) {
        discarding = false;
        onOversized();
      } else {
        const line = Buffer.concat(pending);
        pending = [];
        pendingBytes = 0;
        onLine(line);
      }
      start = nl + 1;
    }
  };
}

function main(): void {
  const { configPath, ownerDecisions } = parseArgs(process.argv.slice(2));
  let runtime: Runtime;
  try {
    runtime = { inventory: loadInventory(configPath), execute: executeOperation, ownerDecisions };
  } catch (e) {
    fatal(`cannot load inventory ${configPath}: ${(e as Error).message}`);
  }

  const onLine = (line: Buffer) => {
    if (!line.toString("latin1").trim()) return;
    let text: string;
    try {
      // Fatal decoding: invalid UTF-8 is refused, never silently rewritten to U+FFFD.
      text = strictUtf8.decode(line);
    } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error: request is not valid UTF-8" } });
      return;
    }
    let msg: unknown;
    try {
      msg = JSON.parse(text);
    } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
      return;
    }
    const reply = handle(msg, runtime);
    if (reply) send(reply);
  };
  const onOversized = () => send({ jsonrpc: "2.0", id: null, error: { code: -32600, message: `request exceeds ${MAX_REQUEST_BYTES} bytes` } });

  const feed = readLines(onLine, onOversized);
  process.stdin.on("data", (chunk: Buffer) => {
    try {
      feed(chunk);
    } catch (e) {
      send({ jsonrpc: "2.0", id: null, error: { code: -32603, message: `internal error: ${(e as Error).message}` } });
    }
  });
  // Let stdout drain and the event loop empty naturally. Forcing exit here can truncate a large reply.
  process.stdin.on("end", () => {
    process.exitCode = 0;
  });
}

if (import.meta.url === `file://${process.argv[1]}`) main();
