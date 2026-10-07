# Explicit tool stack contract

Status: implemented in `mozak stack` (catalog `skills/mozak/tool-stack.json`, schema v1,
catalog version `2026-10-07.1`).
Owner approval: decision `decision-tool-stack-2026-10-05T181833Z`; live adapter retirement
approved by the owner on 2026-10-05. The owner permanently prohibited Firecrawl
on 2026-10-07 and authorized its removal from the active stack.

## Routes

| Route | Effect | Exit |
|---|---|---|
| `mozak stack catalog` | Prints the embedded catalog plus identity (`id`, `version`, `file`, `sha256`). | 0 |
| `mozak stack recommend USE_CASE` | Prints `baseline` plus the named use case, each tool with upstream pins, install text, host registration snippets, probes, credentials (names only). | 0, or 3 for an unknown use case |
| `mozak stack check HOME [USE_CASE]` | Observes local presence under an explicit HOME and the PATH. | 0 ready, 2 incomplete, 3 invalid input |

All three routes perform no networking, launch no program, install nothing, write nothing,
complete no MCP handshake, and never read a credential value into output. Every report
carries `effects` with all of these set to `false`.

An unknown use case returns `state: "invalid"`, the message `unknown use case: ID`, and
`valid_use_cases`. An unsafe HOME (relative, `..`, missing, symlink, not a directory) is
invalid.

## Catalog

- Single source of truth for use cases, tools, companion classification, and hosts. `companion-recommendations.json` remains shipped for
  compatibility and a unit test fails if it diverges from the catalog projection.
- Shipped in the managed `mozak` skill payload in all four skill roots; `setup check`
  verifies byte parity like every other managed file.
- Validated on load with `deny_unknown_fields`. MCP servers must carry repository,
  package, pinned version, docs URL, `verified_at`, registration, probes, and
  `shipped_by_mozak: false`. Allowed tool kinds are `managed_skill`, `skill`,
  `executable`, and `mcp_server`. Allowed requirements are `required`, `optional`, and
  `any_of` with a `group`. The catalog has no adapter registry path, no `legacy_adapter`
  kind, no `adapter`/`adapter_bindings` fields, and no `legacy_alternative` requirement;
  the parser rejects all of them.
- Pins record the version observed in primary upstream docs on `verified_at`. They are
  not a claim that every host combination was tested.

### Use cases

| Id | Gating tools | Other tools |
|---|---|---|
| `baseline` (merged into every use case) | `adhd-skill`, `notes-skills`, `termaid` | `mmdr`, `caveman-skill`, `drawing-skills` (optional) |
| `literature` | `arxiv-mcp` | `github-mcp`, `fetch-mcp` (optional, DAIR.AI at an exact commit) |
| `references` | `zotero-mcp` | `zotero-cli-skill` (optional) |
| `manuscript` (optional, never default) | `overleaf-mcp` | none |
| `tooling-watch` | `fetch-mcp` | `github-mcp` (optional) |
| `deep-research` | None beyond baseline | `fetch-mcp` (optional, exact URLs only) |

### Retired adapter replacement map

| Retired adapter | MCP route | Use case |
|---|---|---|
| `arxiv` | `arxiv-mcp` | `literature` |
| `dair-ai` | `github-mcp` `get_file_contents` at an exact commit, or `fetch-mcp` on a commit-pinned raw URL | `literature` (optional) |
| `mcp-registry` | `fetch-mcp` on exact `registry.modelcontextprotocol.io/v0/servers` URLs, paged explicitly with the API cursor | `tooling-watch` (required) |
| `github-tooling` | `github-mcp` read-only `repos` toolset (`search_repositories`, `list_releases`, `get_latest_release`, `list_tags`, `list_commits`), or `fetch-mcp` on public GitHub API URLs | `tooling-watch` |
| `hyperresearch`, `monokl` | Host built-in search/reading when available, outside the MCP catalog; optional `fetch-mcp` for exact URLs | `deep-research` |

`tooling-watch` requires `fetch-mcp` because only it can read the official MCP registry;
`github-mcp` alone never marks the use case ready. `deep-research` checks baseline
and optional Fetch only. Host built-in search is outside the MCP catalog and
stack check cannot prove its availability or usability. Fetch alone cannot search.
If host search is unavailable, report that limitation. Built-in results must not
be fabricated as MCP evidence or used as a Lab refresh run. Only actual catalog
MCP calls go through the unchanged MOZAK tool-evidence recorder.

Honest limits:

- Former source-specific batch automation (weekly arXiv and DAIR.AI digests, registry and
  GitHub watches, HyperResearch and MONOKL vault runs) is replaced by explicit agent-host
  workflows. MOZAK does not reproduce it automatically and does not claim batch parity.
- The agent pages explicitly, records the exact URL, version, tag, or commit it read, and
  treats the result as proposal-only evidence. Unauthenticated GitHub API requests are
  rate limited (the upstream limit for unauthenticated REST calls is low per hour); use
  `github-mcp` with a token for larger watches.
- `fetch-mcp` upstream cautions that it can reach local and internal IP addresses. Point it
  only at exact public URLs.
- Any permitted tool that spends credits requires explicit owner consent for that
  purpose. This does not authorize adding tools.
