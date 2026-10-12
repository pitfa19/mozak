import { after, test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DomainError } from "../src/errors.ts";
import { assertScopeFiles, loadInventory, resolveScope } from "../src/scope-index.ts";

const workspaces: string[] = [];

after(() => {
  for (const dir of workspaces) rmSync(dir, { recursive: true, force: true });
});

function workspace(): string {
  const base = process.env.JCODE_SCRATCH_DIR ?? tmpdir();
  const root = mkdtempSync(join(base, "mozak-scope-index-"));
  workspaces.push(root);
  return root;
}

function dir(path: string): string {
  mkdirSync(path, { recursive: true });
  return path;
}

function writeConfig(folder: string, body: unknown, name = "inventory.json"): string {
  dir(folder);
  const path = join(folder, name);
  writeFileSync(path, typeof body === "string" ? body : JSON.stringify(body, null, 2));
  return path;
}

function expectCode(fn: () => unknown, code: string): void {
  assert.throws(fn, (err: unknown) => err instanceof DomainError && err.code === code);
}

function listing(folder: string): string[] {
  return readdirSync(folder).sort();
}

test("loadInventory reads the strict format and resolves relative roots against the config directory", () => {
  const ws = workspace();
  const projectRoot = dir(join(ws, "projects", "sample-project"));
  const topicRoot = dir(join(ws, "topics", "sample-topic"));
  const config = writeConfig(join(ws, "config"), {
    format: "mozak.local/v2",
    scopes: [
      { id: "sample-project", root: "../projects/sample-project" },
      { id: "sample-topic", root: "../topics/sample-topic" },
    ],
  });

  const inv = loadInventory(config);

  assert.equal(inv.format, "mozak.local/v2");
  assert.deepEqual(inv.scopes.map((s) => s.id).sort(), ["sample-project", "sample-topic"]);
  assert.equal(inv.scopes.find((s) => s.id === "sample-project")?.root, realpathSync(projectRoot));
  assert.equal(inv.scopes.find((s) => s.id === "sample-topic")?.root, realpathSync(topicRoot));
  assert.match(inv.digest, /^[0-9a-f]{64}$/);
});

test("loadInventory canonicalizes a root that is a symlink to a directory", () => {
  const ws = workspace();
  const real = dir(join(ws, "real", "scope"));
  symlinkSync(real, join(ws, "link-scope"), "dir");
  const config = writeConfig(ws, {
    format: "mozak.local/v2",
    scopes: [{ id: "linked", root: "./link-scope" }],
  });

  const inv = loadInventory(config);

  assert.equal(inv.scopes[0]?.root, realpathSync(real));
});

test("loadInventory retains a missing root so only the selected scope fails", () => {
  const ws = workspace();
  const present = dir(join(ws, "present"));
  const config = writeConfig(ws, {
    format: "mozak.local/v2",
    scopes: [
      { id: "present", root: "./present" },
      { id: "gone", root: "./gone" },
    ],
  });

  const inv = loadInventory(config);

  assert.equal(inv.scopes.length, 2);
  assert.equal(resolveScope(inv, "present").root, realpathSync(present));
  expectCode(() => resolveScope(inv, "gone"), "scope-root-missing");
});

test("loadInventory rejects unknown keys, bad field types, and legacy or unknown formats", () => {
  const ws = workspace();
  const cases: Array<[string, unknown]> = [
    ["unknown top-level key", { format: "mozak.local/v2", scopes: [], digest: "x" }],
    ["unknown entry key", { format: "mozak.local/v2", scopes: [{ id: "a", root: "./a", extra: true }] }],
    ["missing scopes", { format: "mozak.local/v2" }],
    ["scopes not an array", { format: "mozak.local/v2", scopes: {} }],
    ["numeric id", { format: "mozak.local/v2", scopes: [{ id: 1, root: "./a" }] }],
    ["empty root", { format: "mozak.local/v2", scopes: [{ id: "a", root: "" }] }],
    ["entry missing root", { format: "mozak.local/v2", scopes: [{ id: "a" }] }],
    ["format v1", { format: "mozak.local/v1", scopes: [] }],
    ["legacy roots shape", { roots: ["./repos"] }],
    ["not an object", ["mozak.local/v2"]],
  ];
  for (const [label, body] of cases) {
    const config = writeConfig(join(ws, label.replace(/\W+/g, "-")), body);
    assert.throws(
      () => loadInventory(config),
      (err: unknown) => err instanceof DomainError && err.code === "inventory-invalid",
      label,
    );
  }
  const broken = writeConfig(join(ws, "broken-json"), "{ not json");
  expectCode(() => loadInventory(broken), "inventory-invalid");
});

test("loadInventory rejects duplicate scope IDs", () => {
  const ws = workspace();
  dir(join(ws, "a"));
  dir(join(ws, "b"));
  const config = writeConfig(ws, {
    format: "mozak.local/v2",
    scopes: [
      { id: "same", root: "./a" },
      { id: "same", root: "./b" },
    ],
  });

  expectCode(() => loadInventory(config), "inventory-duplicate-id");
});

test("loadInventory rejects two IDs that resolve to the same physical root", () => {
  const ws = workspace();
  const real = dir(join(ws, "one"));
  symlinkSync(real, join(ws, "alias"), "dir");
  const config = writeConfig(ws, {
    format: "mozak.local/v2",
    scopes: [
      { id: "first", root: "./one" },
      { id: "second", root: "./alias" },
    ],
  });

  expectCode(() => loadInventory(config), "inventory-duplicate-root");
});

