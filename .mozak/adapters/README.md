# Historical adapter requests (retired)

Live research adapters are retired. New retrieval is MCP-only: the agent host
calls an MCP server, and MOZAK records the saved response as proposal-only
evidence with `mozak research record-tool`. Run `mozak stack recommend
<use-case>` to see which MCP tool covers a use case.

MOZAK no longer executes, configures, re-pins, or lists adapter bindings. Every
`mozak adapter ...` command refuses with a retirement error and has no effects.
The runner, fetch, digest, and reading scripts that lived under
`scripts/adapters/` have been removed.

## What is kept, and why

- `requests/*.json` are the exact request files that earlier owner-approved
  adapter bindings pinned. They are kept unchanged as provenance for runs that
  were already recorded. Do not edit or delete them. They are not instructions
  for new retrieval.
- `~/.config/mozak/adapters.json` (owner-local, outside this repository) is
  kept as a historical record of where each binding stored its runs. MOZAK reads
  it only to locate those runs.
- Recorded runs stay readable and verifiable:
  - `mozak project current|browse|resolve|why PROJECT_ID` show every validated
    run from every configured binding's runs directory. A binding is reported
    with `state: historical`, `callable: false`, and
    `authority: historical_record`. A changed or deleted runner or request
    appears under `pin_drift` as information only. It never hides runs that
    were already recorded.
  - `mozak research validate RUN_JSON` re-validates any recorded run.
  - `mozak research normalize <arxiv|dair-ai|mcp-registry|github-tooling|hyperresearch|monokl> FIXTURE_JSON RUN_JSON`
    still turns a historical fixture into a run, offline.

## What a recorded run is and is not

A recorded run is immutable, untrusted, proposal-only research evidence. It
records what a source returned at one time, not whether it is correct or
relevant. Promoting anything from it into a Scope input or an accepted planning
input remains an explicit owner decision.
