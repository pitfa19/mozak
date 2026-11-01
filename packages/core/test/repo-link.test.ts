// Display-only repo link (0.6.0): an optional `repo` on a scope entry, `github:owner/repo` or an https URL. It is
// validated where it enters (the loader and `mozak scope link`), shown by `scopes` and the plugin, never used for git or
// the network, and it does not change the inventory digest. Synthetic temp folders only.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, world, NOW } from "./annotations-fixture.ts";
import { executeOperation } from "../src/api.ts";
import { loadInventory } from "../src/scope-index.ts";
import { linkScope, scopeLinkOutput } from "../src/scope-link.ts";
import { parseRepoLink, repoLinkLabel, repoLinkUrl } from "../src/repo-link.ts";
import { moveScope } from "../src/scope-move.ts";
import { makeVault } from "./vault-temp.ts";
import { loadScopesModel } from "../../obsidian/src/load.ts";

after(cleanup);
const raw = (path: string) => JSON.parse(readFileSync(path, "utf8"));

function linked() {
  const w = world(["alpha", "beta"]);
  makeVault(w.base);
  writeFileSync(w.config, '{\n "format": "mozak.local/v3",\n "scopes": [\n  { "id": "alpha", "root": "alpha", "focus": [] },\n  { "id": "beta", "root": "beta" }\n ]\n}\n');
  return w;
}

test("parseRepoLink accepts github:owner/repo and https URLs, and nothing else", () => {
  assert.equal(parseRepoLink("github:pitfa19/mozak"), "github:pitfa19/mozak");
  assert.equal(parseRepoLink("https://github.com/ANPIT-hr/anpit-web"), "https://github.com/ANPIT-hr/anpit-web");
  assert.equal(parseRepoLink("https://gitlab.example.org/team/app.git"), "https://gitlab.example.org/team/app.git");
  for (const bad of ["", " github:a/b", "github:a", "github:a/b/c", "github:../b", "http://x/y", "file:///tmp/x", "https://", "https://x y/z", "git@github.com:a/b.git", 3, null]) {
    assert.equal(parseRepoLink(bad), null, String(bad));
  }
  assert.equal(repoLinkUrl("github:pitfa19/mozak"), "https://github.com/pitfa19/mozak");
  assert.equal(repoLinkUrl("https://github.com/a/b.git"), "https://github.com/a/b");
  assert.equal(repoLinkLabel("github:pitfa19/mozak"), "pitfa19/mozak");
  assert.equal(repoLinkLabel("https://github.com/a/b.git"), "a/b");
  assert.equal(repoLinkLabel("https://gitlab.example.org/team/app"), "gitlab.example.org/team/app");
});

test("the loader keeps a valid repo on the entry, refuses a bad one, and the digest ignores it", () => {
  const w = linked();
  const digest = loadInventory(w.config).digest;
  const doc = raw(w.config);
  doc.scopes[0].repo = "github:o/alpha";
  writeFileSync(w.config, JSON.stringify(doc));
  const inv = loadInventory(w.config);
  assert.equal(inv.scopes.find((s) => s.id === "alpha")!.repo, "github:o/alpha");
  assert.equal(inv.scopes.find((s) => s.id === "beta")!.repo, undefined);
  assert.equal(inv.digest, digest, "repo never changes the inventory digest");
  for (const bad of ["ftp://x/y", 7, ""]) {
    doc.scopes[0].repo = bad;
    writeFileSync(w.config, JSON.stringify(doc));
    assert.throws(() => loadInventory(w.config), { code: "inventory-invalid", message: /repo must be "github:owner\/repo" or an https:\/\/ URL/ });
  }
});

