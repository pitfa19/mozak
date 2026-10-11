#!/usr/bin/env node
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { buildGraph, checkScope, loadConfig, renderMermaid, renderText } from "@mozak/core";

const args = process.argv.slice(2);
const cmd = args[0];
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

function configPath(): string {
  return resolve(value("config") ?? process.env.MOZAK_CONFIG ?? join(homedir(), ".config", "mozak", "config.json"));
}

if (cmd === "check") {
  const r = checkScope(resolve(args[1] && !args[1].startsWith("--") ? args[1] : "."));
  if (r.ok) {
    console.log(`ok: ${r.doc?.id} (${r.doc?.kind}), ${r.doc?.links.length} links, ${r.doc?.translations.length} translations`);
  } else {
    for (const i of r.issues) console.error(`${i.code}${i.line ? `:${i.line}` : ""}: ${i.message}`);
    process.exitCode = 1;
  }
} else if (cmd === "graph") {
  const p = configPath();
  if (!existsSync(p)) {
    console.error(`no config at ${p}. Create it with {"roots": ["/path/to/vault", "/path/to/repos"]} or pass --config FILE`);
    process.exitCode = 2;
  } else {
    const g = buildGraph(loadConfig(p));
    console.log(flag("mermaid") ? renderMermaid(g) : flag("json") ? JSON.stringify(g, null, 2) : renderText(g));
    if (g.problems.length) process.exitCode = 1;
  }
} else {
  console.error("usage: mozak check [scope-dir]\n       mozak graph [--config FILE] [--mermaid|--json]");
  process.exitCode = cmd ? 2 : 0;
}
