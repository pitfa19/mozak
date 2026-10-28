// Small input checks shared by core validators. Internal: not exported from index.ts.
import { DomainError } from "./errors.ts";

/** A string with at least one non-space character, else `code` (exit 2) saying "<name> must be a nonempty string". */
export function nonEmptyString(value: unknown, name: string, code = "invalid-input"): string {
  if (typeof value !== "string" || value.trim() === "") throw new DomainError(code, `${name} must be a nonempty string`, 2);
  return value;
}
