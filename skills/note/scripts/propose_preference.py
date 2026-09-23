#!/usr/bin/env python3
"""Record a preference proposal. Never applies one.

A proposal is written with status "proposed" and nothing else changes. This
script does not read, write, or merge the profile, so being corrected can never
silently become a durable rule.
"""

from __future__ import annotations

import argparse
import json
import sys
from profile_lib import file_sha256, write_json_atomic_verified
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCHEMA_VERSION = 1
SCOPE_KINDS = {"path", "destination", "note_type", "global"}


def parse_scope(value: str) -> tuple[str, str | None]:
    """Parse `global` or `kind:target` into a validated pair."""
    raw = value.strip()
    if not raw:
        raise ValueError("scope must not be empty")
    if ":" not in raw:
        if raw not in SCOPE_KINDS:
            raise ValueError(f"unknown scope kind '{raw}'")
        if raw != "global":
            raise ValueError(f"scope '{raw}' needs a target, as in {raw}:<value>")
        return "global", None
    kind, target = raw.split(":", 1)
    kind, target = kind.strip(), target.strip()
    if kind not in SCOPE_KINDS:
        raise ValueError(f"unknown scope kind '{kind}'")
    if kind == "global":
        raise ValueError("global scope takes no target")
    if not target:
        raise ValueError(f"scope '{kind}' needs a non-empty target")
    return kind, target


def load_existing(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"schema_version": SCHEMA_VERSION, "proposals": []}
    try:
        document = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError, UnicodeError) as error:
        raise SystemExit(f"error: cannot read existing proposals at {path}: {error}")
    if not isinstance(document, dict) or not isinstance(document.get("proposals"), list):
        raise SystemExit(f"error: {path} is not a proposals document")
    return document



def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--id", required=True, help="stable identifier for the rule")
    parser.add_argument("--scope", required=True, help="global, or kind:target")
    parser.add_argument("--rule", required=True, help="the rule, in one sentence")
    parser.add_argument(
        "--evidence",
        required=True,
        action="append",
        help="why this is proposed; repeatable, at least one required",
    )
    parser.add_argument("--output", required=True, help="proposals file to append to")
    args = parser.parse_args()

    identifier = args.id.strip()
    if not identifier:
        print("error: --id must not be empty", file=sys.stderr)
        return 2
    rule = args.rule.strip()
    if not rule:
        print("error: --rule must not be empty", file=sys.stderr)
        return 2
    evidence = [item.strip() for item in args.evidence if item.strip()]
    if not evidence:
        print("error: at least one non-empty --evidence is required", file=sys.stderr)
        return 2

    try:
        kind, target = parse_scope(args.scope)
    except ValueError as error:
        print(f"error: {error}", file=sys.stderr)
        return 2

    path = Path(args.output).expanduser()
    expected_sha256 = file_sha256(path)
    document = load_existing(path)

    for existing in document["proposals"]:
        if not isinstance(existing, dict) or existing.get("id") != identifier:
            continue
        status = existing.get("status")
        if status == "accepted":
            print(
                f"error: proposal '{identifier}' was already accepted; "
                "editing an accepted preference is an owner decision",
                file=sys.stderr,
            )
            return 3
        if status == "rejected":
            print(
                f"error: proposal '{identifier}' was previously rejected; "
                "re-proposing it requires the owner to raise it again",
                file=sys.stderr,
            )
            return 3
        document["proposals"].remove(existing)
        break

    proposal = {
        "id": identifier,
        "scope": {"kind": kind, "target": target},
        "rule": rule,
        "evidence": evidence,
        "status": "proposed",
        "proposed_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    document["schema_version"] = SCHEMA_VERSION
    document["proposals"].append(proposal)
    document["proposals"].sort(key=lambda item: str(item.get("id", "")))
    try:
        write_json_atomic_verified(path, document, expected_sha256=expected_sha256)
    except (OSError, RuntimeError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 4

    print(
        json.dumps(
            {
                "recorded": proposal,
                "output": str(path),
                "authority": "proposal_only: this rule is not applied until the owner accepts it",
            },
            indent=2,
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
