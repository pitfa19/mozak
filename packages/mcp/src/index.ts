#!/usr/bin/env node
import { createInterface } from "node:readline";
import { handle, loadCfg } from "./server.ts";

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }) + "\n");
    return;
  }
  const res = handle(msg, () => loadCfg());
  if (res) process.stdout.write(JSON.stringify(res) + "\n");
});