test("inventory digest is deterministic over the normalized explicit inventory", () => {
  const ws = workspace();
  const a = dir(join(ws, "a"));
  const b = dir(join(ws, "b"));
  const forward = writeConfig(join(ws, "cfg-one"), {
    format: "mozak.local/v2",
    scopes: [
      { id: "alpha", root: "../a" },
      { id: "beta", root: "../b" },
    ],
  });
  const reordered = writeConfig(join(ws, "cfg-two", "nested"), {
    format: "mozak.local/v2",
    scopes: [
      { id: "beta", root: `${b}/` },
      { id: "alpha", root: `${a}` },
    ],
  });
  const renamed = writeConfig(join(ws, "cfg-three"), {
    format: "mozak.local/v2",
    scopes: [
      { id: "alpha", root: "../a" },
      { id: "gamma", root: "../b" },
    ],
  });

  const first = loadInventory(forward).digest;

  assert.equal(loadInventory(reordered).digest, first);
  assert.notEqual(loadInventory(renamed).digest, first);
});

test("resolveScope rejects unknown scope IDs", () => {
  const ws = workspace();
  dir(join(ws, "a"));
  const inv = loadInventory(writeConfig(ws, { format: "mozak.local/v2", scopes: [{ id: "a", root: "./a" }] }));

  expectCode(() => resolveScope(inv, "missing"), "scope-not-found");
});

test("resolveScope rejects a root removed after inventory load", () => {
  const ws = workspace();
  const root = dir(join(ws, "gone-later"));
  const inv = loadInventory(writeConfig(ws, { format: "mozak.local/v2", scopes: [{ id: "later", root: "./gone-later" }] }));
  assert.equal(resolveScope(inv, "later").root, realpathSync(root));

  rmSync(root, { recursive: true, force: true });

  expectCode(() => resolveScope(inv, "later"), "scope-root-missing");
});

test("resolveScope rejects a root whose canonical identity changed after inventory load", () => {
  const ws = workspace();
  const root = dir(join(ws, "swapped"));
  const other = dir(join(ws, "other-real"));
  const inv = loadInventory(writeConfig(ws, { format: "mozak.local/v2", scopes: [{ id: "swap", root: "./swapped" }] }));
  assert.equal(resolveScope(inv, "swap").root, realpathSync(root));

  rmSync(root, { recursive: true, force: true });
  symlinkSync(other, root, "dir");

  expectCode(() => resolveScope(inv, "swap"), "scope-root-identity-changed");
});

test("resolveScope rejects a root that is a regular file", () => {
  const ws = workspace();
  writeFileSync(join(ws, "plain-file"), "not a directory");
  const inv = loadInventory(writeConfig(ws, { format: "mozak.local/v2", scopes: [{ id: "file", root: "./plain-file" }] }));

  expectCode(() => resolveScope(inv, "file"), "scope-root-not-directory");
});

test("assertScopeFiles accepts a root with no scope files and writes nothing", () => {
  const root = dir(join(workspace(), "empty-scope"));
  const before = listing(root);

  assert.doesNotThrow(() => assertScopeFiles(root));

  assert.deepEqual(listing(root), before);
  assert.equal(existsSync(join(root, "MOZAK.json")), false);
});

test("assertScopeFiles accepts regular graph and bridge files and a lock directory", () => {
  const root = dir(join(workspace(), "populated-scope"));
  writeFileSync(join(root, "MOZAK.json"), "{}\n");
  writeFileSync(join(root, "MOZAK.md"), "# bridge\n");
  dir(join(root, ".mozak-write-lock"));
  const before = listing(root);

  assert.doesNotThrow(() => assertScopeFiles(root));

  assert.deepEqual(listing(root), before);
});

test("assertScopeFiles rejects symlinked graph, bridge, or lock paths", () => {
  const ws = workspace();
  const cases: Array<[string, "file" | "dir"]> = [
    ["MOZAK.json", "file"],
    ["MOZAK.md", "file"],
    [".mozak-write-lock", "dir"],
  ];
  for (const [name, kind] of cases) {
    const root = dir(join(ws, `link-${name.replace(/\W+/g, "")}`));
    const target = join(ws, `target-${name.replace(/\W+/g, "")}`);
    if (kind === "dir") dir(target);
    else writeFileSync(target, "elsewhere\n");
    symlinkSync(target, join(root, name), kind);

    expectCode(() => assertScopeFiles(root), "scope-symlink-forbidden");
  }
});

test("assertScopeFiles rejects a directory used as the graph or bridge file", () => {
  const ws = workspace();
  for (const name of ["MOZAK.json", "MOZAK.md"]) {
    const root = dir(join(ws, `dir-as-${name.replace(/\W+/g, "")}`));
    dir(join(root, name));

    expectCode(() => assertScopeFiles(root), "scope-file-not-regular");
  }
});

test("assertScopeFiles rejects a regular file used as the write lock", () => {
  const root = dir(join(workspace(), "file-as-lock"));
  writeFileSync(join(root, ".mozak-write-lock"), "not a directory\n");

  expectCode(() => assertScopeFiles(root), "scope-lock-not-directory");
});
