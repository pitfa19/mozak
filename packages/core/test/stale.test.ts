import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderStale, staleReports, touched } from "../src/index.ts";

const D = (iso: string) => Math.floor(Date.parse(iso + "T12:00:00Z") / 1000);

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "mozak-s-"));
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

const moz = (id: string, kind: string, links = "", plan = "- [ ] x") =>
  `---\nid: ${id}\nkind: ${kind}\nformat: 1\n---\n\n## Plan\n\n${plan}\n\n## Links\n\n${links}\n\n## Translations\n`;
const scopeFiles = (id: string, kind: string, links = "") => ({
  [`${id}/README.md`]: `# ${id}\n`,
  [`${id}/AGENTS.md`]: `# ${id}\n`,
  [`${id}/MOZAK.md`]: moz(id, kind, links),
});

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

test("a scope is flagged when something it depends on changed after it", () => {
  const r = repo();
  commit(r, { ...scopeFiles("api", "project", "- depends-on: [[research]]"), ...scopeFiles("research", "topic") }, "2026-01-10");
  commit(r, { "research/notes.md": "new finding\n" }, "2026-02-20");
  const [api, research] = staleReports({ roots: [r] }, undefined, { now: D("2026-03-01") });
  assert.equal(api.id, "api");
  assert.equal(api.verdict, "inputs-changed");
  assert.equal(api.upstream[0].id, "research");
  assert.equal(api.upstream[0].newerBy, D("2026-02-20") - D("2026-01-10"));
  assert.equal(research.verdict, "no-input-changed");
  assert.equal(api.daysSinceTouched, 50);
});

test("informs points the other way: the scope that informs me is my upstream", () => {
  const r = repo();
  commit(r, { ...scopeFiles("research", "topic", "- informs: [[api]]"), ...scopeFiles("api", "project") }, "2026-01-10");
  commit(r, { "research/n.md": "x\n" }, "2026-02-01");
  const api = staleReports({ roots: [r] }, "api", { now: D("2026-03-01") })[0];
  assert.equal(api.verdict, "inputs-changed");
  assert.equal(api.upstream[0].direction, "reverse");
  const research = staleReports({ roots: [r] }, "research", { now: D("2026-03-01") })[0];
  assert.equal(research.verdict, "no-input-changed", "informing someone does not make me stale");
});

test("when I am newer than everything I rely on, nothing is flagged", () => {
  const r = repo();
  commit(r, scopeFiles("research", "topic"), "2026-01-10");
  commit(r, scopeFiles("api", "project", "- depends-on: [[research]]"), "2026-02-10");
  const api = staleReports({ roots: [r] }, "api", { now: D("2026-03-01") })[0];
  assert.equal(api.verdict, "no-input-changed");
});

test("a note my files cite is flagged when it changed after me, and an unrelated note is not", () => {
  const r = repo();
  commit(r, { "notes/Source A.md": "a\n", "notes/Source B.md": "b\n", "topic/README.md": "uses [[Source A]]\n", "topic/AGENTS.md": "x\n", "topic/MOZAK.md": moz("topic", "topic") }, "2026-01-10");
  commit(r, { "notes/Source A.md": "a2\n", "notes/Source B.md": "b2\n" }, "2026-02-15");
  const t = staleReports({ roots: [r] }, "topic", { now: D("2026-03-01") })[0];
  assert.deepEqual(t.notes.map((n) => n.name), ["Source A"], "only the cited note, not Source B");
  assert.equal(t.verdict, "inputs-changed");
  assert.match(renderStale([t]), /note \[\[Source A\]\]  changed 2026-02-15 \+36d/);
});

test("a link that does not resolve here is reported as not judgeable instead of passing silently", () => {
  const r = repo();
  commit(r, scopeFiles("api", "project", "- depends-on: [[elsewhere]]"), "2026-01-10");
  const api = staleReports({ roots: [r] }, "api", { now: D("2026-03-01") })[0];
  assert.deepEqual(api.unresolved, ["depends-on: [[elsewhere]]"]);
  assert.match(renderStale([api]), /cannot judge, not found on this machine: depends-on: \[\[elsewhere\]\]/);
});

test("scopes across two different git repos are compared by their own commit dates", () => {
  const vault = repo();
  const code = repo();
  commit(vault, scopeFiles("research", "topic"), "2026-01-10");
  commit(vault, { "research/n.md": "x\n" }, "2026-02-20");
  commit(code, scopeFiles("api", "project", "- depends-on: [[research]]"), "2026-02-01");
  const api = staleReports({ roots: [vault, code] }, "api", { now: D("2026-03-01") })[0];
  assert.equal(api.verdict, "inputs-changed");
  assert.equal(api.upstream[0].newerBy, D("2026-02-20") - D("2026-02-01"));
});

test("planOnly ignores edits to other files in a scope and only compares MOZAK.md", () => {
  const r = repo();
  commit(r, { ...scopeFiles("api", "project", "- depends-on: [[lib]]"), ...scopeFiles("lib", "project") }, "2026-01-10");
  commit(r, { "lib/src/code.ts": "x\n" }, "2026-02-20");
  assert.equal(staleReports({ roots: [r] }, "api", { now: D("2026-03-01") })[0].verdict, "inputs-changed");
  assert.equal(staleReports({ roots: [r] }, "api", { now: D("2026-03-01"), planOnly: true })[0].verdict, "no-input-changed");
});

test("the report is read only and leaves the files untouched", () => {
  const r = repo();
  commit(r, scopeFiles("api", "project"), "2026-01-10");
  const before = execFileSync("git", ["-C", r, "status", "--porcelain"], { encoding: "utf8" });
  staleReports({ roots: [r] });
  assert.equal(execFileSync("git", ["-C", r, "status", "--porcelain"], { encoding: "utf8" }), before);
});

test("an untracked file in a dirty tree does not crash and uses its mtime", () => {
  const r = repo();
  commit(r, scopeFiles("api", "project"), "2026-01-10");
  writeFileSync(join(r, "api/new.md"), "fresh\n");
  const old = new Date("2026-02-01T00:00:00Z");
  utimesSync(join(r, "api/new.md"), old, old);
  assert.equal(touched(join(r, "api")).source, "uncommitted");
});
