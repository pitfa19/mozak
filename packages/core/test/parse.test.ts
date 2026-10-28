import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseMozak, checkScope } from "../src/index.ts";

const good = `---
id: demo
kind: project
format: 1
---

## Plan

- [ ] ship it

## Links

- depends-on: https://github.com/pitfa19/mozak
- informs: [[personal-research]]

## Translations

### publishing concept
- source: [[personal-research]]
- target: https://github.com/pitfa19/anpit-web
- [re-derived] deploys from main
- [re-derived] markdown build step
`;

test("parses a valid mozak.md", () => {
  const d = parseMozak(good);
  assert.deepEqual(d.issues, []);
  assert.equal(d.id, "demo");
  assert.equal(d.links.length, 2);
  assert.equal(d.translations[0].assumptions.length, 2);
});

test("rejects missing frontmatter", () => {
  assert.equal(parseMozak("## Plan\n").issues[0].code, "frontmatter-missing");
});

test("rejects unknown relation and bad target", () => {
  const d = parseMozak(good.replace("depends-on: https://github.com/pitfa19/mozak", "likes: foo"));
  assert.ok(d.issues.some((i) => i.code === "link-relation"));
  const d2 = parseMozak(good.replace("[[personal-research]]\n\n##", "not-a-link\n\n##"));
  assert.ok(d2.issues.some((i) => i.code === "link-target"));
});

test("an open assumption makes a translation invalid", () => {
  const d = parseMozak(good.replace("[re-derived] markdown build step", "[open] markdown build step"));
  const issue = d.issues.find((i) => i.code === "translation-open-assumption");
  assert.ok(issue);
  assert.match(issue.message, /markdown build step/);
});

test("a translation with no assumptions is invalid", () => {
  const d = parseMozak(good.replace(/- \[re-derived\].*\n/g, ""));
  assert.ok(d.issues.some((i) => i.code === "translation-no-assumptions"));
});

test("sections must be present and ordered", () => {
  const d = parseMozak("---\nid: x\nkind: topic\nformat: 1\n---\n## Links\n## Plan\n");
  assert.ok(d.issues.some((i) => i.code === "section-order"));
  assert.ok(d.issues.some((i) => i.code === "section-missing"));
});

test("checkScope needs the three root files", () => {
  const dir = mkdtempSync(join(tmpdir(), "mozak-"));
  writeFileSync(join(dir, "mozak.md"), good);
  const r = checkScope(dir);
  assert.equal(r.ok, false);
  assert.deepEqual(r.issues.map((i) => i.message).sort(), ["missing AGENTS.md", "missing README.md"]);
  writeFileSync(join(dir, "README.md"), "# demo\n");
  writeFileSync(join(dir, "AGENTS.md"), "# agents\n");
  assert.equal(checkScope(dir).ok, true);
});

function claudeIssues(setup: (dir: string) => void): number {
  const dir = mkdtempSync(join(tmpdir(), "mozak-"));
  for (const f of ["README.md", "AGENTS.md"]) writeFileSync(join(dir, f), "x\n");
  writeFileSync(join(dir, "mozak.md"), good);
  setup(dir);
  return checkScope(dir).issues.filter((i) => i.code === "claude-pointer").length;
}

test("no CLAUDE.md is fine, Claude Code 2.1.277+ falls back to AGENTS.md", () => {
  assert.equal(claudeIssues(() => {}), 0);
});

test("a CLAUDE.md that only says in words to read AGENTS.md is flagged, it is not an import", () => {
  assert.equal(claudeIssues((d) => writeFileSync(join(d, "CLAUDE.md"), "See AGENTS.md\n")), 1);
  assert.equal(claudeIssues((d) => writeFileSync(join(d, "CLAUDE.md"), "Read AGENTS.md first.\n")), 1);
  assert.equal(claudeIssues((d) => writeFileSync(join(d, "CLAUDE.md"), "lots of separate instructions\n")), 1);
});

test("a CLAUDE.md with an @AGENTS.md import passes, with or without extra Claude instructions", () => {
  assert.equal(claudeIssues((d) => writeFileSync(join(d, "CLAUDE.md"), "@AGENTS.md\n")), 0);
  assert.equal(claudeIssues((d) => writeFileSync(join(d, "CLAUDE.md"), "@AGENTS.md\n\n## Claude Code\n\nUse plan mode.\n")), 0);
});

test("@AGENTS.md inside a code span or fenced block is not an import and is flagged", () => {
  assert.equal(claudeIssues((d) => writeFileSync(join(d, "CLAUDE.md"), "Mentions `@AGENTS.md` only\n")), 1);
  assert.equal(claudeIssues((d) => writeFileSync(join(d, "CLAUDE.md"), "```\n@AGENTS.md\n```\n")), 1);
});

