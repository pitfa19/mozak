// `mozak scope move` (owner route): move a scope's files into a vault folder and point its inventory entry there.
// Copies mozak.json, mozak.md (or their pre-0.4 names), README.md, AGENTS.md and the annotations sidecar, verifies
// every copy byte for byte, then rewrites only that inventory entry to { id, root } under the inventory lock with the
// same validated atomic write as `focus`. Every other key and entry stays as it was. The old files stay in place.
// A failure before the inventory rename removes what was copied, so both places and the old inventory stay valid.
// `--drop` removes a 0-plan entry from the inventory instead (its files stay). No git and no network here.

import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DomainError } from "./errors.ts";
import { executeOperation, type OperationOutput } from "./api.ts";
import { fsyncDir, writeFileDurable } from "./durable.ts";
import { inventoryText, withInventoryLock, writeInventoryValidated } from "./inventory-file.ts";
import { canonicalPath, loadInventory, type ScopeEntry, type ScopeInventory } from "./scope-index.ts";
import { SCOPE_FILE_NAMES } from "./scope-files.ts";
import { readScope, withScopeLocks } from "./scope-store.ts";
import { ANNOTATIONS_FILE } from "./annotations.ts";
import { isUtcTimestamp } from "./understanding.ts";
import { nonEmptyString } from "./validate.ts";
import { vaultOf } from "./vault-config.ts";

/** Files a move carries, in copy order. The plan file comes first so a reader never sees a projection without it. */
export const MOVED_FILES = [...SCOPE_FILE_NAMES, ANNOTATIONS_FILE, "README.md", "AGENTS.md"] as const;
/** Entry keys that name where the plans are. A move replaces them with one `root`. */
const LOCATION_KEYS = new Set(["root", "remote", "ref", "plans"]);

export interface MoveArgs {
  scope: unknown; to?: unknown; drop?: unknown; dryRun?: unknown;
  ownerRef: unknown; ownerMessageAt: unknown; reason: unknown;
}
export interface MovedFile { name: string; bytes: number; sha256: string }
export interface MoveResult {
  status: "ok" | "dry-run";
  scope: string;
  action: "move" | "drop";
  from: string;
  to: string | null;
  inPlace: boolean;
  changed: boolean;
  plans: number;
  files: MovedFile[];
  /** The rewritten inventory entry, or null for a drop. */
  entry: Record<string, unknown> | null;
  warnings: { code: string; message: string }[];
  owner: { ownerRef: string; ownerMessageAt: string; reason: string };
}
export interface MoveOptions { onPhase?: (phase: string) => void; lockTimeoutMs?: number }

type RawEntry = Record<string, unknown> & { id: string };
type SourceFile = { name: string; bytes: Buffer; mode: number };
interface Request { scope: string; to: string | null; dryRun: boolean; owner: MoveResult["owner"] }

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const invalid = (message: string) => new DomainError("invalid-input", message, 2);

/** Boundary: check every argument once. Owner provenance is required and never synthesized. */
export function parseMoveArgs(a: MoveArgs): Request {
  const scope = nonEmptyString(a.scope, "scope");
  const drop = a.drop === true;
  if (a.drop !== undefined && typeof a.drop !== "boolean") throw invalid("drop must be a boolean");
  if (drop === (a.to !== undefined)) throw invalid("scope move needs exactly one of --to PATH or --drop");
  const to = drop ? null : nonEmptyString(a.to, "to");
  const ownerRef = nonEmptyString(a.ownerRef, "ownerRef");
  if (!isUtcTimestamp(a.ownerMessageAt)) throw invalid("ownerMessageAt must be the UTC time of the owner's message, for example 2026-11-01T17:25:00.000Z");
  const reason = nonEmptyString(a.reason, "reason");
  return { scope, to, dryRun: a.dryRun === true, owner: { ownerRef, ownerMessageAt: a.ownerMessageAt, reason } };
}

/** Run `check` on the source folder as a plain local scope: no settings, no remote refresh, no network. */
function assertSourceChecks(entry: ScopeEntry): void {
  const local: ScopeInventory = { format: "mozak.local/v3", scopes: [{ id: entry.id, root: entry.root }], digest: "" };
  const out = executeOperation(local, "check", { scope: entry.id });
  if (out.exitCode === 0) return;
  const codes = (out.data.issues as { code: string }[]).map((i) => i.code).join(", ");
  throw new DomainError("move-source-fails-check", `scope "${entry.id}" at ${entry.root} fails check (${codes}); fix that first, the move copies only a clean scope`, 3);
}

/**
 * The regular files of MOVED_FILES present in `root`, with their bytes. Names come from listing the folder, so on a
 * case-insensitive disk mozak.json is never also read as MOZAK.json. A symlink or other file type is refused.
 */
function sourceFiles(root: string): SourceFile[] {
  const present = new Set(readdirSync(root));
  const out: SourceFile[] = [];
  for (const name of MOVED_FILES) {
    if (!present.has(name)) continue;
    const path = join(root, name);
    const st = lstatSync(path);
    if (!st.isFile()) throw new DomainError("scope-file-not-regular", `${name} in ${root} must be a regular file, not a link or folder`, 2);
    out.push({ name, bytes: readFileSync(path), mode: st.mode & 0o777 });
  }
  return out;
}

