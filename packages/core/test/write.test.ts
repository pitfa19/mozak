import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { guardedWrite, hashText, readSnapshot, StaleWriteError, updateFile } from "../src/index.ts";

const child = fileURLToPath(new URL("./writer-child.ts", import.meta.url));
const fresh = () => join(mkdtempSync(join(tmpdir(), "mozak-w-")), "MOZAK.md");

test("a write with the current base hash succeeds", () => {
  const f = fresh();
  writeFileSync(f, "a\n");
  const snap = readSnapshot(f);
  const h = guardedWrite(f, "b\n", snap.hash);
  assert.equal(readFileSync(f, "utf8"), "b\n");
  assert.equal(h, hashText("b\n"));
});

test("a stale write is refused and changes nothing", () => {
  const f = fresh();
  writeFileSync(f, "base\n");
  const a = readSnapshot(f);
  const b = readSnapshot(f);
  guardedWrite(f, "from B\n", b.hash);
  assert.throws(() => guardedWrite(f, "from A\n", a.hash), StaleWriteError);
  assert.equal(readFileSync(f, "utf8"), "from B\n");
});

test("a missing file can be created with the empty hash and no temp or lock files remain", () => {
  const f = fresh();
  guardedWrite(f, "new\n", readSnapshot(f).hash);
  assert.equal(readFileSync(f, "utf8"), "new\n");
  assert.deepEqual(readdirSync(join(f, "..")), ["MOZAK.md"]);
});

test("updateFile re-runs the transform on fresh content after a stale refusal", () => {
  const f = fresh();
  writeFileSync(f, "start\n");
  let first = true;
  updateFile(f, (t) => {
    if (first) {
      first = false;
      writeFileSync(f, t + "interloper\n"); // someone else sneaks in between read and write
    }
    return t + "mine\n";
  });
  assert.equal(readFileSync(f, "utf8"), "start\ninterloper\nmine\n");
});

test("an abandoned lock is broken after it goes stale", () => {
  const f = fresh();
  writeFileSync(f, "x\n");
  writeFileSync(`${f}.lock`, "99999\n");
  const old = new Date(Date.now() - 60_000);
  utimesSync(`${f}.lock`, old, old);
  guardedWrite(f, "y\n", readSnapshot(f).hash, { staleMs: 1000 });
  assert.equal(readFileSync(f, "utf8"), "y\n");
});

test("a live lock makes a writer time out instead of overwriting", () => {
  const f = fresh();
  writeFileSync(f, "x\n");
  writeFileSync(`${f}.lock`, "1\n");
  assert.throws(() => guardedWrite(f, "y\n", readSnapshot(f).hash, { timeoutMs: 100 }), { code: "lock-timeout" });
  assert.equal(readFileSync(f, "utf8"), "x\n");
});

test("three real processes appending concurrently lose no update", async () => {
  const f = fresh();
  writeFileSync(f, "");
  const per = 40;
  const tags = ["agent-a", "agent-b", "agent-c"];
  await Promise.all(
    tags.map(
      (tag) =>
        new Promise<void>((resolve, reject) => {
          const p = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", child, f, tag, String(per)], { stdio: "inherit" });
          p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${tag} exited ${code}`))));
        }),
    ),
  );
  const lines = readFileSync(f, "utf8").trim().split("\n");
  assert.equal(lines.length, per * tags.length);
  assert.equal(new Set(lines).size, lines.length, "no duplicate lines");
  for (const tag of tags) {
    const mine = lines.filter((l) => l.startsWith(tag)).map((l) => Number(l.split("-").pop()));
    assert.deepEqual(mine, [...mine].sort((x, y) => x - y), `${tag} wrote in order`);
    assert.equal(mine.length, per);
  }
  assert.equal(existsSync(`${f}.lock`), false);
});
