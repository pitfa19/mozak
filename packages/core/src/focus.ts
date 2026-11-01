// Focus list: the owner's starred plans, one `focus` array of plan ids per scope entry in mozak-inventory.json.
// A sidebar marker only. It is not plan state: mozak.json and mozak.md never change, and the inventory digest
// (format plus sorted id and root) ignores it. Only owner routes write it (`mozak focus add|remove`, the plugin star).

import { readFileSync } from "node:fs";
import { DomainError } from "./errors.ts";
import type { LockOptions } from "./dir-lock.ts";
import { inventoryText, withInventoryLock, writeInventoryValidated } from "./inventory-file.ts";
import { loadInventory, resolveScope, type ScopeInventory } from "./scope-index.ts";
import { readScope } from "./scope-store.ts";
import type { OperationOutput } from "./api.ts";

export { INVENTORY_LOCK_DIR, jsonStyle } from "./inventory-file.ts";

export type FocusAction = "add" | "remove";
export interface FocusChange { scope: string; plan: string; action: FocusAction }
export interface FocusResult { scope: string; focus: string[]; changed: boolean }

type RawEntry = Record<string, unknown> & { id: string; focus?: string[] };

function rawEntries(text: string): RawEntry[] {
  return (JSON.parse(text) as { scopes: RawEntry[] }).scopes;
}

/** Focus lists by scope id, read from the inventory file. A scope without `focus` has an empty list. */
export function readFocus(inventoryPath: string): Record<string, string[]> {
  loadInventory(inventoryPath);
  const out: Record<string, string[]> = {};
  for (const e of rawEntries(readFileSync(inventoryPath, "utf8"))) out[e.id] = [...(e.focus ?? [])];
  return out;
}

/**
 * Read route shared by `mozak focus list` and MCP `mozak_focus`: every scope's list, or one scope's. Read-only.
 * An inventory loaded without a file path (tests, embedders) has no focus lists.
 */
export function focusList(inv: ScopeInventory, args: { scope?: unknown }): OperationOutput {
  try {
    const all = inv.path ? readFocus(inv.path) : Object.fromEntries(inv.scopes.map((s) => [s.id, [] as string[]]));
    if (args.scope === undefined) return { exitCode: 0, data: { status: "ok", focus: all } };
    const scope = String(args.scope);
    if (!(scope in all)) throw new DomainError("scope-not-found", `no scope "${scope}" in the inventory; run mozak scopes (MCP mozak_scopes) to list the scope ids`);
    return { exitCode: 0, data: { status: "ok", focus: { [scope]: all[scope]! } } };
  } catch (err) {
    if (!(err instanceof DomainError)) throw err;
    return { exitCode: err.exitCode, data: { status: err.code, issues: [{ code: err.code, message: err.message }] } };
  }
}

/**
 * Write route shared by `mozak focus add|remove` and the plugin star: setFocus with its errors as an envelope.
 * Owner only: the CLI runs it on owner routes and MCP never exposes it.
 */
export function focusChange(inventoryPath: string, change: FocusChange): OperationOutput {
  try {
    return { exitCode: 0, data: { status: "ok", ...setFocus(inventoryPath, change) } };
  } catch (err) {
    if (!(err instanceof DomainError)) throw err;
    return { exitCode: err.exitCode, data: { status: err.code, issues: [{ code: err.code, message: err.message }] } };
  }
}

/** Text form of `mozak focus list`: one line per scope, `scope: id, id` or `(none)`. */
export function renderFocus(focus: Record<string, string[]>): string {
  return Object.entries(focus).map(([id, ids]) => `${id}: ${ids.length ? ids.join(", ") : "(none)"}\n`).join("");
}

/** The new list, or null when the change would not alter it. */
export function nextFocus(current: readonly string[], plan: string, action: FocusAction): string[] | null {
  if (action === "add") return current.includes(plan) ? null : [...current, plan];
  return current.includes(plan) ? current.filter((id) => id !== plan) : null;
}

function assertPlan(inv: ScopeInventory, scope: string, plan: string): void {
  const state = readScope(resolveScope(inv, scope)).state;
  if (!state.plans.some((p) => p.id === plan)) {
    throw new DomainError("plan-not-found", `no plan "${plan}" in scope "${scope}"; run mozak plans (MCP mozak_plans) to list the plan ids`, 2);
  }
}

/**
 * Add or remove one plan id in one scope's focus list. Takes the inventory write lock, writes a temp file, fsyncs it,
 * validates the new content with the normal inventory loader, then renames it into place. Entry order, indent and
 * every other key (including `x`) are kept. A failed write leaves the old file as it was. Running it twice is a no-op.
 */
export function setFocus(inventoryPath: string, change: FocusChange, options: LockOptions = {}): FocusResult {
  if (change.action !== "add" && change.action !== "remove") throw new DomainError("invalid-input", `focus action must be add or remove, not "${String(change.action)}"`, 2);
  return withInventoryLock(inventoryPath, () => {
    const text = readFileSync(inventoryPath, "utf8");
    const inv = loadInventory(inventoryPath);
    if (!inv.scopes.some((s) => s.id === change.scope)) {
      throw new DomainError("scope-not-found", `no scope "${change.scope}" in the inventory; run mozak scopes (MCP mozak_scopes) to list the scope ids`);
    }
    if (change.action === "add") assertPlan(inv, change.scope, change.plan);
    const doc = JSON.parse(text) as { scopes: RawEntry[] };
    const entry = doc.scopes.find((e) => e.id === change.scope)!;
    const next = nextFocus(entry.focus ?? [], change.plan, change.action);
    if (next === null) return { scope: change.scope, focus: [...(entry.focus ?? [])], changed: false };
    entry.focus = next;
    writeInventoryValidated(inventoryPath, inventoryText(doc, text));
    return { scope: change.scope, focus: next, changed: true };
  }, options);
}
