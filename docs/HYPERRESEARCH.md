# HyperResearch adapter (retired, historical)

MOZAK no longer runs a HyperResearch adapter. New deep research goes through
the `deep-research` use case: use host built-in search and reading when
available, with optional `fetch-mcp` for exact known URLs. MOZAK records only
actual catalog MCP calls with `mozak research record-tool`, never built-in
results presented as MCP evidence. See the
[tool-stack guide](TOOL-STACK.md#deep-research-deep-research).

That MCP path is not a drop-in copy of the HyperResearch pipeline. It does not
reproduce HyperResearch's vault, 16-step pipeline, deduplication,
contradiction analysis, or citation checks. Report which steps you actually
ran rather than implying the old pipeline ran.

HyperResearch itself is an independent tool. You can still run it on your own.
MOZAK just no longer launches it, binds it, or snapshots its vault.

## Already-recorded HyperResearch runs

Runs recorded before the retirement stay valid and are never rewritten:

- `mozak research validate RUN_JSON` validates a recorded run.
- `mozak research normalize hyperresearch FIXTURE_JSON RUN_JSON` re-derives a
  run from an already-recorded fixture, offline. It is for historical fixtures
  only and retrieves nothing.
- `project current`, `project browse`, and `project why` show these runs with
  `historical` freshness and `callable: false`.

What those runs pinned still holds as history: identity, source URL,
provenance, word count, status, and a SHA-256 of each body, never the body
itself. Their two disclosures also still apply: an external agent chose the
corpus, so presence is not truth or completeness, and vault notes are
untrusted web text with no authority.

Do not delete, rewrite, or re-pin these runs. They remain proposal-only until
the owner accepts an input.
