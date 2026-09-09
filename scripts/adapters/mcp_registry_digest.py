#!/usr/bin/env python3
"""Render a validated MCP registry run as an owner decision list.

Reads a run MOZAK already validated and prints retained metadata only. It makes
no recommendation: deciding that a tool matters is the owner's call.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def field(lines: list[str], prefix: str) -> str:
    for line in lines:
        if line.startswith(prefix):
            return line[len(prefix):].strip()
    return ""


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    run = json.loads(Path(argv[1]).read_text())
    print("# MCP registry candidate tooling\n")
    print("Identity, version and dates only. Publisher prose is not retained.")
    print("Presence in the registry is publication, not endorsement.\n")
    for gap in run.get("gaps", []):
        if gap["impact"] == "high":
            print(f"> **{gap['id']}**: {gap['description']}\n")
    for record in run.get("raw_records", []):
        lines = record["content"].splitlines()
        name = field(lines, "server:")
        version = field(lines, "version:")
        repository = field(lines, "repository:")
        updated = field(lines, "updated_at:")
        clusters = field(lines, "clusters:")
        link = f"[{name}]({repository})" if repository.startswith("http") else name
        print(f"- {link} `{version}`  ")
        print(f"  updated {updated} · clusters: {clusters}")
    print(f"\nRecorded {len(run.get('raw_records', []))} candidates.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
