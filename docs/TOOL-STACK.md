# Explicit tool stack

MOZAK picks research and writing tools per use case, from a catalog that ships
with the binary. You see what each use case needs, what is ready on this
machine, and the exact install step for anything missing. Nothing installs on
its own.

New retrieval is MCP-only. Your agent host calls an MCP server, and MOZAK
records and validates the bytes that came back. MOZAK ships no live source
adapter and has no adapter fallback.

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

| Use case | Required | Optional | Notes |
|---|---|---|---|
| `baseline` | `adhd-skill`, `notes-skills`, `termaid` | `mmdr`, `caveman-skill`, `drawing-skills` | Always included |
| `literature` | `arxiv-mcp` | `github-mcp`, `fetch-mcp` | arXiv search and reading; curated DAIR.AI snapshots |
| `references` | `zotero-mcp` | `zotero-cli-skill` | Needs a local Zotero database |
| `manuscript` | `overleaf-mcp` | none | Optional use case, needs credentials |
| `tooling-watch` | `fetch-mcp` | `github-mcp` | Released tooling and repository watch |
| `deep-research` | `firecrawl-mcp` | `fetch-mcp` | Multi-source search and reading; consumes Firecrawl credits |

Values in the table are catalog tool ids. `mozak stack catalog` is the
authority if this table and the catalog ever disagree.

Activate a tool only for its use case. Literature uses arXiv. References and
reading use Zotero. Manuscripts use Overleaf. A literature question does not
open Zotero or Overleaf.

Exact package names, versions, and install commands live in
`skills/mozak/tool-stack.json`. This guide does not copy them, so it cannot
drift from the catalog. Read them with `mozak stack recommend USE_CASE`.

Credential key names the catalog declares:

- `github-mcp`: `GITHUB_PERSONAL_ACCESS_TOKEN` (required).
- `firecrawl-mcp`: `FIRECRAWL_API_KEY` (required), `FIRECRAWL_API_URL`
  (optional).
- `fetch-mcp`: none.
- `overleaf-mcp`: see `mozak stack recommend manuscript`, for example
  `OVERLEAF_SESSION`.

A missing required credential makes `stack check` report incomplete. It never
switches to another retrieval path.

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
`configured` for MCP servers) with prerequisites and required credentials
present, and each `any_of` group has one ready member; `2` incomplete; `3`
invalid input (an unknown use case lists the valid ids).

## When a tool is missing

1. Show the exact install step and prerequisites from `stack recommend`.
2. Ask the owner, one tool at a time. Installing is a separate decision.
3. After install, run `stack check` again.

Never invent a package name or command. Never install every recommended tool
at once. When the required MCP tool is missing or unconfigured, the workflow
stops as incomplete. There is no adapter to fall back to. MOZAK keeps no live
tool runtime: it does not start, supervise, or keep MCP servers alive. The
agent host does that.

Credentials: MOZAK reports only the required key names and whether they are
present. It never emits or stores their values and never implies a write
grant.

## Workflows

Each workflow below ends the same way: the agent saves the exact response
bytes, writes a `mozak.tool-evidence.v1` fixture, and runs
`mozak research record-tool FIXTURE_JSON RESPONSE_BYTES RUN_JSON`. One tool
call is one fixture. The run is proposal-only.

### Literature (`literature`)

1. `mozak stack check "$HOME" literature`.
2. Search and read through `arxiv-mcp`. Read one section at a time; do not
   keep full paper text in MOZAK.
3. Optional curated complement: read a DAIR.AI AI-Papers-of-the-Week snapshot
   through `github-mcp` or `fetch-mcp`, pinned to an exact commit. Upstream
   declares no license, so retain only titles, links, week labels, and exact
   source provenance. Curator prose is used transiently and never stored.
   DAIR.AI is a curated sample, not a complete literature search.

### Tooling watch (`tooling-watch`)

Watches released tooling so a module can move to a current standard instead of
guessing at one.

1. `mozak stack check "$HOME" tooling-watch`. `fetch-mcp` is required.
   `github-mcp` is optional and adds authenticated repository access.
2. **Repository discovery**: run owner-declared topic and keyword searches
   against the public GitHub API through `fetch-mcp`, or through `github-mcp`
   when it is configured. Unauthenticated public API reads are rate limited,
   so keep each search bounded and record the page you stopped at. Discovery
   proposes only. A repository becomes watched only when the owner adds it to
   the watchlist.
3. **Repository watch**: for each repository on the owner's explicit
   watchlist, record the latest release when one exists, otherwise the head
   commit. Never present a repository as dormant because it publishes no
   releases.
