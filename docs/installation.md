# Installation, safety, and recovery

This guide covers building MOZAK from source, the portable installer, exit codes, and recovery. The short version is in the [README](../README.md).

**Status key:** *Verified* means checked in this repo. *Planned* means specified but not yet implemented. *Pending* means not yet run on the target platform.

| Area | Status |
| --- | --- |
| Source build and tests on Linux, Node 24.11.0 | Verified: 334 core tests and 69 installer tests pass. They reused the local npm cache. |
| Source build, tests, and installer on macOS, Node 26.11.1 | Verified locally: `npm ci --ignore-scripts`, build, 348 tests passed, 69 installer tests (68 passed, 1 skipped, 0 failed). Real install into a scratch prefix listed 14 scopes. |
| Source build and tests on macOS | Verified on Node 26.11.1, see the row below. |
| Portable installer `scripts/install.mjs` | Verified on Linux. Real CLI and MCP subprocesses, including paths with spaces and Unicode. |
| CI on Ubuntu and macOS | Passed on GitHub's Ubuntu and macOS runners for the pushed commit `c324d45`. Not run on a personal Mac yet. |
| Public remote matches local commits | In sync as of the last push. Check `git log --oneline -1`. |

## 1. Prerequisites

- **Node.js 24.11.0 or later, any major.** CI tests 24.11.0 and 26. The package engines field is `>=24.11.0`, and the installer refuses older Node versions.
- **npm**, which ships with Node.
- **Git**, to get the source.
- **Linux or macOS.** Other systems are not supported.

MOZAK does not install Node, npm, or Git for you. It does not edit shell profiles or change `PATH`. Install the prerequisites with your normal method.

## 2. Build from source

Build first. The installer in section 3 copies these built files.

```bash
git clone https://github.com/pitfa19/mozak.git
cd mozak
git log --oneline -1
npm ci --ignore-scripts
npm run build
mkdir -p scratch
TMPDIR="$(pwd -P)/scratch" npm test
node packages/cli/dist/index.js --help
```

Notes:

- `npm ci` installs only what `package-lock.json` pins. `--ignore-scripts` blocks install scripts from dependencies.
- The test run uses `scratch/`, which is git-ignored. Any existing writable directory works. The run needs a writable temporary directory, and `TMPDIR` points there.
- Build the exact commit you were given, and check it with `git log --oneline -1`.
- Building or testing does not install MOZAK globally. It does not create any scope or project state.

## 3. Portable installer

