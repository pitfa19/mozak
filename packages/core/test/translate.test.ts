import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPacket, insertTranslation, parseMozak, renderTranslation, setAssumption, updateFile } from "../src/index.ts";

const base = `---\nid: target\nkind: project\nformat: 1\n---\n## Plan\n- [ ] x\n## Links\n## Translations\n`;
const draft = { title: "publishing concept", source: "src", target: "target", assumptions: ["deploys from main", "markdown build step"] };

test("a fresh translation is invalid until every assumption is re-derived", () => {
  const text = insertTranslation(base, renderTranslation(draft), draft.title);
  assert.equal(parseMozak(text).issues.filter((i) => i.code === "translation-open-assumption").length, 2);

  const one = setAssumption(text, draft.title, 1, "re-derived");
  assert.equal(parseMozak(one).issues.filter((i) => i.code === "translation-open-assumption").length, 1);

  const both = setAssumption(one, draft.title, 2, "re-derived");
  assert.deepEqual(parseMozak(both).issues, []);
  assert.equal(parseMozak(both).translations[0].assumptions.every((a) => a.status === "re-derived"), true);
});

test("a translation needs assumptions and a title", () => {
  assert.throws(() => renderTranslation({ ...draft, assumptions: [] }), /at least one assumption/);
  assert.throws(() => renderTranslation({ ...draft, title: " " }), /needs a title/);
});

test("duplicate titles and missing sections are refused", () => {
  const text = insertTranslation(base, renderTranslation(draft), draft.title);
  assert.throws(() => insertTranslation(text, renderTranslation(draft), draft.title), /already exists/);
  assert.throws(() => insertTranslation("no sections here", "x", "t"), /no "## Translations"/);
});

test("setAssumption only touches the named translation and reports bad numbers", () => {
  let text = insertTranslation(base, renderTranslation(draft), draft.title);
  text = insertTranslation(text, renderTranslation({ ...draft, title: "other idea" }), "other idea");
  const out = setAssumption(text, "other idea", 1, "re-derived");
  const doc = parseMozak(out);
  assert.equal(doc.translations[0].assumptions[0].status, "open");
  assert.equal(doc.translations[1].assumptions[0].status, "re-derived");
  assert.throws(() => setAssumption(text, draft.title, 9, "re-derived"), /no number 9/);
  assert.throws(() => setAssumption(text, "nope", 1, "re-derived"), /no translation titled/);
});

test("packet carries both plans, the existing relation, and the draft", () => {
  const source = parseMozak(`---\nid: src\nkind: topic\nformat: 1\n---\n## Plan\nsource plan\n## Links\n- informs: [[target]]\n## Translations\n`);
  const target = parseMozak(base);
  const p = buildPacket(source, target, draft);
  assert.deepEqual(p.related, ["src informs target"]);
  assert.equal(p.source.plan, "source plan");
  assert.match(p.draft, /\[open\] deploys from main/);
  assert.ok(p.instructions.some((i) => /Do not carry the source's answer over/.test(i)));
});

test("insert through the guarded writer keeps a concurrent edit", () => {
  const dir = mkdtempSync(join(tmpdir(), "mozak-t-"));
  mkdirSync(dir, { recursive: true });
  const f = join(dir, "MOZAK.md");
  writeFileSync(f, base);
  let first = true;
  updateFile(f, (t) => {
    if (first) {
      first = false;
      writeFileSync(f, t.replace("- [ ] x", "- [ ] x\n- [ ] concurrent edit"));
    }
    return insertTranslation(t, renderTranslation(draft), draft.title);
  });
  const out = readFileSync(f, "utf8");
  assert.match(out, /concurrent edit/);
  assert.match(out, /### publishing concept/);
});
