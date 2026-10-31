import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const readRepo = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");

// Obsidian reads manifest.json and versions.json from the default branch. versions.json maps a plugin version to
// the lowest Obsidian version it needs, so older apps can fall back to a compatible release.
test("versions.json maps the current plugin version to the manifest's minAppVersion", () => {
  const manifest = JSON.parse(readRepo("manifest.json")) as { version: string; minAppVersion: string; description: string; id: string };
  const versions = JSON.parse(readRepo("versions.json")) as Record<string, string>;
  assert.equal(versions[manifest.version], manifest.minAppVersion);
  for (const [v, min] of Object.entries(versions)) {
    assert.match(v, /^\d+\.\d+\.\d+$/, `plugin version ${v} is x.y.z`);
    assert.match(min, /^\d+\.\d+\.\d+$/, `minAppVersion ${min} is x.y.z`);
  }
  assert.ok(!manifest.id.includes("obsidian"), "id does not contain obsidian");
  assert.ok(manifest.description.length <= 250 && manifest.description.endsWith("."), "description is short and ends with a period");
});

test("plugin README discloses the visibility check and that the update notice reads a cache only", () => {
  const readme = readRepo("packages/obsidian/README.md");
  assert.match(readme, /api\.github\.com\/repos\/OWNER\/REPO/);
  assert.match(readme, /makes no network call for this/);
  assert.match(readme, /never installs or updates itself/);
});