4. **MCP registry** through `fetch-mcp`: read the official registry's public
   v0 API. It paginates by server name, not by date, so read every page of the
   `updated_since` window before picking the newest. Put each page's exact URL
   and cursor in that call's arguments, one fixture per page. If you stop at a
   page ceiling, set `truncated: true` and record a high-impact gap saying the
   unread pages may contain newer entries.
5. Keep only release facts: identity, version, repository and website links,
   timestamps, `isLatest`, and status. Do not retain descriptions or READMEs.

Every tooling-watch record must disclose, as a gap or limitation:

- Stars and pushes measure attention, not quality, security, or fitness.
- Licences vary and some are undeclared.
- Discovery cannot see a repository that declares no matching topic.
- Registry entries are self-published. Presence means someone published, not
  that anyone assessed quality, security, or fitness.
- The registry lists MCP servers only. Tooling that ships no MCP server is
  outside it.

Tooling watch runs when you or your agent ask for it. MOZAK schedules nothing.

### Deep research (`deep-research`)

1. `mozak stack check "$HOME" deep-research`. `firecrawl-mcp` needs
   `FIRECRAWL_API_KEY`. Every Firecrawl search or scrape consumes credits on
   that account, so state the planned number of calls and get the owner's
   explicit consent before spending.
2. Search and read across sources with `firecrawl-mcp`. Use `fetch-mcp` for a
   single known URL, and `arxiv-mcp` when the source is an arXiv paper and the
   `literature` check passed.
3. Record each call as its own fixture with exact versions, declared effects,
   and excerpt byte ranges. Bounded results that stop early set
   `truncated: true` with a gap.

This is not the old HyperResearch or MONOKL pipeline. It does not reproduce
their vaults, ranking, contradiction analysis, or citation checks. Say which
steps you actually ran.

## Networking, stated precisely

- MOZAK project, stack, and validation routes are offline. They read local
  config, files, and recorded evidence.
- The agent host calls MCP servers. Those calls may use the network.
- The managed `mozak` launcher may contact GitHub, only to check for tool
  updates.
- MOZAK validates the recorded snapshot that came back. It never treats a
  live resource as evidence.
- Not every API is reachable through these tools. A source no catalog MCP
  server can read is out of scope, and you say so.

## Evidence: record once, accept separately

What a tool returns is a proposal, not knowledge.

1. The agent calls the tool through its host.
2. The result is recorded as an immutable, source-neutral evidence snapshot:
   catalog tool id, exact version, source, time, and content hashes. See
   [the fixture example](examples/tool-evidence-example.md).
3. Validation refuses any later edit. A correction is a new snapshot.
4. The snapshot stays `proposal_only` and `accepted: false`.
5. Only an explicit owner decision moves it into a new accepted input set,
   with provenance naming who decided and from which bytes.

A tool call, a successful record, a passing `stack check`, or approval of
this migration is not acceptance.

## Feeding the Improve Lab

```bash
mozak lab start <run-dir> <scope-id> <module> "<question>" arxiv-mcp github-mcp
mozak lab refresh <run-dir> <mcp-research-run.json> [mcp-research-run.json ...]
```

`lab start` takes catalog MCP tool ids, not registry or binding ids. `lab
refresh` takes a run written by `research record-tool` whose `tool_id` exactly
matches one of those ids, whose `scope_id` matches the Lab Scope, and which is
still `proposal_only`. Lab candidates come only from the run's selected
excerpt records, so record every excerpt you want the Lab to consider.
Anything else, including a historical adapter run, is refused.

## Historical adapter evidence

Live source adapters are retired. MOZAK no longer ships adapter runners, an
adapter registry route, or adapter catalog entries, and nothing can launch
one. A coverage claim for a source needs a real recorded MCP run.

Runs that adapters already recorded stay valid. MOZAK keeps offline readers
for them so their hashes still verify:

- `mozak research validate RUN_JSON` validates any recorded run.
- `mozak research normalize <source> FIXTURE_JSON RUN_JSON` re-derives a run
  from an already-recorded fixture, offline. It is for historical fixtures
  only and never retrieves anything.
- `project current`, `project browse`, and `project why` keep the
  `adapter_freshness` field name for hash compatibility. It now reports
  `historical`, `callable: false`, and informational pin drift. That describes
  how old an artifact is, not whether a runtime is available.

Do not delete, rewrite, or re-pin historical adapter evidence.

## Companion recommendations

`companion-recommendations.json` still ships unchanged for compatibility.
Its entries are now policies inside the stack catalog, mainly `baseline`.
`setup` and `doctor` keep their companion output and add a nonblocking
`stack_onboarding` pointer to `stack recommend` and `stack check`.
