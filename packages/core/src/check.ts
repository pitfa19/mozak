import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseMozak, type Issue, type MozakDoc } from "./parse.ts";

export interface CheckResult {
  ok: boolean;
  doc: MozakDoc | null;
  issues: Issue[];
}

const REQUIRED = ["README.md", "AGENTS.md", "MOZAK.md"];

/** Validate one scope directory: three root files plus a well formed MOZAK.md. */
export function checkScope(dir: string): CheckResult {
  const issues: Issue[] = [];
  for (const f of REQUIRED) {
    if (!existsSync(join(dir, f))) issues.push({ code: "file-missing", message: `missing ${f}` });
  }
  const claude = join(dir, "CLAUDE.md");
  if (existsSync(claude) && !/AGENTS\.md/.test(readFileSync(claude, "utf8"))) {
    issues.push({ code: "claude-pointer", message: "CLAUDE.md should be a one line pointer to AGENTS.md" });
  }
  let doc: MozakDoc | null = null;
  const mozak = join(dir, "MOZAK.md");
  if (existsSync(mozak)) {
    doc = parseMozak(readFileSync(mozak, "utf8"));
    issues.push(...doc.issues);
  }
  return { ok: issues.length === 0, doc, issues };
}
