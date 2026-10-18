import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// `mozak doctor` against an isolated HOME: a real installation, made by the real installer, then broken on purpose.

const here = fileURLToPath(new URL(".", import.meta.url));
const repo = resolve(here, "..", "..", "..");
const cliPath = resolve(here, "..", "dist", "index.js");
const scratch = realpathSync(process.env.JCODE_SCRATCH_DIR ?? process.env.TMPDIR ?? tmpdir());
const roots: string[] = [];

after(() => {
  for (const root of roots) {
    if (!root.startsWith(scratch + "/") || !root.includes("/mozak-doctor-")) throw new Error(`refusing to remove ${root}`);
    rmSync(root, { recursive: true, force: true });
  }
});

const PRODUCT = ["LICENSE", "package.json", "scripts/install.mjs", "scripts/install-obsidian-plugin.mjs", "skills/mozak",
  ...["core", "cli", "mcp"].flatMap((p) => [`packages/${p}/package.json`, `packages/${p}/dist`]), "packages/obsidian/dist/plugin"];

function fixture() {
  const home = mkdtempSync(join(scratch, "mozak-doctor-"));
  roots.push(home);
  const source = join(home, "src", "mozak");
  for (const rel of PRODUCT) cpSync(join(repo, rel), join(source, rel), { recursive: true });
  mkdirSync(join(source, ".git"));
  const prefix = join(home, ".local", "share", "mozak");
  mkdirSync(join(home, ".local", "share"), { recursive: true });
  // The test PATH keeps system tools but never a real mozak: only the fixture's own ~/.local/bin.
  const systemPath = (process.env.PATH ?? "").split(":").filter((d) => d && !d.endsWith("/.local/bin") && !existsSync(join(d, "mozak"))).join(":");
  const env = { PATH: `${join(home, ".local", "bin")}:${systemPath}`, HOME: home, MOZAK_NO_UPDATE_CHECK: "1" };
  const r = spawnSync(process.execPath, [join(source, "scripts", "install.mjs"), "--prefix", prefix, "--json"], { env, encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  // Notes folder with an inventory, one local scope and one vault with the plugin.
  const notes = join(home, "notes");
  const vault = join(notes, "vault");
  mkdirSync(join(vault, ".obsidian", "plugins", "mozak"), { recursive: true });
  for (const f of ["main.js", "manifest.json", "styles.css"]) cpSync(join(source, "packages/obsidian/dist/plugin", f), join(vault, ".obsidian/plugins/mozak", f));
  const inventory = join(notes, "mozak-inventory.json");
  writeFileSync(inventory, JSON.stringify({ format: "mozak.local/v3", scopes: [] }));
  for (const d of [".claude/skills", ".jcode/skills"]) mkdirSync(join(home, d), { recursive: true });
  return { home, source, prefix, notes, vault, inventory, env };
}

function doctor(f: ReturnType<typeof fixture>, extra: string[] = []) {
  const r = spawnSync(process.execPath, ["--no-warnings", cliPath, "doctor", "--prefix", f.prefix, "--json", ...extra], { env: f.env, encoding: "utf8", timeout: 60_000 });
  const data = JSON.parse(r.stdout) as { status: string; checks: Array<{ id: string; state: string; message: string; fix?: string; fixed?: string }> };
  return { code: r.status, data, by: (id: string) => data.checks.find((c) => c.id === id) };
}

test("doctor on a fresh setup reports what is missing, and --fix makes links and wrappers but never edits MCP config", () => {
  const f = fixture();
  let r = doctor(f, ["--config", f.inventory]);
  assert.equal(r.by("node")?.state, "ok");
  assert.equal(r.by("installation")?.state, "ok", r.by("installation")?.message);
  assert.equal(r.by("source")?.state, "ok");
  assert.equal(r.by("path-mozak")?.state, "fail");
  assert.equal(r.by("skill-claude")?.state, "warn");
  assert.equal(r.by("inventory")?.state, "ok");
  assert.equal(r.by(`plugin:${f.vault}`)?.state, "ok");
  assert.equal(r.by("skill-codex"), undefined, "a skills folder that does not exist is not created");
  assert.equal(r.code, 3);

  // An old copied skill folder is moved aside, never deleted.
  mkdirSync(join(f.home, ".jcode/skills/mozak"));
  writeFileSync(join(f.home, ".jcode/skills/mozak/SKILL.md"), "old copy\n");
  // MCP config pointing elsewhere is reported with the exact change, and left alone.
  const claudeJson = join(f.home, ".claude.json");
  const mcpBefore = JSON.stringify({ mcpServers: { mozak: { command: "/opt/other/mozak-mcp", args: ["--config", f.inventory] } } });
  writeFileSync(claudeJson, mcpBefore);

  r = doctor(f, ["--fix", "--config", f.inventory]);
  for (const id of ["path-mozak", "path-mozak-mcp", "skill-claude", "skill-jcode"]) assert.ok(r.by(id)?.fixed, `${id} fixed: ${JSON.stringify(r.by(id))}`);
  assert.equal(r.by("mcp-claude")?.state, "fail");
  assert.match(r.by("mcp-claude")!.fix!, /set the mozak server's command to .*\.local\/bin\/mozak-mcp/);
  assert.equal(readFileSync(claudeJson, "utf8"), mcpBefore, "MCP config is never edited");
  for (const d of [".claude/skills", ".jcode/skills"]) {
    const link = join(f.home, d, "mozak");
    assert.ok(lstatSync(link).isSymbolicLink());
    assert.equal(readlinkSync(link), join(f.prefix, "skills", "mozak"));
  }
  const backups = readdirSync(join(f.home, ".jcode/skills")).filter((n) => n.startsWith("mozak.backup-"));
  assert.equal(backups.length, 1);
  assert.equal(readFileSync(join(f.home, ".jcode/skills", backups[0]!, "SKILL.md"), "utf8"), "old copy\n");
  const wrapper = join(f.home, ".local/bin/mozak");
  const v = spawnSync(wrapper, ["--version"], { env: f.env, encoding: "utf8" });
  assert.equal(v.stdout.trim(), JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).version, "the new wrapper runs the installation");

  // After fixing MCP by hand, everything is ok, and the inventory comes from the MCP config.
  writeFileSync(claudeJson, JSON.stringify({ mcpServers: { mozak: { command: join(f.home, ".local/bin/mozak-mcp"), args: ["--config", f.inventory] } } }));
  r = doctor(f);
  assert.deepEqual(r.data.checks.filter((c) => c.state !== "ok").map((c) => c.id), []);
  assert.equal(r.data.status, "ok");
  assert.equal(r.code, 0);
});

test("doctor flags a changed installation, an outdated plugin copy (fixed by --fix), and an unreadable inventory", () => {
  const f = fixture();
  writeFileSync(join(f.vault, ".obsidian/plugins/mozak/main.js"), "// old build\n");
  writeFileSync(join(f.notes, "broken.json"), "{");
  let r = doctor(f, ["--config", join(f.notes, "broken.json")]);
  assert.equal(r.by("inventory")?.state, "fail");
  r = doctor(f, ["--config", f.inventory]);
  assert.equal(r.by(`plugin:${f.vault}`)?.state, "warn");
  r = doctor(f, ["--config", f.inventory, "--fix"]);
  assert.match(r.by(`plugin:${f.vault}`)?.fixed ?? "", /reinstalled/);
  assert.equal(readFileSync(join(f.vault, ".obsidian/plugins/mozak/main.js"), "utf8"), readFileSync(join(f.source, "packages/obsidian/dist/plugin/main.js"), "utf8"));

  writeFileSync(join(f.prefix, "LICENSE"), "tampered\n");
  r = doctor(f, ["--config", f.inventory]);
  assert.equal(r.by("installation")?.state, "fail");
  assert.match(r.by("installation")!.message, /LICENSE differs/);
  assert.match(r.by("installation")!.fix!, /Move .* to the Trash/);
  assert.equal(existsSync(join(f.prefix, "LICENSE")), true, "doctor never removes an installation");

  const gone = doctor({ ...f, prefix: join(f.home, "nowhere") });
  assert.equal(gone.by("installation")?.state, "fail");
  assert.match(gone.by("installation")!.fix!, /git clone https:\/\/github.com\/pitfa19\/mozak/);
});

test("doctor on a restore: a correct MCP setting naming a missing wrapper points at --fix, and its inventory is still checked", () => {
  const f = fixture();
  mkdirSync(join(f.notes, "proj"));
  writeFileSync(join(f.notes, "proj", "README.md"), "# p\n");
  writeFileSync(f.inventory, JSON.stringify({ format: "mozak.local/v3", scopes: [{ id: "proj", root: "./proj" }] }));
  const wrapper = join(f.home, ".local/bin/mozak-mcp");
  writeFileSync(join(f.home, ".claude.json"), JSON.stringify({ mcpServers: { mozak: { command: wrapper, args: ["--config", f.inventory] } } }));
  let r = doctor(f);
  assert.equal(r.by("mcp-claude")?.state, "fail");
  assert.match(r.by("mcp-claude")!.fix!, /mozak doctor --fix/);
  assert.equal(r.by("inventory")?.state, "fail", "the MCP setting's inventory is checked even before the wrapper exists");
  assert.match(r.by("inventory")!.message, /proj \(scope-uninitialized\)/);
  assert.match(r.by("inventory")!.fix!, /scope init/);
  r = doctor(f, ["--fix"]);
  r = doctor(f);
  assert.equal(r.by("mcp-claude")?.state, "ok", JSON.stringify(r.by("mcp-claude")));
});

test("versions agree across the root, every package, the plugin manifest and the installer", () => {
  const read = (rel: string) => JSON.parse(readFileSync(join(repo, rel), "utf8"));
  const version = read("package.json").version as string;
  assert.match(version, /^\d+\.\d+\.\d+$/);
  for (const p of ["core", "cli", "mcp", "obsidian"]) {
    const pkg = read(`packages/${p}/package.json`);
    assert.equal(pkg.version, version, `packages/${p}`);
    if (pkg.dependencies?.["@mozak/core"]) assert.equal(pkg.dependencies["@mozak/core"], version, `packages/${p} depends on the same core`);
  }
  assert.equal(read("packages/obsidian/manifest.json").version, version, "plugin manifest");
  assert.match(readFileSync(join(repo, "scripts/install.mjs"), "utf8"), /const VERSION = JSON\.parse\(readFileSync\(new URL\('\.\.\/package\.json'/, "installer reads the root version");
  assert.match(readFileSync(join(repo, "CHANGELOG.md"), "utf8"), new RegExp(`^## ${version.replaceAll(".", "\\.")} `, "m"), "CHANGELOG has this version");
  const cli = spawnSync(process.execPath, [cliPath, "--version"], { encoding: "utf8" });
  assert.equal(cli.stdout.trim(), version);
  const help = spawnSync(process.execPath, [cliPath, "--help"], { encoding: "utf8" });
  assert.equal(help.stdout.split("\n")[0], `mozak ${version}`);
  void symlinkSync;
});
