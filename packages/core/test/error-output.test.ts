// Gaps 2 and 3: an error result names the reason before any echoed request, so truncated output still shows it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DomainError } from "../src/errors.ts";
import { errorOutput } from "../src/api.ts";

test("errorOutput puts status and issues first and the unsaved observe request last", () => {
  const request = { operationId: "op-1", scopeId: "alpha", action: "observe", payload: { planId: "p1", observations: ["x".repeat(5000)] } };
  const out = errorOutput(new DomainError("invalid-payload", "payload has unknown field \"observations\"", 2), "observe", { scope: "alpha", request });
  const keys = Object.keys(out.data);
  assert.deepEqual(keys.slice(0, 2), ["status", "issues"]);
  assert.equal(keys.at(-1), "unsavedRequest");
  const text = JSON.stringify(out.data, null, 2);
  assert.ok(text.indexOf("payload has unknown field") < 300);
  assert.ok(text.indexOf("payload has unknown field") < text.indexOf("unsavedRequest"));
  assert.deepEqual((out.data as { unsavedRequest: unknown }).unsavedRequest, request);
});
