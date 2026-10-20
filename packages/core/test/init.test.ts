import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkScope } from "../src/check.ts";
import { auditProject, initScope } from "../src/init.ts";

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

test("retired format-1 init refuses before creating a directory", () => {
  const parent = tmp();
  const dir = join(parent, "My Project");
  assert.throws(() => initScope(dir, { kind: "project" }), { code: "unsupported-legacy-operation" });
  assert.deepEqual(readdirSync(parent), []);
});

test("retired format-1 init preserves existing entry documents", () => {
  const dir = tmp();
  writeFileSync(join(dir, "README.md"), "mine\n");
  const before = snapshot(dir);
  assert.throws(() => initScope(dir, { kind: "topic", id: "t" }), { code: "unsupported-legacy-operation" });
  assert.deepEqual(snapshot(dir), before);
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

  // the proposed draft must itself be a valid mozak.md
  writeFileSync(join(dir, "README.md"), "x\n");
  writeFileSync(join(dir, "AGENTS.md"), "x\n");
  writeFileSync(join(dir, "mozak.md"), a.draft);
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
