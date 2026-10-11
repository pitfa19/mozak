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

test("parses a valid MOZAK.md", () => {
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
  writeFileSync(join(dir, "MOZAK.md"), good);
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
  writeFileSync(join(dir, "MOZAK.md"), good);
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
