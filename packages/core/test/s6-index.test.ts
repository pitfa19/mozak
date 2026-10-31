// S6: Croatian folding, fence-aware wikilinks, indexRoots settings, locator resolution, cited-note staleness in check,
// plans.md and the include-private usage flag. Synthetic temp vaults only.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupS6, git, s6world } from "./s6-fixture.ts";
import { foldText } from "../src/fold.ts";
import { stripCode, wikiLinks } from "../src/notes.ts";
import { loadSettings } from "../src/settings.ts";
import { anchoredSection, defaultIndexRoots, LocatorResolver, noteTitle } from "../src/locators.ts";
import { PLANS_INDEX_MARKER } from "../src/plans-index.ts";
import { readUsageLines } from "../src/usage.ts";

after(cleanupS6);
type Issue = { code: string; message: string; planId?: string; path?: string; source?: string };

test("Croatian folding maps č ć š ž đ in both cases and leaves other letters", () => {
  assert.equal(foldText("Čćšžđ ČĆŠŽĐ ñ é"), "Ccszd CCSZD ñ é");
});

test("wikilinks skip fenced blocks and code spans, and keep anchors without aliases", () => {
  const text = ["See [[Alpha note#Plan|the plan]] and ![[embed.png]].", "```", "[[Inside fence]]", "```", "~~~md", "[[Tilde fence]]", "~~~", "Inline `[[In code]]` and [[Beta]] again [[Beta]]."].join("\n");
  assert.deepEqual(wikiLinks(text), [{ target: "Alpha note", anchor: "Plan" }, { target: "embed.png", anchor: null }, { target: "Beta", anchor: null }]);
  assert.ok(!stripCode(text).includes("Inside fence"));
});