test("a CLAUDE.md symlinked to AGENTS.md passes, one symlinked elsewhere or dangling is flagged", () => {
  assert.equal(claudeIssues((d) => symlinkSync("AGENTS.md", join(d, "CLAUDE.md"))), 0);
  assert.equal(
    claudeIssues((d) => {
      writeFileSync(join(d, "OTHER.md"), "x\n");
      symlinkSync("OTHER.md", join(d, "CLAUDE.md"));
    }),
    1,
  );
  assert.equal(claudeIssues((d) => symlinkSync("/nonexistent/target", join(d, "CLAUDE.md"))), 1);
});

// Line numbers are 1-based lines of the whole file, frontmatter included, so an editor can jump to them.
test("links, translations and assumptions carry the file line they came from", () => {
  const d = parseMozak(good);
  assert.deepEqual(d.links.map((l) => [l.relation, l.line]), [["depends-on", 13], ["informs", 14]]);
  assert.equal(d.translations[0].line, 18);
  assert.equal(d.translations[0].source, "[[personal-research]]");
  assert.equal(d.translations[0].target, "https://github.com/pitfa19/anpit-web");
  assert.deepEqual(d.translations[0].assumptions.map((a) => [a.text, a.line]), [["deploys from main", 21], ["markdown build step", 22]]);
  assert.equal(d.plan, "- [ ] ship it");
});

test("issues point at the offending line", () => {
  const lineOf = (text: string, code: string) => parseMozak(text).issues.find((i) => i.code === code)?.line;
  assert.equal(lineOf(good.replace("- informs: [[personal-research]]", "- just words"), "link-malformed"), 14);
  assert.equal(lineOf(good.replace("- informs: [[personal-research]]", "- likes: [[x]]"), "link-relation"), 14);
  assert.equal(lineOf(good.replace("- depends-on: https://github.com/pitfa19/mozak", "- depends-on: nowhere"), "link-target"), 13);
  assert.equal(lineOf(good.replace("[re-derived] markdown", "[open] markdown"), "translation-open-assumption"), 22);
  assert.equal(lineOf(good.replace("- target: https://github.com/pitfa19/anpit-web\n", ""), "translation-incomplete"), 18);
  assert.equal(lineOf(good.replace(/- \[re-derived\].*\n/g, ""), "translation-no-assumptions"), 18);
  assert.equal(lineOf(`${good}\n## Plan\n`, "section-duplicate"), 24);
});

test("line numbers stay right with CRLF endings and a longer frontmatter", () => {
  const d = parseMozak(good.replace("format: 1\n", "format: 1\ntitle: Demo # a comment\n").replace(/\n/g, "\r\n"));
  assert.deepEqual(d.issues, []);
  assert.deepEqual(d.links.map((l) => l.line), [14, 15]);
  assert.equal(d.translations[0].assumptions[1].line, 23);
});

test("frontmatter: id, kind and format are checked, comments are stripped", () => {
  const codes = (text: string) => parseMozak(text).issues.map((i) => i.code);
  assert.equal(parseMozak(good.replace("kind: project", "kind: topic # notes")).kind, "topic");
  assert.deepEqual(codes(good.replace("id: demo\n", "")), ["id-missing"]);
  assert.deepEqual(codes(good.replace("kind: project", "kind: repo")), ["kind-invalid"]);
  assert.deepEqual(codes(good.replace("format: 1", "format: 2")), ["format-unsupported"]);
  assert.deepEqual(codes("---\nid: x\n"), ["frontmatter-missing"]);
  assert.deepEqual(codes(`x\n${good}`), ["frontmatter-missing"]);
});

test("unknown sections are reported, and list markers, blank lines and stray lines are ignored", () => {
  const d = parseMozak(good.replace("## Translations", "## Notes\n\nfree text\n\n## Translations").replace("- [ ] ship it", "- [ ] ship it\n- [x] done"));
  assert.deepEqual(d.issues.map((i) => i.code), ["section-unknown"]);
  assert.equal(d.plan, "- [ ] ship it\n- [x] done");
  const starred = parseMozak(good.replace("- informs:", "* informs:").replace("- source:", "source:"));
  assert.deepEqual(starred.issues, []);
  assert.equal(starred.links[1].relation, "informs");
  assert.equal(starred.translations[0].source, "[[personal-research]]");
  const beforeHeading = parseMozak(good.replace("### publishing concept", "- [open] orphan\n### publishing concept"));
  assert.deepEqual(beforeHeading.issues, []);
});

test("messages and titles carry the parsed names, and odd shapes do not crash", () => {
  const rel = parseMozak(good.replace("- informs: [[personal-research]]", "- likes: [[x]]")).issues.find((i) => i.code === "link-relation");
  assert.match(rel!.message, /^unknown relation "likes" /);
  assert.equal(parseMozak(good).translations[0].title, "publishing concept");
  const empty = parseMozak("---\n---\n## Plan\n## Links\n## Translations\n");
  assert.deepEqual(empty.issues.map((i) => i.code), ["id-missing", "kind-invalid", "format-unsupported"]);
  const noPlan = parseMozak("---\nid: x\nkind: topic\nformat: 1\n---\n## Links\n## Translations\n");
  assert.equal(noPlan.plan, "");
  assert.deepEqual(noPlan.issues.map((i) => i.code), ["section-missing"]);
});
