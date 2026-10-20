// Demo for the launch GIF: two agents, two repos, one shared graph. Run: node scripts/demo.ts
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildGraph, guardedWrite, readSnapshot, renderText, StaleWriteError, updateFile } from "../packages/core/src/index.ts";

const say = (s: string) => console.log(s);
const root = mkdtempSync(join(tmpdir(), "mozak-demo-"));

function scope(rel: string, id: string, kind: "project" | "topic", links: string[]) {
  const dir = join(root, rel);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "README.md"), `# ${id}\n`);
  writeFileSync(join(dir, "AGENTS.md"), `# ${id}\n`);
  writeFileSync(join(dir, "mozak.md"), `---\nid: ${id}\nkind: ${kind}\nformat: 1\n---\n## Plan\n- [ ] start\n## Links\n${links.join("\n")}\n## Translations\n`);
  return join(dir, "mozak.md");
}

const research = scope("vault/research", "research", "topic", []);
const api = scope("repos/api", "api", "project", ["- depends-on: [[research]]"]);
const cfg = { roots: [root] };

say("== graph before");
say(renderText(buildGraph(cfg)));

say("\n== agent A and agent B both read research/mozak.md");
const a = readSnapshot(research);
const b = readSnapshot(research);
say(`A base ${a.hash.slice(0, 8)}   B base ${b.hash.slice(0, 8)}`);

say("\n== agent B writes first");
guardedWrite(research, b.text.replace("- [ ] start", "- [ ] start\n- [ ] B: survey papers"), b.hash);
say("B: accepted");

say("\n== agent A writes from its stale base");
try {
  guardedWrite(research, a.text.replace("- [ ] start", "- [ ] start\n- [ ] A: collect datasets"), a.hash);
} catch (e) {
  if (!(e instanceof StaleWriteError)) throw e;
  say(`A: REFUSED  ${e.message.split(": ")[1]}`);
}

say("\n== agent A re-reads and retries");
updateFile(research, (t) => t.replace("## Links", "- [ ] A: collect datasets\n## Links"));
say("A: accepted");

say("\n== agent on api adds an edge at the same time");
updateFile(api, (t) => t.replace("## Translations", "- informs: [[research]]\n## Translations"));

say("\n== research/mozak.md plan, both edits survived");
say(readSnapshot(research).text.split("## Links")[0].split("## Plan")[1].trim());

say("\n== graph after");
say(renderText(buildGraph(cfg)));
