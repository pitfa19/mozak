# Installation, safety, and recovery

This guide covers building mozak from source, the portable installer, exit codes, and recovery. The short version is in the [README](../README.md).

**Status key:** *Verified* means checked in this repo. *Planned* means specified but not yet implemented. *Pending* means not yet run on the target platform.

| Area | Status |
| --- | --- |
| Fresh public GitHub clone, build, install and README walkthrough on macOS, Node 26.11.1 | Verified 2026-10-18 at `8337e04`: clean `git clone`, `npm ci --ignore-scripts`, build and install into a fresh prefix with an isolated `HOME` took about 8 seconds. Every README command then ran as written (section 8). |
| Full test suite on macOS, Node 26.11.1 | Verified at `2bd8cfc` (0.2.0 plus tests): 437 tests passed, 0 failed, 0 skipped. Installer suite 69 passed, 1 skipped (case-collision test needs a case-sensitive filesystem). |
| Source build and tests on Linux, Node 24.11.0 | Verified earlier at `c324d45`: 334 core tests and 69 installer tests passed. CI covers Linux on every push since. |
| CI on Ubuntu and macOS, Node 24 and 26 | Passing on every push, latest `2bd8cfc`. Release `v0.2.0` tagged at `e73179d` after CI passed. |
| `mozak upgrade` on a real installation | Verified 2026-10-18 on macOS: 0.1.0 to 0.2.0 with `--source` (0.1.0 did not record it), five vaults got the 0.2.0 plugin, the old installation kept as `mozak.previous-0.1.0`, the checkout returned to `main`; the installed `mozak upgrade` then reported `up-to-date`. |
| `mozak doctor` on a real setup | Verified 2026-10-18 on macOS: 16 checks ok (installation, PATH, two skill links, two MCP configs, 21 scopes readable, five vault plugins at 0.2.0) and one warning (no skill link in an existing `~/.codex/skills`). Fresh user account or machine: pending (owner). |

## 1. Prerequisites

- **Node.js 24.11.0 or later, any major.** CI tests 24.11.0 and 26. The package engines field is `>=24.11.0`, and the installer refuses older Node versions.
- **npm**, which ships with Node.
- **Git**, to get the source.
- **Linux or macOS.** Other systems are not supported.

mozak does not install Node, npm, or Git for you. It does not edit shell profiles or change `PATH`. Install the prerequisites with your normal method.

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
- Building or testing does not install mozak globally. It does not create any scope or project state.

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
- It does not read or print credentials, and it does not initialize any mozak scope.
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
  skills/mozak/  SKILL.md, references/, examples/, rendered for this PREFIX
  installation.json         manifest: format, version, nodeRange, contentDigest, files
