import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditProject, checkScope, initScope } from "../src/index.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "mozak-i-"));

/** Every file path with its content, so a before/after comparison catches any write. */
function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (p: string) => {
    for (const e of readdirSync(p, { withFileTypes: true })) {
      const q = join(p, e.name);
      if (e.isDirectory()) walk(q);
      else out[q] = readFileSync(q, "utf8");
    }
  };
  walk(root);
  return out;
}

test("init creates a scope that passes check", () => {
  const dir = join(tmp(), "My Project");
  const r = initScope(dir, { kind: "project" });
  assert.deepEqual(r.created.sort(), ["AGENTS.md", "MOZAK.md", "README.md"]);
  const c = checkScope(dir);
  assert.equal(c.ok, true);
  assert.equal(c.doc?.id, "my-project");
});

test("init never overwrites existing files", () => {
  const dir = tmp();
  writeFileSync(join(dir, "README.md"), "mine\n");
  const r = initScope(dir, { kind: "topic", id: "t" });
  assert.deepEqual(r.skipped, ["README.md"]);
  assert.equal(readFileSync(join(dir, "README.md"), "utf8"), "mine\n");
  assert.equal(initScope(dir, { kind: "topic", id: "t" }).created.length, 0);
});

test("audit reads old state, proposes a valid draft, and changes no file", () => {
  const dir = tmp();
  mkdirSync(join(dir, ".mozak", "features"), { recursive: true });
  mkdirSync(join(dir, ".mozak", "evidence"), { recursive: true });
  writeFileSync(join(dir, ".mozak", "project.yml"), "version: 1\nproject:\n  id: oldie\n  name: Oldie\n");
  writeFileSync(join(dir, ".mozak", "idea.md"), "# idea\n\n## Intent\n\nShip the thing.\n\n## Open questions\n\n- Which host?\n- Pricing?\n");
  writeFileSync(join(dir, ".mozak", "features", "a.json"), "{}");

  const before = snapshot(dir);
  const a = auditProject(dir);
  assert.deepEqual(snapshot(dir), before, "audit must not add, remove or change any file");

  assert.equal(a.hasOldState, true);
  assert.equal(a.oldId, "oldie");
  assert.equal(a.intent, "Ship the thing.");
  assert.deepEqual(a.openQuestions, ["Which host?", "Pricing?"]);
  assert.equal(a.counts.features, 1);
  assert.match(a.draft, /id: oldie/);
  assert.match(a.draft, /- \[ \] Pricing\?/);
  assert.ok(a.notes.some((n) => /1 feature files/.test(n)));

  // the proposed draft must itself be a valid MOZAK.md
  writeFileSync(join(dir, "README.md"), "x\n");
  writeFileSync(join(dir, "AGENTS.md"), "x\n");
  writeFileSync(join(dir, "MOZAK.md"), a.draft);
  assert.equal(checkScope(dir).ok, true);
});

test("audit of a directory with no old state says so", () => {
  const a = auditProject(tmp());
  assert.equal(a.hasOldState, false);
  assert.match(a.notes[0], /nothing to port/);
});

test("audit survives a dangling symlink inside old evidence", () => {
  const dir = tmp();
  mkdirSync(join(dir, ".mozak", "evidence", "run", "profile"), { recursive: true });
  writeFileSync(join(dir, ".mozak", "evidence", "run", "real.json"), "{}");
  symlinkSync("/nonexistent/target", join(dir, ".mozak", "evidence", "run", "profile", "SingletonCookie"));
  const a = auditProject(dir);
  assert.equal(a.counts.evidence, 2);
});
