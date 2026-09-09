# ADR-0003: Publishable knowledge packages and successor lineage

- Status: accepted
- Decision date: 2026-09-02
- Scope: public MOZAK Project Framework

## Context

`ProjectRelease` already publishes accepted project knowledge, and a local Meta KB can
validate, list, and graph releases. A release is not yet a self-contained transport
unit: its optional human overview and other bounded public artifacts have no common
manifest, and there is no explicit release-to-release lineage.

MOZAK needs a package that can be copied through Git, an archive, an object store, or a
future registry without making the transport an authority. The same contract must work
offline and must not introduce the private self-improvement lab into the public product.

## Decision

MOZAK will define an immutable **knowledge package** as a directory whose root contains
`mozak-package.json`. The canonical manifest has a closed shape and these fields:

- `schema_version`: exactly `1`;
- `project_id`: the project identity copied from the packaged `ProjectRelease`;
- `release_id`: the release identity copied from the packaged `ProjectRelease`;
- `accepted_state_version`: the version copied from the packaged `ProjectRelease`;
- `artifacts`: a non-empty list of typed, safe-relative-path, SHA-256-pinned files;
- `predecessor`: either `null` for the first package or one predecessor reference with
  its project ID, release ID, accepted-state version, and canonical manifest SHA-256;
- `restores`: either `null` or the identity and canonical manifest SHA-256 of an older
  package whose accepted knowledge this new successor intentionally restores.

The package identity is the SHA-256 of canonical `mozak-package.json` bytes. Human names,
timestamps, paths, registry tags, and upload order are not package identity or lineage.

The artifact vocabulary is closed for version 1:

- `project_release`: required exactly once and authoritative for accepted project
  knowledge;
- `human_overview`: required exactly once, UTF-8 Markdown, and non-authoritative;
- `research_artifact`: optional, bounded, provenance-bearing public research output;
- `planning_artifact`: optional, bounded public plan or packet output.

Every artifact has a unique terminal-safe `id`, a kind, a safe relative `path`, a
lowercase SHA-256, and an explicit media type. Paths resolve inside the package root,
must name regular files, and may not target the manifest itself. The directory is
recursively closed: only the manifest, declared artifact files, and ancestor
directories required to reach declared artifacts may exist. Symlinks, non-regular
entries, undeclared files, and empty or otherwise unneeded directories fail closed,
as do exact and ASCII-case-folding path collisions. The total package-byte bound
includes the manifest, so unlisted bytes cannot evade limits. Unknown fields and
unknown artifact kinds fail closed.

The package validator must parse and semantically validate the embedded
`ProjectRelease`, then require its project and release identities to equal the manifest.
Research and planning artifacts remain context. They do not become accepted project
truth, implementation authority, or permission to mutate a consuming project.

## Successor semantics

A successor is a new immutable package. Existing package bytes are never edited.

When validating a supplied package history, MOZAK requires:

1. each predecessor and restore reference resolves to a supplied canonical manifest
   with the stated hash and identity;
2. predecessor and successor have the same `project_id`;
3. release identities and canonical manifest hashes are unique;
4. the successor's accepted-state version is exactly its predecessor's version plus one;
5. the predecessor graph is acyclic.

Lineage may branch. A package cannot prove that it is globally “latest”, “official”, or
preferred. A registry may expose branches and an owner may publish a signed or otherwise
authenticated selection later, but neither transport order nor upload time establishes
authority. A published rollback is a new successor of the current selected head whose
`restores` field names a proper ancestor of that predecessor. Naming the predecessor
itself is a no-op and is rejected. Directly selecting an ancestor is a consumer
downgrade, not a new publication, and never rewrites history.

## Publication and ingestion boundary

- Publication is byte transport of a validated immutable package.
- A future registry stores and serves packages by identity and digest. It does not add
  truth, execute plans, or authorize project changes.
- Downloading or discovering a package does not ingest it into a Meta KB.
- Meta KB import and update are separate owner-gated mutations with locking, append-only
  history, and stale-base checks.
- The public package contains no raw agent transcript, hidden prompt, credential, private
  self-improvement state, or executable authority.

## Consequences

The first implementation can remain local and read-only: validate one package, validate
a supplied history, list artifacts, and emit deterministic machine output. Registry,
networking, signing, automatic import, canonical-channel selection, and the private
self-improvement lab remain later modules.