- Historical adapter runs and recorded evidence remain readable through the existing
  evidence readers and the generic record tool. The catalog no longer offers adapters as
  a route or fallback.

### Pins and provenance (verified 2026-10-05)

| Tool | Package | Pin | Primary source |
|---|---|---|---|
| `fetch-mcp` | PyPI `mcp-server-fetch` | `2026.8.18` (uploaded 2026-08-18) | PyPI JSON API and `modelcontextprotocol/servers` `src/fetch` README |
| `github-mcp` | `ghcr.io/github/github-mcp-server` | `v1.14.0` image index `sha256:7aaeeec9ae4fe9a736d100c1ff0798f3c219b5009e05f5d3945fcacb13cc196b` (release 2026-10-02) | GitHub release API, ghcr manifest, README at tag `v1.14.0` |

Registrations are local stdio only, with exact versions; no moving `latest` tag. The host
config parser does not yet observe remote transports. Install text is never executed by
MOZAK.

## Readiness

Ladder: `missing` < `installed` < `configured` < `handshake_ok` < `usable` < `write_granted`.

`stack check` can observe only the first three, plus `prerequisite_missing`:

- `installed`: a declared executable is on an absolute PATH entry, or declared skill
  directories exist under a skill root in HOME.
- `configured`: an explicit host MCP config names the server (by name or command marker).
  The adapter registry is not consulted.
- `prerequisite_missing`: present, but a declared prerequisite is unmet.

Every tool reports `handshake` (`not_observed` for MCP servers), `usable: "unknown"`, and
`write_grant: "not_observed"`. A tool is ready at its catalog `ready_at` level. A use case
is ready when every `required` tool and at least one tool per `any_of` group is ready.
Without `USE_CASE`, all use cases are reported but only `baseline` gates the exit code.

## Host config observation

Read-only, bounded (8 MiB), and only at catalog paths under HOME:
`.jcode/mcp.json` (`servers`), `.claude.json` (`mcpServers`),
`.config/Claude/claude_desktop_config.json` (`mcpServers`), `.codex/config.toml`
(`mcp_servers`). Any symlink in the path or the file itself is refused and reported as
`unreadable: symlink refused`; nothing outside HOME is read.

- JSON: an entry counts only if it is an object with a non-empty `command` or `url`, and
  is not `disabled: true` or `enabled: false`.
- TOML: conservative subset. Supported: single-line `[mcp_servers.NAME]` and
  `[mcp_servers.NAME.env]` headers, escape-free strings, single-line string arrays,
  single-line inline `env` tables, boolean `enabled`, and `#` comments. Anything else
  inside the servers table (malformed header, array tables, dotted keys, multi-line or
  escaped values) fails the whole file closed as `unreadable`. A disabled entry, or one
  without `command`/`url`, never counts.
- Only command line strings and env key names are retained. Env values are retained only
  for keys a prerequisite declares as a non-secret path (`ZOTERO_DB_PATH`).

## Prerequisites

- `executable_any`: one of the named executables is on PATH. Never executed.
- `file_any`: one candidate file exists: the `path_env` value from a matched host server
  or the process env, a profile `prefs` data directory under HOME, or a HOME-relative
  default. Candidate files must be regular files with no symlink in any path component.
  Optional `alternative_env_all` is satisfied only from one source: every named key in a
  single matched host server, or every named key in the process env. Names are never
  unioned across servers or sources; the satisfying `source` is reported.
- `credential_env`: the named env key is declared in a matched host server or the process
  env. `value_reported` is always `false`. A missing required credential makes a present
  tool `prerequisite_missing`, so its use case reports `incomplete`.

GitHub: `github-mcp` requires `GITHUB_PERSONAL_ACCESS_TOKEN` (an owner-created read-only
token) plus Docker or the release binary. Read-only mode and the `repos` toolset are set
in the registration.

Fetch: `fetch-mcp` needs no credential, only `uvx` or the installed executable.

Zotero: satisfied by `zotero.sqlite` at `ZOTERO_DB_PATH`, the Zotero prefs `dataDir`, or
`~/Zotero`, or by declared `ZOTERO_API_KEY` plus `ZOTERO_LIBRARY_ID` (web mode).
Otherwise a configured server stays `prerequisite_missing`, because the server can
complete a handshake without any readable library.

Overleaf: requires `OVERLEAF_SESSION` to be declared. Edit tools additionally need
`OVERLEAF_GIT_TOKEN` and a separate owner write grant.

## Setup and doctor

`setup install|check` and `doctor` add a nonblocking `stack_onboarding` object (catalog
identity, use case ids, the three stack commands, recommended MCP server ids, and the
policy that they never affect setup or doctor state). `companion_recommendations` keeps
its historical shape and order and is now projected from the catalog.

## Boundaries

- Install steps and registration snippets are text for the owner to run deliberately.
- Retrieved content stays proposal-only research evidence until separately accepted.
- No blanket write grant is ever inferred.
- No live adapter route remains in the catalog. Historical adapter evidence stays readable
  through the existing evidence readers; it is not re-run or re-pinned.

## Tests

`crates/mozak-cli/tests/tool_stack.rs`, unit tests in `stack_workflow.rs` and
`distribution.rs`, and the payload and onboarding assertions in
`crates/mozak-cli/tests/distribution_commands.rs`.
