// `mozak scope link` (owner route): set or clear the display-only `repo` link of one inventory entry. Same inventory
// lock and validated atomic write as `focus` and `scope move`. Entry order, indent and every other key are kept, and
// running it twice is a no-op. Never touches mozak.json or mozak.md, and never runs git.

import { readFileSync } from "node:fs";
import { DomainError } from "./errors.ts";
import { inventoryText, withInventoryLock, writeInventoryValidated } from "./inventory-file.ts";
import { loadInventory } from "./scope-index.ts";
import { parseRepoLink, REPO_LINK_HELP } from "./repo-link.ts";
import { nonEmptyString } from "./validate.ts";
import type { OperationOutput } from "./api.ts";

export interface LinkArgs { scope: unknown; repo?: unknown; clear?: unknown }
export interface LinkResult { scope: string; repo: string | null; changed: boolean }

const invalid = (message: string) => new DomainError("invalid-input", message, 2);

/** Boundary: exactly one of a valid repo link or clear. */
function parseLinkArgs(a: LinkArgs): { scope: string; repo: string | null } {
  const scope = nonEmptyString(a.scope, "scope");
  const clear = a.clear === true;
  if (clear === (a.repo !== undefined)) throw invalid("scope link needs exactly one of --repo SPEC or --clear");
  if (clear) return { scope, repo: null };
  const repo = parseRepoLink(a.repo);
  if (repo === null) throw invalid(`${REPO_LINK_HELP}, not ${JSON.stringify(a.repo)}`);
  return { scope, repo };
}

/** Set or clear one entry's repo link. */
export function linkScope(inventoryPath: string, args: LinkArgs): LinkResult {
  const req = parseLinkArgs(args);
  return withInventoryLock(inventoryPath, () => {
    const text = readFileSync(inventoryPath, "utf8");
    loadInventory(inventoryPath);
    const doc = JSON.parse(text) as { scopes: (Record<string, unknown> & { id: string })[] };
    const entry = doc.scopes.find((e) => e.id === req.scope);
    if (!entry) throw new DomainError("scope-not-found", `no scope "${req.scope}" in the inventory; run mozak scopes to list the scope ids`, 2);
    const current = typeof entry.repo === "string" ? entry.repo : null;
    if (current === req.repo) return { scope: req.scope, repo: req.repo, changed: false };
    if (req.repo === null) delete entry.repo;
    else entry.repo = req.repo;
    writeInventoryValidated(inventoryPath, inventoryText(doc, text));
    return { scope: req.scope, repo: req.repo, changed: true };
  });
}

/** Route used by the CLI: linkScope with its errors as an envelope. Owner only; MCP never exposes it. */
export function scopeLinkOutput(inventoryPath: string, args: LinkArgs): OperationOutput {
  try {
    return { exitCode: 0, data: { status: "ok", ...linkScope(inventoryPath, args) } };
  } catch (err) {
    if (!(err instanceof DomainError)) throw err;
    return { exitCode: err.exitCode, data: { status: err.code, issues: [{ code: err.code, message: err.message }] } };
  }
}
