import { existsSync, readdirSync, readFileSync, lstatSync, type Dirent } from "node:fs";
import { basename, join, resolve } from "node:path";
import { DomainError } from "./errors.ts";

export interface InitOptions {
  id?: string;
  kind: "project" | "topic";
  title?: string;
}

export interface InitResult {
  created: string[];
  skipped: string[];
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "scope";

export function mozakTemplate(id: string, kind: "project" | "topic", plan = "- [ ] first step"): string {
  return `---\nid: ${id}\nkind: ${kind}\nformat: 1\n---\n\n## Plan\n\n${plan}\n\n## Links\n\n## Translations\n`;
}

/** Format-1 scaffolding is retired, including its old free-edit instructions. */
export function initScope(_dir: string, _opts: InitOptions): never {
  throw new DomainError("unsupported-legacy-operation", "format-1 init is retired; explicitly initialize a new inventoried format-2 scope");
}

export interface AuditReport {
  dir: string;
  hasOldState: boolean;
  /** Old project id, if project.yml named one. */
  oldId: string | null;
  /** First line of the old idea.md intent, if present. */
  intent: string | null;
  openQuestions: string[];
  counts: Record<string, number>;
  /** Suggested mozak.md text. The owner edits it and approves. Nothing is written. */
  draft: string;
  notes: string[];
}

function countFiles(dir: string): number {
  let n = 0;
  const walk = (d: string) => {
    let entries: Dirent[];
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return; // unreadable directory, leave it uncounted rather than crash
    }
    for (const e of entries) {
      // Dirent does not follow symlinks, so a dangling link (left by browser profiles) cannot throw.
      if (e.isDirectory()) walk(join(d, e.name));
      else n++;
    }
  };
  walk(dir);
  return n;
}

function section(md: string, heading: string): string {
  const m = new RegExp(`^##\\s+${heading}\\s*$([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, "mi").exec(md);
  return m ? m[1].trim() : "";
}

/** Read only. Look at an old .mozak/ directory and propose a mozak.md draft. Never writes, never deletes. */
export function auditProject(dir: string, kind: "project" | "topic" = "project"): AuditReport {
  const root = resolve(dir);
  const old = join(root, ".mozak");
  const notes: string[] = [];
  const counts: Record<string, number> = {};
  if (!existsSync(old)) {
    return { dir: root, hasOldState: false, oldId: null, intent: null, openQuestions: [], counts, draft: mozakTemplate(slug(basename(root)), kind), notes: ["no .mozak/ directory, nothing to port"] };
  }
  for (const name of readdirSync(old)) {
    const p = join(old, name);
    counts[name] = lstatSync(p).isDirectory() ? countFiles(p) : 1;
  }
  let oldId: string | null = null;
  const yml = join(old, "project.yml");
  if (existsSync(yml)) {
    const m = /^\s*id:\s*(\S+)/m.exec(readFileSync(yml, "utf8"));
    oldId = m ? m[1] : null;
  }
  let intent: string | null = null;
  let openQuestions: string[] = [];
  const idea = join(old, "idea.md");
  if (existsSync(idea)) {
    const md = readFileSync(idea, "utf8");
    intent = section(md, "Intent") || null;
    openQuestions = section(md, "Open questions").split(/\r?\n/).map((l) => l.replace(/^[-*]\s+/, "").trim()).filter(Boolean);
  } else notes.push("no idea.md, so there is no intent to carry over");

  const planPieces: string[] = [];
  if (intent) planPieces.push(`Intent: ${intent}`);
  for (const q of openQuestions) planPieces.push(`- [ ] ${q}`);
  if (planPieces.length === 0) planPieces.push("- [ ] first step");

  const features = counts["features"] ?? 0;
  const planning = counts["planning"] ?? 0;
  if (features) notes.push(`${features} feature files exist. Finished work belongs in git history, so none are carried into the plan. Review them by hand for open items.`);
  if (planning) notes.push(`${planning} planning files exist. Look for goals that are not completed and add only those to the plan.`);
  if (counts["evidence"]) notes.push(`${counts["evidence"]} evidence files exist. Evidence becomes plain notes in a topic, linked from Links.`);
  if (counts["concepts"] || counts["translations"]) notes.push("old concepts or translations exist. Re-create them as Translations blocks only if still wanted, with every assumption re-derived.");
  notes.push("archive .mozak/ only after you have reviewed this draft and approved it");

  return { dir: root, hasOldState: true, oldId, intent, openQuestions, counts, draft: mozakTemplate(oldId ?? slug(basename(root)), kind, planPieces.join("\n")), notes };
}
