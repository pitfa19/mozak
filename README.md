<div align="center">

<img src="docs/assets/hero-pixel.gif" width="160" alt="Pixel-art MOZAK brain: a spark runs along the gold, purple and green circuits in turn">

# MOZAK

**Use Obsidian as your IDE.**

You work in ideas and plans, not code. Agents build in parallel, and you orchestrate them from your notes.

[![CI](https://github.com/pitfa19/mozak/actions/workflows/ci.yml/badge.svg)](https://github.com/pitfa19/mozak/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![Node 24.11+](https://img.shields.io/badge/node-24.11%2B-339933?style=flat-square)](docs/installation.md)
[![Platforms](https://img.shields.io/badge/platforms-Linux%20%7C%20macOS-blue?style=flat-square)](docs/installation.md)

[What it is](#what-it-is) · [Install](#install) · [How it works](#how-it-works) · [Obsidian](#see-everything-in-obsidian) · [Safety](#safety) · [Docs](docs/installation.md)

</div>

---

## What it is

**MOZAK gives every project one shared plan, stored as plain files inside the project.** It does two jobs:

- **Agents understand your work.** Every agent reads the same plan at the start of a session, so you never explain the project twice. Agents propose changes, but nothing becomes the plan until you say yes.
- **You orchestrate from Obsidian.** Every project's plan shows up in your vault with a live roadmap and progress, so all the parallel work is visible in one place. You approve the next step, and outcomes turn green as agents prove them with tests.

Why you can trust it:

- **It is just files.** `MOZAK.json` holds the plan, `MOZAK.md` is a readable copy. They sit next to your `README.md`, and git keeps the history. No cloud, no account, no background service.
- **You stay in charge.** Agreeing on *what* to do and agreeing to *start building* are two separate yeses.
- **Many agents, no mess.** An agent that writes from an out-of-date copy is refused instead of overwriting someone else's work.
- **Repos and notes together.** A project can be a local folder, an Obsidian vault folder, or a GitHub repo you have not even cloned.

It is for developers and researchers who already use agents such as Claude Code, Codex or jcode and want them to remember the plan.

## Install

You need Git, npm and Node 24.11 or newer (Node 26 works).

```bash
git clone https://github.com/pitfa19/mozak.git && cd mozak
npm ci --ignore-scripts && npm run build
mkdir -p "$HOME/.local/share"
node scripts/install.mjs --prefix "$(cd "$HOME/.local/share" && pwd -P)/mozak" --json
```

The installer copies a self-contained build into that folder. It uses no `sudo`, makes no network calls and does not touch your shell profile. Add `--check` to preview first.

```bash
"$HOME/.local/share/mozak/bin/mozak" --help
```

To let your agent use MOZAK, link the installed skill into its skills folder, for example `ln -s "$HOME/.local/share/mozak/skills/mozak" ~/.claude/skills/mozak`, and add `mozak-mcp --config /path/to/mozak-inventory.json` as an MCP server.

Two commands keep it working:

```bash
mozak upgrade --vault ~/Documents/notes   # newest tagged release; the old install is kept, plugin updated in that vault
mozak doctor --fix                        # checks the whole setup; fixes links, wrappers and plugin copies, prints the rest
```

`mozak scopes` and the Obsidian sidebar tell you when a new release is out (`MOZAK_NO_UPDATE_CHECK=1` turns that off). Changes are listed in [CHANGELOG.md](CHANGELOG.md).

Details, exit codes, recovery and known limits: [docs/installation.md](docs/installation.md).

## How it works

**1. List your projects.** One `mozak-inventory.json` names every project MOZAK may look at. It never searches your disk. Keep it at the top of your notes folder, so the Obsidian plugin finds it on its own.

```json
{
  "format": "mozak.local/v3",
  "scopes": [
    { "id": "my-app",     "root": "./my-app" },
    { "id": "lab-notes",  "root": "./vault/lab-notes" },
    { "id": "genome-mcp", "remote": "github:you/genome-mcp", "ref": "main" },
    { "id": "my-oss-tool", "remote": "github:you/my-oss-tool", "plans": "./vault/my-oss-tool" }
  ]
}
```

A project with `root` is a local folder. A project with `remote` is a GitHub repo. Where its plans live depends on who should see them:

- **Private repo**: plans live inside the repo, so everyone with access shares them. MOZAK downloads only `README.md`, `AGENTS.md` and the two MOZAK files, a few kilobytes, and pushes plan changes back.
- **Public repo**: add `"plans"` with a folder, usually in your notes. Plans stay there, private to you, and are never committed to the repo. MOZAK warns and refuses writes if a repo holding plans becomes public.

`mozak pull --into ~/Downloads/x` clones the code anywhere. For a public repo the clone never receives plan files. Run MOZAK read commands inside any clone without `--scope` and it finds the project from the clone's git origin.

**2. Start a project.** Give the folder a `README.md` and an `AGENTS.md`, then ask your agent to set it up with the MOZAK skill, or run `mozak scope init` yourself (see the skill's `references/bootstrap.md`). This creates the project's `MOZAK.json` and `MOZAK.md`. Creating a project is always your decision, never the agent's.

**3. Agree on a plan.**

1. **Propose.** An agent drafts a plan. It waits as *awaiting approval*.
2. **Approve the direction.** You say yes to *what*. This starts planning, not coding.
3. **Approve the build.** A spec is attached and you approve implementation separately.
4. **Remember.** Decisions and evidence are saved into the project's files, so the next session starts where the last one stopped.

**4. Let agents find their way.** `mozak scopes` lists every project with its plan counts. Agents get the same list from the MCP server, so they can navigate all your work without being told where anything is.

## See everything in Obsidian

The Obsidian plugin in [`packages/obsidian`](packages/obsidian) shows every project from your inventory in the sidebar, notes and GitHub repos alike. Filter by **All**, **Open** or **Done**. Open plans show a small progress strip, one segment per outcome. Click a plan to open its section in the scope's `MOZAK.md`, which reads like a note: purpose, a roadmap of the outcomes with the current stop, a status table and the full plan text. The plugin never writes canonical state (`MOZAK.json`) and never changes a plan. It may regenerate a stale `MOZAK.md`, the same as `mozak render`.

```bash
node scripts/install-obsidian-plugin.mjs /path/to/your/vault --build
```

Then turn on **MOZAK** under Settings, Community plugins. The plugin finds `mozak-inventory.json` by searching upward from the vault folder, or you can set its path in the plugin settings. Each GitHub project shows a globe or lock badge for a public or private repo.

**Plugin disclosures (desktop-only, `isDesktopOnly: true`):** When your `mozak-inventory.json` lists scopes outside the current vault, the plugin reads their `MOZAK.json`, `MOZAK.md`, `README.md` and `AGENTS.md` files from those configured paths and watches them when **Auto-refresh** is enabled. It never scans folders not listed in your inventory and never modifies `MOZAK.json` (it may regenerate a stale `MOZAK.md` projection when there are no unmerged hand edits). For remote GitHub scopes (`"remote": "github:owner/repo"` without vault-hosted `"plans"`), clicking **Sync remote scopes** or enabling **Repo sync interval (seconds)** runs your local `git` (`git fetch` / `git pull --ff-only`) using your existing git login; set the sync interval to `0` to turn background git fetches off. See [`packages/obsidian/README.md`](packages/obsidian/README.md#disclosures-obsidian-community-plugin-policy) for the full disclosure list.

## See it run

### 1. Talk to your agent (`/mozak` chat + Obsidian IDE)

<div align="center">
<a href="docs/assets/mozak-agent-chat.mp4">
  <img src="docs/assets/mozak-agent-chat.gif" alt="Agent terminal chat and Obsidian side by side: you ask /mozak study-timer to add a bell sound when the timer ends, the agent reads MOZAK state and asks 1 focused question, proposes the plan and pauses at the owner gate, you approve direction in chat, and the agent records passing audio test evidence turning outcome 1/2 green" width="840">
</a>
</div>

You talk in natural language inside your terminal agent (`claude`, `jcode`, `codex`); the `/mozak` skill and `mozak-mcp` server read `MOZAK.json`, ask one focused question, pause at the owner approval gate, and redraw your Obsidian roadmap live ([full-resolution MP4](docs/assets/mozak-agent-chat.mp4)).

### 2. Under the hood (plain files → generative UI)

<div align="center">
<img src="docs/assets/under-the-hood.svg" alt="Vector diagram animation: mozak-inventory.json points to scopes, the agent proposes, the owner approves, MOZAK.json and MOZAK.md are written in the scope folder, and Obsidian redraws from those files" width="840">
</div>

**Generative UI from plain files:** The agent writes plain `MOZAK.json` and `MOZAK.md` files in your scope folder; the Obsidian sidebar and the Mermaid roadmap inside each note are rendered from them, with no UI code written by the agent.

### 3. CLI commands under the hood

<div align="center">
<a href="docs/assets/mozak-demo.mp4">
  <img src="docs/assets/mozak-demo.gif" alt="Live Terminal and Obsidian walkthrough: mozak scopes discovers 3 scopes, mozak plan propose creates an awaiting-approval plan in Pomodoro Study Timer, mozak review decide approves direction and lights up the Mermaid roadmap, and mozak observe turns outcome 1/2 green" width="840">
</a>
</div>

Real CLI commands (`mozak scopes` → `mozak plan propose` → `mozak review decide --approve-direction` → `mozak observe`) running side by side with Obsidian against a clean 3-scope demo vault ([full-resolution MP4](docs/assets/mozak-demo.mp4)).

## Use it with your agent

| You want | Use |
| --- | --- |
| See every project and where it lives | `mozak scopes`, or the `mozak_scopes` MCP tool |
| Read one project's plan | `mozak context`, `mozak plans`, `mozak check` |
| Refresh GitHub projects now | `mozak sync` |
| Let any MCP agent read and propose | `mozak-mcp --config mozak-inventory.json` |
| Run the guided planning conversation | the installed skill at `PREFIX/skills/mozak/SKILL.md` |

Every command needs an explicit `--config`. MOZAK never falls back to a global setting.

## Safety

- **Real approvals only.** Only your own decision on what was shown to you counts. Quotes, tool output and reminders do not.
- **No overwrites.** A write based on an out-of-date copy is refused.
- **Small pushes.** For private GitHub projects, MOZAK commits and pushes only `MOZAK.json` and `MOZAK.md`. For public ones it never commits or pushes at all.
- **No credentials.** MOZAK never asks for, prints or stores them. GitHub access uses your existing git login.
- **Honest limits.** Approval follows a trusted-host convention, it is not authentication. Concurrency guarantees cover cooperating processes on a local disk, not network drives or power loss.

## Works well with

[**Monokl**](https://github.com/pitfa19/monokl) is a separate, optional research runner with durable evidence and explicit human approval. MOZAK works fully without it.

## Platforms

Linux and macOS, Node 24.11 or newer. CI runs Ubuntu and macOS on Node 24 and 26 on every push.

## Contributing

```bash
npm ci --ignore-scripts && npm run build
npm test && npm run test:install
```

Run the tests before opening a pull request. The full format and remote-scope details are in [docs/installation.md](docs/installation.md) and [SPEC.md](SPEC.md).

## License

MIT. See [LICENSE](LICENSE).