/** Refuse a target that already holds a scope or any file the move would write. Only called when the folder changes. */
function assertTargetFree(target: string, names: string[], inv: ScopeInventory): void {
  const other = inv.scopes.find((s) => s.root === target);
  if (other) throw new DomainError("move-target-has-scope", `${target} is already the folder of scope "${other.id}"`, 2);
  if (!existsSync(target)) return;
  if (!statSync(target).isDirectory()) throw new DomainError("move-target-not-directory", `${target} exists and is not a folder`, 2);
  const plan = SCOPE_FILE_NAMES.find((n) => existsSync(join(target, n)));
  if (plan) throw new DomainError("move-target-has-scope", `${target} already holds ${plan}; pick an empty folder`, 2);
  const taken = names.filter((n) => existsSync(join(target, n)));
  if (taken.length) throw new DomainError("move-target-file-exists", `${target} already holds ${taken.join(", ")}; the move never overwrites a file`, 2);
}

/** Pinned specification paths of every plan that do not exist under `target`. The move does not carry them. */
function specsLeftBehind(source: ScopeEntry, target: string): { code: string; message: string }[] {
  const paths = new Set(readScope(source).state.plans.flatMap((p) => p.specifications.map((s) => s.path)));
  return [...paths].sort().filter((p) => !existsSync(join(target, p))).map((p) => ({
    code: "spec-not-moved",
    message: `specification ${p} is not copied; copy it to ${join(target, p)} by hand if the plan still needs it`,
  }));
}

/** The entry after the move: id, the new root, then every other key of the old entry in its order (focus, x). */
function movedEntry(old: RawEntry, to: string): Record<string, unknown> {
  const out: Record<string, unknown> = { id: old.id, root: to };
  for (const [k, v] of Object.entries(old)) if (k !== "id" && !LOCATION_KEYS.has(k)) out[k] = v;
  return out;
}

/**
 * Copy every file through a flushed temp file, verify the bytes, rename into place, then run the inventory step.
 * Any failure before the inventory points at `target` removes what was copied and the folders it made.
 */
function copyVerified(files: SourceFile[], target: string, onPhase: (p: string) => void, inventoryStep: () => void, inventoryPointsHere: () => boolean): void {
  const createdDirs = missingDirs(target);
  const placed: string[] = [];
  try {
    for (const d of [...createdDirs].reverse()) mkdirSync(d);
    for (const f of files) {
      placed.push(placeVerified(f, target));
      onPhase(`after-copy:${f.name}`);
    }
    fsyncDir(target);
    for (const f of files) assertSameBytes(join(target, f.name), f.bytes);
    inventoryStep();
  } catch (e) {
    if (!inventoryPointsHere()) rollBack(placed, createdDirs);
    throw e;
  }
}

/** Folders from `target` up to the first one that exists, deepest first. */
function missingDirs(target: string): string[] {
  const out: string[] = [];
  for (let d = target; !existsSync(d); d = dirname(d)) out.push(d);
  return out;
}

function assertSameBytes(path: string, bytes: Buffer): void {
  if (!readFileSync(path).equals(bytes)) throw new DomainError("move-verify-failed", `${path} differs from the source after the copy`, 4);
}

/** One file: flushed temp file, same mode, bytes checked, renamed into place. Returns the final path. */
function placeVerified(f: SourceFile, target: string): string {
  const temp = join(target, `.${f.name}.${randomUUID()}.move-tmp`);
  try {
    writeFileDurable(temp, f.bytes);
    chmodSync(temp, f.mode);
    assertSameBytes(temp, f.bytes);
    renameSync(temp, join(target, f.name));
  } catch (e) {
    rmSync(temp, { force: true });
    throw e;
  }
  return join(target, f.name);
}

function rollBack(placed: string[], createdDirs: string[]): void {
  for (const p of placed) rmSync(p);
  for (const d of createdDirs) { try { rmdirSync(d); } catch { /* not empty or gone: leave it */ } }
}

/** Under the scope lock: the files must still be the ones the plan read, else a write slipped in between. */
function assertUnchanged(fresh: SourceFile[], planned: SourceFile[]): void {
  const same = fresh.length === planned.length && fresh.every((f, i) => f.name === planned[i]!.name && f.bytes.equals(planned[i]!.bytes));
  if (!same) throw new DomainError("stale-input", "the scope changed while the move started; run it again", 3);
}

/**
 * Move or drop one scope. Dry run reports the files and the new entry without writing anything. Running the same
 * move twice is a no-op the second time (the entry already points at the target).
 */
