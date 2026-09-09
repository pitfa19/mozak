# Explicit KB registry and parity assessment contract

## Status and boundary

This document defines migration step 7's smallest honest framework. It adds a
read-only index over existing Scope roots and an executable parity assessment.
It does not import, migrate, rewrite, archive, delete, or become authoritative
for any registered source or vault.

## `kb.json`

A registry root contains exactly one strict JSON manifest named `kb.json`:

```json
{
  "schema_version": 1,
  "registrations": [
    {
      "id": "personal",
      "path": "/home/alice/Documents/mozak-kb",
      "scope_manifest_sha256": "<64 lowercase hexadecimal characters>"
    },
    {
      "id": "example-alpha",
      "path": "/home/alice/Documents/mozak-kb/scopes/example-alpha",
      "scope_manifest_sha256": "<64 lowercase hexadecimal characters>"
    },
    {
      "id": "explore",
      "path": "/home/alice/Documents/explore/.mozak/scope",
      "scope_manifest_sha256": "<64 lowercase hexadecimal characters>"
    }
  ]
}
```

The example paths are illustrative local registrations, not portable defaults.
A registration path must be explicit, absolute, canonical, existing, and a
non-symlink directory. Its `scope.json` must be a regular non-symlink file whose
exact bytes match the declared hash and pass the existing Scope v2 validator.
Registration IDs and canonical roots are unique. Unknown fields fail closed.
Nested registered roots are allowed.

Validation loads only the registrations in `kb.json`. It does not walk the
registry root, a registered root, parent directories, sibling directories, or
source vaults looking for additional manifests. A later ANPIT root appears only
after an owner explicitly adds and hashes that registration.

## Read-only routes

```text
mozak kb validate REGISTRY_ROOT
mozak kb list REGISTRY_ROOT
mozak kb tree REGISTRY_ROOT
mozak kb graph-source REGISTRY_ROOT
mozak kb graph REGISTRY_ROOT
```

`validate` emits compact JSON and states `auto_discovery: false` and
`authority: registered_sources_remain_authoritative`. `list` and `tree` are
stable terminal views. Tree nesting is derived only between explicitly
registered canonical paths. `graph-source` is deterministic Mermaid source.
`graph` sends those exact bytes to Termaid stdin and has no fallback renderer.
All routes are read-only.

## Parity observations

`mozak kb parity REGISTRY_ROOT OBSERVATIONS_JSON` accepts a strict manifest:

```json
{
  "schema_version": 1,
  "registry_sha256": "<exact SHA-256 of kb.json>",
  "source_files": [
    {
      "registration_id": "personal",
      "input_id": "input-reading-list",
      "path": "/canonical/absolute/path/to/list.md",
      "observed_revision": "<40 lowercase hexadecimal characters>"
    }
  ]
}
```

Source files are never discovered. Each optional observation names one known
registered input and one explicit canonical absolute regular non-symlink file.
The harness reads only those files, compares their bytes with the projected
content-addressed object, compares SHA-256, and compares the caller-observed
revision with the pinned source revision. Missing observations block the
relevant preservation or attachment gate rather than being inferred as passing.

Wikilink and embed resolution is bounded to the registered input source paths
inside the same explicit Scope root. A target passes only when it resolves to
exactly one registered source path. This is an observed closed-snapshot check,
not a claim of complete Obsidian resolution semantics.

## Fixed gates and exit behavior

Every assessment emits exactly these gates in order:

1. `markdown_wikilink_preservation`
2. `markdown_embed_preservation`
3. `wikilink_resolution`
4. `embed_resolution`
5. `attachments`
6. `content_hashes`
7. `deterministic_export`
8. `import_export_round_trip`
9. `version_history`
10. `rollback_recovery`
11. `human_editability`
12. `agent_discovery`

Each gate is `passed`, `failed`, `unsupported`, or `blocked`, with an
observation and concrete evidence. The command exits 0 only if all gates pass.
It exits 2 with a complete JSON report when parity is not demonstrated. Invalid
contracts exit 1 with no successful stdout.

In this release, import/export round trip, version history, and rollback or
recovery are explicitly unsupported. Human editability is blocked until a
witnessed editing trial exists. Therefore this release does not claim parity.
A valid registry, deterministic export, hashes, or agent-readable views are not
sufficient to transfer authority or justify archiving a source vault.

## Acceptance observations

The production tests include real Markdown containing both `[[B]]` and
`![[asset.png]]`, a real attachment byte fixture, explicit live source files,
content-addressed projections, deterministic repeated export, unique bounded
resolution, source drift, unsafe paths, unknown fields, duplicate roots, hash
tampering, ignored unregistered manifests, exact tree output, and exact Termaid
stdin.

A read-only acceptance run also registered the current personal root, nested
Example Alpha root, and Explore root in a scratch `kb.json`. It validated 3 registered
roots, 6 Scopes, 2 advisory Meta Goals, and 17 inputs, then rendered the unified
tree and Termaid graph. The parity harness returned `parity: false`: content
hashes, deterministic export, and agent discovery passed; current wikilink
resolution failed for missing closed-snapshot targets; source preservation,
embeds, attachments, and human editability were blocked without the necessary
observations; import/export round trip, version history, and rollback/recovery
were unsupported. No registered root or source vault was modified.
