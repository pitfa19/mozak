#!/usr/bin/env python3
"""Turn a validated HyperResearch run into a readable decision list.

A run is machine-shaped and lists hashes. This renders what a person needs to
decide whether a source is worth promoting: what it is, where it came from, and
what this retrieval could not see.

usage: hyperresearch_digest.py RUN_JSON
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def field(content: str, name: str) -> str:
    prefix = f"{name}: "
    for line in content.splitlines():
        if line.startswith(prefix):
            return line[len(prefix) :]
    return ""


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    try:
        run = json.loads(Path(argv[1]).read_text())
    except (OSError, json.JSONDecodeError) as error:
        print(f"error: cannot read run: {error}", file=sys.stderr)
        return 1

    records = run.get("raw_records", [])
    lines = [
        "# HyperResearch vault snapshot",
        "",
        "Identity, source and provenance only. Note bodies are hashed, not retained.",
        "An external harness chose what to read. Nothing here is adopted or endorsed.",
        "",
    ]
    for gap in run.get("gaps", []):
        if gap.get("impact") == "high":
            lines.append(f"> **{gap.get('id')}**: {gap.get('description')}")
            lines.append("")

    lines.append("## Sources recorded")
    lines.append("")
    for record in records:
        content = record.get("content", "")
        title = field(content, "title") or "untitled"
        source = field(content, "source")
        lines.append(f"### {title}")
        lines.append(f"- note `{field(content, 'note')}` · {field(content, 'words')} words")
        if source and source != "unrecorded":
            lines.append(f"- source: {source}")
        lines.append(f"- tier {field(content, 'tier')} · {field(content, 'content_type')}")
        lines.append(f"- body sha256 `{field(content, 'body_sha256')[:16]}...`")
        lines.append("")

    lines.append(f"Recorded {len(records)} sources.")
    lines.append("")
    lines.append("Promotion to an accepted input remains an owner decision.")
    print("\n".join(lines))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
