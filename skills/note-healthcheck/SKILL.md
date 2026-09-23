---
name: note-healthcheck
description: Audit Markdown or Obsidian notes safely. Use this for note vault health checks, broken Markdown hygiene, trust metadata review, archive proposals, and previewed mechanical repairs. Default mode is read-only and requires an explicit root. It never performs semantic merge, delete, restructure, or supplement extraction without owner decision.
---

# note-healthcheck

Audit first. Repair only mechanical problems that have an exact preview, hashes, and snapshots. Preserve the author's notes over making a tidy report.

This skill works on plain Markdown directories. Obsidian syntax is optional. It does not need Obsidian, a plugin, or a running app.

## Default boundary

1. Require an explicit root path for every audit or repair.
2. Default to read-only audit.
3. Treat every semantic change as proposal-only.
4. Never permanently delete content.
5. Verify preservation after any apply.

If the user asks to "clean up", "dedupe", "merge", "archive", "extract supplements", or "restructure", produce proposals only. Do not change files unless each change is mechanical and previewed.

## What counts as mechanical

Mechanical repairs are byte-local, deterministic, and meaning-preserving. Examples:

- Normalize trailing whitespace.
- Collapse three or more blank lines to two blank lines.
- Add a final newline.
- Remove duplicate spaces inside Markdown link targets only when the target bytes are unchanged after decoding.

Do not apply repairs that choose meaning, destination, priority, ownership, voice, confidence, or structure. Those are semantic.

## Required workflow

1. Run `scripts/healthcheck.py audit --root ROOT --output REPORT.json`.
2. Review `REPORT.json`. It must list findings, mechanical repair candidates, proposal-only semantic findings, and root-relative paths only.
3. Run `scripts/healthcheck.py plan --report REPORT.json --output PLAN.json` to create the exact repair plan.
4. If applying mechanical repairs, run `scripts/healthcheck.py apply --plan PLAN.json --root ROOT --snapshot-dir SNAPSHOTS --archive-dir ARCHIVE --output RECEIPT.json`.
5. Read `RECEIPT.json` and confirm preservation verification passed.

Never skip the plan step. Never apply from a hand-written plan.

## Trust metadata

Audit frontmatter for optional trust fields:

- `last_verified`: ISO date or datetime.
- `confidence`: `low`, `medium`, or `high`.
- `archive_proposal`: free text explaining why archive is proposed.

Missing trust metadata is a finding, not a repair. The skill may propose adding or updating trust fields, but it does not write them automatically because confidence and verification are owner judgements.

## Archive policy

Archive is recoverable movement, not deletion. A semantic archive remains proposal-only. If a future owner-approved workflow moves a note, the original bytes must remain recoverable under the named archive root and the receipt must name the original relative path, archive path, original hash, and archived hash.

## Content guard

The auditor may flag these as proposals:

- Possible duplicate notes.
- Missing trust metadata.
- Stale `last_verified` values.
- Orphan notes.
- Broken links.
- Candidate supplements.
- Candidate merges or restructuring.

These flags are evidence for a human decision. They are not authorization to edit.

## Privacy boundary

Reports and plans use root-relative paths by default. Do not print private absolute roots, vault names, profile paths, organization names, or local routing rules in public output. Use `--show-absolute-root` only for a private local debugging session, never in an eval or public fixture.

## References

- [references/repair-boundary.md](references/repair-boundary.md)
- [references/report-schema.md](references/report-schema.md)
- [references/trust-metadata.md](references/trust-metadata.md)

## When to stop

Stop and ask for owner approval when a requested action would merge notes, delete notes, restructure folders, extract or inline supplements, change trust metadata, or archive content. The safe output is a proposal with hashes and exact paths, not a mutation.
