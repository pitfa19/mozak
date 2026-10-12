import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { inspectSpecification, readSpecification, MAX_SPECIFICATION_BYTES } from "../src/spec-file.ts";

const scratch = process.env.JCODE_SCRATCH_DIR ?? tmpdir();
const roots: string[] = [];
after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

/** A fresh scope root plus a sibling outside directory, both real temporary directories. */
function world() {
  const base = mkdtempSync(join(scratch, "mozak-spec-"));
  roots.push(base);
  const root = join(base, "scope");
  const outside = join(base, "outside");
  mkdirSync(root);
  mkdirSync(outside);
  return { base, root, outside };
}

function expectError(fn: () => unknown, code: string, exitCode: number) {
  assert.throws(fn, (e: unknown) => {
    const err = e as { name?: string; code?: string; exitCode?: number };
    return err.name === "DomainError" && err.code === code && err.exitCode === exitCode;
  });
}

test("returns raw-byte SHA-256, byte length and decoded content for a Markdown spec", () => {
  const { root } = world();
  const bytes = Buffer.from("# Spec\r\n\r\nCRLF line endings and café.\n", "utf8");
  writeFileSync(join(root, "spec.md"), bytes);
  const result = inspectSpecification(root, "spec.md");
  assert.deepEqual(Object.keys(result).sort(), ["byteLength", "content", "path", "sha256"]);
  assert.equal(result.path, "spec.md");
  assert.equal(result.sha256, sha(bytes));
  assert.equal(result.byteLength, bytes.length);
  assert.equal(result.content, bytes.toString("utf8"));
});

test("hashes the actual bytes, so a byte order mark and CRLF are not normalised away", () => {
  const { root } = world();
  const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("a\r\nb\r\n")]);
  writeFileSync(join(root, "bom.markdown"), bytes);
  const result = inspectSpecification(root, "bom.markdown");
  assert.equal(result.sha256, sha(bytes));
  assert.equal(result.byteLength, 9); // 3-byte BOM plus 6 bytes of CRLF text
  assert.equal(result.content.charCodeAt(0), 0xfeff);
  assert.equal(result.content.slice(1), "a\r\nb\r\n");
});

test("accepts nested .md and .markdown paths and accepts the exact 256 KiB limit", () => {
  const { root } = world();
  mkdirSync(join(root, "docs"));
  mkdirSync(join(root, "docs", "deep"));
  writeFileSync(join(root, "docs", "deep", "plan.markdown"), "x");
  assert.equal(inspectSpecification(root, "docs/deep/plan.markdown").byteLength, 1);
  const max = Buffer.alloc(MAX_SPECIFICATION_BYTES, "a");
  writeFileSync(join(root, "max.md"), max);
  const result = inspectSpecification(root, "max.md");
  assert.equal(result.byteLength, MAX_SPECIFICATION_BYTES);
  assert.equal(result.sha256, sha(max));
});

test("same bytes give the same digest and changed bytes give a different digest", () => {
  const { root } = world();
  writeFileSync(join(root, "a.md"), "same\n");
  const first = inspectSpecification(root, "a.md");
  const again = inspectSpecification(root, "a.md");
  assert.equal(again.sha256, first.sha256);
  writeFileSync(join(root, "a.md"), "same!\n");
  assert.notEqual(inspectSpecification(root, "a.md").sha256, first.sha256);
});

test("refuses malformed UTF-8 as unavailable-spec", () => {
  const { root } = world();
  writeFileSync(join(root, "bad.md"), Buffer.from([0x23, 0x20, 0xff, 0xfe, 0x0a]));
  expectError(() => inspectSpecification(root, "bad.md"), "unavailable-spec", 2);
});

test("refuses a file one byte over 256 KiB as unavailable-spec", () => {
  const { root } = world();
  writeFileSync(join(root, "big.md"), Buffer.alloc(MAX_SPECIFICATION_BYTES + 1, "a"));
  expectError(() => inspectSpecification(root, "big.md"), "unavailable-spec", 2);
});

test("reports a missing spec as unavailable-spec, including a missing directory component", () => {
  const { root } = world();
  expectError(() => inspectSpecification(root, "absent.md"), "unavailable-spec", 2);
  expectError(() => inspectSpecification(root, "nodir/absent.md"), "unavailable-spec", 2);
});

test("refuses a missing or non-directory scope root as unavailable-spec", () => {
  const { base, root } = world();
  expectError(() => inspectSpecification(join(base, "nope"), "spec.md"), "unavailable-spec", 2);
  writeFileSync(join(root, "file-not-dir"), "x");
  expectError(() => inspectSpecification(join(root, "file-not-dir"), "spec.md"), "unavailable-spec", 2);
});

