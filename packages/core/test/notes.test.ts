import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { touched } from "../src/notes.ts";

// touched() derives change times from git. These tests moved here from the deleted format-1 stale report tests.

const D = (iso: string) => Math.floor(Date.parse(iso + "T12:00:00Z") / 1000);

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "mozak-notes-"));
  execFileSync("git", ["init", "-q", "-b", "main", dir]);
  execFileSync("git", ["-C", dir, "config", "user.email", "t@t"]);
  execFileSync("git", ["-C", dir, "config", "user.name", "t"]);
  return dir;
}

/** Write files then commit them with a fixed date, so assertions can be exact. */
function commit(dir: string, files: Record<string, string>, date: string) {
  for (const [rel, text] of Object.entries(files)) {
    const p = join(dir, rel);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, text);
  }
  const when = `${date}T12:00:00Z`;
  execFileSync("git", ["-C", dir, "add", "-A"]);
  execFileSync("git", ["-C", dir, "commit", "-q", "-m", "c", "--date", when], { env: { ...process.env, GIT_COMMITTER_DATE: when } });
}

test("touched reads the commit date of a file and of a directory", () => {
  const r = repo();
  commit(r, { "a/one.md": "1\n", "b/two.md": "2\n" }, "2026-01-10");
  commit(r, { "a/one.md": "1b\n" }, "2026-03-05");
  assert.deepEqual(touched(join(r, "a")), { epoch: D("2026-03-05"), source: "commit" });
  assert.deepEqual(touched(join(r, "b/two.md")), { epoch: D("2026-01-10"), source: "commit" });
});

test("uncommitted edits count as newer than the last commit", () => {
  const r = repo();
  commit(r, { "a/one.md": "1\n" }, "2026-01-10");
  writeFileSync(join(r, "a/one.md"), "edited\n");
  const t = touched(join(r, "a"));
  assert.equal(t.source, "uncommitted");
  assert.ok(t.epoch! > D("2026-01-10"));
});

test("a file with no git history is unknown, not fresh", () => {
  const dir = mkdtempSync(join(tmpdir(), "mozak-nogit-"));
  writeFileSync(join(dir, "x.md"), "x\n");
  assert.deepEqual(touched(join(dir, "x.md")), { epoch: null, source: "none" });
});

test("an untracked file in a dirty tree does not crash and uses its mtime", () => {
  const r = repo();
  commit(r, { "api/README.md": "# api\n" }, "2026-01-10");
  writeFileSync(join(r, "api/new.md"), "fresh\n");
  const old = new Date("2026-02-01T00:00:00Z");
  utimesSync(join(r, "api/new.md"), old, old);
  assert.equal(touched(join(r, "api")).source, "uncommitted");
});
