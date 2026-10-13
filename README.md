<div align="center">

# MOZAK

**Agentic planning for developers and researchers. Plain files in git and Obsidian.**

You own the plan. The agent does the work.

[![CI](https://github.com/pitfa19/mozak/actions/workflows/ci.yml/badge.svg)](https://github.com/pitfa19/mozak/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![Node 24](https://img.shields.io/badge/node-24.11%2B-339933?style=flat-square)](docs/installation.md)
[![Platforms](https://img.shields.io/badge/platforms-Linux%20%7C%20macOS-blue?style=flat-square)](docs/installation.md)

<img src="docs/assets/overview.gif" alt="A purple packet travels between GitHub, an agent, and Obsidian, lighting up MOZAK at the centre each time information passes through" width="760">

[Install](#install) · [How it works](#how-it-works) · [Demo](#see-it-run) · [Safety](#safety) · [Docs](docs/installation.md)

</div>

---

## Why

Your work lives in git repos and note folders. Your agent forgets both between sessions, so you explain everything again, and nothing stops two agents from overwriting each other.

MOZAK keeps each project's plan, decisions, and evidence in plain files inside the project itself. Any agent can read them. Nothing changes until you approve it.

- **Local-first.** No cloud, no account, no background process.
- **Plain files.** `MOZAK.json` is the plan. `MOZAK.md` is a readable bridge. Both live in your repo or Obsidian vault, and git keeps the history.
- **You approve.** Direction and implementation are separate decisions. One "yes" never covers both.
- **Safe with several agents.** A stale write is refused, never merged silently.

## Install

You need Git, npm, and Node 24.11 or later.

```bash
git clone https://github.com/pitfa19/mozak.git && cd mozak
npm ci --ignore-scripts && npm run build
mkdir -p "$HOME/.local/share"
node scripts/install.mjs --prefix "$(cd "$HOME/.local/share" && pwd -P)/mozak" --json
```

The installer copies a self-contained build into a new folder. It uses no `sudo`, makes no network calls, and changes no shell profile or `PATH`. It never overwrites an existing install. Add `--check` to preview first. Then use the installed commands:

```bash
"$HOME/.local/share/mozak/bin/mozak" --help
"$HOME/.local/share/mozak/bin/mozak-mcp" --config inventory.json   # MCP server over stdio
```

Details, exit codes, and recovery: [docs/installation.md](docs/installation.md).

## How it works

A **scope** is a git repo or a notes folder. You list the scopes you want in one `inventory.json`. MOZAK reads only those and never crawls your disk.

1. **Register.** Each scope gets a `MOZAK.json` next to its `README.md` and `AGENTS.md`.
2. **Propose.** An agent drafts a plan. It waits as *awaiting approval*.
3. **Approve.** You approve the direction. This starts planning, not coding.
4. **Build.** A spec is attached. You approve implementation separately, then bounded work runs.
5. **Remember.** Decisions and evidence are saved back into the scope's files, so the next session picks up where the last one stopped.

```json
{
  "format": "mozak.local/v2",
  "scopes": [
    { "id": "atlas-app",   "root": "./atlas-app" },
    { "id": "field-notes", "root": "./field-notes" }
  ]
}
```

Open `plans --all` and you see every scope grouped as **Completed**, **Open**, and **Awaiting approval**.

To find out what exists, run `mozak scopes`. It lists every scope in your inventory with its folder, title, plan counts, and which entry files are present. Your agent gets the same index from the `mozak_scopes` MCP tool, so it can navigate a whole vault without being told where anything is. The index is read-only. It returns no plan text, evidence, or decisions, and a scope it cannot read is listed with its error instead of being skipped.

## See it run

<div align="center">
<img src="docs/assets/demo-terminal.gif" alt="Terminal recording: register two scopes, propose, approve, a stale write is refused, a new process recovers the saved plan, git shows the diff" width="760">
</div>

Real commands against a throwaway repo and notes folder. The typing pace is scripted and the output is the real CLI's. The data is synthetic.

A side-by-side video for sharing is [docs/assets/demo-split-screen.mp4](docs/assets/demo-split-screen.mp4). To regenerate the media, see [docs/assets/src](docs/assets/src).

## Use it with your agent

| You want | Use |
| --- | --- |
| Find every scope and where it lives | `mozak scopes`, or the `mozak_scopes` MCP tool |
| Read or check a project | `mozak context`, `plans`, `check` |
| Let an agent read and propose over MCP | `mozak-mcp --config inventory.json` (any MCP client) |
| Run the guided conversation | the installed skill at `PREFIX/skills/mozak-conversation/SKILL.md` |

Every call needs an explicit `--config`. MOZAK never falls back to a global setting. Load the skill by its exact installed path.

## Safety

- **Real approvals only.** Only an owner decision that matches what was displayed counts. Quotes, tool output, and reminders do not.
- **No overwrites.** Writes carry the snapshot they were based on. A write based on an out-of-date snapshot is refused, and nothing is overwritten.
- **No credentials.** Nothing here asks for, prints, or stores them.
- **Honest limits.** Owner approval follows a trusted-host convention and is not authentication. Concurrency guarantees cover cooperating processes on a local filesystem, not network drives or power loss.

## Works well with

[**Monokl**](https://github.com/pitfa19/monokl) is a separate, optional research tool: a small agent-agnostic research runner with durable evidence and explicit human approval. It is a companion, not a requirement, and MOZAK works fully without it.

## Platforms

Linux and macOS, on Node 24.11 or later. CI runs both on every push.

## Contributing

```bash
npm ci --ignore-scripts && npm run build
npm test && npm run test:install
```

Run the tests before opening a pull request.

## License

MIT. See [LICENSE](LICENSE).
