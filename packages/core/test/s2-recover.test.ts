// S2 recover: owner.json records host; the owner route clears a lock from another host or a dead local pid.
// Synthetic temp scopes only. Never run against a real inventory.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { cleanup, world, NOW } from "./annotations-fixture.ts";
import { executeOperation } from "../src/api.ts";
import { inspectLock, recoverLock } from "../src/lock-recover.ts";
import { mutateScope, readScope } from "../src/scope-store.ts";

after(cleanup);

const lockDir = (root: string) => join(root, ".mozak-write-lock");
function plantLock(root: string, owner: Record<string, unknown>) {
  mkdirSync(lockDir(root));
  writeFileSync(join(lockDir(root), "owner.json"), JSON.stringify(owner));
}
/** A pid that certainly belonged to a process on this host and has exited. */
function deadPid(): number {
  const r = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" });
  return Number(r.stdout);
}
const request = (scopeId: string, lock: { token: string; host: string; pid: number }, requestId = "recover-1") =>
  ({ requestId, scopeId, lock, ownerRef: "synthetic:owner-recover", ownerMessageAt: NOW });

test("owner.json records the host while a write holds the lock", () => {
  const w = world();
  let seen: Record<string, unknown> | null = null;
  const e = w.entries.alpha;
  mutateScope(e, { operationId: "p1", scopeId: "alpha", expected: readScope(e).snapshot, action: "propose", payload: { planId: "p", content: { constraints: [], nonGoals: [], outcomes: [{ acceptance: "objective", criterion: "c", id: "o", statement: "s" }], purpose: "p", questions: [], rationale: "r", sources: [], title: "t" } } }, "agent", {
    onPhase(phase) { if (phase === "after-lock") seen = JSON.parse(readFileSync(join(lockDir(e.root), "owner.json"), "utf8")); },
  });
  assert.ok(seen);
  assert.equal(seen!.host, hostname());
  assert.equal(seen!.pid, process.pid);
  assert.equal(existsSync(lockDir(e.root)), false);
});

test("recover clears a lock that names another host, and writes work again", () => {
  const w = world();
  const e = w.entries.alpha;
  const lock = { token: "tok-other", host: "synthetic-other-host", pid: process.pid };
  plantLock(e.root, { ...lock, processStartHint: NOW, acquiredAt: NOW });
  const before = readFileSync(join(e.root, "mozak.json"));
  const blocked = executeOperation(w.inv(), "propose", { scope: "alpha", request: { operationId: "x1", scopeId: "alpha", expected: readScope(e).snapshot, action: "propose", payload: {} } }, "agent");
  assert.notEqual(blocked.exitCode, 0);
  const check = executeOperation(w.inv(), "check", { scope: "alpha" }, "agent");
  const finding = (check.data.issues as { code: string; lock?: { verdict: string; token: string } }[]).find((i) => i.code === "write-lock-stuck");
  assert.equal(finding?.lock?.verdict, "other-host");
  assert.equal(finding?.lock?.token, "tok-other");
  assert.equal(check.exitCode, 3);
  // Agents can never recover.
  const agent = executeOperation(w.inv(), "recover", { scope: "alpha", request: request("alpha", lock) }, "agent");
  assert.equal(agent.data.status, "not-permitted");
  assert.equal(existsSync(lockDir(e.root)), true);
  const out = executeOperation(w.inv(), "recover", { scope: "alpha", request: request("alpha", lock) }, "owner");
  assert.equal(out.exitCode, 0, JSON.stringify(out.data));
  assert.equal(out.data.status, "ok");
  assert.equal(out.data.reason, "other-host");
  assert.equal(existsSync(lockDir(e.root)), false);
  assert.deepEqual(readFileSync(join(e.root, "mozak.json")), before, "recover never touches mozak.json");
  assert.equal(readdirSync(e.root).some((n) => n.startsWith(".mozak-write-lock")), false);
  // Running the same request again is harmless.
  assert.equal(executeOperation(w.inv(), "recover", { scope: "alpha", request: request("alpha", lock) }, "owner").data.status, "already-clear");
  w.propose("alpha", "after-recover");
  assert.equal(executeOperation(w.inv(), "check", { scope: "alpha" }, "agent").exitCode, 0);
});