```

- The three packages are copied as ordinary files. There are no symlinks back to the source checkout.
- The wrappers find the installed modules relative to themselves. They pass arguments and exit status through unchanged.
- The installed skill has this PREFIX's exact paths written into its command examples. Moving the folder by hand is not a supported migration. Install again at the new prefix instead.
- To make the skill available to an agent host, symlink the installed skill folder into the host's skills folder, for example `ln -s PREFIX/skills/mozak ~/.claude/skills/mozak`. Do not copy it: a copy keeps the old paths after an upgrade. The installer never does this step for you.
- `installation.json` uses format `mozak.installation/v1` and version `0.1.0`. Its `contentDigest` covers the rendered bytes for this prefix. It is not a signed release identity.

### Smoke test after install

Use the installed command, not the source checkout:

```bash
"$PREFIX/bin/mozak" --help
```

Create a scope only for an isolated test folder. Never point the installer at your real projects.

### Upgrading

Run `mozak upgrade`. It finds the newest release tag (`vX.Y.Z`) in the checkout you installed from (recorded as `source` in `PREFIX/installation.json`), and:

1. Fetches tags from that checkout's `origin`. If nothing is newer, it reports `up-to-date` and stops.
2. Refuses (`source-dirty`, exit 3) if the checkout has uncommitted changes to tracked files.
3. With `--check`, reports `installed`, `latest` and `source` and stops.
4. Checks out the tag, runs `npm ci --ignore-scripts` and `npm run build`, then returns the checkout to the branch it was on. A failed build reports `build-failed` (exit 2) and leaves the installation as it was.
5. Moves the old installation to `PREFIX.previous-<old version>`, installs the new one at `PREFIX`, and checks that `PREFIX/bin/mozak --version` is the new version. If that fails, the old installation is moved back. The previous installation is kept, never deleted. Move it to the Trash once you are happy.
6. With `--vault PATH` (repeat for each vault), installs the new Obsidian plugin into that vault. Vaults are never guessed. Reload Obsidian afterwards.

```sh
mozak upgrade --check
mozak upgrade --vault ~/Documents/notes
```

Because the new release lands at the same path, skill links to `PREFIX/skills/mozak`, `~/.local/bin` wrappers and MCP settings keep working. Your plans are never inside the prefix, so upgrading cannot touch them. If the checkout is gone, clone it again and pass `--source PATH`.

Installations from before 0.2.0 do not record their checkout: run `mozak upgrade --source /path/to/mozak` once, or reinstall by hand (move the old prefix to the Trash, build, run the installer with the same prefix).

### Lowercase plan files (0.4)

Plan files are now `mozak.json` and `mozak.md`. Scopes made before 0.4 keep `MOZAK.json` and `MOZAK.md` and keep working: every read accepts both names, and a write goes to whichever name the scope already has. New scopes get the lowercase names.

To move older scopes to the new names, run once (owner only):

```sh
mozak rename-files --config INVENTORY --all
```

It renames both files under the scope lock and regenerates the note so its link points to `mozak.json`. The plan bytes do not change, so approvals stay valid. It refuses a scope whose note has hand edits, or one that has both names. Repo scopes that commit plans to GitHub are skipped: rename those in a clone with `git mv` and push. Commit the rename in your notes repo afterwards. On a case-insensitive disk, git needs `git add -A` to record a case-only rename.

### Update notice

`mozak scopes` adds an `update-available` issue, and the Obsidian sidebar a line under its header, when a newer release exists. The check reads GitHub's public tag list for `pitfa19/mozak` with no login, at most once every 24 hours (once an hour after a failure), in a background process, so commands never wait on the network. The answer is cached in `~/.local/state/mozak/update.json` (or `$XDG_STATE_HOME/mozak/update.json`). Set `MOZAK_NO_UPDATE_CHECK=1` to turn it off. Only an installed `mozak` checks; a source checkout never does.

### Checking a setup: `mozak doctor`

`mozak doctor [--config FILE] [--fix] [--json]` checks, in order: Node version; the installation (every file matches `installation.json`, `bin/mozak` runs) and its source checkout; that `mozak` and `mozak-mcp` on `PATH` are this installation; skill links in `~/.claude/skills`, `~/.jcode/skills` and `~/.codex/skills` (only folders that exist); the `mozak` server in `~/.claude.json` and `~/.jcode/mcp.json`; the inventory (from `--config`, else from the MCP settings) and that every scope reads; the Obsidian plugin in each vault under the inventory's folder; and the update notice. Each problem comes with the exact command or edit that fixes it. Exit 0 means no failures (warnings allowed), exit 3 means at least one failure.

`--fix` applies only safe fixes and reports each one:

- creates or replaces the `mozak` link in an existing skills folder (an old copied folder is moved to `mozak.backup-<date>`, an old link to `mozak.previous-link-<date>`, never deleted);
- creates missing `~/.local/bin/mozak` and `~/.local/bin/mozak-mcp` wrappers;
- reinstalls an outdated plugin copy into a vault, when the source checkout has this release's build.

It never edits MCP settings, the inventory or any plan file. For those it prints the change to make.

**Restoring on a new machine or account:** install Node, clone and build mozak, run the installer, clone your notes repo (with the inventory and vault-plans folders), connect the MCP server to the inventory, then run `mozak doctor --fix` and follow what it prints until it reports no failures.

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

### Bounded context reads

`context` without new flags keeps the full existing response. For cheaper recovery:

- `mozak context --config INVENTORY --scope ID --brief --json` returns one body-free summary per plan: title, lifecycle, accepted revision ID, pending revision ID/review state, handoff identity/health/eligibility/blockers, discussion status, review-needed flag and permitted next action. It omits plan content, observations/evidence, discussion bodies, specifications, decisions and history. Handoff bounds are explicitly omitted (`boundsOmitted: true`); read the full plan before execution.
- `mozak context --config INVENTORY --scope ID --plan PLAN --json` returns the full recovery DTO for exactly that plan. Unknown IDs return `plan-not-found`, exit 2, never an all-plan fallback.
- Both flags together return only the selected plan's brief summary. MCP `mozak_context` accepts the equivalent optional `brief` boolean and `plan` string. Scope selection and existing remote-refresh behavior are unchanged.

Every form preserves the full whole-scope `snapshot` for CAS, projection status and issues. Reads create no approvals and do not change canonical state or projections. These are response-size optimizations, not storage-format or I/O changes; brief size still scales with plan count and title length. The source skill starts with `--brief`, drills into `--plan PLAN` before work and uses that focused read after stale conflicts.

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

mozak never steals a write lock because it is old. Follow this order:

1. Stop every writer for that scope. This includes paused processes and child workers. A timeout, an old timestamp, or one PID check does not prove that no writer is active.
2. Keep the lock metadata and the graph and bridge files as they are.
3. Confirm the holder is dead. Be careful about PID reuse. If you are not sure, remove nothing.
4. Only then, with no writers running, remove the `.mozak-write-lock` folder by hand. Keep any unexpected contents for inspection.
5. Run `context` and `check`, which only read. If the scope state exists, run `projection repair` against the current snapshot.
6. If a bridge was edited by hand, it is kept as a conflict. Resolve it with the owner before writing again.

There is no online force-unlock command.

### Projection repair

If a write saved the JSON but not the generated `mozak.md` bridge, the result says so (exit 5). Later semantic writes wait until you run an explicit `projection repair`. `check` never repairs anything.

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

- **Fetch.** mozak makes a sparse, blobless, depth 1 git clone under `.mozak-cache/<id>/` next to the inventory file. Only `README.md`, `mozak.json`, `mozak.md` and `AGENTS.md` are checked out. It is real git, so you can also commit and push normally. Add `.mozak-cache/` to the `.gitignore` of the inventory folder if it is a git repo (`mozak sync` warns when it is not ignored).
- **Freshness.** `mozak scopes`, `plans` and `context` refresh a remote scope when the last fetch is older than 10 minutes. `mozak sync [--scope ID]` forces a refresh. If the fetch fails (offline, auth), the cached copy is used and marked `stale` (JSON: `stale`, `lastFetchAt`, `remote[]`, a `remote-stale` issue). The MCP tool `mozak_sync` does the same as `mozak sync`.
- **Writes.** `propose`, `revise`, `complete`, `observe` and the rest work against the sparse copy. After a successful write mozak commits only `mozak.json` and `mozak.md` and pushes. Owner approval rules are unchanged. A write refuses with `remote-stale` if the copy cannot be refreshed first. If the push fails, the commit stays local, the result is exit 5 with `remote-push-failed`, and the next `mozak sync` pushes it.
- **Pull.** `mozak pull --scope ID [--into PATH]` (owner) makes a full working clone, default `~/Documents/<repo-name>`. It refuses a destination that exists and is not a clone of the same remote. Afterwards the inventory still says `remote`, but reads and writes use the full clone (recorded in `.mozak-cache/<id>.meta.json`). A sync of a full clone only fast-forwards it. It never overwrites your working tree.
- **Vault plans (public repos).** Add `"plans": "<folder>"` to a remote entry to keep its `mozak.json` and `mozak.md` in that folder instead of the repo. The folder works like a local scope (it needs `README.md` and `AGENTS.md`, created before `scope init`). mozak never clones, fetches, commits or pushes for such a scope, so it works offline and plans are never published. `sync` reports it as `source: "vault"`. `pull` clones the code only and leaves the plans where they are.
- **Visibility guard.** For a remote scope whose plans live in the repo, mozak asks the public GitHub API (no login, 5 second timeout) whether the repo is public, and caches the answer for 24 hours in the scope's meta file. A public answer refuses writes with `public-repo-plans` (exit 3) and adds a warning to `sync` and `scopes`. Reads are never blocked, and a failed check never blocks anything.
- **Inside a clone.** `context`, `plans`, `check` and `review show` may omit `--scope` when run inside a clone of an inventoried repo. The scope is found from the clone's `origin` URL (https, ssh, `github:` and local path forms). Writes always need `--scope`.
- **Auth.** mozak shells out to `git` (no shell, hard timeouts, no prompts), so your credential helper, for example `gh auth setup-git`, is used.
- A repo with no `mozak.json` at its root is reported as `scope-uninitialized` ("not a scope").

Cache layout: `.mozak-cache/<id>/` (sparse git clone) and `.mozak-cache/<id>.meta.json` (last fetch time, last error, full clone path). Deleting the cache is safe once everything is pushed. Unpushed commits in a sparse copy are pushed by the next `mozak sync`.

## 7. Known limits

- **One branch per remote scope.** There is no merge handling: a diverged remote makes a write or sync fail and the scope shows stale. The installer does not edit your `.gitignore`.
- **No network filesystems.** Locking and crash safety assume a local disk. Network filesystems and concurrent editors (sync tools writing the same files) are not covered.
- **Approval is a trusted-host convention.** mozak records the owner's approval message as given by the agent host. It does not authenticate the owner; an agent host that lies can forge an approval.
- **Restore needs the notes repo plus `mozak doctor --fix`.** Plans live in your notes (and private repos). A new machine needs that repo cloned, mozak installed, the MCP server connected, then `mozak doctor --fix` (section 3, Checking a setup).
- Crash safety: plan files are flushed to disk before they replace the old ones, and the folder after. On filesystems that ignore folder flushes this is best effort, and it always depends on the disk honouring flushes.
- Upgrading needs the source checkout the installation came from (or `--source PATH`), and only knows release tags of that checkout's `origin`.
- The source copy of the conversation skill is a template. The installer refuses an unrendered template. Load the skill only from the installed folder, directly or through a symlink.
- Older scope formats are refused. mozak does not migrate them.

## 8. Verification status

| Check | Status |
| --- | --- |

| W1 partial: P0.1 duplicate bypass and P0.2 merge capacity (2026-10-20, isolated worktree) | Passed: `npm run build`; targeted review/conversation/store/render tests 108 passed, 0 failed, 0 skipped (4022.780209 ms); `TMPDIR=$HOME/.cache/mozak-test-tmp ALLOW_ANY_IDENTITY=1 npm test` 458 passed, 0 failed, 0 skipped (79824.040083 ms). Test-first regressions reproduced four missed exact copies and missing 20+20 capacity refusal. Synthetic fixtures verify unrelated templates, 10+10 merge, normalized deduplication at 32/33, and approval-time capacity rechecks after either discussion grows; refusals preserve canonical and bridge bytes. Build retains the existing plugin CJS `import.meta` warning. This verifies P0.1/P0.2 only, not all W1 outcomes. |

| Bounded context reads: public core facade, built CLI and fresh built MCP; synthetic fixtures only | Verified 2026-10-20: six context-mode tests cover full/brief/focused/combined parity, unknown-plan and malformed-option refusal, actual handoff blockers, body/history omission, read-only bytes and CAS/stale recovery. Full suite: 452 passed, 0 failed/skipped (`TMPDIR` isolated, `ALLOW_ANY_IDENTITY=1`). Build/typecheck passed; existing plugin CJS `import.meta` warning remains. Installer suite: 69 passed, 0 failed, 1 skipped (case-sensitive filesystem required). No live installation was changed. |

| Public GitHub clone and install on macOS (Node 26.11.1, `8337e04`, isolated `HOME`) | Passed: clean clone, `npm ci --ignore-scripts`, build, install (67 files), `mozak --help`. The public clone contains no `mozak.json` or `mozak.md`. |
| README walkthrough with the fresh install | Passed: `scope init` for a local scope and a vault-plans scope for a real public GitHub repo, `scopes`, `context`, `plans`, `check`, `sync`, `pull --into ~/Downloads/x` (code only, 0 plan files), `context` with no `--scope` inside that clone, `mozak-mcp` (13 tools), `install-obsidian-plugin.mjs <vault> --build`, and the Contributing commands (416 tests, installer 69 passed and 1 skipped). |
| Linux relocation from a git archive, Node 24.11.0 | Passed earlier at `c324d45`: 334 tests, 0 failed. Reused the local npm cache. Not a clean machine. |
| Installer suite (70 tests): install, check, unchanged, conflict, partial, concurrency, symlinks, bounds, timeouts, unreadable target | Passed on macOS (69, 1 skipped) and Linux. |
| `mozak scopes` and `mozak_scopes` | Passed on both platforms. A fresh MCP session listed all scopes of a real workspace. |
| Installed skill loaded by a fresh agent host | Passed: jcode registered and loaded `/mozak` through a symlink to the installed skill. |
| CI on Ubuntu and macOS | Passing on every push, latest `2bd8cfc`. |
| Restoring a workspace from GitHub and a private vault | Built (`mozak doctor --fix`). Simulated 2026-10-18 on macOS with an isolated `HOME`: public clone at `v0.2.0`, build, install, plugin, a standard MCP setting, then `mozak doctor --fix` created both wrappers and both skill links and the only remaining failure was the synthetic scope with no `mozak.json` (fixed on `main`: clearer messages for that case). Owner run on a real fresh account or machine pending. |

Record the actual results of any new check here before claiming it passed.
