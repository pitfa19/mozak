# Trust metadata

Trust metadata is optional frontmatter that helps a reader know when a note was last checked.

```yaml
---
last_verified: 2026-09-23
confidence: medium
archive_proposal: superseded by another note, needs owner review
---
```

`last_verified` records the last human or agent verification date. `confidence` is `low`, `medium`, or `high`. `archive_proposal` records why a note may belong in a recoverable archive.

The audit reports missing, invalid, or stale metadata. It does not write trust metadata automatically because verification and confidence are semantic judgements.
