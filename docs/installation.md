# Installation, safety, and recovery

This guide covers building mozak from source, the portable installer, exit codes, and recovery. The short version is in the [README](../README.md).

**Status key:** *Verified* means checked in this repo. *Planned* means specified but not yet implemented. *Pending* means not yet run on the target platform.

| Area | Status |
| --- | --- |
| Pending-revision summary order and safe projection recovery | Verified 2026-10-29 on macOS, Node 26.11.1: build passed, all 495 tests passed, installer suite 73 passed and 1 skipped (case-sensitive filesystem required). Three built-CLI regressions and two core tests cover deterministic field order, official repair, unchanged canonical bytes and review subject, repeat repair, legacy filenames, merge metadata, and refusal of other edits. Test-first: CLI revision initially exited 5 with its own `bridge-conflict`; after sorting, recovery still failed `bridge-conflict` versus `bridge-stale` until the recogniser was added. With focused Node coverage, crapper scored the new recogniser 1.0, `pendingChangedFields` 8.1, `isOlderRender` 3.0 and `projectStatus` 7.1; unrelated existing functions still exceed 10. Dryer found no duplicate candidates at 0.8 across the three changed source files. Mutator killed all three selected recogniser mutants (not a whole-repo mutation run). Existing plugin CJS `import.meta` warnings remain. No live scope or installation was changed. |
| Fresh public GitHub clone, build, install and README walkthrough on macOS, Node 26.11.1 | Verified 2026-10-18 at `8337e04`: clean `git clone`, `npm ci --ignore-scripts`, build and install into a fresh prefix with an isolated `HOME` took about 8 seconds. Every README command then ran as written (section 8). |
| Full test suite on macOS, Node 26.10.0 and 24.11.0 | Verified 2026-11-01 on `release/0.5.0` (`9c26892`, version 0.5.0): 630 tests passed with three `TMPDIR` settings on each Node version, installer suite 73 passed and 1 skipped. Details and the verifier numbers are in [section 8](#8-verification-status). |
| Full test suite on macOS, Node 26.10.0 | Verified 2026-10-31 on branch `vnext/2a-fixes` (`b8e0f71` plus the 0.4.8 version bump, not yet merged or tagged): `npm ci --ignore-scripts && npm run build`, then `npm test` with `JCODE_SCRATCH_DIR` unset: 539 tests passed, 0 failed, with the default macOS `TMPDIR`, with `TMPDIR=/tmp` and with a realpath folder. Installer suite 73 passed, 1 skipped (case-collision test needs a case-sensitive filesystem). `npm run build:npm` built a package reporting 0.4.8, and the built CLI reports 0.4.8. New tests cover P0.1, P0.2, P0.5 to P0.7 (including `plan delete` under a concurrent edit), the SPEC banner and README network disclosure, accepted outcomes after late support, MCP error text, and a vault opened through a symlink. Not run on Linux or in CI. |
| Full test suite on macOS, Node 26.11.1 | Verified 2026-10-29 at `a8e0fa9` plus the 0.4.7 version bump: 497 tests passed, 0 failed. Installer suite 73 passed, 1 skipped (case-collision test needs a case-sensitive filesystem). New tests: `attach-spec` computes an omitted `discussionDigest` and refuses a stale supplied one, and `observe` flag errors list the allowed values for activity-kind, relation, classification and verdict. |
| Source build and tests on Linux, Node 24.11.0 | Verified earlier at `c324d45`: 334 core tests and 69 installer tests passed. CI covers Linux on every push since. |
| CI on Ubuntu and macOS, Node 24.11.0 and 26 | Passing on every push to `main` and every pull request, latest `81de182` (0.4.1). The release workflow for `v0.4.1` ran the tests again, attested the plugin assets and published the release. |
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
- `installation.json` uses format `mozak.installation/v1` and the installed package version (for example `0.4.1`). Its `contentDigest` covers the rendered bytes for this prefix. It is not a signed release identity.

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

It renames both files under the scope lock and regenerates the note so its link points to `mozak.json`. The plan bytes do not change, so approvals stay valid. It refuses a scope whose note has hand edits, or one that has both names. Commit the rename in your notes repo afterwards. On a case-insensitive disk, git needs `git add -A` to record a case-only rename.

### Update notice

`mozak scopes` adds an `update-available` issue, and the Obsidian sidebar a line under its header, when a newer release exists. The check reads GitHub's public tag list for `pitfa19/mozak` with no login, at most once every 24 hours (once an hour after a failure), in a background process, so commands never wait on the network. The answer is cached in `~/.local/state/mozak/update.json` (or `$XDG_STATE_HOME/mozak/update.json`). Set `MOZAK_NO_UPDATE_CHECK=1` to turn it off. Only an installed `mozak` checks; a source checkout never does.

### Checking a setup: `mozak doctor`

`mozak doctor [--config FILE] [--fix] [--json]` checks, in order: Node version; the installation (every file matches `installation.json`, `bin/mozak` runs) and its source checkout; that `mozak` and `mozak-mcp` on `PATH` are this installation; skill links in `~/.claude/skills`, `~/.jcode/skills` and `~/.codex/skills` (only folders that exist); the `mozak` server in `~/.claude.json` and `~/.jcode/mcp.json`; the inventory (from `--config`, else from the MCP settings) and that every scope reads; the Obsidian plugin in each vault under the inventory's folder; and the update notice. Each problem comes with the exact command or edit that fixes it. Exit 0 means no failures (warnings allowed), exit 3 means at least one failure.

`--fix` applies only safe fixes and reports each one:

- creates or replaces the `mozak` link in an existing skills folder (an old copied folder is moved to `mozak.backup-<date>`, an old link to `mozak.previous-link-<date>`, never deleted);
- creates missing `~/.local/bin/mozak` and `~/.local/bin/mozak-mcp` wrappers;
- reinstalls an outdated plugin copy into a vault, when the source checkout has this release's build.

It never edits MCP settings, the inventory or any plan file. For those it prints the change to make.

**Restoring on a new machine or account:** install Node, clone and build mozak, run the installer, clone your notes repo (with the inventory and the scope folders), connect the MCP server to the inventory, then run `mozak doctor --fix` and follow what it prints until it reports no failures.

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

- `mozak context --config INVENTORY --scope ID --brief --json` returns a bounded, body-free overview. Included plans retain title, lifecycle, accepted revision ID, pending revision ID/review state, handoff identity/health/authorization/eligibility/blockers, discussion status, review-needed flag and permitted next action. It omits plan content, observations/evidence, discussion bodies, specifications, decisions and revision history. Handoff bounds are explicitly omitted (`boundsOmitted: true`); read the full plan before execution.
- The overview admits whole plan rows within a 6000-byte pretty-JSON context budget. It orders execution-eligible work first, then other implementation-authorized work, pending/review-needed work, other active work and completed history, with exact ID ordering within each group. Completed plans with pending direction or review findings stay active. Other completed history is grouped in counts and capped at two rows. `summary` gives total/included/omitted counts for active work, history and each next action, plus whole-selection authorization and execution-eligibility counts, even when rows are omitted.
- Scope and plan display titles have a 160-byte UTF-8 prefix limit, plus an ellipsis. `titleOmittedBytes` reports removed source bytes when clipped. Identifiers and JSON are never sliced. `followUp` supplies command templates for listing plan IDs and reading one full plan. Replace the placeholders with the same inventory/scope and the exact plan ID; omitted rows are not absent plans.
- `mozak context --config INVENTORY --scope ID --plan PLAN --json` returns the full recovery DTO for exactly that plan. Unknown IDs return `plan-not-found`, exit 2, never an all-plan fallback.
- Both flags together return only the selected plan's brief summary. MCP `mozak_context` accepts the equivalent optional `brief` boolean and `plan` string. Scope selection and existing remote-refresh behavior are unchanged.

Every form preserves the full whole-scope `snapshot` for CAS, projection status and issues. Reads create no approvals and do not change canonical state or projections. These are response-size optimizations, not storage-format or I/O changes. The 6000-byte admission budget covers the context presentation, not the outer snapshot, diagnostics or remote-status envelope. Unusually large scope identifiers or diagnostics can still exceed the overall 8 KB target; they are not silently shortened. Full and focused reads remain unbounded recovery paths. The source skill starts with `--brief`, drills into `--plan PLAN` before work and uses that focused read after stale conflicts.

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

There is no force-unlock command. The owner route `mozak recover` removes one named lock only in two cases where no
local writer can still own it:

- the lock's `owner.json` names another host (`host` is recorded since S2). Such a lock can only have arrived by sync, for example through a `git add -A` in a vault.
- it names this host and a pid that is no longer running.

`check` reports a stuck lock as `write-lock-stuck` with its `token`, `host`, `pid` and `verdict`. The owner repeats those
in a request file: `{ "requestId", "scopeId", "lock": { "token", "host", "pid" }, "ownerRef", "ownerMessageAt" }`, then runs
`mozak recover --scope ID --request FILE`. It refuses a lock that changed, a lock with contents other than `owner.json`,
a live local pid (`lock-owner-alive`), and a lock without a host from an older mozak (`lock-host-unknown`, remove that
one by hand as above). It never touches `mozak.json`. Agents cannot run it, and the MCP server does not offer it.

### Projection tolerance

A `mozak.md` that differs from the current render only by CRLF line endings, trailing spaces or tabs, or blank lines at
the end counts as current, not as a bridge conflict. The next write puts back the exact render. Any other difference,
including leading or inner whitespace, is still a conflict.

### Pruning rejected plans: `mozak plan prune --rejected`

Owner route. The request lists the plan ids the owner saw: `{ "operationId", "scopeId", "expected", "planIds", "ownerRef", "ownerMessageAt" }`.
Only plans that were never accepted and whose revision is rejected can be pruned. A plan another plan still references (a
pending merge, a reasoning link) is refused with `prune-referenced`. The write is a normal CAS write and is never rebased.
Its receipt `{ "action": "prune-rejected", "ids": [...] }` is the prune record: owner refs to a pruned id resolve as
`pruned` (with the operation id), `check` reports `ref-target-pruned`, and the id cannot be proposed again. A 0.4.0
client reads such a scope unchanged.

### Hand edits: `mozak check --history N`

Every mozak write sets a new `storage.revision` and records it in a receipt. `check --history N` walks the last N commits
(1 to 500) that touched the scope's `mozak.json`, from local git objects only, and reports `hand-edit` for a commit that
changed the file but kept the revision (with removed and added plan ids), and `hand-edit-revision` for a revision that no
receipt records. Outside git it reports `history-unavailable` and skips the walk.

### Syncing a vault: `mozak sync --scope ID` or `mozak sync --local`

For a scope inside a git repo (usually your vault), `sync` replaces a bare `git pull --rebase`, which bypasses the scope locks. Per repo
it fetches the upstream of the current branch outside the locks, takes the write lock of every inventoried
scope in that repo in path order, runs `git merge --ff-only`, and releases. It never rebases, merges a
diverged history or pushes. Row status: `fast-forwarded`, `up-to-date`, `ahead` (local commits to push), or a problem:
`not-fast-forward` (exit 3, nothing changed), `busy` (exit 4, a scope lock is held), `fetch-failed`, `merge-failed`,
`no-upstream`, `detached`, `not-in-git`. Plain `mozak sync` syncs every such repo. `--local` is still accepted and means
the same (before 0.6.0 it added the vault repos to the remote scopes).

### Projection repair

If a write saved the JSON but not the generated `mozak.md` bridge, the result says so (exit 5). Later semantic writes wait until you run an explicit `projection repair`. `check` never repairs anything.

Versions through 0.4.6 could also produce a conflict themselves after revising several fields: the pending-summary field list followed request key order, while the saved JSON used sorted keys. New renders sort that display list. Repair recognises an old list only when reordering its known field labels makes the entire file exactly match the current render of the same graph. Outcome counts, merge metadata, graph hash and every other byte must match. Other hand edits remain conflicts and are preserved. Repair changes only `mozak.md`, not plan content, approval subjects or review digests, and a repeat reports `already-current`.

### Parallel writes: `concurrency.rebase` (experimental, off by default)

Every write names the snapshot it was based on. By default any other write in between makes it `stale-input` (exit 3), even when the two writes do not touch the same thing. A scope can opt in to read-set rebase in the `mozak-settings.json` next to the inventory file (the same file as the annotation settings, see `docs/annotations.md`):

```json
{ "format": "mozak.settings/v1",
  "concurrency": { "rebase": false },
  "scopes": { "my-scope": { "concurrency": { "rebase": true } } } }
```

A per-scope value wins over the top-level `concurrency.rebase`. A missing or invalid file keeps the default (off), and `check` reports an invalid one. A `mozak-settings.json` inside a scope folder is not read. `check` reports it as `settings-scope-file-deprecated`.

With rebase on, a stale write can still commit onto the fresh state when it only appends:

- `observe`: each linked outcome keeps its revision and display status, no one else superseded the same observation, and its ids are still free.
- `save-discussion`: that plan's discussion was not saved in between.
- `propose` of a new id: the id is still free. The duplicate check runs on the fresh state.

Owner decisions, `revise`, `complete` and `attach-spec` are never rebased. Any of them in between also refuses the rebase. Only a snapshot equal to the current revision or to a retained receipt's revision can rebase. A rebased result carries `rebased: { from, onto }` and the fresh `snapshot`, so the next write needs no reread. A refused rebase is a normal `stale-input` with the reason in the message.

Limits: the writes in between are found through receipt times. A write merged by git from a machine whose clock is behind can be missed, so a non-rebasable receipt up to 1 second before the snapshot's receipt also refuses. Hand edits to `mozak.json` that keep the same revision always refuse.

## 6. Safety rules

- **No secrets in this repo.** Do not paste tokens, passwords, or keys into files, commands, or chat. The installer never copies credentials.
- **No global changes.** Installing, testing, and building do not change your installed commands, skills, shell profile, or other agent settings.
- **Owner decisions are real decisions.** Direction and implementation approvals need a real owner message that matches the displayed subject. Tool output, quotes, swarm messages, and reminders do not count.
- **Use only the scopes you list.** The inventory file is explicit. Every CLI and MCP call needs `--config FILE`. The MCP server needs it at startup.
- **Do not onboard real projects while testing.** Use an isolated test folder and synthetic data.

## 6a. Focus list

Every scope entry in the inventory may carry `focus`: an array of unique plan ids the owner starred. The Obsidian sidebar shows them in its Focus tab.

```json
{ "id": "atlas-app", "root": "./atlas-app", "focus": ["launch", "billing"] }
```

- `mozak focus list [--scope ID] [--json]` reads the lists. MCP has the read-only tool `mozak_focus`. Agents cannot write focus.
- `mozak focus add|remove --scope ID --plan ID` (owner) and the sidebar star change one list. The write takes the inventory lock (`.mozak-inventory-lock` next to the inventory file), writes a flushed temp file, checks it with the normal inventory loader, then renames it into place. Entry order, indent and every other key (including `x`) stay as they were. `add` refuses an unknown scope or plan. Adding twice or removing an id that is not there changes nothing.
- Focus is not plan state. `mozak.json` and `mozak.md` never change, and the inventory digest (format plus sorted id and root) ignores it.
- A starred id that is no longer a plan is a `check` warning (`focus-unknown-plan`), never an error. Remove it with `mozak focus remove`.
- mozak before 0.5.0 refuses an inventory with `focus` (`unknown key "focus"`). Upgrade every machine that reads the inventory before starring a plan.

## 6b. Vault-only scopes (0.6.0)

Every scope entry is `{ "id", "root" }`, plus the optional `focus` list and `repo` link. The `root` must be a folder inside an Obsidian vault: some folder at or above it holds a `.obsidian` folder. mozak checks this when it loads the inventory. An entry outside a vault is listed as a failed scope with `scope-outside-vault`, and every route refuses it, while the other scopes keep working. `mozak doctor` names the `scope move` command for it.

```json
{
  "format": "mozak.local/v3",
  "scopes": [
    { "id": "atlas-app",  "root": "./creations/atlas-app", "repo": "github:pitfa19/atlas-app" },
    { "id": "lab-notes",  "root": "./research/lab-notes" }
  ]
}
```

- **Repo link, display only.** `repo` is `github:owner/repo` or an `https://` URL. The Obsidian sidebar shows it as a link on the scope row and `mozak scopes` prints it. mozak never uses it for git or the network, and the inventory digest ignores it (as with `focus`). Set or clear it with `mozak scope link --scope ID (--repo SPEC | --clear)` (owner). mozak before 0.6.0 refuses an inventory with a `repo` key, so add links only after every machine runs 0.6.0.
- **Agents in a code repo.** Agents work in the code repo and name the scope with `--scope`. mozak does not guess a scope from the current folder or its git origin.
- **Network.** No read or write route fetches, clones or pushes for a scope. `mozak sync` fast-forwards the vault repositories (see [Syncing a vault](#syncing-a-vault-mozak-sync---scope-id-or-mozak-sync---local)). A write with `--commit` commits the scope's two files in its vault repository and pushes when that branch has an upstream.

## Moving to 0.6.0

0.6.0 removes GitHub repo scopes: entries with `remote`, `ref` or `plans`, `mozak pull`, the remote part of `mozak sync`, the `mozak_sync` MCP tool, the `.mozak-cache` sparse clones and the public-repo check. A local entry whose folder is not inside a vault (for example a code repo holding `mozak.json`) is refused too. Nothing is deleted: 0.6.0 lists each such entry as a failed scope, with the exact command to move it, and every other scope keeps working.

`mozak scope move` (owner) moves one scope:

```sh
mozak scope move --config INVENTORY --scope ID --to PATH [--repo SPEC] --owner-ref REF --owner-message-at ISO --reason TEXT [--dry-run] [--json]
mozak scope move --config INVENTORY --scope ID --drop --owner-ref REF --owner-message-at ISO --reason TEXT [--dry-run] [--json]
```

- `--to PATH` is the new folder, inside a vault (relative paths resolve against the inventory's folder). mozak copies `mozak.json`, `mozak.md`, the annotations sidecar, `README.md` and `AGENTS.md`, checks every copy byte for byte, then rewrites only that inventory entry to `{ "id", "root": PATH }` (plus `repo` when given) under the inventory lock, with the same validated atomic write as `focus`. Every other key (including `focus` and `x`) and every other entry stays as it was.
- It reads the files from wherever the scope is today: a local folder, a pre-0.6 vault-plans folder, the full clone `mozak pull` made, or the `.mozak-cache/<id>` sparse copy. The plan file stores the scope id, not its path, so plans, receipts and approvals stay valid.
- It refuses a target outside a vault (`move-target-outside-vault`), a target that already holds mozak files (`move-target-has-scope`, `move-target-file-exists`), a source that fails `check` (`move-source-fails-check`), and an inventory changed since it was read (`stale-input`). A failure before the inventory is replaced removes what it copied, so the old files and the old inventory stay valid. Running it again after a success changes nothing.
- The old files stay in place. Delete them yourself once you have checked the new folder (for a code repo, as a commit there). Attached specification files are not copied: the result lists each as a `spec-not-moved` warning so you can copy it by hand.
- `--drop` removes an entry with 0 plans from the inventory instead. Its files stay.
- `--dry-run` prints the files it would copy, their sizes and hashes, and the new entry, and writes nothing.

Steps:

1. On 0.5, run `mozak sync --scope ID` for every repo scope whose plans live in its repo, so the cache holds the newest plans.
2. With the 0.6.0 CLI (a scratch install is enough, the inventory keeps working with 0.5 as long as it has no `repo` keys), run `mozak scope move ... --dry-run` for every failed scope, check the list, then run the same commands without `--dry-run`. Use `--drop` for entries you no longer need.
3. Run `mozak scopes`: 0 failed. Run `mozak check --scope ID` for each moved scope: 0 issues. Commit and push your vault.
4. Upgrade every machine to 0.6.0 (`mozak upgrade`), then add repo links with `mozak scope link --scope ID --repo github:owner/repo`.
5. Delete the old plan files from the code repos and remove `.mozak-cache/` next to the inventory (keep `.mozak-cache/usage/` if you use the usage log).

The Obsidian plugin drops its old **Repo sync interval** setting on its own.

## 7. Known limits

- **One branch per vault repo.** `mozak sync` only fast-forwards: a diverged vault branch is reported as `not-fast-forward` and left for you to merge. The installer does not edit your `.gitignore`.
- **No network filesystems.** Locking and crash safety assume a local disk. Network filesystems and concurrent editors (sync tools writing the same files) are not covered.
- **Approval is a trusted-host convention.** mozak records the owner's approval message as given by the agent host. It does not authenticate the owner; an agent host that lies can forge an approval.
- **Restore needs the notes repo plus `mozak doctor --fix`.** Plans live in your vaults. A new machine needs those repos cloned, mozak installed, the MCP server connected, then `mozak doctor --fix` (section 3, Checking a setup).
- Crash safety: plan files are flushed to disk before they replace the old ones, and the folder after. On filesystems that ignore folder flushes this is best effort, and it always depends on the disk honouring flushes.
- Upgrading needs the source checkout the installation came from (or `--source PATH`), and only knows release tags of that checkout's `origin`.
- The source copy of the conversation skill is a template. The installer refuses an unrendered template. Load the skill only from the installed folder, directly or through a symlink.
- Older scope formats are refused. mozak does not migrate them.
- `mozak similar` is lexical. It finds copies and near copies, and supersession only when the newer plan names the older one or the older one was rejected. Plans that mean the same thing in different words are not found.

## 8. Verification status

| Check | Status |
| --- | --- |
| 0.5.0 full gate on `release/0.5.0` (`9c26892`, 2026-11-01, macOS 27 arm64, Node 26.10.0 and Node 24.11.0) | Passed on both Node versions: `npm ci --ignore-scripts`, `npm run build`, then `npm test` with `JCODE_SCRATCH_DIR` unset, 630 of 630 with the default macOS `TMPDIR`, with `TMPDIR=/tmp` and with a realpath folder. `npm run test:install` 73 passed, 1 skipped (case-collision test needs a case-sensitive filesystem). `npm run typecheck` and `npm run lint` (33 Markdown files, 61 relative links, 0 broken) passed. `npm run build:npm` built `mozak 0.5.0` and its CLI prints `0.5.0`. The version check from `release.yml`, run locally for tag `v0.5.0`: package, root manifest and plugin manifest all `0.5.0`, all three plugin assets present. Linux runs in CI on the pull request. |
| 0.5.0 verifiers (same commit, both Node versions) | V-race, V-ref and V-dup tests (`rebase.test.ts`, `scope-process.test.ts`, `vref.test.ts`, `vdup.test.ts`): 41 of 41. `node scripts/verify-dup.ts`: precision 1.000, recall 0.988, 0 templated duplicates. `node scripts/verify-latency.ts` (23 synthetic scopes, 230 plans): `plans.md` max 19.5 ms (budget 1000), CLI 62 ms, 460 locators max 25.3 ms (budget 300). |
| 0.5.0 large-store stress, V-race 9 at 1000 write attempts (Node 26) | `MOZAK_VRACE_KILL_OPS=1000`, 8 writers, think 1 to 2 s, rebase on, kill -9 once per round. Two runs: 1007 and 1003 attempts, 605 and 609 commits, 0 violations, 31 of 31 locks left by killed writers cleared by `recover`, commit p50 95.2 and 100.1 ms, **p95 222.9 and 219.6 ms** (target 300 ms), max 629.4 and 649.5 ms. V-race 1 (3 agents x 10): flag off 46 of 76 attempts wasted, flag on 0 of 30, 0 lost either way. |
| 0.5.0 old client and upgrade (scratch prefixes only) | `scripts/verify-old-client-sidecar.sh` with `OLD_CLI` set to a scratch install of `v0.4.7`: the old CLI reads, checks and writes a scope with an annotations sidecar, the sidecar is unchanged, and the branch reads one edge with 0 dangling. `mozak upgrade` from a scratch `v0.4.7` install against a local mirror tagged `v0.5.0`: `upgraded`, `mozak --version` 0.5.0, the plugin in a scratch vault went from 0.4.7 to 0.5.0, the old install kept as `mozak.previous-0.4.7`, the source checkout back on its branch and clean, and a second run reported `up-to-date`. |
| 0.5.0 on real plan data (read only, copies) | 26 local and vault-plans scopes copied from the owner's inventory (1 GitHub repo scope without a local copy skipped). `render --all` with the branch reported all 26 current, `check` found 0 issues in each, and a fresh render of every `mozak.json` with the 0.4.7 core and the 0.5.0 core is byte-identical to the stored `mozak.md` (26 of 26). `context --brief` on the real `mozak` scope through a scratch install: 6168 bytes. Focus on a copy of the inventory: add, idempotent add, list, unknown plan refused with exit 2, only the `focus` key changed; 0.4.7 refuses the starred inventory with `unknown key "focus" in scope entry` (expected); removing the last plan leaves `"focus": []`. |
| P0.5 to P0.7 storage hygiene on `vnext/2a-fixes` (2026-10-31, macOS, Node 26) | Passed: `npm test` with `JCODE_SCRATCH_DIR` unset, 529 of 529 with the default macOS `TMPDIR`, with `TMPDIR=/tmp` and with a realpath folder. P0.5: `init` and projection repair add the write-lock and temp-file ignore lines, `check` reports `lock-not-ignored` and `lock-in-git`. P0.6: `mozak.json` and `mozak.md` are hashed again right before each rename (`graph-changed-during-write`), for propose, retitle, init and `plan delete` (a new delete test failed before the fix and passes after). P0.7: a reserved `x` object in the inventory or a scope entry is accepted and reported as `inventory-x-ignored`. The rename check narrows the direct-editor race, it does not close it. |
| P0.1 duplicate bypass and P0.2 merge capacity on `vnext/2a-fixes` (2026-10-31, macOS, Node 26) | Passed: `npm ci --ignore-scripts && npm run build`, then `npm test` with `JCODE_SCRATCH_DIR` unset: 510 of 510 with the default macOS `TMPDIR`, with `TMPDIR=/tmp` and with a realpath folder. Exact copies with different id numbers are now refused as `duplicate-plan-candidate`, and a merge over 32 discussion questions is refused as `merge-capacity` at propose and at approval instead of being cut. Two existing fixtures that repeat one direction on purpose pass `distinctFromPlanIds`. |
| Agent ergonomics on `vnext/2a-fixes` (2026-10-31, macOS, Node 26) | Passed: `env -u JCODE_SCRATCH_DIR node --import ./scripts/test-git-isolation.mjs --test --experimental-strip-types packages/cli/test/agent-ergonomics.test.ts`: 11 of 11 (decide, delete and observe flag forms, dry-run writes nothing, provenance required, `--spec` mismatch refusal, revise and decide warnings, `plan show` size and fields, MCP `mozak_decide` off by default, help lists the flag forms, invalid observe kinds). Part of the full suite below. Measured on synthetic temp scopes only. |
| Brief and bounded context reads on `vnext/2a-fixes` (2026-10-31, macOS, Node 26) | Passed: `packages/cli/test/context-modes.test.ts` 9 of 9 through core, the built CLI and the built MCP (brief keeps snapshot, pending work, handoff blockers and next action without plan bodies, bounds growth over many plans and long UTF-8 titles, counts omitted history, focused recovery and stale-snapshot recovery, malformed options refused without writes). Synthetic fixtures only, no real vault measured. |
| Full suite on `vnext/2a-fixes` (2026-10-31, macOS, Node 26) | Passed: `npm ci --ignore-scripts && npm run build`, then `npm test` with `JCODE_SCRATCH_DIR` unset, 539 of 539 with the default macOS `TMPDIR` (`/var/folders/.../T/`), with `TMPDIR=/tmp` and with a realpath folder. On `main` (`c170eb0`) the same commands failed 11 tests with the default `TMPDIR` and 7 with `/tmp` (symlinked scratch paths), fixed here. The plugin build keeps its existing CJS `import.meta` warning. Not run on Linux or the mini's live install. |
| Public GitHub clone and install on macOS (Node 26.11.1, `8337e04`, isolated `HOME`) | Passed: clean clone, `npm ci --ignore-scripts`, build, install (67 files), `mozak --help`. The public clone contains no `mozak.json` or `mozak.md`. |
| README walkthrough with the fresh install | Passed: `scope init` for a local scope and a vault-plans scope for a real public GitHub repo, `scopes`, `context`, `plans`, `check`, `sync`, `pull --into ~/Downloads/x` (code only, 0 plan files), `context` with no `--scope` inside that clone, `mozak-mcp` (13 tools), `install-obsidian-plugin.mjs <vault> --build`, and the Contributing commands (416 tests, installer 69 passed and 1 skipped). |
| Linux relocation from a git archive, Node 24.11.0 | Passed earlier at `c324d45`: 334 tests, 0 failed. Reused the local npm cache. Not a clean machine. |
| Installer suite (70 tests): install, check, unchanged, conflict, partial, concurrency, symlinks, bounds, timeouts, unreadable target | Passed on macOS (69, 1 skipped) and Linux. |
| `mozak scopes` and `mozak_scopes` | Passed on both platforms. A fresh MCP session listed all scopes of a real workspace. |
| Installed skill loaded by a fresh agent host | Passed: jcode registered and loaded `/mozak` through a symlink to the installed skill. |
| CI on Ubuntu and macOS | Passing on every push, latest `2bd8cfc`. |
| Restoring a workspace from GitHub and a private vault | Built (`mozak doctor --fix`). Simulated 2026-10-18 on macOS with an isolated `HOME`: public clone at `v0.2.0`, build, install, plugin, a standard MCP setting, then `mozak doctor --fix` created both wrappers and both skill links and the only remaining failure was the synthetic scope with no `mozak.json` (fixed on `main`: clearer messages for that case). Owner run on a real fresh account or machine pending. |

Record the actual results of any new check here before claiming it passed.

### CLI config placement, 2026-10-27

- macOS, Node 26.11.1: `npm run build` passed with the existing plugin `import.meta` warnings. `npm test` passed 481 tests, 0 failed or skipped. Synthetic CLI subprocess tests cover leading `--config FILE` and `--config=FILE` for one- and two-word routes, parity with the existing placement, and duplicate and unknown flag rejection. The installed CLI was not updated or tested for this change.

### 0.4.0 submission preparation, 2026-10-21

- macOS source build and 447 unit/regression tests passed with `GIT_CONFIG_GLOBAL=/dev/null` (the laptop's global hooks otherwise override a test fixture's rejecting Git hook). The installer suite also passed: 69 passed, 1 skipped, 0 failed.
- The real bundled plugin is rebuilt by a regression test and contains no release-tags fetch, refresher script or spawned update process. Its update notice still reads the CLI-written cache. The CLI update checker is unchanged.
- Source typechecks against Obsidian API definitions 1.5.7, 1.6.6, 1.7.2 and 1.8.7 passed. This is compile-time evidence only, not an app-runtime test. The plugin now conservatively declares `minAppVersion: 1.14.4`, matching the owner's currently used Obsidian installation. No clean-install runtime smoke test of this new bundle has been claimed.
- Release assets are attached to a tag equal to the manifest version (`0.4.0`). The `v0.4.0` tag remains for the CLI updater. The release workflow refuses to reuse a numeric tag pointing at a different commit and checks out the requested tag for manual reruns.

### Test git isolation, 2026-10-26

- `npm test` and `npm run test:install` now preload `scripts/test-git-isolation.mjs`, which points `GIT_CONFIG_GLOBAL` at a fresh temp file. On the laptop with a global `core.hooksPath` pre-push guard: before, 458 of 478 passed (20 remote and vault tests refused by the guard); after, 479 of 479 passed (with the new `git-isolation` regression test) and the installer suite 73 passed, 1 skipped, 0 failed. The regression test fails when run without the preload.
