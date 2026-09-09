# Project discovery review contract (PF-0025)

`mozak project review DISCOVERY_JSON` is the public, read-only pre-mutation gate for a discovery proposal. It does not create an approval or config and does not replace `project register` or `project refresh`.

## Input

The input must be the exact strict `project discover` JSON object. Unknown or missing fields, trailing JSON, an invalid proposal shape, or a proposal digest mismatch fail nonzero with no stdout.

The proposal target must equal the current default config path and contain no path or symlink hazard. The live config bytes must match `config_base_sha256` exactly.

- If the config is absent, the proposal base must be `null` and `action` is `register`.
- If the config is present, it must satisfy the strict local-config contract and the proposal base must equal its SHA-256. `action` is `refresh` when the exact snapshot changes and `none` when there are no additions, removals, or changed pins.

The live KB must validate at the exact proposed canonical root and SHA-256. Every proposed project root, manifest, idea, identity, revision, and content pin must validate and equal the proposal. Stale, drifted, hazardous, conflicting, or malformed state fails nonzero with no stdout.

## Output

Success writes one deterministic compact JSON object with:

- `schema_version: 1` and `command: "project review"`
- `action`, `target_config_path`, `config_base_sha256`, and `proposal_digest`
- `kb_root` and `kb_sha256`
- `project_count`
- sorted project-ID arrays `additions`, `removals`, `changed_pins`, and `unchanged`
- `auto_discovery: false`, `trust_transfer: false`, and `mutation: false`

For initial registration, every proposed project is an addition. For refresh, the arrays compare the exact validated proposal to the exact validated current config. A changed pin means the same project ID has any different stored project record.

When `action` is `none`, an agent stops without requesting approval or invoking a mutation route.

## Approval boundary

An agent presents the exact review JSON to the owner. Review output is not approval. Only a separate strict owner approval pinned to the proposal digest and target permits the matching `project register` or `project refresh` mutation. Refresh approval additionally requires `intent: "project refresh"`.
