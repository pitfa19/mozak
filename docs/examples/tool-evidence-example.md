# Example: recording one MCP tool call as evidence

This is a documentation example. It shows the shape of a
`mozak.tool-evidence.v1` fixture and the commands around it. It is not a
recorded real run, and it does not show that the arXiv MCP tool has been
tested end to end. The values are illustrative.

## 1. The agent calls the tool

The agent host, not MOZAK, calls the arXiv MCP server for the `literature`
use case, after `mozak stack check "$HOME" literature` reported it configured.
The host saves the exact response bytes to `response.json`:

```json
{"papers":[{"id":"2501.00001","title":"Example paper title"}]}
```

That file is 63 bytes (with a trailing newline) and its SHA-256 is
`043a056ec4f82cadc12195b3490ef3b79852ce2c8b0e9e7bca2ed786f596f2e3`.

## 2. The agent writes a fixture

```json
{
  "schema": "mozak.tool-evidence.v1",
  "scope_id": "topic-agentic-systems",
  "question": "Which recent papers discuss agent memory?",
  "tool": {
    "tool_id": "arxiv-mcp",
    "kind": "mcp",
    "version": "0.8.1",
    "operation": "search_papers",
    "server": "arxiv"
  },
  "call": {
    "arguments": {"query": "agent memory", "max_results": 1},
    "started_at": "2026-10-05T18:00:00Z",
    "finished_at": "2026-10-05T18:00:02Z"
  },
  "effects": {
    "network_used": true,
    "external_writes": [],
    "mutations_performed": "none",
    "irreversible_effects": [],
    "dry_run_available": true,
    "owner_approval_required": false
  },
  "response": {
    "sha256": "043a056ec4f82cadc12195b3490ef3b79852ce2c8b0e9e7bca2ed786f596f2e3",
    "byte_length": 63,
    "media_type": "application/json"
  },
  "selections": [
    {
      "id": "sel-0001",
      "locator": "arxiv:2501.00001",
      "response_byte_start": 39,
      "response_byte_end": 58,
      "excerpt": "Example paper title"
    }
  ],
  "total_results": 1,
  "truncated": false,
  "gaps": [],
  "accepted": false,
  "authority": "proposal_only"
}
```

What each part pins:

- `tool`: which catalog tool, exact version, which operation, which server.
  `tool_id` is the shipped catalog id (`arxiv-mcp`), never a package name such
  as the server's install package. New recordings must use `kind: "mcp"` and a
  catalog MCP tool id; `record-tool` refuses anything else. `latest`,
  `unknown`, or `*` versions are refused.
- `call`: the canonical arguments (hashed) and the UTC call window.
  Argument keys that look like credentials (`token`, `api_key`, `cookie`, ...)
  are refused.
- `response`: hash and length of the exact bytes. The full response is never
  stored, only its hash plus the selected excerpts.
- `selections`: each excerpt must equal the response bytes in its range.
- `accepted: false` and `authority: "proposal_only"` are required.
- `gaps` items are `{id, description, impact}` with a lowercase `gap-` id and
  `impact` of `low`, `medium`, or `high`. MOZAK adds
  `gap-tool-output-untrusted`, `gap-selected-excerpts-only`, and
  `gap-truncated` itself, so a fixture cannot supply those ids.
- `tool.server` is required for `kind: "mcp"`. The generic format still
  describes other kinds so that `verify-tool` and `research validate` can read
  evidence recorded before the MCP-only rule, but new recordings are MCP only.

## 3. Record, then verify

The fixture and response above are saved as
`docs/examples/tool-evidence/fixture.json` and `response.json`. Write the run
to a new path outside the repository:

```bash
mozak research record-tool fixture.json response.json run.json   # create-only
mozak research verify-tool fixture.json response.json run.json   # read-only
mozak research validate run.json
```

`record-tool` writes a standard research run and refuses to overwrite. Its
receipt `input_hash` is the SHA-256 of the canonical (key-sorted, compact)
fixture JSON, so reformatting the fixture does not change it.
`verify-tool` re-derives the run and requires it to match byte for byte.

Because `tool_id` is the catalog id, this run can feed a Lab opened with that
id:

```bash
mozak lab start lab-run topic-agentic-systems research "Which memory designs apply?" arxiv-mcp
mozak lab refresh lab-run run.json
```

`lab refresh` reads only the run's selected excerpt records as candidates.

## 4. What gets refused

- Edit one byte of `response.json`: hash mismatch.
- Change the excerpt or its range: excerpt mismatch.
- Declare an external write, a mutation other than `none`, an irreversible
  effect, or a pending owner approval: refused. No field can mark a tool
  "safe" to bypass this. `dry_run_available` is recorded but not enforced,
  because a call that already happened has no meaningful dry run.
- Set `accepted: true`: refused.
- Point any path through a symlink, or reuse an existing output: refused.

## 5. What it still is not

The recorded run is proposal-only evidence. It accepts nothing and promotes
nothing. Turning it into a planning input is a separate, explicit owner
decision recorded in a new accepted input set.
