import { execFileSync } from "node:child_process";
import { appendFileSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DomainError } from "./errors.ts";

const IGNORE_PATTERNS = [".mozak-write-lock/", "mozak.json.*.tmp", "mozak.md.*.tmp", "MOZAK.json.*.tmp", "MOZAK.md.*.tmp"];

/** Only explicit init/repair writes these local rules. Never changes the git index. */
export function ensureStorageIgnored(root: string): void {
  const path = join(root, ".gitignore");
  let previous = "";
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new DomainError("unsafe-path", ".gitignore must be a regular non-symlink file");
    previous = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const existing = new Set(previous.split(/\r?\n/));
  const missing = IGNORE_PATTERNS.filter(pattern => !existing.has(pattern));
  if (missing.length) appendFileSync(path, `${previous && !previous.endsWith("\n") ? "\n" : ""}${missing.join("\n")}\n`, { mode: 0o600 });
}

function git(root: string, args: string[]) {
  try {
    return { status: 0, stdout: execFileSync("git", args, { cwd: root, encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"], env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" } }) };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string };
    return { status: failure.status ?? null, stdout: failure.stdout ?? "" };
  }
}

/** Read-only diagnostics work for repository roots, nested vault scopes and git worktrees. */
export function storageIgnoreIssues(root: string): { code: string; message: string }[] {
  if (git(root, ["rev-parse", "--is-inside-work-tree"]).stdout?.trim() !== "true") return [];
  const issues: { code: string; message: string }[] = [];
  const ignored = git(root, ["check-ignore", "--no-index", "-q", "--", ".mozak-write-lock/owner.json"]);
  if (ignored.status === 1) issues.push({ code: "lock-not-ignored", message: "Ignore .mozak-write-lock/ before staging files; init or explicit projection repair adds the write-artifact ignore patterns." });
  else if (ignored.status !== 0) issues.push({ code: "lock-ignore-unavailable", message: "Could not inspect write-lock ignore rules." });
  const tracked = git(root, ["ls-files", "-z", "--", ".mozak-write-lock"]);
  if (tracked.status !== 0) issues.push({ code: "lock-index-unavailable", message: "Could not inspect the git index for tracked write locks." });
  else if (tracked.stdout) issues.push({ code: "lock-in-git", message: "The git index contains .mozak-write-lock; remove it from the index after establishing offline quiescence. Ignore rules do not untrack it." });
  return issues;
}
