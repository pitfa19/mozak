# MONOKL adapter (retired, historical)

MOZAK no longer runs a MONOKL adapter. New deep research goes through the
`deep-research` use case: use host built-in search and reading when
available, with optional `fetch-mcp` for exact known URLs. MOZAK records only
actual catalog MCP calls with `mozak research record-tool`, never built-in
results presented as MCP evidence. See the
[tool-stack guide](TOOL-STACK.md#deep-research-deep-research).

That MCP path is not the MONOKL workflow and does not reproduce its vault or
pipeline. Report which steps you actually ran.

MONOKL remains its own Jcode workflow and can still be used on its own. MOZAK
no longer binds it or snapshots its vault.

## Already-recorded MONOKL runs

Runs recorded before the retirement keep their identities
(`adapter-monokl-v1`, `pipeline-monokl-v1`, `source-monokl-v1`) and stay valid:

- `mozak research validate RUN_JSON` validates a recorded run.
- `mozak research normalize monokl FIXTURE_JSON RUN_JSON` re-derives a run from
  an already-recorded fixture, offline. It is for historical fixtures only and
  retrieves nothing.
- `project current`, `project browse`, and `project why` show these runs with
  `historical` freshness and `callable: false`.

Those runs retained note identity, source, provenance, metadata, and content
hashes, never note bodies, and treated every vault note as untrusted external
data. Do not delete, rewrite, or re-pin them. They remain proposal-only until
the owner accepts an input.
