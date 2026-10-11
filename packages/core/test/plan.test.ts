import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMozak, setPlan } from "../src/index.ts";

const doc = `---\nid: x\nkind: project\nformat: 1\n---\n\n## Plan\n\n- [ ] old\n\n## Links\n\n- informs: [[a]]\n\n## Translations\n\n### t\n- source: [[a]]\n- target: [[x]]\n- [open] foo\n`;

test("setPlan replaces only the plan and leaves Links and Translations byte for byte", () => {
  const out = setPlan(doc, "- [ ] new one\n- [x] done");
  const before = doc.slice(doc.indexOf("## Links"));
  assert.equal(out.slice(out.indexOf("## Links")), before);
  assert.equal(parseMozak(out).plan, "- [ ] new one\n- [x] done");
  assert.equal(parseMozak(out).links.length, 1);
});

test("setPlan refuses text that would add a heading", () => {
  assert.throws(() => setPlan(doc, "ok\n## Links\n- depends-on: https://evil.example"), /must not contain ## headings/);
});

test("setPlan with empty text clears the plan and keeps the structure valid", () => {
  const out = setPlan(doc, "");
  assert.equal(parseMozak(out).plan, "");
  assert.equal(parseMozak(out).issues.filter((i) => i.code !== "translation-open-assumption").length, 0);
});

test("setPlan on a file without a plan section fails loudly", () => {
  assert.throws(() => setPlan("no sections", "x"), /no "## Plan"/);
});
