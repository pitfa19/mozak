import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG_DIR, vaultConfigDir, vaultPluginDir } from "../src/vault-config.ts";

const scratch = () => mkdtempSync(join(process.env.JCODE_SCRATCH_DIR || tmpdir(), "mozak-vault-config-"));

test("vaultConfigDir: the default folder, a renamed config folder, and no vault", () => {
  const plain = scratch();
  assert.equal(vaultConfigDir(plain), null, "an empty folder is not a vault");
  assert.equal(vaultPluginDir(plain), null);

  const standard = scratch();
  mkdirSync(join(standard, DEFAULT_CONFIG_DIR));
  assert.equal(vaultConfigDir(standard), join(standard, DEFAULT_CONFIG_DIR), "an existing default folder wins, even empty");
  assert.equal(vaultPluginDir(standard), join(standard, DEFAULT_CONFIG_DIR, "plugins", "mozak"));

  const renamed = scratch();
  mkdirSync(join(renamed, ".git"));
  writeFileSync(join(renamed, ".git", "app.json"), "{}");
  mkdirSync(join(renamed, ".notes-config"));
  writeFileSync(join(renamed, ".notes-config", "community-plugins.json"), "[]");
  mkdirSync(join(renamed, ".cache"));
  assert.equal(vaultConfigDir(renamed), join(renamed, ".notes-config"), "a renamed folder is found by Obsidian's own config files; .git is never used");

  const noMarkers = scratch();
  mkdirSync(join(noMarkers, ".something"));
  assert.equal(vaultConfigDir(noMarkers), null, "a dot folder without Obsidian config files is not a vault config");
});
