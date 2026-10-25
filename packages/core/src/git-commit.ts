// Opt-in git commit for a local (or vault-plans) scope after a write. `mozak <write> --commit`.
// A mozak write "commits" the scope transaction to mozak.json and mozak.md on disk. It does not
// touch git for local scopes, because those usually live in a repo the caller owns (a vault, a
// project). This helper is the explicit follow-up: commit just the two scope files in the
// containing repo, then pull --rebase and push when the branch has an upstream. Never forces.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { scopeFileName } from "./scope-files.ts";

export interface GitCommitResult {
  /** True when a new commit was made for the scope files. */
  committed: boolean;
  /** True when the branch was pushed to its upstream. */
  pushed: boolean;
  /** Short human outcome, also used for failures. */
  message: string;
  /** Set when the step stopped early: not-a-repo, nothing-to-commit is not an error. */
  error?: "not-a-repo" | "commit-failed" | "pull-conflict" | "pull-failed" | "push-failed";
}

function run(args: string[], cwd: string): { ok: boolean; out: string } {
  try {
    const out = execFileSync("git", args, {
      cwd, encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
    });
    return { ok: true, out: out.trim() };
  } catch (err) {
    const e = err as { stderr?: Buffer | string; message?: string };
    const text = String(e.stderr ?? e.message ?? "").trim().split("\n").slice(-3).join(" ");
    return { ok: false, out: text };
  }
}

export function gitCommitScope(scopeRoot: string, message: string): GitCommitResult {
  const top = run(["rev-parse", "--show-toplevel"], scopeRoot);
  if (!top.ok) return { committed: false, pushed: false, error: "not-a-repo", message: `written, not committed: ${scopeRoot} is not inside a git repo` };
  const repo = top.out;
  const files = [scopeFileName(scopeRoot, "graph"), scopeFileName(scopeRoot, "bridge")]
    .map((n) => join(scopeRoot, n)).filter((p) => existsSync(p)).map((p) => relative(repo, p) || ".");
  let committed = false;
  if (files.length > 0) {
    const add = run(["add", "--", ...files], repo);
    if (!add.ok) return { committed: false, pushed: false, error: "commit-failed", message: `written, not committed: git add failed: ${add.out}` };
    const staged = run(["diff", "--cached", "--quiet", "--", ...files], repo);
    if (!staged.ok) {
      // --only commits exactly these paths, leaving anything else the caller staged untouched.
      const c = run(["commit", "--quiet", "-m", message, "--only", "--", ...files], repo);
      if (!c.ok) return { committed: false, pushed: false, error: "commit-failed", message: `written, not committed: git commit failed: ${c.out}` };
      committed = true;
    }
  }
  const upstream = run(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], repo);
  if (!upstream.ok) return { committed, pushed: false, message: committed ? "committed to git (no upstream, not pushed)" : "nothing to commit (no upstream)" };
  const pull = run(["pull", "--rebase", "--autostash", "--quiet"], repo);
  if (!pull.ok) {
    const rebasing = existsSync(join(repo, ".git", "rebase-merge")) || existsSync(join(repo, ".git", "rebase-apply"));
    if (rebasing) {
      run(["rebase", "--abort"], repo);
      return { committed, pushed: false, error: "pull-conflict", message: `committed locally, not pushed: git pull --rebase hit a conflict with ${upstream.out} and was aborted. Resolve it by hand in ${repo}, then push. Nothing was forced.` };
    }
    return { committed, pushed: false, error: "pull-failed", message: `committed locally, not pushed: git pull --rebase failed: ${pull.out}` };
  }
  const ahead = run(["rev-list", "--count", "@{u}..HEAD"], repo);
  if (ahead.ok && ahead.out === "0") return { committed, pushed: false, message: committed ? "committed to git, already in sync with upstream" : "nothing to commit, in sync with upstream" };
  const push = run(["push", "--quiet"], repo);
  if (!push.ok) return { committed, pushed: false, error: "push-failed", message: `committed locally, not pushed: git push failed: ${push.out}` };
  return { committed, pushed: true, message: `committed to git and pushed to ${upstream.out}` };
}
