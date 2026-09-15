# Continue existing MOZAK projects

Use this path when a teammate already onboarded the projects and you need to
continue them from your own machine. Allow about ten minutes after the project
and KB repositories are available locally.

MOZAK keeps two kinds of state separate:

- Project truth lives in each repository under `.mozak/` and is shared through Git.
- Your project index lives in `~/.config/mozak/config.json` and is local to your machine.

The local index is why installing the binary alone cannot reveal somebody
else's projects. Registration records locations and hashes. It transfers no
trust, project authority, or permission to mutate them.

## 1. Install the tool and its agent skill

Linux x86-64 requires `curl` and `python3`.

```bash
curl -fsSL https://raw.githubusercontent.com/pitfa19/mozak/main/scripts/install.sh | bash
export PATH="$HOME/.local/bin:$PATH"
mozak setup check "$HOME"
```

The release installs all of these together:

- `mozak`
- `mozak-mcp`
- the same versioned MOZAK skill under `.agents`, `.claude`, `.jcode`, and `.codex`

`setup check` must report `"parity": true`. It may also report that local
configuration is absent. That is expected until step 3.

## 2. Make the shared work available locally

Clone or update:

1. The shared MOZAK KB repository or directory.
2. Every project workspace this machine should know about.

Do not copy another person's `~/.config/mozak/config.json`. Paths and the local
owner identity belong to one machine. Rebuild the index from the project and KB
repositories instead.

Example layout:

```text
~/work/mozak-kb/
~/work/anpit/
~/work/potjera/
```

## 3. Configure your identity and KB

Use your own name, not the previous operator's name.

```bash
mozak setup install "$HOME" \
  --owner YOUR_NAME \
  --kb-root "$HOME/work/mozak-kb"
mozak setup check "$HOME"
```

This creates the local configuration only when the KB is valid. It refuses to
overwrite a different existing configuration.

## 4. Discover the existing projects without changing anything

Name every workspace root that should remain registered. Discovery describes a
complete replacement, not an additive merge.

```bash
mozak project discover \
  "$HOME/work/mozak-kb" \
  "$HOME/work/anpit" \
  "$HOME/work/potjera" \
  > discovery.json

mozak project review discovery.json
```

Read `additions`, `removals`, `changed_pins`, and `action`. If an expected
project is missing or a removal is unexpected, stop and rerun discovery with
the correct workspace roots. Review mutates nothing.

Registration or refresh requires a separate approval pinned to the proposal
digest and target path. Ask the installed MOZAK-aware agent to show the exact
approval before it applies it. Do not hand-edit the local config.

## 5. Continue one project

```bash
mozak project registrations
mozak project context PROJECT_ID
```

`project registrations` works even when the live KB has drifted. `project
context` validates the exact registered project and returns its idea, latest
plan, ready goals, and next actions.

The normal prompt to your coding agent is:

> Work on PROJECT_ID through MOZAK. Show me the current goal and any drift
> before changing files.

The agent must use `mozak project context PROJECT_ID` first. It must not guess a
project by scanning unrelated directories.

## If something fails

| Symptom | Meaning | Next action |
|---|---|---|
| `local config does not exist` | Tool installed, machine not configured | Complete steps 2 and 3 |
| Project ID is not registered | Workspace was absent from approved discovery | Repeat step 4 with the correct root |
| KB or project pin drift | Shared bytes changed since registration | Discover, review, and explicitly approve a refresh |
| `setup check` reports drift | A managed skill file was owner-edited | Review the changed file instead of overwriting it |
| `doctor` reports missing Termaid | Core and MCP are installed, but rendered graph commands need the external renderer | Install Termaid or use `graph-source` |
| Install cannot read releases | Repository may require authentication | Run `gh auth login`, then retry |

For channels, offline archives, updates, rollback, and platform limits, see
[Install and update](distribution/INSTALL.md). For all commands, see the
[reference](REFERENCE.md).
