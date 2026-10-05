# Explicit tool stack

MOZAK picks research and writing tools per use case, from a catalog that ships
with the binary. You see what each use case needs, what is ready on this
machine, and the exact install step for anything missing. Nothing installs on
its own.

## Start here

```bash
mozak stack catalog                      # every use case and tool
mozak stack recommend literature         # tools for one use case
mozak stack check "$HOME" literature     # what is ready here
```

All three are read-only and offline. They install nothing, never emit or store
credential values (only declared key names and presence), and never handshake
with an MCP server.

## The rule every agent follows

Every MOZAK use starts the same way, like the ADHD rule:

1. Load the `i-have-adhd` skill.
2. For project work, run `mozak project context PROJECT_ID`.
3. Run `stack check` for `baseline`, which is always included. If the request
   also matches a specialized use case, run `stack recommend` and `stack check`
   for that use case, then use only what check reports. With no specialized
   match, `baseline` alone applies.

The CLI checks observable facts: files, hashes, host configuration, recorded
evidence. It cannot make an agent follow these steps. The managed skill tells
the agent to, and the agent is responsible for doing it.

## Use cases

| Use case | Default tool | Fallback | Notes |
|---|---|---|---|
| `baseline` | `i-have-adhd`, Notes skills, Termaid | none | Always included |
| `literature` | arXiv MCP server | legacy `arxiv`, `dair-ai` adapters | Search and read papers |
| `references` | Zotero MCP server | optional `zotero-cli` skill | Needs a local Zotero database |
| `manuscript` | Overleaf MCP server | none | Optional, needs credentials |
| `tooling-watch` | legacy `mcp-registry`, `github-tooling` adapters | none | Release and repository watch |
| `deep-research` | legacy `hyperresearch`, `monokl` adapters | none | Long-form research runs |

Catalog ids: `arxiv-mcp`, `zotero-mcp`, `overleaf-mcp` (host server names
`arxiv`, `zotero`, `overleaf`), baseline `adhd-skill`, `notes-skills`,
`termaid`, and legacy `adapter-arxiv`, `adapter-dair-ai`,
`adapter-mcp-registry`, `adapter-github-tooling`, `adapter-hyperresearch`,
`adapter-monokl`. `zotero-cli-skill` is an optional Zotero alternative.
`stack check` also matches a host server whose command or arguments name the
catalog package or executable, not only the server name.

Activate a tool only for its use case. Literature uses arXiv. References and
reading use Zotero. Manuscripts use Overleaf. A literature question does not
open Zotero or Overleaf.

Exact package names, versions, and install commands live in
`skills/mozak/tool-stack.json`. This guide does not copy them, so it cannot
drift from the catalog. Read them with `mozak stack recommend USE_CASE`.

## Readiness is a ladder

Each rung is a separate fact. Passing one says nothing about the next.

1. `missing`: nothing found.
2. `installed`: the package or executable exists.
3. `configured`: a host config (`~/.jcode/mcp.json`, `~/.claude.json`,
   `~/.codex/config.toml`) declares the server.
4. `handshake_ok`: the server answered an MCP handshake.
5. `usable`: a real call returned real data from the real library.
6. `write_granted`: the owner granted write access.

`prerequisite_missing` means configured, but a declared prerequisite is absent.

`stack check` observes up to `configured` only. It reports
`handshake: "not_observed"`, `usable: "unknown"`, and
`write_grant: "not_observed"` because only the agent host can call an MCP
server. An agent must not upgrade those values from memory.

Real example from 2026-10-05: the Zotero MCP handshake succeeded, but no
`zotero.sqlite` existed at the default path or `ZOTERO_DB_PATH`. Installed and
handshake were true. Usable was false.

Exit codes for `stack check`: `0` when every required tool reaches its
declared `ready_at` rung (`installed` for baseline skills and executables,
`configured` for MCP servers and adapter bindings) with prerequisites present
and each `any_of` group has one ready member; `2` incomplete; `3` invalid input
(an unknown use case lists the valid ids).

## When a tool is missing

1. Show the exact install step and prerequisites from `stack recommend`.
2. Ask the owner, one tool at a time. Installing is a separate decision.
3. After install, run `stack check` again.

Never invent a package name or command. Never install every recommended tool
at once. MOZAK keeps no live tool runtime: it does not start, supervise, or
keep MCP servers alive. The agent host does that.

Credentials: MOZAK reports only the required key names, for example
`OVERLEAF_SESSION`, and whether they are present. It never emits or stores
their values and never implies a write grant.

## Networking, stated precisely

- MOZAK project, stack, and validation routes are offline. They read local
  config, files, and recorded evidence.
- The agent host calls MCP servers. Those calls may use the network.
- Legacy adapter runners may use the network and declare it.
- The managed `mozak` launcher may contact GitHub, only to check for tool
  updates.
- MOZAK validates the recorded snapshot that came back. It never treats a
  live resource as evidence.

## Evidence: record once, accept separately

What a tool returns is a proposal, not knowledge.

1. The agent calls the tool through its host.
2. The result is recorded as an immutable, source-neutral evidence snapshot:
   source, time, and content hashes. See
   [the fixture example](examples/tool-evidence-example.md).
3. Validation refuses any later edit. A correction is a new snapshot.
4. The snapshot stays `proposal_only` and `accepted: false`.
5. Only an explicit owner decision moves it into a new accepted input set,
   with provenance naming who decided and from which bytes.

A tool call, a successful record, a passing `stack check`, or approval of
this migration is not acceptance.

## Legacy adapters: compatibility only

The six existing capabilities stay covered:

- `arxiv`, `dair-ai` → `literature`
- `mcp-registry`, `github-tooling` → `tooling-watch`
- `hyperresearch`, `monokl` → `deep-research`

Adapter bindings, `adapter run`, and `research normalize` keep working so
every recorded run stays valid and reproducible. They are no longer the
default path. Do not delete, rewrite, or re-pin historical adapter evidence
to migrate it.

A new MCP tool counts as tested for a capability only after a real recorded
run through it. Until then, the legacy adapter is the verified path.

## Companion recommendations

`companion-recommendations.json` still ships unchanged for compatibility.
Its entries are now policies inside the stack catalog, mainly `baseline`.
`setup` and `doctor` keep their companion output and add a nonblocking
`stack_onboarding` pointer to `stack recommend` and `stack check`.
