#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  auditProject,
  buildGraph,
  buildPacket,
  checkScope,
  initScope,
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
} else if (cmd === "init") {
  // mozak init [dir] --kind project|topic [--id ID]
  const dir = args[1] && !args[1].startsWith("--") ? args[1] : ".";
  const kind = value("kind");
  if (kind !== "project" && kind !== "topic") {
    console.error("need --kind project or --kind topic");
    process.exitCode = 2;
  } else {
    const r = initScope(dir, { kind, id: value("id") });
    for (const f of r.created) console.log(`created ${f}`);
    for (const f of r.skipped) console.log(`kept existing ${f}`);
  }
} else if (cmd === "audit") {
  // mozak audit [dir] [--kind project|topic] [--json]   read only
  const dir = args[1] && !args[1].startsWith("--") ? args[1] : ".";
  const kind = value("kind") === "topic" ? "topic" : "project";
  const a = auditProject(dir, kind);
  if (flag("json")) console.log(JSON.stringify(a, null, 2));
  else {
    console.log(`${a.dir}: ${a.hasOldState ? "old .mozak/ found" : "no old state"}`);
    for (const [k, n] of Object.entries(a.counts)) console.log(`  ${k}: ${n} file${n === 1 ? "" : "s"}`);
    for (const n of a.notes) console.log(`- ${n}`);
    console.log("\nProposed MOZAK.md (nothing was written):\n");
    console.log(a.draft);
  }
} else {
  console.error(
    [
      "usage: mozak init [dir] --kind project|topic [--id ID]",
      "       mozak check [scope-dir]",
      "       mozak audit [dir] [--kind project|topic] [--json]",
      "       mozak graph [--config FILE] [--mermaid|--json]",
      "       mozak translate --idea TITLE --from SRC --to TARGET --assumption TEXT [--assumption TEXT ...] [--write]",
      "       mozak resolve --in TARGET --idea TITLE --n N",
    ].join("\n"),
  );
  process.exitCode = cmd ? 2 : 0;
}
