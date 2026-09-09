#!/usr/bin/env python3
"""Render a validated GitHub tooling run as an owner promotion report.

Prints retained metadata only, plus a ready-to-paste watchlist block. It makes
no recommendation: deciding what to watch is the owner's call, which is the
whole reason discovery stops here.
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


def marker(lines: list[str]) -> tuple[str, str]:
    for kind in ("latest_release: ", "latest_commit: "):
        value = field(lines, kind)
        if value:
            return kind.split("_")[1].rstrip(": "), value
    return "unknown", ""


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    run = json.loads(Path(argv[1]).read_text())
    records = run.get("raw_records", [])
    mode = "discover" if any(
        g["id"] == "gap-discovery-is-proposal-only" for g in run.get("gaps", [])
    ) else "watch"

    print(f"# GitHub tooling report ({mode})\n")
    print("Identity, activity, licence and topics only. Repository prose is not retained.")
    print("Stars measure attention, not quality. Nothing here is adopted or endorsed.\n")
    for gap in run.get("gaps", []):
        if gap["impact"] == "high":
            print(f"> **{gap['id']}**: {gap['description']}\n")

    rows = []
    for record in records:
        lines = record["content"].splitlines()
        kind, value = marker(lines)
        rows.append(
            {
                "repo": field(lines, "repository:"),
                "url": field(lines, "url:"),
                "kind": kind,
                "marker": value,
                "at": field(lines, "latest_at:"),
                "stars": int(field(lines, "stars:") or 0),
                "lang": field(lines, "language:"),
                "license": field(lines, "license:"),
                "topics": field(lines, "topics:"),
                "matched": field(lines, "matched:"),
            }
        )

    print("## Candidates by most recent activity\n")
    for row in rows:
        print(f"### [{row['repo']}]({row['url']})")
        print(f"- {row['stars']:,} stars · {row['lang']} · licence {row['license']}")
        print(f"- latest {row['kind']}: `{row['marker']}` at {row['at']}")
        print(f"- matched: {row['matched']}")
        print(f"- topics: {row['topics']}\n")

    if mode == "discover":
        print("## To watch any of these\n")
        print("Add the ones you choose to a watch request's `watchlist`, then rerun in watch mode.")
        print("Discovery will not add them for you.\n")
        print("```json")
        print(json.dumps({"watchlist": [r["repo"] for r in rows]}, indent=2))
        print("```")
    print(f"\nRecorded {len(rows)} repositories.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
