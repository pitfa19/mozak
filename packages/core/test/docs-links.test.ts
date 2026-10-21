import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkLinks, slug } from "../../../scripts/check-links.mjs";

const repo = fileURLToPath(new URL("../../../", import.meta.url));

// Broken links in public docs read as neglect. Every relative link in the repo's Markdown must resolve.
test("every relative link and anchor in the repo's Markdown resolves", () => {
  const r = checkLinks(repo);
  assert.ok(r.files > 0 && r.links > 0, "the checker found Markdown files and links");
  assert.deepEqual(r.broken, [], r.broken.map((b: { file: string; line: number; target: string; reason: string }) => `${b.file}:${b.line} ${b.target} (${b.reason})`).join("\n"));
});

test("link checker reports a missing file and a missing anchor, and skips code and external links", () => {
  const scratch = process.env.TMPDIR;
  assert.ok(scratch, "scratch directory required");
  const root = mkdtempSync(join(scratch, "mozak-links-"));
  try {
    mkdirSync(join(root, "docs"));
    writeFileSync(join(root, "docs", "a.md"), "# Title\n\n## Reads and the network\n\n## Reads and the network\n");
    writeFileSync(join(root, "README.md"), [
      "[ok](docs/a.md#reads-and-the-network) [dup](docs/a.md#reads-and-the-network-1) [self](#top)",
      "[gone](docs/missing.md) [bad anchor](docs/a.md#nope) [web](https://example.com/x.md)",
      "`[in code](docs/missing-in-code.md)`",
      "```",
      "[in fence](docs/missing-in-fence.md)",
      "```",
      "<a id=\"top\"></a>",
    ].join("\n"));
    const r = checkLinks(root);
    assert.deepEqual(r.broken.map((b: { target: string; reason: string }) => `${b.target} ${b.reason}`).sort(), ["docs/a.md#nope anchor not found", "docs/missing.md file not found"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("heading slugs follow GitHub rules", () => {
  assert.equal(slug("Disclosures (Obsidian community plugin policy)"), "disclosures-obsidian-community-plugin-policy");
  assert.equal(slug("Parallel writes: `concurrency.rebase` (experimental, off by default)"), "parallel-writes-concurrencyrebase-experimental-off-by-default");
  assert.equal(slug("6. First implementation contract: portable local installation (3A)"), "6-first-implementation-contract-portable-local-installation-3a");
});

// mozak is not on npm yet. The README may mention an npm install only inside the owner's TODO comment.
test("README claims no npm install outside an HTML comment", () => {
  const readme = readFileSync(join(repo, "README.md"), "utf8").replace(/<!--[\s\S]*?-->/g, "");
  assert.doesNotMatch(readme, /npm (i|install) (-g|--global)|npx @?mozak/);
});
