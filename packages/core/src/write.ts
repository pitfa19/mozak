import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DomainError } from "./errors.ts";

export const hashText = (text: string): string => createHash("sha256").update(text).digest("hex");
export const EMPTY_HASH = hashText("");
export interface Snapshot { text: string; hash: string }
/** Legacy inspection helper only. Format-2 writers distinguish missing and empty files. */
export function readSnapshot(path: string): Snapshot {
  let text: string;
  try { text = readFileSync(path, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; text = ""; }
  return { text, hash: hashText(text) };
}
export interface LockOptions { timeoutMs?: number; staleMs?: number }
/** Retired path kept only to fail explicitly for old internal consumers. */
export function guardedWrite(_path: string, _text: string, _baseHash: string, _opts: LockOptions = {}): never {
  throw new DomainError("unsupported-legacy-operation", "raw Markdown writes are retired; use explicit format-2 plan operations");
}
export function updateFile(_path: string, _transform: (text: string) => string, _opts: LockOptions & { retries?: number } = {}): never {
  throw new DomainError("unsupported-legacy-operation", "raw transform writes are retired; use explicit format-2 plan operations");
}