test("recover clears a lock from a dead local pid but refuses a live local pid", () => {
  const w = world();
  const e = w.entries.alpha;
  const dead = { token: "tok-dead", host: hostname(), pid: deadPid() };
  plantLock(e.root, { ...dead, processStartHint: NOW, acquiredAt: NOW });
  assert.equal(inspectLock(e.root).verdict, "dead-local-pid");
  const ok = recoverLock(e, request("alpha", dead));
  assert.equal(ok.status, "ok");
  assert.equal(ok.reason, "dead-local-pid");
  assert.equal(existsSync(lockDir(e.root)), false);

  const live = { token: "tok-live", host: hostname(), pid: process.pid };
  plantLock(e.root, { ...live, processStartHint: NOW, acquiredAt: NOW });
  const refused = executeOperation(w.inv(), "recover", { scope: "alpha", request: request("alpha", live) }, "owner");
  assert.equal(refused.data.status, "lock-owner-alive");
  assert.equal(refused.exitCode, 4);
  assert.equal(existsSync(join(lockDir(e.root), "owner.json")), true);
  // A live local holder is informational in check, not a finding.
  const check = executeOperation(w.inv(), "check", { scope: "alpha" }, "agent");
  assert.equal((check.data.issues as { code: string }[]).some((i) => i.code === "write-lock-held"), true);
  assert.equal((check.data.issues as { code: string }[]).some((i) => i.code === "write-lock-stuck"), false);
});

test("recover refuses a changed lock, extra contents, a hostless lock and malformed requests", () => {
  const w = world();
  const e = w.entries.alpha;
  const lock = { token: "tok-a", host: "synthetic-other-host", pid: 4242 };
  plantLock(e.root, { ...lock, processStartHint: NOW, acquiredAt: NOW });
  const run = (r: unknown) => executeOperation(w.inv(), "recover", { scope: "alpha", request: r }, "owner");
  assert.equal(run(request("alpha", { ...lock, token: "tok-b" })).data.status, "lock-changed");
  assert.equal(run(request("alpha", { ...lock, host: "elsewhere" })).data.status, "lock-changed");
  assert.equal(run(request("beta", lock)).data.status, "scope-mismatch");
  assert.equal(run({ ...request("alpha", lock), extra: 1 }).data.status, "invalid-input");
  assert.equal(run({ requestId: "r", scopeId: "alpha", lock: { token: "tok-a", host: "h" }, ownerRef: "o", ownerMessageAt: NOW }).data.status, "invalid-input");
  writeFileSync(join(lockDir(e.root), "unexpected.txt"), "keep\n");
  assert.equal(run(request("alpha", lock)).data.status, "lock-unexpected-contents");
  assert.equal(readFileSync(join(lockDir(e.root), "unexpected.txt"), "utf8"), "keep\n");

  const w2 = world();
  const e2 = w2.entries.alpha;
  plantLock(e2.root, { token: "tok-old", pid: 4242, processStartHint: NOW, acquiredAt: NOW });
  const old = executeOperation(w2.inv(), "recover", { scope: "alpha", request: request("alpha", { token: "tok-old", host: "x", pid: 4242 }) }, "owner");
  assert.equal(old.data.status, "lock-changed", "a hostless lock never matches a named host");
  assert.equal(inspectLock(e2.root).verdict, "host-unknown");
  assert.equal(existsSync(lockDir(e2.root)), true);
});

test("recover restores the lock untouched if it was replaced between inspection and rename", () => {
  const w = world();
  const e = w.entries.alpha;
  const lock = { token: "tok-first", host: "synthetic-other-host", pid: 7 };
  plantLock(e.root, { ...lock, processStartHint: NOW, acquiredAt: NOW });
  let calls = 0;
  // The probe runs at the end of the first inspection: the owner file is swapped before the rename.
  const probe = {
    hostname: () => {
      calls++;
      if (calls === 1) writeFileSync(join(lockDir(e.root), "owner.json"), JSON.stringify({ token: "tok-second", host: "synthetic-other-host", pid: 7 }));
      return hostname();
    },
  };
  assert.throws(() => recoverLock(e, request("alpha", lock), probe), { code: "lock-changed" });
  assert.equal(JSON.parse(readFileSync(join(lockDir(e.root), "owner.json"), "utf8")).token, "tok-second");
});