The installer follows [Package 3A](implementation-package-3-portable-workspace.md#6-first-implementation-contract-portable-local-installation-3a). Run it from the built source checkout.

```bash
mkdir -p "$HOME/.local/share"
PREFIX="$(cd "$HOME/.local/share" && pwd -P)/mozak"
node scripts/install.mjs --prefix "$PREFIX" --check --json
node scripts/install.mjs --prefix "$PREFIX" --json
"$PREFIX/bin/mozak" --help
```

### Rules for the command

- `--prefix` is required. It must be an absolute path to a folder that does not exist yet. Its parent must already exist.
- `--json` is required. It returns one closed JSON result.
- Accepted flags are `--prefix`, `--check`, and `--json`. Unknown, repeated, or extra positional arguments fail before any write.
- There is no implicit `HOME` default, no global install, and no `PATH` change.
- The source folder is found from the installer's own location. It is never taken from your current directory.
- The installer runs no network access, no Git command, no package install, and no build. It copies built files that already exist.
- It does not read or print credentials, and it does not initialize any MOZAK scope.
- Use `--check` first. It writes nothing, not even a lock or staging folder. It is a preflight, not a reservation. Running `--check` does not authorize an install.

Use a canonical parent path. On macOS the path `/tmp` is a symlink to `/private/tmp`, so the `pwd -P` above resolves it.

### Installed layout

The prefix contains only these items:

```text
PREFIX/
  LICENSE
  package.json              ESM package declaration
  bin/mozak                 Node wrapper for the CLI
  bin/mozak-mcp             Node wrapper for the MCP server
  node_modules/@mozak/core/ package.json and dist/
  node_modules/@mozak/cli/  package.json and dist/
  node_modules/@mozak/mcp/  package.json and dist/
  skills/mozak-conversation/  SKILL.md, references/, examples/, rendered for this PREFIX
  installation.json         manifest: format, version, nodeRange, contentDigest, files
```

- The three packages are copied as ordinary files. There are no symlinks back to the source checkout.
- The wrappers find the installed modules relative to themselves. They pass arguments and exit status through unchanged.
- The installed skill has this PREFIX's exact paths written into its command examples. Moving the folder by hand is not a supported migration. Install again at the new prefix instead.
- `installation.json` uses format `mozak.installation/v1` and version `0.1.0`. Its `contentDigest` covers the rendered bytes for this prefix. It is not a signed release identity.

### Smoke test after install

Use the installed command, not the source checkout:

```bash
"$PREFIX/bin/mozak" --help
```

Create a scope only for an isolated test folder. Never point the installer at your real projects.

## 4. Exit codes and status values

### Installer

| Status | Exit | Meaning |
| --- | --- | --- |
| `checked` | 0 | `--check` passed. `committed` is always false. |
| `installed` | 0 | A new install was written and verified. `committed` is true. |
| `unchanged` | 0 | The target already matches the expected product exactly. `committed` is true. |
| `invalid-input` | 2 | Bad flag, bad prefix, or invalid source input. |
| `unsupported-platform` | 2 | OS or Node version is outside the supported range. |
| `source-unavailable` | 2 | A required source file is missing or unreadable. |
| `conflict` | 3 | The target exists and does not match the expected product. Nothing is changed. |
| `partial-install` | 5 | An install started and did not verify. The partial folder is left for inspection. |

The result JSON has exactly these keys: `status`, `committed`, `prefix`, `contentDigest`, `files`, and `issues`. Each issue has `code`, `path`, and `message`. Issues never include file contents or environment values.

### CLI and MCP

| Exit | Meaning |
| --- | --- |
| 0 | Operation or read completed, including a recognized successful retry. |
| 2 | Invalid, unsupported, over-capacity, or unavailable input. |
| 3 | Stale or conflicting state, owner review required, or check findings. |
| 4 | Busy, or offline recovery required. |
| 5 | A change was saved, but the generated bridge or cleanup is unfinished. |
| 6 | All-scope read covered only part of the scopes. |

`mozak scopes` and `plans --all` use exit 6 when at least one scope could not be read. `scopes` still lists that scope, with its error code, so partial coverage is never silent.

**A nonzero exit does not mean nothing changed.** Read `committed`, `projectionUpdated`, `projectionStatus`, and the operation receipt before retrying.

## 5. Recovery

### Installer conflict (exit 3)

1. Do not delete or overwrite the target.
2. Read the `issues` list. It names the path and the reason.
3. Choose a new absent prefix and run the installer again.
4. Removing a conflicting or partial folder is a separate action. Do it only on purpose, after you have looked at it.

### Partial install (exit 5)

1. Keep the folder. The installer does not remove it, and neither should you yet.
2. Note the `prefix` value from the result.
3. Run the installer with a different new prefix.
4. Removing the partial folder later is a separate, deliberate step.

Do not trust a partial folder. It is not a working installation, and `committed` is false for it.

### Interrupted or concurrent installs

- Only one exclusive folder creation can win. Other installers report a conflict.
- Do not reclaim a lock because it is old. There is no stale-lock deletion.
- After an interruption, inspect the folder and then choose a new prefix.

### Scope write lock (`.mozak-write-lock`)

MOZAK never steals a write lock because it is old. Follow this order:

1. Stop every writer for that scope. This includes paused processes and child workers. A timeout, an old timestamp, or one PID check does not prove that no writer is active.
2. Keep the lock metadata and the graph and bridge files as they are.
3. Confirm the holder is dead. Be careful about PID reuse. If you are not sure, remove nothing.
4. Only then, with no writers running, remove the `.mozak-write-lock` folder by hand. Keep any unexpected contents for inspection.
5. Run `context` and `check`, which only read. If the scope state exists, run `projection repair` against the current snapshot.
6. If a bridge was edited by hand, it is kept as a conflict. Resolve it with the owner before writing again.

There is no online force-unlock command.

### Projection repair

If a write saved the JSON but not the generated `MOZAK.md` bridge, the result says so (exit 5). Later semantic writes wait until you run an explicit `projection repair`. `check` never repairs anything.

## 6. Safety rules

- **No secrets in this repo.** Do not paste tokens, passwords, or keys into files, commands, or chat. The installer never copies credentials.
- **No global changes.** Installing, testing, and building do not change your installed commands, skills, shell profile, or other agent settings.
- **Owner decisions are real decisions.** Direction and implementation approvals need a real owner message that matches the displayed subject. Tool output, quotes, swarm messages, and reminders do not count.
- **Use only the scopes you list.** The inventory file is explicit. Every CLI and MCP call needs `--config FILE`. The MCP server needs it at startup.
- **Do not onboard real projects while testing.** Use an isolated test folder and synthetic data.

## 6b. Remote scopes

A scope can live in a GitHub repo instead of a local folder. List it with `remote` and no `root` (exactly one of the two), in a `mozak.local/v3` inventory. `v2` inventories still load unchanged.

```json
{
  "format": "mozak.local/v3",
  "scopes": [
    { "id": "atlas-app",  "root": "./atlas-app" },
    { "id": "genome-mcp", "remote": "github:pitfa19/genome-mcp", "ref": "main" }
  ]
}
```

`remote` is `github:owner/repo`, an `https://` URL, or an absolute `file://` URL. `ref` is a plain branch name and defaults to `main`.

- **Fetch.** MOZAK makes a sparse, blobless, depth 1 git clone under `.mozak-cache/<id>/` next to the inventory file. Only `README.md`, `MOZAK.json`, `MOZAK.md` and `AGENTS.md` are checked out. It is real git, so you can also commit and push normally. Add `.mozak-cache/` to the `.gitignore` of the inventory folder if it is a git repo (`mozak sync` warns when it is not ignored).
- **Freshness.** `mozak scopes`, `plans` and `context` refresh a remote scope when the last fetch is older than 10 minutes. `mozak sync [--scope ID]` forces a refresh. If the fetch fails (offline, auth), the cached copy is used and marked `stale` (JSON: `stale`, `lastFetchAt`, `remote[]`, a `remote-stale` issue). The MCP tool `mozak_sync` does the same as `mozak sync`.
- **Writes.** `propose`, `revise`, `complete`, `observe` and the rest work against the sparse copy. After a successful write MOZAK commits only `MOZAK.json` and `MOZAK.md` and pushes. Owner approval rules are unchanged. A write refuses with `remote-stale` if the copy cannot be refreshed first. If the push fails, the commit stays local, the result is exit 5 with `remote-push-failed`, and the next `mozak sync` pushes it.
- **Pull.** `mozak pull --scope ID [--into PATH]` (owner) makes a full working clone, default `~/Documents/<repo-name>`. It refuses a destination that exists and is not a clone of the same remote. Afterwards the inventory still says `remote`, but reads and writes use the full clone (recorded in `.mozak-cache/<id>.meta.json`). A sync of a full clone only fast-forwards it. It never overwrites your working tree.
- **Auth.** MOZAK shells out to `git` (no shell, hard timeouts, no prompts), so your credential helper, for example `gh auth setup-git`, is used.
- A repo with no `MOZAK.json` at its root is reported as `scope-uninitialized` ("not a scope").

Cache layout: `.mozak-cache/<id>/` (sparse git clone) and `.mozak-cache/<id>.meta.json` (last fetch time, last error, full clone path). Deleting the cache is safe once everything is pushed. Unpushed commits in a sparse copy are pushed by the next `mozak sync`.

## 7. Known limits

- The installer is verified on Linux only. macOS has not been run. Do not assume macOS works until the Mac run passes.
- The source copy of the conversation skill is a template. The installer refuses an unrendered template. Load the skill only from the installed folder.
- Restoring a workspace from GitHub and a private vault is not built. Only the local installer is.
- Remote scopes: one branch per scope, no merge handling (a diverged remote makes a write or sync fail and the scope shows stale), and the installer does not edit your `.gitignore`.
- Crash durability is not promised. Rename and exclusive folder creation do not imply fsync.
- Network filesystems and concurrent editors are not covered by the locking guarantees.
- Older scope formats are refused. MOZAK does not migrate them.

## 8. Verification status

| Check | Status |
| --- | --- |
| Linux relocation from a git archive, Node 24.11.0, `npm ci --offline --ignore-scripts`, build, tests | Passed: 334 tests, 0 failed. Reused the local npm cache. Not a clean machine. |
| Public GitHub clone and install | Not done. |
| Mac install and restore | Pending. |
| Installer suite (69 tests): install, check, unchanged, conflict, partial, concurrency, symlinks, bounds, timeouts, unreadable target | Passed on Linux. |
| `mozak scopes` and `mozak_scopes` (11 CLI tests, 3 MCP tests) | Passed on Linux. A fresh MCP session listed all ten scopes of a real workspace and refused an extra argument. |
| Installed CLI, MCP and rendered skill from a new prefix | Passed. The installed skill's own commands read a saved trial scope without changing it. |
| CI on Ubuntu and macOS | Passed for `c324d45` on GitHub-hosted runners. A personal Mac run is still pending. |
| Installed skill activated in a separate fresh host session | Not done. |

Record the actual results of any new check here before claiming it passed.