test("refuses absolute, traversing, NUL, backslash and malformed relative paths as invalid-input", () => {
  const { root, base } = world();
  writeFileSync(join(base, "secret.md"), "outside root\n");
  const bad: unknown[] = [
    "",
    "/etc/passwd.md",
    "/abs/spec.md",
    "C:/spec.md",
    "../secret.md",
    "a/../../secret.md",
    "./spec.md",
    "a/./spec.md",
    "a//spec.md",
    "dir/",
    "a\\spec.md",
    "spec\0.md",
    "spec.txt",
    "spec",
    ".md",
    "spec.MD",
    "x".repeat(1025) + ".md",
    42,
    null,
  ];
  for (const path of bad) {
    expectError(() => inspectSpecification(root, path as string), "invalid-input", 2);
  }
});

test("refuses a symlink as the final component, even one pointing at a valid spec", () => {
  const { root, outside } = world();
  writeFileSync(join(root, "real.md"), "real\n");
  symlinkSync(join(root, "real.md"), join(root, "link.md"));
  expectError(() => inspectSpecification(root, "link.md"), "invalid-input", 2);
  writeFileSync(join(outside, "elsewhere.md"), "outside\n");
  symlinkSync(join(outside, "elsewhere.md"), join(root, "escape.md"));
  expectError(() => inspectSpecification(root, "escape.md"), "invalid-input", 2);
});

test("refuses a symlink in any directory component, including one that escapes the root", () => {
  const { root, outside } = world();
  mkdirSync(join(root, "real"));
  writeFileSync(join(root, "real", "spec.md"), "inside\n");
  symlinkSync(join(root, "real"), join(root, "alias"));
  expectError(() => inspectSpecification(root, "alias/spec.md"), "invalid-input", 2);
  writeFileSync(join(outside, "spec.md"), "outside\n");
  symlinkSync(outside, join(root, "out"));
  expectError(() => inspectSpecification(root, "out/spec.md"), "invalid-input", 2);
  mkdirSync(join(root, "a"));
  mkdirSync(join(root, "a", "b"));
  symlinkSync(join(root, "real"), join(root, "a", "b", "via"));
  expectError(() => inspectSpecification(root, "a/b/via/spec.md"), "invalid-input", 2);
});

test("refuses a directory where the spec file should be, as unavailable-spec", () => {
  const { root } = world();
  mkdirSync(join(root, "folder.md"));
  expectError(() => inspectSpecification(root, "folder.md"), "unavailable-spec", 2);
});

test("special files are refused without hanging, even when a FIFO sits at the path", (t) => {
  const { root } = world();
  const fifo = join(root, "pipe.md");
  const made = spawnSync("mkfifo", [fifo]);
  if (made.status !== 0) { t.skip("mkfifo unavailable on this host"); return; }
  // Run in a child with a hard timeout so a regression that blocks on the FIFO cannot hang the suite.
  const moduleUrl = new URL("../src/spec-file.ts", import.meta.url).href;
  const script = `import(${JSON.stringify(moduleUrl)}).then(m => {
    try { m.inspectSpecification(${JSON.stringify(root)}, "pipe.md"); console.log("ok"); }
    catch (e) { console.log(JSON.stringify({ code: e.code, exitCode: e.exitCode })); }
  })`;
  const child = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "-e", script], { timeout: 10_000, encoding: "utf8" });
  assert.equal(child.error, undefined, "inspection must not block on a FIFO");
  assert.equal(child.signal, null);
  assert.deepEqual(JSON.parse(child.stdout.trim()), { code: "unavailable-spec", exitCode: 2 });
});

test("a file that changes size during the read is refused as stale-reference", () => {
  const { root } = world();
  const path = join(root, "grow.md");
  writeFileSync(path, "short\n");
  expectError(() => readSpecification(root, "grow.md", {
    afterRead: () => writeFileSync(path, "much longer content than before\n"),
  }), "stale-reference", 3);
});

test("a same-length in-place rewrite during the read is refused as stale-reference", () => {
  const { root } = world();
  const path = join(root, "inplace.md");
  writeFileSync(path, "aaaa\n");
  utimesSync(path, 1_000_000, 1_000_000); // fixed past mtime so the rewrite is observable
  expectError(() => readSpecification(root, "inplace.md", {
    afterRead: () => writeFileSync(path, "bbbb\n"),
  }), "stale-reference", 3);
});

test("a file replaced by an identical-byte file during the read is refused as stale-reference", () => {
  const { root } = world();
  const path = join(root, "swap.md");
  writeFileSync(path, "same bytes\n");
  writeFileSync(join(root, "replacement.tmp"), "same bytes\n");
  expectError(() => readSpecification(root, "swap.md", {
    afterRead: () => renameSync(join(root, "replacement.tmp"), path),
  }), "stale-reference", 3);
});

