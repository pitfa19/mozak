# Explicit tool stack contract

Status: implemented in `mozak stack` (catalog `skills/mozak/tool-stack.json`, schema v1).
Owner approval: decision `decision-tool-stack-2026-10-05T181833Z`.

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

- Single source of truth for use cases, tools, companion classification, hosts, and the
  adapter registry location. `companion-recommendations.json` remains shipped for
  compatibility and a unit test fails if it diverges from the catalog projection.
- Shipped in the managed `mozak` skill payload in all four skill roots; `setup check`
  verifies byte parity like every other managed file.
- Validated on load with `deny_unknown_fields`. MCP servers must carry repository,
  package, pinned version, docs URL, `verified_at`, registration, probes, and
  `shipped_by_mozak: false`. Legacy adapters must name their adapter and binding.
- Pins record the version observed in primary upstream docs on `verified_at`. They are
  not a claim that every host combination was tested.

### Use cases

| Id | Gating tools | Other tools |
|---|---|---|
| `baseline` (merged into every use case) | `adhd-skill`, `notes-skills`, `termaid` | `mmdr`, `caveman-skill`, `drawing-skills` (optional) |
| `literature` | `arxiv-mcp` | `adapter-arxiv` (legacy alternative), `adapter-dair-ai` (optional) |
| `references` | `zotero-mcp` | `zotero-cli-skill` (optional) |
| `manuscript` (optional, never default) | `overleaf-mcp` | none |
| `tooling-watch` | any of `adapter-mcp-registry`, `adapter-github-tooling` | none |
| `deep-research` | any of `adapter-hyperresearch`, `adapter-monokl` | none |

All six existing adapters have explicit guidance, so no capability is silently dropped.

## Readiness

Ladder: `missing` < `installed` < `configured` < `handshake_ok` < `usable` < `write_granted`.

`stack check` can observe only the first three, plus `prerequisite_missing`:

- `installed`: a declared executable is on an absolute PATH entry, or declared skill
  directories exist under a skill root in HOME.
- `configured`: an explicit host MCP config names the server (by name or command marker),
  or the MOZAK adapter registry has a callable binding for the adapter. A binding is
  callable only when it passes the strict registry validator shared with `adapter list`,
  both pins match, and its target Scope is registered in the KB named by HOME's own
  `.config/mozak/config.json` with a matching `kb_sha256`. Every binding is reported with
  `state` (`ready` or `needs_recheck`) and `reasons` (`request_pin_drifted`,
  `runner_pin_drifted`, `target_scope_unverified`, `target_scope_not_registered`).
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
  env. `value_reported` is always `false`.

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
- Existing adapter bindings, requests, runs, and `research normalize` remain valid.

## Tests

`crates/mozak-cli/tests/tool_stack.rs`, unit tests in `stack_workflow.rs` and
`distribution.rs`, and the payload and onboarding assertions in
`crates/mozak-cli/tests/distribution_commands.rs`.
