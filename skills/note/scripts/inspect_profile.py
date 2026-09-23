#!/usr/bin/env python3
"""Inspect the device-local note profile and resolve precedence.

Reports exactly one state: ready, needs_input, invalid, or blocked. Absence of a
profile is `needs_input` rather than an error, because a fresh install has no
configuration and the skill is expected to work without one.

This inspector never writes, never scans the filesystem for candidate
destinations, and never invents a default.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from profile_lib import READINESS_EXIT_CODES, inspect_profile, profile_path, resolve_precedence


def explicit_values(args: argparse.Namespace) -> dict[str, Any]:
    return {
        "destination_id": args.explicit_destination,
        "path": args.explicit_path,
        "trim": args.explicit_trim,
        "obsidian": True if args.explicit_obsidian else None,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--path", help="inspect an explicit profile path")
    parser.add_argument("--resolve", action="store_true", help="also emit precedence resolution JSON")
    parser.add_argument("--target", help="target file or directory for nearest style document lookup")
    parser.add_argument("--request", help="operation text used only for routing-signal resolution")
    parser.add_argument("--explicit-destination", help="operation-only destination id from the user's request")
    parser.add_argument("--explicit-path", help="operation-only path from the user's request")
    parser.add_argument("--explicit-trim", choices=("low", "medium", "high"), help="operation-only trim level")
    parser.add_argument("--explicit-obsidian", action="store_true", help="operation-only Obsidian mode override")
    args = parser.parse_args()

    try:
        report = inspect_profile(profile_path(args.path))
        state = report["state"]
        if args.resolve:
            target = Path(args.target).expanduser() if args.target else None
            report["resolution"] = resolve_precedence(
                explicit=explicit_values(args),
                target=target,
                profile_report=report,
                request=args.request,
            )
            state = report["resolution"]["state"]
        print(json.dumps(report, indent=2, sort_keys=True))
        return READINESS_EXIT_CODES[state]
    except (OSError, RuntimeError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 4


if __name__ == "__main__":
    sys.exit(main())
