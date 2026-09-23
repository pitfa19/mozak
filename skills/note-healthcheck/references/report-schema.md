# Report schema

`healthcheck.py audit` writes JSON with these top-level fields:

- `schema_version`: currently `1`.
- `mode`: `read_only_audit`.
- `root_included`: whether the private absolute root is present.
- `root`: `null` unless explicitly requested.
- `file_count`: audited Markdown file count.
- `findings`: warnings that do not imply repair.
- `mechanical_repairs`: exact repair candidates with root-relative path, before hash, after hash, and codes.
- `semantic_proposals`: proposal-only findings such as broken links, stale trust metadata, archive proposals, duplicates, and missing trust metadata.

Paths are root-relative by default. Public fixtures and evals must not use `--show-absolute-root`.
