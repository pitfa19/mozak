import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildGraph, renderMermaid, renderText, targetKey } from "../src/index.ts";

function scope(root: string, rel: string, id: string, kind: "project" | "topic", links: string[]) {
  const dir = join(root, rel);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "README.md"), `# ${id}\n`);
  writeFileSync(join(dir, "AGENTS.md"), `# ${id}\n`);
  writeFileSync(join(dir, "MOZAK.md"), `---\nid: ${id}\nkind: ${kind}\nformat: 1\n---\n## Plan\n## Links\n${links.join("\n")}\n## Translations\n`);
  return dir;
}

test("targetKey reads wikilinks and repo urls", () => {
  assert.equal(targetKey("[[personal-research]]"), "personal-research");
  assert.equal(targetKey("[[note|alias]]"), "note");
  assert.equal(targetKey("https://github.com/pitfa19/mozak.git"), "mozak");
  assert.equal(targetKey("https://github.com/pitfa19/mozak/"), "mozak");
});

test("graph spans a vault and a folder of repos", () => {
  const root = mkdtempSync(join(tmpdir(), "mozak-g-"));
  scope(root, "vault/topics/research", "research", "topic", ["- informs: https://github.com/me/app", "- derived-from: [[missing-topic]]"]);
  scope(root, "repos/app", "app", "project", ["- depends-on: [[research]]"]);
  const g = buildGraph({ roots: [join(root, "vault"), join(root, "repos")] });
  assert.deepEqual(g.nodes.map((n) => n.id), ["app", "research"]);
  assert.equal(g.nodes.every((n) => n.ok), true);
  const informs = g.edges.find((e) => e.relation === "informs");
  assert.equal(informs?.to, "app");
  assert.equal(g.edges.find((e) => e.relation === "depends-on")?.to, "research");
  assert.equal(g.edges.find((e) => e.target === "[[missing-topic]]")?.to, null);
  assert.match(renderText(g), /derived-from -> \[\[missing-topic\]\]  \[unresolved here\]/);
  assert.match(renderMermaid(g), /research -->\|informs\| app/);
});

test("explicit map resolves a link whose name does not match the id", () => {
  const root = mkdtempSync(join(tmpdir(), "mozak-g-"));
  const dir = scope(root, "repos/x", "renamed", "project", []);
  scope(root, "vault/a", "a", "topic", ["- informs: https://github.com/me/old-name"]);
  const g = buildGraph({ roots: [root], map: { "https://github.com/me/old-name": dir } });
  assert.equal(g.edges[0].to, "renamed");
});

test("duplicate ids are reported, not silently merged", () => {
  const root = mkdtempSync(join(tmpdir(), "mozak-g-"));
  scope(root, "one", "same", "project", []);
  scope(root, "two", "same", "project", []);
  const g = buildGraph({ roots: [root] });
  assert.equal(g.nodes.length, 1);
  assert.match(g.problems[0], /duplicate scope id "same"/);
});

test("a scope that fails check still appears and is flagged", () => {
  const root = mkdtempSync(join(tmpdir(), "mozak-g-"));
  const dir = scope(root, "bad", "bad", "project", []);
  writeFileSync(join(dir, "AGENTS.md"), "");
  // remove a required file by overwriting MOZAK links with an invalid relation instead
  writeFileSync(join(dir, "MOZAK.md"), `---\nid: bad\nkind: project\nformat: 1\n---\n## Plan\n## Links\n- likes: x\n## Translations\n`);
  const g = buildGraph({ roots: [root] });
  assert.equal(g.nodes[0].ok, false);
  assert.match(renderText(g), /\[check failed\]/);
});
