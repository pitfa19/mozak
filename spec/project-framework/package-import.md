# Owner-approved local package import

`mozak kb import-package PACKAGE_ROOT INPUT_REGISTRY_ROOT APPROVAL_JSON OUTPUT_KB_ROOT` is the only package import route. It is local, offline, and fail-closed. It validates the closed source package and exact input registry before creating staging state.

The strict version-one approval artifact sets `decision: true`, identifies a non-empty `owner`, canonical UTC `approved_at`, and non-empty `rationale`, and pins the exact `package_id`, `project_id`, `release_id`, SHA-256 of the input registry's `kb.json`, and canonical new `output_root`. Approval confers permission only for this copy transaction. It does not make a package trusted, official, preferred, latest, canonical, or executable.

The command rejects missing or false approval, unknown fields, identity mismatch, stale registry base, tampering, symlink or unsafe paths, special filesystem entries, existing output, existing staging, package ID conflicts, duplicate `(project_id, release_id)` identities, and package histories whose exact references are absent or invalid. The same `release_id` may appear in different projects because release identity is project-scoped. Exact duplicates are explicitly rejected, not treated as a successful no-op.

A successful transaction reconstructs a new sibling KB root. It copies every validated package byte into `packages/sha256/<package digest>` under KB ownership, writes a deterministic registry containing the exact package registration, validates the entire staged KB and package history, and publishes only with a same-parent atomic rename. On failure, no final output exists and staging is removed where feasible. The source package and input registry are read-only.

The compact JSON receipt pins the approval hash, input and output registry hashes, exact package tuple, owned path, authority marker, and explicit false values for network use and source/input mutation. Imported packages appear deterministically in `kb validate`, `kb list`, `kb tree`, `kb graph-source`, and therefore `kb graph`.

See [`package-import-approval.schema.json`](package-import-approval.schema.json) and [`kb-registry.schema.json`](kb-registry.schema.json).
