import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  cachedUpdateNotice, compareVersions, highestRelease, installedVersion, parseVersion, readUpdateCache,
  refreshUpdateCacheIfStale, setUpdateChecker, updateCachePath, UPDATE_FAILURE_TTL_MS, UPDATE_TTL_MS,
} from "../src/update.ts";

const scratch = () => mkdtempSync(join(process.env.JCODE_SCRATCH_DIR || tmpdir(), "mozak-update-"));
const HOUR = 60 * 60 * 1000;

test("versions: releases parse, compare numerically, and other tags are ignored", () => {
  assert.deepEqual(parseVersion("v0.10.2"), [0, 10, 2]);
  assert.equal(parseVersion("0.2.0-rc.1"), null);
  assert.equal(parseVersion("01.2.3"), null);
  assert.equal(compareVersions("0.10.0", "0.9.9"), 1);
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
  assert.equal(highestRelease(["v0.2.0", "v0.10.0", "v0.9.1", "latest", "v1.0.0-beta", "0.99.0"]), "0.10.0");
  assert.equal(highestRelease([]), null);
});

test("cache path honours XDG_STATE_HOME, else ~/.local/state", () => {
  assert.equal(updateCachePath({ HOME: "/h" }), "/h/.local/state/mozak/update.json");
  assert.equal(updateCachePath({ HOME: "/h", XDG_STATE_HOME: "/s" }), "/s/mozak/update.json");
  assert.equal(updateCachePath({ HOME: "/h", XDG_STATE_HOME: "relative" }), "/h/.local/state/mozak/update.json", "relative XDG paths are ignored");
});

test("a stale cache refreshes, a fresh one does not, and the notice shows only for a newer release", () => {
  const path = join(scratch(), "state", "update.json");
  let calls = 0;
  const restore = setUpdateChecker(() => { calls++; return "v0.3.0"; });
  try {
    const t0 = new Date("2026-10-18T00:00:00Z");
    assert.equal(cachedUpdateNotice("0.2.0", { path, env: {} }), null, "no cache, no notice");
    assert.equal(refreshUpdateCacheIfStale({ path, env: {}, now: t0 }), "started");
    assert.equal(calls, 1);
    assert.deepEqual(readUpdateCache(path), { format: "mozak.update/v1", checkedAt: t0.toISOString(), latest: "0.3.0", ok: true });
    assert.deepEqual(cachedUpdateNotice("0.2.0", { path, env: {} }), { installed: "0.2.0", latest: "0.3.0", command: "mozak upgrade" });
    assert.equal(cachedUpdateNotice("0.3.0", { path, env: {} }), null, "same version: no notice");
    assert.equal(cachedUpdateNotice("0.4.0", { path, env: {} }), null, "newer installed: no notice");

    assert.equal(refreshUpdateCacheIfStale({ path, env: {}, now: new Date(t0.getTime() + UPDATE_TTL_MS - 1) }), "fresh");
    assert.equal(calls, 1, "within 24 hours nothing is checked");
    assert.equal(refreshUpdateCacheIfStale({ path, env: {}, now: new Date(t0.getTime() + UPDATE_TTL_MS) }), "started");
    assert.equal(calls, 2, "after 24 hours it checks again");
  } finally {
    restore();
  }
});

test("offline: a failure is cached for an hour, keeps the last known answer, and never throws", () => {
  const path = join(scratch(), "update.json");
  const t0 = new Date("2026-10-18T00:00:00Z");
  let restore = setUpdateChecker(() => "0.3.0");
  refreshUpdateCacheIfStale({ path, env: {}, now: t0 });
  restore();
  let calls = 0;
  restore = setUpdateChecker(() => { calls++; throw new Error("offline"); });
  try {
    const t1 = new Date(t0.getTime() + UPDATE_TTL_MS + 1);
    assert.equal(refreshUpdateCacheIfStale({ path, env: {}, now: t1 }), "started");
    const c = readUpdateCache(path)!;
    assert.equal(c.ok, false);
    assert.equal(c.latest, "0.3.0", "a failed check keeps the last known answer");
    assert.equal(refreshUpdateCacheIfStale({ path, env: {}, now: new Date(t1.getTime() + UPDATE_FAILURE_TTL_MS - 1) }), "fresh");
    assert.equal(calls, 1, "a failure is not retried within the hour");
    assert.equal(refreshUpdateCacheIfStale({ path, env: {}, now: new Date(t1.getTime() + UPDATE_FAILURE_TTL_MS) }), "started");
    assert.equal(calls, 2, "it retries after an hour");
  } finally {
    restore();
  }
  // A garbage answer is a failure, not a version.
  restore = setUpdateChecker(() => "not-a-version");
  try {
    refreshUpdateCacheIfStale({ path, env: {}, now: new Date(t0.getTime() + 10 * HOUR + UPDATE_TTL_MS) });
    assert.equal(readUpdateCache(path)!.ok, false);
  } finally {
    restore();
  }
});

test("MOZAK_NO_UPDATE_CHECK=1 disables checking and the notice", () => {
  const path = join(scratch(), "update.json");
  let calls = 0;
  const restore = setUpdateChecker(() => { calls++; return "9.9.9"; });
  try {
    assert.equal(refreshUpdateCacheIfStale({ path, env: { MOZAK_NO_UPDATE_CHECK: "1" } }), "disabled");
    assert.equal(calls, 0);
    refreshUpdateCacheIfStale({ path, env: {} });
    assert.ok(cachedUpdateNotice("0.2.0", { path, env: {} }));
    assert.equal(cachedUpdateNotice("0.2.0", { path, env: { MOZAK_NO_UPDATE_CHECK: "1" } }), null);
  } finally {
    restore();
  }
});

test("a corrupt or foreign cache file reads as no cache", () => {
  const dir = scratch();
  const path = join(dir, "update.json");
  writeFileSync(path, "{nope");
  assert.equal(readUpdateCache(path), null);
  writeFileSync(path, JSON.stringify({ format: "other", checkedAt: "2026-01-01T00:00:00Z", latest: "1.0.0", ok: true }));
  assert.equal(readUpdateCache(path), null);
  writeFileSync(path, JSON.stringify({ format: "mozak.update/v1", checkedAt: "2026-01-01T00:00:00Z", latest: "../../x", ok: true }));
  assert.equal(readUpdateCache(path), null);
});

test("installedVersion reads PREFIX/installation.json from an installed module path, and is null elsewhere", () => {
  const prefix = scratch();
  const dist = join(prefix, "node_modules", "@mozak", "core", "dist");
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(prefix, "installation.json"), JSON.stringify({ format: "mozak.installation/v1", version: "0.2.0", source: "/src/mozak" }));
  const url = pathToFileURL(join(dist, "update.js")).href;
  assert.deepEqual(installedVersion(url), { prefix, version: "0.2.0", source: "/src/mozak" });
  assert.equal(installedVersion(), null, "the source tree has no installation.json");
  assert.equal(installedVersion(undefined), null);
  void readFileSync;
});
