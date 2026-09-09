# Immutable knowledge package contract

A version-one knowledge package is a closed local directory rooted at
`mozak-package.json`. Validation is offline, deterministic, and read-only. It
confers no trust, import, publication, signing, branch-selection, or execution
authority.

## Closed contents and limits

The manifest contains exactly one `project_release`, exactly one
`human_overview`, and zero or more `research_markdown` or `planning_markdown`
artifacts. The release media type is
`application/vnd.mozak.project-release+json`. Markdown uses exactly
`text/markdown; charset=utf-8` and must decode as UTF-8. Unknown fields, kinds,
and media types are rejected.

Artifact paths are non-empty ASCII relative paths containing no backslash,
control byte, absolute/root/prefix component, `.` or `..` component. Paths must
be unique both exactly and after ASCII case folding.

The directory policy is closed and recursive. The root may contain only the
regular, non-symlink `mozak-package.json` file, declared artifact regular files,
and directories that are required ancestors of declared artifacts. Every
regular file other than the manifest must match exactly one declared artifact.
Empty directories, directories without declared artifact descendants,
undeclared files at any depth, symlinks at any depth, filesystem path
case-folding collisions, and special or other non-regular entries are rejected.
Directories are structural only and are not artifacts.

Every artifact file's complete bytes are pinned by lowercase SHA-256 and an
exact byte count. Limits are 64 declared artifact files, 8 MiB per artifact,
32 MiB for the complete package including the manifest, and 1 MiB for the
manifest. Because all package entries are closed, undeclared bytes or entries
cannot bypass count or byte limits.

## Canonical bytes and identity

Canonical manifest bytes are compact UTF-8 JSON in the Rust contract's declared
field order, with artifacts sorted by `(path, kind)`, followed by one LF.
Package identity avoids self-reference by hashing a projection with these fields
in this exact order:

1. `schema_version`
2. `project_id`
3. `release_id`
4. `predecessor`
5. `restores`
6. sorted `artifacts`

The projection omits `package_id`, uses compact JSON without insignificant
whitespace, appends one LF byte, and is hashed over all resulting bytes. The
manifest identity is the lowercase string `sha256:<64 hexadecimal digits>`.
Artifact order and input manifest whitespace therefore cannot change identity.

## History

`predecessor` and `restores` references name an exact immutable
`(project_id, release_id, package_id)` tuple. History validation operates only
on the packages explicitly supplied by the caller. All packages must have the
same project, unique `(project_id, release_id)` identities and unique digests.
Every reference must resolve exactly, and predecessor edges must form an
acyclic branch-capable DAG. Each successor's accepted-state version is exactly
its predecessor's version plus one.

A rollback is a new successor. It must name its current predecessor, name a
proper ancestor of that predecessor in `restores`, advance the version by one,
and carry the restored ancestor's exact `accepted_state_sha256`. Naming the
predecessor itself is a rejected no-op restore. Validation never infers a
latest, official, preferred, or canonical branch.

See [`mozak-package.schema.json`](mozak-package.schema.json) and the canonical
fixture under [`fixtures/pf-0015/canonical`](fixtures/pf-0015/canonical).
