# Tool evidence contract: `mozak.tool-evidence.v1`

Status: implemented in `crates/mozak-core/src/tool_evidence.rs` and
`crates/mozak-cli/src/tool_evidence_workflow.rs`.

## Purpose

The CLI records one already-completed, read-only call to a catalog MCP server as
proposal-only research evidence. One source-neutral fixture shape covers every
MCP source. The core schema retains `cli`, `skill`, `api`, and `other` kinds only
for historical compatibility, and source-specific fixture normalizers remain
offline readers for previously recorded snapshots. Recording derives an ordinary
`ResearchRun`, so `research validate` and `research landmarks` apply unchanged.

MOZAK performs no networking and handles no credentials here. The tool ran
outside MOZAK. MOZAK only validates the fixture against the response bytes
that the fixture names.

## Routes

- `mozak research record-tool <fixture.json> <response-bytes> <run.json>`
  - Requires `tool.kind: "mcp"` and an exact shipped catalog ID whose kind is `mcp_server`. Non-MCP and undeclared tools are refused before output is created.
  - Create-only: opens the output with `create_new` and never overwrites.
  - Refuses an existing or dangling output.
  - Refuses `..` and a symlink anywhere in an input or output path, ancestors included.
  - Bounds every input to 16 MiB, checked during the read.
- `mozak research verify-tool <fixture.json> <response-bytes> <run.json>`
  - Read-only, including historical non-MCP recordings and older tool IDs. Verification never creates new evidence or consults current catalog membership.
  - Rebuilds the run from the fixture and response and requires exact equality with the stored run.

## Fixture schema (closed: any unknown field is refused)

| Field | Rule |
|---|---|
| `schema` | exactly `mozak.tool-evidence.v1` |
| `scope_id` | lowercase `[a-z0-9-]` identifier |
| `question` | non-empty, at most 1000 bytes |
| `tool.tool_id` | catalog tool id, lowercase `[a-z0-9._-]` |
| `tool.kind` | CLI new recordings: `mcp` only. Core historical readers also recognize `cli`, `skill`, `api`, and `other`. |
| `tool.version` | exact pinned version that contains a digit; moving labels (`latest`, `main`, `unknown`, etc.) refused |
| `tool.operation` | invoked operation (for example an MCP tool name) |
| `tool.server` | required for `mcp`, forbidden otherwise |
| `call.arguments` | JSON object, at most 8192 canonical bytes; credential-like keys and `Bearer`/`Basic` values refused |
| `call.started_at`, `call.finished_at` | strict real-calendar UTC `YYYY-MM-DDTHH:MM:SSZ`, start <= finish |
| `effects` | the historical `AdapterEffects` serialization shape (see "Authority boundary"); its name does not imply a live adapter runtime |
| `response.sha256`, `response.byte_length`, `response.media_type` | pin of the exact response bytes, at most 16 MiB |
| `selections[]` | 1 to 32 items. Each has an `id` (`sel-*`), a printable `scheme:rest` `locator`, a `response_byte_start`/`response_byte_end` range, and an `excerpt` |
| `total_results`, `truncated` | honest counts; distinct locators <= `total_results` |
| `gaps[]` | `{id: gap-*, description, impact}`, at most 16; MOZAK-reserved ids refused |
| `accepted` | must be `false` |
| `authority` | must be `proposal_only` |

## Bounds and retention

- Every excerpt must equal `response[start..end]` byte for byte.
- Excerpts are capped at 2000 bytes each and 8000 bytes in total.
- The full response is never stored. Only its SHA-256, its length, and the selected excerpts persist, as immutable `untrusted_data` raw records. Full papers or bodies are therefore not stored.
- MOZAK always adds `gap-tool-output-untrusted` and `gap-selected-excerpts-only`. It adds a high-impact `gap-truncated` when `truncated` is true.

## Derived run

- Source profile `source-tool-evidence-v1`, pipeline `pipeline-tool-evidence-v1`, receipt adapter `adapter-tool-evidence-v1`. Every URI uses the prefix `recorded:tool-evidence:`.
- `raw-provenance` lists the tool identity and version, the server, the operation, the call arguments SHA-256, the call window, and the response pin. Its last line is `fixture: <canonical fixture JSON>`.
- One raw record, one evidence record, and one claim are derived per selection. Every claim is `qualified`, so a run can never be `supported` and its receipt can never be `passed`.
- `receipt.input_hash` is the SHA-256 of the canonical (key-sorted, compact) fixture JSON. The run id is derived deterministically, so the same fixture always gives the same run.
- If a run carries any of these markers, `research validate` rebuilds it from the embedded fixture and refuses any difference. A forged run fails even when every hash was recomputed. No historical artifact uses these markers.

## Integrity, not authenticity

The contract proves that the stored run, the fixture, and the response bytes
agree with each other and have not drifted.

It does **not** prove:
- that the tool really returned those bytes,
- that the recorder honestly reported the version, time, or effects,
- that the content is true, complete, or fit for use.

The declared effects are the recorder's own assertion. Nothing signs the
recording.

## Authority boundary

- Refused effects:
  - non-empty `external_writes`
  - `mutations_performed` other than `none`
  - non-empty `irreversible_effects`
  - `owner_approval_required: true`
- Allowed effects:
  - `network_used` may be true or false.
  - `dry_run_available` is recorded but not enforced, because a completed call has no meaningful dry run.
- No field can declare a call safe or trusted and bypass these checks, because unknown fields are refused.
- Recording accepts nothing, promotes nothing, and transfers no trust.
- Turning any excerpt into an accepted planning or Scope input remains a separate, explicit owner decision through the ordinary acceptance gates.
