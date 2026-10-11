#!/usr/bin/env node
import { resolve } from "node:path";
import { checkScope } from "@mozak/core";

const [cmd, arg = "."] = process.argv.slice(2);

if (cmd === "check") {
  const dir = resolve(arg);
  const r = checkScope(dir);
  if (r.ok) {
    console.log(`ok: ${r.doc?.id} (${r.doc?.kind}), ${r.doc?.links.length} links, ${r.doc?.translations.length} translations`);
  } else {
    for (const i of r.issues) console.error(`${i.code}${i.line ? `:${i.line}` : ""}: ${i.message}`);
    process.exitCode = 1;
  }
} else {
  console.error("usage: mozak check [scope-dir]");
  process.exitCode = cmd ? 2 : 0;
}