export function moveScope(inventoryPath: string, args: MoveArgs, options: MoveOptions = {}): MoveResult {
  const req = parseMoveArgs(args);
  const onPhase = (phase: string) => options.onPhase?.(phase);
  if (req.dryRun) return { ...planMove(inventoryPath, req).result, status: "dry-run" };
  return withInventoryLock(inventoryPath, () => {
    const p = planMove(inventoryPath, req);
    if (!p.result.changed) return p.result;
    const writeInventory = () => { onPhase("before-inventory-write"); writeInventoryValidated(inventoryPath, p.text); };
    const written = () => readFileSync(inventoryPath, "utf8") === p.text;
    withScopeLocks([p.source.root], () => {
      // Reread under the scope lock: a plan write between the plan and the lock would change the bytes.
      if (p.files.length === 0) return writeInventory();
      const fresh = sourceFiles(p.source.root);
      assertUnchanged(fresh, p.files);
      copyVerified(fresh, p.result.to!, onPhase, writeInventory, written);
    }, options);
    return p.result;
  }, options);
}

interface Planned { result: MoveResult; source: ScopeEntry; files: SourceFile[]; text: string }

/** Everything the move will do, checked against the current inventory and files. Writes nothing. */
function planMove(inventoryPath: string, req: Request): Planned {
  const text = readFileSync(inventoryPath, "utf8");
  const inv = loadInventory(inventoryPath);
  const loaded = inv.scopes.find((s) => s.id === req.scope);
  if (!loaded) throw new DomainError("scope-not-found", `no scope "${req.scope}" in the inventory; run mozak scopes to list the scope ids`, 2);
  const source: ScopeEntry = { id: loaded.id, root: loaded.root };
  const doc = JSON.parse(text) as { scopes: RawEntry[] };
  const index = doc.scopes.findIndex((e) => e.id === req.scope);
  const old = doc.scopes[index]!;
  const base = { scope: req.scope, from: source.root, owner: req.owner, warnings: [] as MoveResult["warnings"] };

  if (req.to === null) {
    const plans = readScope(source).state.plans.length;
    if (plans > 0) throw new DomainError("drop-refused-has-plans", `scope "${req.scope}" has ${plans} plan(s); only a scope with 0 plans can be dropped. Move it instead`, 2);
    doc.scopes.splice(index, 1);
    return { source, files: [], text: inventoryText(doc, text), result: { ...base, status: "ok", action: "drop", to: null, inPlace: false, changed: true, plans, files: [], entry: null } };
  }

  const target = canonicalPath(resolve(dirname(inventoryPath), req.to));
  if (vaultOf(target) === null) {
    throw new DomainError("move-target-outside-vault", `${target} is not inside an Obsidian vault: no folder at or above it has a .obsidian folder`, 2);
  }
  const inPlace = target === source.root;
  const files = inPlace ? [] : sourceFiles(source.root);
  if (!inPlace) assertTargetFree(target, files.map((f) => f.name), inv);
  assertSourceChecks(source);
  const entry = movedEntry(old, req.to);
  const changed = JSON.stringify(entry) !== JSON.stringify(old);
  doc.scopes[index] = entry as RawEntry;
  const plans = readScope(source).state.plans.length;
  const warnings = inPlace ? [] : specsLeftBehind(source, target);
  return {
    source, files, text: inventoryText(doc, text),
    result: { ...base, status: "ok", action: "move", to: target, inPlace, changed, plans, warnings, entry, files: files.map((f) => ({ name: f.name, bytes: f.bytes.length, sha256: sha256(f.bytes) })) },
  };
}

/** Route shared by the CLI: moveScope with its errors as an envelope. Owner only; MCP never exposes it. */
export function scopeMoveOutput(inventoryPath: string, args: MoveArgs, options: MoveOptions = {}): OperationOutput {
  try {
    return { exitCode: 0, data: { ...moveScope(inventoryPath, args, options) } };
  } catch (err) {
    if (!(err instanceof DomainError)) throw err;
    return { exitCode: err.exitCode, data: { status: err.code, issues: [{ code: err.code, message: err.message }] } };
  }
}

/** One-screen text form for the CLI. Errors print as their JSON envelope. */
export function renderMove(d: Record<string, any>): string {
  if (d.status !== "ok" && d.status !== "dry-run") return `${JSON.stringify(d, null, 2)}\n`;
  const lines = [`status: ${d.status}${statusNote(d)}`, ...(d.action === "drop" ? dropLines(d) : moveLines(d))];
  for (const w of d.warnings) lines.push(`warning ${w.code}: ${w.message}`);
  return `${lines.join("\n")}\n`;
}

function statusNote(d: Record<string, any>): string {
  if (d.status === "dry-run") return " (nothing written)";
  return d.changed ? "" : " (already done, nothing changed)";
}

function dropLines(d: Record<string, any>): string[] {
  return [`drop ${d.scope}: remove its inventory entry (0 plans); files stay in ${d.from}`];
}

function moveLines(d: Record<string, any>): string[] {
  const lines = [`move ${d.scope}: ${d.plans} plan(s)`, `  from ${d.from}`, `  to   ${d.to}${d.inPlace ? " (same folder, entry only)" : ""}`];
  for (const f of d.files) lines.push(`  copy ${f.name} (${f.bytes} bytes, sha256 ${String(f.sha256).slice(0, 12)})`);
  lines.push(`  new entry: ${JSON.stringify(d.entry)}`);
  if (d.status === "ok" && d.changed && !d.inPlace) lines.push(`the old files stay in ${d.from}; delete them only after checking the new folder`);
  return lines;
}
