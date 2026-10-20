import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { parseMozak, type Issue, type MozakDoc } from "./parse.ts";
import { scopeFile, BRIDGE_FILE } from "./scope-files.ts";

export interface CheckResult {
  ok: boolean;
  doc: MozakDoc | null;
  issues: Issue[];
}

const REQUIRED = ["README.md", "AGENTS.md"];

/**
 * Claude Code only follows an `@AGENTS.md` import. Prose such as "see AGENTS.md" is not an import, and once a
 * CLAUDE.md exists Claude Code stops falling back to AGENTS.md, so prose would hide the file.
 * Import parsing skips code spans and fenced blocks, so a mention inside backticks does not count either.
 */
export function importsAgents(text: string): boolean {
  const live = text.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  return /(^|\s)@AGENTS\.md(?=$|\s|[.,;:)])/m.test(live);
}

function claudeReachesAgents(dir: string): boolean {
  const claude = join(dir, "CLAUDE.md");
  try {
    if (lstatSync(claude).isSymbolicLink()) return realpathSync(claude) === realpathSync(join(dir, "AGENTS.md"));
    return importsAgents(readFileSync(claude, "utf8"));
  } catch {
    return false;
  }
}

function exists(path: string): boolean {
  try {
    lstatSync(path); // lstat so a dangling symlink still counts as present
    return true;
  } catch {
    return false;
  }
}

/** Validate one scope directory: three root files plus a well formed mozak.md (or pre-0.4 MOZAK.md). */
export function checkScope(dir: string): CheckResult {
  const issues: Issue[] = [];
  for (const f of REQUIRED) {
    if (!existsSync(join(dir, f))) issues.push({ code: "file-missing", message: `missing ${f}` });
  }
  const mozak = scopeFile(dir, "bridge");
  if (!existsSync(mozak)) issues.push({ code: "file-missing", message: `missing ${BRIDGE_FILE}` });
  if (exists(join(dir, "CLAUDE.md")) && !claudeReachesAgents(dir)) {
    issues.push({
      code: "claude-pointer",
      message:
        'CLAUDE.md must contain a line "@AGENTS.md" (or be a symlink to AGENTS.md). Text like "see AGENTS.md" is not an import, and with a CLAUDE.md present Claude Code would not read AGENTS.md at all. Delete CLAUDE.md if you do not need it.',
    });
  }
  let doc: MozakDoc | null = null;
  if (existsSync(mozak)) {
    doc = parseMozak(readFileSync(mozak, "utf8"));
    issues.push(...doc.issues);
  }
  return { ok: issues.length === 0, doc, issues };
}
