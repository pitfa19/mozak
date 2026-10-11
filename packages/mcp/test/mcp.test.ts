import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { handle, TOOLS } from "../src/server.ts";

function world() {
  const root = mkdtempSync(join(tmpdir(), "mozak-m-"));
  const mk = (rel: string, id: string, kind: string, links: string) => {
    const dir = join(root, rel);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "README.md"), "x\n");
    writeFileSync(join(dir, "AGENTS.md"), "x\n");
    writeFileSync(join(dir, "MOZAK.md"), `---\nid: ${id}\nkind: ${kind}\nformat: 1\n---\n\n## Plan\n\n- [ ] start\n\n## Links\n\n${links}\n\n## Translations\n`);
    return join(dir, "MOZAK.md");
  };
  const research = mk("vault/research", "research", "topic", "");
  const api = mk("repos/api", "api", "project", "- depends-on: [[research]]");
  return { cfg: { roots: [root] }, research, api, root };
}

const call = (cfg: { roots: string[] }, name: string, args: Record<string, unknown>) => {
  const r = handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, () => cfg) as {
    result: { content: { text: string }[]; isError?: boolean };
  };
  return { text: r.result.content[0].text, isError: r.result.isError === true };
};

test("tools/list exposes exactly the five tools, and only one of them writes", () => {
  const r = handle({ jsonrpc: "2.0", id: 1, method: "tools/list" }, () => ({ roots: [] })) as { result: { tools: { name: string }[] } };
  assert.deepEqual(r.result.tools.map((t) => t.name).sort(), ["mozak_check", "mozak_graph", "mozak_read", "mozak_set_plan", "mozak_translation_packet"]);
  assert.equal(TOOLS.filter((t) => /set_|write|link|translat.*apply/.test(t.name)).length, 1);
});

test("read then set_plan with the right hash writes the plan", () => {
  const w = world();
  const read = JSON.parse(call(w.cfg, "mozak_read", { scope: "research" }).text);
  const res = call(w.cfg, "mozak_set_plan", { scope: "research", plan: "- [ ] survey papers", base_hash: read.base_hash });
  assert.equal(res.isError, false);
  assert.match(readFileSync(w.research, "utf8"), /survey papers/);
});

test("a stale hash is refused with advice to re-read, and nothing changes", () => {
  const w = world();
  const first = JSON.parse(call(w.cfg, "mozak_read", { scope: "research" }).text);
  call(w.cfg, "mozak_set_plan", { scope: "research", plan: "- [ ] B was here", base_hash: first.base_hash });
  const stale = call(w.cfg, "mozak_set_plan", { scope: "research", plan: "- [ ] A overwrites", base_hash: first.base_hash });
  assert.equal(stale.isError, true);
  assert.match(stale.text, /stale/);
  assert.match(stale.text, /mozak_read/);
  assert.match(readFileSync(w.research, "utf8"), /B was here/);
  assert.doesNotMatch(readFileSync(w.research, "utf8"), /A overwrites/);
});

test("an agent cannot change Links or Translations through set_plan, even with a hostile plan", () => {
  const w = world();
  const before = readFileSync(w.api, "utf8");
  const read = JSON.parse(call(w.cfg, "mozak_read", { scope: "api" }).text);
  const evil = call(w.cfg, "mozak_set_plan", { scope: "api", plan: "ok\n## Links\n- depends-on: https://evil.example", base_hash: read.base_hash });
  assert.equal(evil.isError, true);
  assert.equal(readFileSync(w.api, "utf8"), before, "file unchanged after the attack");
  const fine = call(w.cfg, "mozak_set_plan", { scope: "api", plan: "- [ ] legit", base_hash: read.base_hash });
  assert.equal(fine.isError, false);
  assert.match(readFileSync(w.api, "utf8"), /- depends-on: \[\[research\]\]/, "links survived a legitimate plan write");
});

test("unknown scope and missing arguments return errors, not crashes", () => {
  const w = world();
  assert.equal(call(w.cfg, "mozak_read", { scope: "nope" }).isError, true);
  assert.equal(call(w.cfg, "mozak_read", {}).isError, true);
  const r = handle({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "nope", arguments: {} } }, () => w.cfg) as { error: { code: number } };
  assert.equal(r.error.code, -32602);
});

test("graph, check and packet work through the tool layer", () => {
  const w = world();
  assert.match(call(w.cfg, "mozak_graph", {}).text, /api \(project\)\n  depends-on -> research/);
  assert.equal(call(w.cfg, "mozak_check", { scope: "api" }).text, "ok");
  const p = JSON.parse(call(w.cfg, "mozak_translation_packet", { idea: "i", from: "research", to: "api", assumptions: ["a"] }).text);
  assert.deepEqual(p.related, ["api depends-on research"]);
  assert.equal(readFileSync(w.api, "utf8").includes("[open] a"), false, "packet is read only");
});

test("real stdio session: initialize, list, call, and a notification gets no reply", async () => {
  const w = world();
  const cfgPath = join(w.root, "config.json");
  writeFileSync(cfgPath, JSON.stringify(w.cfg));
  const entry = fileURLToPath(new URL("../src/index.ts", import.meta.url));
  const p = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", entry], { env: { ...process.env, MOZAK_CONFIG: cfgPath } });
  const lines: string[] = [];
  let buf = "";
  p.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      lines.push(buf.slice(0, i));
      buf = buf.slice(i + 1);
    }
  });
  const send = (o: unknown) => p.stdin.write(JSON.stringify(o) + "\n");
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "mozak_graph", arguments: {} } });
  const deadline = Date.now() + 5000;
  while (lines.length < 3 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
  p.kill();
  assert.equal(lines.length, 3, "three replies: the notification must not get one");
  const [init, list, graph] = lines.map((l) => JSON.parse(l));
  assert.equal(init.result.serverInfo.name, "mozak");
  assert.equal(list.result.tools.length, 5);
  assert.match(graph.result.content[0].text, /research \(topic\)/);
});
