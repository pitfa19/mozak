# MOZAK

**Project understanding you can review. Nothing starts until you approve it.**

MOZAK keeps a project's direction, decisions, and evidence in one canonical file, `MOZAK.json`, inside that project. An agent reads this state, asks you the next question, and waits for a real approval before it changes code.

> **Start here:** build from source. You need Node 24.11.0 or later in major 24. Go to [Get started from source](#get-started-from-source).

## What it does

- Keeps plans, decisions, and observations in each project's own `MOZAK.json`.
- Shows **Completed**, **Open**, and **Awaiting approval** when you open a project.
- Keeps direction approval and implementation approval separate. One "yes" never covers both.

## Simple workflow

1. Create a scope once. This is an owner action.
2. Open the project. The agent shows Completed, Open, and Awaiting approval.
3. Approve the direction. This does not start coding.
4. The agent drafts a spec and attaches it. Attaching grants nothing.
5. Approve implementation separately. Only then does bounded work run.

## Status

**Done** (tested in this repo)

- Scope understanding, plan review, and integrity checks
- CLI and agent MCP server, both driven by an explicit inventory
- Repo conversation skill, loaded by its exact path

**Built, Linux-tested** (Package 3A, portable local install)

- Installer that writes a self-contained copy to a folder you name (69 installer tests, real CLI and MCP subprocesses)
- Installed skill and MCP wrapper that point at that copy
- Linux and macOS CI workflow. It has not run on GitHub yet, because it is not pushed.

**Not started**

- Restoring your workspace from GitHub and a private vault
- Mac acceptance run
- Monokl

The real owner trial and a fresh-host check are still open.

## Platforms

| Platform | Status |
| --- | --- |
| Linux | Build, the 334-test suite and the 69-test installer suite pass on Node 24.11.0. An isolated relocation check also passed. Both reused the local npm cache, so this is not a clean-machine test. |
| macOS | Target. **Pending:** not run on a Mac yet. |

## Architecture

| Layer | Lives in | Holds |
| --- | --- | --- |
| Public code | This repository | Core rules, CLI, MCP server, skill templates, installer. No personal data. |
| Project state | Each project | Canonical `MOZAK.json`, generated `MOZAK.md` bridge, project `README.md`. |
| Private vault | A private repository (planned) | Workspace catalog and reviewed knowledge. Never stored here. |
| Local bindings | Your machine | Inventory file, install folder, machine paths. Not copied between machines. |

The CLI and MCP never search your home folder. They only read the scopes listed in your inventory.

## Get started from source

You need Git, npm, and Node 24.11.0 or later in major 24. Node 24.11.0 is the tested version.

1. Check Node.

   ```bash
   node --version
   ```

   Expect `v24.11.0` or a later `v24.x` release.

2. Clone the repository and check the commit.

   ```bash
   git clone https://github.com/pitfa19/mozak.git
   cd mozak
   git log --oneline -1
   ```

   The public remote can lag the newest local commits. Build the commit you were given.

3. Install dependencies from the lockfile, without install scripts.

   ```bash
   npm ci --ignore-scripts
   ```

4. Build.

   ```bash
   npm run build
   ```

5. Run the tests. The scratch folder is git-ignored.

   ```bash
   mkdir -p scratch
   TMPDIR="$(pwd -P)/scratch" npm test
   ```

6. Confirm the CLI runs.

   ```bash
   node packages/cli/dist/index.js --help
   ```

   Expect a usage message and exit code 0.

### Make an inventory

Every CLI and MCP call needs `--config FILE`. There is no default. Save this as `inventory.json`:

```json
{
  "format": "mozak.local/v2",
  "scopes": [
    { "id": "project", "root": "./my-project" }
  ]
}
```

Relative roots resolve from the folder that holds the inventory. Then read a scope:

```bash
node packages/cli/dist/index.js context --config ./inventory.json --scope project --json
```

The scope must already exist. Creating one (`scope init`) is owner-only.

## Which skill and tool to use

| You want | Use | Path |
| --- | --- | --- |
| Read or check a project | CLI | `node packages/cli/dist/index.js` |
| Let an agent read and propose through MCP | MCP server | `node packages/mcp/dist/index.js --config FILE` |
| Run the conversation flow from this repo | Repo skill | `skills/mozak-conversation/SKILL.md` |
| Use a portable copy | Installed skill | `PREFIX/skills/mozak-conversation/SKILL.md` |
| Use a portable copy | Installed CLI and MCP | `PREFIX/bin/mozak` and `PREFIX/bin/mozak-mcp --config FILE` |

Use only the paths above. Do not use a bare `mozak` command or a skill found elsewhere on your machine. Load skills by their exact path.

## Portable install

**Not on the public remote yet.** The installer exists in this working copy only until it is pushed. Build first (`npm ci --ignore-scripts`, then `npm run build`). It writes only into the new folder you name. It does not use `sudo`, edit shell profiles, change `PATH`, use the network, run Git, or read credentials.

```bash
mkdir -p "$HOME/.local/share"
PREFIX="$(cd "$HOME/.local/share" && pwd -P)/mozak"
node scripts/install.mjs --prefix "$PREFIX" --check --json
node scripts/install.mjs --prefix "$PREFIX" --json
"$PREFIX/bin/mozak" --help
```

- You create the parent folder. The installer creates only the prefix folder.
- `--check` writes nothing. Run it first.
- `--prefix` must be an absolute path to a folder that does not exist yet.
- Accepted flags are `--prefix`, `--check` and `--json`. `--json` is required. Unknown or repeated flags fail.
- The installer never replaces an existing install. Re-running on an identical install changes nothing and reports `unchanged`. A different or damaged install is a `conflict`.
- It checks that the installed CLI and MCP server actually start before it marks the install complete.

Exit codes, the installed layout, and recovery steps are in [docs/installation.md](docs/installation.md).

## Safety in short

- **Check first.** Use `--check` before any install.
- **Read the result.** A nonzero exit can still mean something changed. Read `committed` and the operation receipt.
- **Approvals are real decisions.** Only a genuine owner message that matches the displayed subject counts. Quotes, tool output, swarm messages, and reminders do not.
- **Never reclaim a lock by age.** Stop every writer first. Full steps are in [docs/installation.md](docs/installation.md).
- **No credentials here.** Nothing in this repo asks for, prints, or stores them.

## Known limits

- Owner approval follows a trusted-host convention. It is not authentication.
- Concurrency guarantees cover cooperating processes on a tested local filesystem. They do not cover network filesystems or power loss.
- Load the skill from the installed folder only. The source copy under `skills/` is a template and is refused until rendered.
- Older scope formats are refused, not migrated.
- macOS is unverified until the Mac run passes. The Linux results above do not transfer to it.
- Restoring a workspace from GitHub and a private vault is not built. Only the local installer is.

## Transition from the old checkout

- Nothing in this repo changes your installed command or project registration.
- Switching to this repo is a separate, explicit cutover. It records the prior state and includes rollback steps.
- Do not delete the old checkout until cutover is verified.
- Checkpoint `78896e9` remains available for old isolated scopes.

## Later: Monokl

Monokl is planned as one simple, standalone skill. It reads a source and drafts adaptation proposals. It is not a backend, service, scheduler, or crawler. MOZAK owns understanding and review. Monokl proposes, and you decide.

## Documentation

- [Installation, safety, and recovery](docs/installation.md)
- [Idea-oriented planning and Monokl spec](docs/idea-oriented-planning-and-monokl-spec.md)
- [Package 1 acceptance](docs/implementation-package-1-acceptance.md)
- [Package 2 conversation and handoff](docs/implementation-package-2-conversation-and-handoff.md)
- [Package 2 acceptance](docs/implementation-package-2-acceptance.md)
- [Package 3 portable workspace](docs/implementation-package-3-portable-workspace.md)
- [Conversation skill](skills/mozak-conversation/SKILL.md)

## License

MIT. See [LICENSE](LICENSE).