test("a file replaced by a symlink during the read is refused as stale-reference", () => {
  const { root, outside } = world();
  const path = join(root, "turn.md");
  writeFileSync(path, "inside\n");
  writeFileSync(join(outside, "target.md"), "outside\n");
  expectError(() => readSpecification(root, "turn.md", {
    afterRead: () => {
      rmSync(path);
      symlinkSync(join(outside, "target.md"), path);
    },
  }), "stale-reference", 3);
});

test("a parent directory replaced during the read is refused as stale-reference", () => {
  const { root } = world();
  mkdirSync(join(root, "dir"));
  writeFileSync(join(root, "dir", "spec.md"), "one\n");
  mkdirSync(join(root, "dir-new"));
  writeFileSync(join(root, "dir-new", "spec.md"), "one\n");
  expectError(() => readSpecification(root, "dir/spec.md", {
    afterRead: () => {
      renameSync(join(root, "dir"), join(root, "dir-old"));
      renameSync(join(root, "dir-new"), join(root, "dir"));
    },
  }), "stale-reference", 3);
});

test("a file removed during the read is refused as stale-reference", () => {
  const { root } = world();
  const path = join(root, "gone.md");
  writeFileSync(path, "bytes\n");
  expectError(() => readSpecification(root, "gone.md", {
    afterRead: () => rmSync(path),
  }), "stale-reference", 3);
});

test("a changed-during-read file is never returned, even when the final bytes look valid", () => {
  const { root } = world();
  const path = join(root, "late.md");
  writeFileSync(path, "first\n");
  let result: unknown;
  try {
    result = readSpecification(root, "late.md", { afterRead: () => writeFileSync(path, "second!\n") });
  } catch (e) {
    assert.equal((e as { code?: string }).code, "stale-reference");
    return;
  }
  assert.fail(`expected stale-reference, got ${JSON.stringify(result)}`);
});

test("hook-free reads of an unchanged file match the bytes on disk exactly", () => {
  const { root } = world();
  const bytes = Buffer.from("stable\n", "utf8");
  writeFileSync(join(root, "stable.md"), bytes);
  const expected = readFileSync(join(root, "stable.md"));
  const first = readSpecification(root, "stable.md", {});
  assert.equal(first.sha256, sha(expected));
  assert.equal(first.byteLength, expected.length);
});

test("accepts an absolute scope root and resolves relative spec paths beneath it", () => {
  const { root } = world();
  writeFileSync(join(root, "rel.md"), "x\n");
  const result = inspectSpecification(resolve(root), "rel.md");
  assert.equal(result.byteLength, 2);
});

test("refuses a symlinked scope root instead of following it", () => {
  const { root, base } = world();
  writeFileSync(join(root, "spec.md"), "inside\n");
  const link = join(base, "root-link");
  symlinkSync(root, link);
  expectError(() => inspectSpecification(link, "spec.md"), "invalid-input", 2);
});

test("a raw filesystem error during the read becomes unavailable-spec, not a raw errno", (t) => {
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    t.skip("root ignores file permission bits");
    return;
  }
  const { root } = world();
  const path = join(root, "locked.md");
  writeFileSync(path, "secret\n");
  chmodSync(path, 0o000);
  try {
    expectError(() => inspectSpecification(root, "locked.md"), "unavailable-spec", 2);
  } finally {
    chmodSync(path, 0o600);
  }
});

test("a metadata-only change during the read is refused, via the descriptor ctime comparison", (t) => {
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    t.skip("chmod change check is exercised the same way; skipped only to keep root runs consistent");
    return;
  }
  const { root } = world();
  const path = join(root, "meta.md");
  writeFileSync(path, "same bytes\n");
  expectError(() => readSpecification(root, "meta.md", {
    afterRead: () => chmodSync(path, 0o640),
  }), "stale-reference", 3);
});

test("a same-inode metadata change between lstat and open is refused as stale-reference", (t) => {
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    t.skip("chmod change check skipped as root to keep runs consistent");
    return;
  }
  const { root } = world();
  const path = join(root, "pre-open.md");
  writeFileSync(path, "same inode\n");
  expectError(() => readSpecification(root, "pre-open.md", {
    beforeOpen: () => chmodSync(path, 0o640),
  }), "stale-reference", 3);
});

test("an exception thrown by the test hook propagates unchanged, not as a spec error", () => {
  const { root } = world();
  writeFileSync(join(root, "hook.md"), "x\n");
  const boom = new Error("hook programmer failure");
  assert.throws(() => readSpecification(root, "hook.md", { afterRead: () => { throw boom; } }), (e: unknown) => e === boom);
});
