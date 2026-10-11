#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  buildGraph,
  buildPacket,
  checkScope,
  insertTranslation,
  loadConfig,
  parseMozak,
  renderMermaid,
  renderText,
  setAssumption,
  updateFile,
} from "@mozak/core";

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
} else if (cmd === "translate" || cmd === "resolve") {
  const p = configPath();
  if (!existsSync(p)) {
    console.error(`no config at ${p}`);
    process.exitCode = 2;
  } else {
    const g = buildGraph(loadConfig(p));
    const dirOf = (id: string) => g.nodes.find((n) => n.id === id)?.dir;
    try {
      if (cmd === "translate") {
        // mozak translate --idea TITLE --from SRC --to TARGET --assumption A [--assumption B ...] [--write]
        const idea = value("idea");
        const from = value("from");
        const to = value("to");
        const assumptions = args.flatMap((a, i) => (a === "--assumption" ? [args[i + 1]] : []));
        if (!idea || !from || !to) throw new Error("need --idea, --from, --to and at least one --assumption");
        const sDir = dirOf(from);
        const tDir = dirOf(to);
        if (!sDir) throw new Error(`source scope "${from}" not found under the configured roots`);
        if (!tDir) throw new Error(`target scope "${to}" not found under the configured roots`);
        const draft = { title: idea, source: from, target: to, assumptions };
        const packet = buildPacket(parseMozak(readFileSync(join(sDir, "MOZAK.md"), "utf8")), parseMozak(readFileSync(join(tDir, "MOZAK.md"), "utf8")), draft);
        if (flag("write")) {
          updateFile(join(tDir, "MOZAK.md"), (t) => insertTranslation(t, packet.draft, idea));
          console.log(`wrote draft to ${join(tDir, "MOZAK.md")} with ${assumptions.length} open assumptions`);
        } else {
          console.log(JSON.stringify(packet, null, 2));
        }
      } else {
        // mozak resolve --in TARGET --idea TITLE --n 1
        const inScope = value("in");
        const idea = value("idea");
        const n = Number(value("n"));
        if (!inScope || !idea || !Number.isInteger(n)) throw new Error("need --in, --idea and --n");
        const tDir = dirOf(inScope);
        if (!tDir) throw new Error(`scope "${inScope}" not found under the configured roots`);
        updateFile(join(tDir, "MOZAK.md"), (t) => setAssumption(t, idea, n, "re-derived"));
        console.log(`assumption ${n} of "${idea}" marked re-derived in ${inScope}`);
      }
    } catch (e) {
      console.error((e as Error).message);
      process.exitCode = 1;
    }
  }
} else {
  console.error(
    [
      "usage: mozak check [scope-dir]",
      "       mozak graph [--config FILE] [--mermaid|--json]",
      "       mozak translate --idea TITLE --from SRC --to TARGET --assumption TEXT [--assumption TEXT ...] [--write]",
      "       mozak resolve --in TARGET --idea TITLE --n N",
    ].join("\n"),
  );
  process.exitCode = cmd ? 2 : 0;
}