test("indexRoots: parsed relative to the settings file; unknown item keys and scope-level indexRoots are reported", () => {
  const w = s6world({ a: "vault/research/a" }, { repos: ["vault"], settings: { format: "mozak.settings/v1", indexRoots: [{ path: "vault/personal", private: true, extra: 1 }, { path: "vault/research" }], scopes: { a: { indexRoots: [] } } } });
  const s = loadSettings(w.inv());
  assert.deepEqual(s.indexRoots?.map((r) => [r.path.endsWith(join("vault", "personal")), r.private]), [[true, true], [false, false]]);
  assert.deepEqual(s.issues.map((i) => i.message.match(/"([^"]+)"/)?.[1]), ["indexRoots[0].extra", "scopes.a.indexRoots"]);
  writeFileSync(join(w.base, "mozak-settings.json"), JSON.stringify({ format: "mozak.settings/v1", indexRoots: [{ path: 3 }] }));
  assert.throws(() => loadSettings(w.inv()), { code: "settings-invalid" });
  const check = w.op("check", { scope: "a" });
  assert.ok((check.data.issues as Issue[]).some((i) => i.code === "settings-invalid"));
});

test("default index roots: top folders of a vault repo holding scopes, personal private, a scope at a repo root is not a root", () => {
  const w = s6world({ me: "vault/personal/me", lab: "vault/research/lab", co: "company" }, { repos: ["vault", "company"] });
  const roots = defaultIndexRoots(w.inv());
  assert.deepEqual(roots.map((r) => [r.path.split("/").slice(-2).join("/"), r.private]), [["vault/personal", true], ["vault/research", false]]);
});

function locatorWorld() {
  const w = s6world({ me: "vault/personal/me", lab: "vault/research/lab", co: "company" }, { repos: ["vault", "company"] });
  const v = join(w.base, "vault");
  mkdirSync(join(v, "research", "notes"), { recursive: true });
  writeFileSync(join(v, "research", "notes", "Đakovo trip.md"), "---\ntags: x\n---\n# Trip to Đakovo\n\nIntro line.\n\n## Budget and costs\n\nCosts are low.\n\n```\n## Not a heading\n```\n");
  writeFileSync(join(v, "research", "notes", "dup.md"), "# Dup one\n");
  mkdirSync(join(v, "research", "other"), { recursive: true });
  writeFileSync(join(v, "research", "other", "dup.md"), "# Dup two\n");
  writeFileSync(join(v, "personal", "secret.md"), "# Private title\n\nPrivate body text.\n");
  writeFileSync(join(w.entries.lab.root, "local.md"), "# Local note\n\nLocal body.\n");
  writeFileSync(join(w.base, "company", "brief.md"), "# Company brief\n\nCompany body.\n");
  return w;
}

test("locator resolution: paths, note links, anchors, privacy and prose", () => {
  const w = locatorWorld();
  const inv = w.inv();
  const r = new LocatorResolver(inv);
  const lab = w.entries.lab;
  const at = (loc: string, anchor: string | null = null, entry = lab, res = r) => res.resolve(entry, loc, anchor);

  assert.deepEqual(at("https://example.invalid/x"), { kind: "url", status: "external" });
  assert.deepEqual(at("git:abc123:src/x.ts"), { kind: "git", status: "external" });
  assert.deepEqual(at("owner message in a chat on 2026-10-20"), { kind: "text", status: "not-checked" });
  assert.deepEqual(at("ssh host 'df -h /'"), { kind: "text", status: "not-checked" });

  const local = at("local.md");
  assert.equal(local.status, "resolved");
  assert.equal(local.title, "Local note");
  assert.equal(local.excerpt, "Local body.");

  const fromRepo = at("research/notes/Đakovo trip.md", "budget");
  assert.equal(fromRepo.status, "resolved");
  assert.equal(fromRepo.title, "Trip to Đakovo");
  assert.equal(fromRepo.anchorFound, true);
  assert.equal(fromRepo.excerpt, "Costs are low.");
  assert.equal(at("research/notes/Đakovo trip.md#Not a heading").anchorFound, false);
  assert.equal(at("research/notes/Đakovo trip.md:12").status, "resolved");

  const link = at("[[Dakovo trip#Budget and costs|costs]]");
  assert.equal(link.kind, "wikilink");
  assert.equal(link.status, "resolved", "a folded name finds a note with diacritics");
  assert.equal(link.anchorFound, true);
  const amb = at("[[dup]]");
  assert.equal(amb.status, "ambiguous");
  assert.equal(amb.candidates?.length, 2);
  assert.equal(at("[[No such note]]").status, "missing");
  assert.equal(at("research/notes/missing.md").status, "missing");

  const priv = at("personal/secret.md");
  assert.equal(priv.status, "resolved");
  assert.equal(priv.private, true);
  assert.equal(priv.title, "Private title");
  assert.equal(priv.excerpt, undefined, "a private root returns path and title only");
  const full = at("personal/secret.md", null, lab, new LocatorResolver(inv, { includePrivate: true }));
  assert.equal(full.excerpt, "Private body text.");

  // The company scope is not a root, but its own notes resolve for its own citations, with detail.
  const co = at("brief.md", null, w.entries.co);
  assert.equal(co.status, "resolved");
  assert.equal(co.excerpt, "Company body.");
  // From another scope, a file outside every root resolves by explicit path, path and title only.
  const outside = at(join(w.base, "company", "brief.md"));
  assert.equal(outside.status, "resolved");
  assert.equal(outside.excerpt, undefined);
});

test("locators route: per-row resolution, counts, plan filter, and include-private is recorded in the usage log", () => {
  const w = locatorWorld();
  w.propose("lab", "p1", { title: "Lab trip budget", sources: [{ locator: "local.md" }, { locator: "https://example.invalid" }, { locator: "personal/secret.md" }] });
  w.propose("me", "p2", { title: "Personal errand list", sources: [{ locator: "secret.md" }] });
  const one = w.op("locators", { scope: "lab" });
  assert.equal(one.exitCode, 0);
  assert.deepEqual(one.data.counts, { resolved: 2, external: 1 });
  const rows = one.data.locators as { planId: string; locator: string; excerpt?: string; private?: boolean }[];
  assert.equal(rows.find((x) => x.locator === "personal/secret.md")?.excerpt, undefined);
  const all = w.op("locators", { all: true, plan: "p2", includePrivate: true });
  assert.equal(all.exitCode, 0);
  assert.equal((all.data.locators as { excerpt?: string }[])[0].excerpt, "Private body text.");
  assert.equal(w.op("locators", { all: true, plan: "nope" }).data.status, "plan-not-found");
  assert.equal(w.op("locators", { scope: "lab", all: true }).exitCode, 2);
  const month = new Date().toISOString().slice(0, 7);
  const lines = readUsageLines(w.base, month).filter((l) => l.op === "locators");
  assert.deepEqual(lines.map((l) => l.includePrivate === true), [false, true, false, false]);
});

test("cited-note staleness: check reports a cited note changed after its citation landed, as information only", () => {
  const w = s6world({ lab: "vault/research/lab" }, { repos: ["vault"] });
  const v = join(w.base, "vault");
  mkdirSync(join(v, "research", "notes"), { recursive: true });
  for (const n of ["topic", "early", "between", "dirty"]) writeFileSync(join(v, "research", "notes", `${n}.md`), `# ${n}\n\nfirst\n`);
  writeFileSync(join(v, ".gitignore"), ".mozak-cache/\n");
  git(v, ["add", "-A"]);
  git(v, ["commit", "-qm", "base"], "2026-01-01T00:00:00Z");
  w.propose("lab", "p", { title: "Lab topic survey" });
  for (const n of ["topic", "early", "between", "dirty"]) w.observe("lab", "p", `research/notes/${n}.md`, "2026-02-01T00:00:00.000Z");
  writeFileSync(join(v, "research", "notes", "between.md"), "# between\n\nedited before the citation was committed\n");
  git(v, ["add", "research/notes/between.md"]);
  git(v, ["commit", "-qm", "between"], "2026-02-01T00:05:00Z");
  git(v, ["add", "-A"]);
  git(v, ["commit", "-qm", "citation lands"], "2026-02-01T00:10:00Z");
  writeFileSync(join(v, "research", "notes", "topic.md"), "# topic\n\nedited later\n");
  git(v, ["add", "research/notes/topic.md"]);
  git(v, ["commit", "-qm", "later edit"], "2026-03-01T00:00:00Z");
  writeFileSync(join(v, "research", "notes", "dirty.md"), "# dirty\n\nuncommitted edit\n");

  const check = w.op("check", { scope: "lab" });
  const cited = (check.data.issues as Issue[]).filter((i) => i.code === "cited-note-changed");
  assert.deepEqual(cited.map((i) => [i.path!.split("/").pop(), i.source]), [["dirty.md", "uncommitted"], ["topic.md", "commit"]]);
  assert.match(cited[1].message, /plan p cites research\/notes\/topic\.md, which changed 2026-03-01 after it was cited 2026-02-01/);
  assert.equal(check.exitCode, 0, "cited-note changes are information, not findings");
  assert.equal(check.data.status, "ok");
});

test("plans.md: one file per repo, titles and states only, company plans only in the company file, rejected left out", () => {
  const w = s6world({ me: "vault/personal/me", lab: "vault/research/lab", co: "company", loose: "loose/x" }, { repos: ["vault", "company"] });
  w.propose("me", "errand", { title: "Personal errand list", purpose: "SECRET-PURPOSE-TEXT" });
  w.propose("me", "dropped", { title: "Dropped idea" }, "reject");
  w.propose("lab", "survey", { title: "Lab survey" }, "await");
  w.propose("co", "pilot", { title: "Company pilot", purpose: "COMPANY-PURPOSE-TEXT" });

  const printed = w.op("plans-md", { print: true });
  assert.equal(printed.exitCode, 0);
  const files = printed.data.files as { path: string; content: string; result: string; plans: number }[];
  assert.deepEqual(files.map((f) => [f.path.split("/").slice(-2).join("/"), f.result, f.plans]), [["company/plans.md", "printed", 1], ["vault/plans.md", "printed", 2]]);
  assert.deepEqual(printed.data.skipped, [{ scope: "loose", reason: "not-in-git-repo" }]);
  const [company, vault] = files.map((f) => f.content);
  assert.ok(company.startsWith(PLANS_INDEX_MARKER));
  assert.ok(company.includes("- open: Company pilot (`pilot`)"));
  assert.ok(!company.includes("errand") && !company.includes("Lab survey"));
  assert.ok(vault.includes("- open: Personal errand list (`errand`)"));
  assert.ok(vault.includes("- awaiting approval: Lab survey (`survey`)"));
  assert.ok(vault.includes("Scope `me`, folder `personal/me`."));
  for (const text of [company, vault]) {
    assert.ok(!text.includes("PURPOSE-TEXT"), "no purposes");
    assert.ok(!text.includes("Dropped idea"), "rejected drafts are left out");
  }
  assert.ok(!existsSync(join(w.base, "vault", "plans.md")), "print writes nothing");

  assert.equal(w.op("plans-md", {}).data.status, "not-permitted");
  const wrote = w.op("plans-md", {}, "owner");
  assert.equal(wrote.exitCode, 0);
  assert.deepEqual((wrote.data.files as { result: string }[]).map((f) => f.result), ["written", "written"]);
  assert.equal(readFileSync(join(w.base, "vault", "plans.md"), "utf8"), vault);
  assert.deepEqual((w.op("plans-md", {}, "owner").data.files as { result: string }[]).map((f) => f.result), ["unchanged", "unchanged"]);
  assert.deepEqual(readdirSync(join(w.base, "vault")).filter((n) => n.includes(".tmp")), []);

  writeFileSync(join(w.base, "company", "plans.md"), "# My own plans file\n");
  const conflict = w.op("plans-md", {}, "owner");
  assert.equal(conflict.exitCode, 3);
  assert.equal((conflict.data.issues as Issue[])[0].code, "plans-md-conflict");
  assert.equal(readFileSync(join(w.base, "company", "plans.md"), "utf8"), "# My own plans file\n");
});

test("note title and anchored section helpers", () => {
  assert.equal(noteTitle("---\ntitle: From front matter\n---\nbody"), "From front matter");
  assert.equal(noteTitle("no heading"), null);
  assert.equal(anchoredSection("# A\n\n## Rok prijave\n\nDo 1. 11. 2026.\n## Next\n", "rok"), "\nDo 1. 11. 2026.");
});
