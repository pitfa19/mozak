import { test } from "node:test";
import assert from "node:assert/strict";
import { reviseWarnings } from "../src/assist.ts";

const trace = (authorized = false) => ({
  outcomes: [{ id: "o1", acceptance: "owner", status: "done" }, { id: "o2", acceptance: "objective", status: "done" }, { id: "o3", acceptance: "objective", status: "todo" }],
  implementationAuthorized: authorized, acceptedId: "rev-1", permittedNextAction: "none", hasCandidate: false,
});

test("reviseWarnings lists done outcomes that will not carry forward", () => {
  const all = reviseWarnings("s", "p", trace());
  assert.deepEqual(all.map((w) => w.code), ["outcome-reacceptance-needed", "outcome-relink-needed"]);
  assert.match(all[0].command!, /--purpose accept-outcome --outcome o1/);
  assert.match(all[1].message, /outcome o2 is done on revision rev-1/);
});

test("reviseWarnings skips unchanged outcomes, which carry forward on approval", () => {
  assert.deepEqual(reviseWarnings("s", "p", trace(), new Set(["o1", "o2"])), []);
  assert.deepEqual(reviseWarnings("s", "p", trace(), new Set(["o1"])).map((w) => w.message.slice(0, 10)), ["outcome o2"]);
});

test("reviseWarnings still warns that an implementation grant ends", () => {
  assert.deepEqual(reviseWarnings("s", "p", trace(true), new Set(["o1", "o2"])).map((w) => w.code), ["implementation-reapproval-needed"]);
  assert.deepEqual(reviseWarnings("s", "p", null), []);
});
