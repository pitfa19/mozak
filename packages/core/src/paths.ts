// Small path helpers shared across core and the plugin.

import { realpathSync } from "node:fs";
import { isAbsolute, relative } from "node:path";

/** Resolve symlinks. A path that does not exist (or cannot be resolved) is returned unchanged. */
export function realOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** True when `child` is `parent` or lies under it. Lexical: callers resolve symlinks first when that matters. */
export function isWithin(child: string, parent: string): boolean {
  const r = relative(parent, child);
  return r === "" || (!r.startsWith("..") && !isAbsolute(r));
}