test("scope link sets, replaces and clears only that entry's repo; style, order and other keys kept; idempotent", () => {
  const w = linked();
  const before = readFileSync(w.config, "utf8");
  assert.deepEqual(linkScope(w.config, { scope: "alpha", repo: "github:o/alpha" }), { scope: "alpha", repo: "github:o/alpha", changed: true });
  assert.deepEqual(raw(w.config).scopes, [{ id: "alpha", root: "alpha", focus: [], repo: "github:o/alpha" }, { id: "beta", root: "beta" }]);
  assert.match(readFileSync(w.config, "utf8"), /^\{\n "format"/, "one-space indent kept");
  const once = readFileSync(w.config, "utf8");
  assert.equal(linkScope(w.config, { scope: "alpha", repo: "github:o/alpha" }).changed, false);
  assert.equal(readFileSync(w.config, "utf8"), once);
  linkScope(w.config, { scope: "alpha", repo: "https://github.com/o/alpha2" });
  assert.equal(raw(w.config).scopes[0].repo, "https://github.com/o/alpha2");
  assert.deepEqual(linkScope(w.config, { scope: "alpha", clear: true }), { scope: "alpha", repo: null, changed: true });
  assert.deepEqual(raw(w.config), JSON.parse(before), "clearing restores the same content");
  assert.equal(linkScope(w.config, { scope: "alpha", clear: true }).changed, false);
});

test("scope link refuses a bad link, an unknown scope and a missing or double choice, writing nothing", () => {
  const w = linked();
  const before = readFileSync(w.config, "utf8");
  assert.throws(() => linkScope(w.config, { scope: "alpha", repo: "git@github.com:o/a.git" }), { code: "invalid-input", message: /github:owner\/repo/ });
  assert.throws(() => linkScope(w.config, { scope: "gamma", repo: "github:o/g" }), { code: "scope-not-found" });
  assert.throws(() => linkScope(w.config, { scope: "alpha" }), { code: "invalid-input", message: /--repo SPEC or --clear/ });
  assert.throws(() => linkScope(w.config, { scope: "alpha", repo: "github:o/a", clear: true }), { code: "invalid-input" });
  assert.equal(readFileSync(w.config, "utf8"), before);
  const out = scopeLinkOutput(w.config, { scope: "gamma", repo: "github:o/g" });
  assert.equal(out.exitCode, 2);
  assert.equal(out.data.status, "scope-not-found");
  const ok = scopeLinkOutput(w.config, { scope: "beta", repo: "github:o/b" });
  assert.deepEqual([ok.exitCode, ok.data.status], [0, "ok"]);
});

test("scopes and the plugin show the link; nothing reads the network", () => {
  const w = linked();
  linkScope(w.config, { scope: "alpha", repo: "github:o/alpha" });
  const idx = executeOperation(loadInventory(w.config), "scopes", {});
  const rows = idx.data.scopes as { id: string; repo?: string }[];
  assert.equal(rows.find((r) => r.id === "alpha")!.repo, "github:o/alpha");
  assert.equal("repo" in rows.find((r) => r.id === "beta")!, false);
  const model = loadScopesModel(w.config);
  assert.deepEqual(model.scopes.find((s) => s.id === "alpha")!.repo, { spec: "github:o/alpha", url: "https://github.com/o/alpha", label: "o/alpha" });
  assert.equal(model.scopes.find((s) => s.id === "beta")!.repo, null);
});

test("scope move --repo adds the link to the moved entry; without it an existing link is kept", () => {
  const w = world(["alpha", "beta"]);
  makeVault(join(w.base, "vault"));
  writeFileSync(w.config, JSON.stringify({ format: "mozak.local/v3", scopes: [{ id: "alpha", root: "alpha" }, { id: "beta", root: "beta", repo: "github:o/beta" }] }));
  const owner = { ownerRef: "synthetic:owner", ownerMessageAt: NOW, reason: "into the vault" };
  assert.deepEqual(moveScope(w.config, { scope: "alpha", to: "vault/alpha", repo: "github:o/alpha", ...owner }).entry, { id: "alpha", root: "vault/alpha", repo: "github:o/alpha" });
  assert.deepEqual(moveScope(w.config, { scope: "beta", to: "vault/beta", ...owner }).entry, { id: "beta", root: "vault/beta", repo: "github:o/beta" });
  assert.throws(() => moveScope(w.config, { scope: "beta", to: "vault/beta", repo: "ftp://x", ...owner }), { code: "invalid-input", message: /github:owner\/repo/ });
  assert.throws(() => moveScope(w.config, { scope: "beta", drop: true, repo: "github:o/beta", ...owner }), { code: "invalid-input", message: /--repo goes with --to/ });
  assert.deepEqual(raw(w.config).scopes, [{ id: "alpha", root: "vault/alpha", repo: "github:o/alpha" }, { id: "beta", root: "vault/beta", repo: "github:o/beta" }]);
});
