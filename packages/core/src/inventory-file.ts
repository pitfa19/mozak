// Shared pieces for owner routes that rewrite mozak-inventory.json (focus, scope move, scope link): the inventory
// lock, the file's own JSON style, and a validated atomic replace.

import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { acquireDirLock, type LockOptions } from "./dir-lock.ts";
import { replaceFileDurable } from "./durable.ts";
import { loadInventory } from "./scope-index.ts";

export const INVENTORY_LOCK_DIR = ".mozak-inventory-lock";

/** Run `work` while holding the inventory write lock next to the inventory file. */
export function withInventoryLock<T>(inventoryPath: string, work: () => T, options: LockOptions = {}): T {
  const release = acquireDirLock(join(dirname(inventoryPath), INVENTORY_LOCK_DIR), "inventory", options);
  try {
    return work();
  } finally {
    release();
  }
}

/** The file's own indent (spaces or a tab) and whether it ends with a newline, so a rewrite keeps its style. */
export function jsonStyle(text: string): { indent: string; newline: boolean } {
  const m = /\n([ \t]+)\S/.exec(text);
  return { indent: m ? m[1]! : "  ", newline: text.endsWith("\n") };
}

/** `doc` serialized in the style of `original`. */
export function inventoryText(doc: unknown, original: string): string {
  const style = jsonStyle(original);
  return JSON.stringify(doc, null, style.indent) + (style.newline ? "\n" : "");
}

/**
 * Replace the inventory with `bytes`: the temp file next to it is flushed and loaded with the normal inventory loader
 * (same folder, so relative roots resolve the same) before the rename. On any failure the temp file is removed and the
 * old inventory stays as it was. Call it while holding the inventory lock.
 */
export function writeInventoryValidated(inventoryPath: string, bytes: string, beforeRename?: () => void): void {
  let temporary: string | null = null;
  try {
    replaceFileDurable(inventoryPath, bytes, (t) => { temporary = t; }, () => { loadInventory(temporary!); beforeRename?.(); });
  } catch (e) {
    if (temporary !== null) rmSync(temporary, { force: true });
    throw e;
  }
}
