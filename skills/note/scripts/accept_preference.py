#!/usr/bin/env python3
"""Accept a proposed preference into the device-local profile.

Only an explicit proposal id is accepted. Current-operation instructions are not
read from prompts and never persist through this script. The profile update uses
a same-directory temporary file, fsync, atomic replace, and readback verification.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from profile_lib import file_sha256, inspect_profile, profile_path, write_json_atomic_verified


def load_json(path: Path, label: str) -> dict[str, Any]:
    try:
        document = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError, UnicodeError) as error:
        raise SystemExit(f"error: cannot read {label} at {path}: {error}")
    if not isinstance(document, dict):
        raise SystemExit(f"error: {label} must be a JSON object")
    return document


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--proposal-id", required=True, help="id of an existing proposed preference")
    parser.add_argument("--proposals", required=True, help="proposal document created by propose_preference.py")
    parser.add_argument("--profile", help="profile path; defaults to $XDG_CONFIG_HOME/notes/profile.json")
    args = parser.parse_args()

    proposal_id = args.proposal_id.strip()
    if not proposal_id:
        print("error: --proposal-id must not be empty", file=sys.stderr)
        return 2

    proposals_path = Path(args.proposals).expanduser()
    proposals_sha256 = file_sha256(proposals_path)
    proposals_doc = load_json(proposals_path, "proposals")
    proposals = proposals_doc.get("proposals")
    if not isinstance(proposals, list):
        print("error: proposals document needs a proposals list", file=sys.stderr)
        return 3
    proposal = next((item for item in proposals if isinstance(item, dict) and item.get("id") == proposal_id), None)
    if proposal is None:
        print(f"error: proposal '{proposal_id}' not found", file=sys.stderr)
        return 3
    if proposal.get("status") != "proposed":
        print(f"error: proposal '{proposal_id}' is not proposed", file=sys.stderr)
        return 3

    profile = profile_path(args.profile)
    profile_sha256 = file_sha256(profile)
    inspection = inspect_profile(profile)
    if inspection["state"] in {"invalid", "blocked"}:
        print(json.dumps({"state": inspection["state"], "issues": inspection["issues"]}, indent=2, sort_keys=True), file=sys.stderr)
        return 4 if inspection["state"] == "blocked" else 3
    if profile.exists():
        document = load_json(profile, "profile")
    else:
        document = {"schema_version": 1, "destinations": []}

    preferences = document.setdefault("preferences", [])
    if not isinstance(preferences, list):
        print("error: profile preferences must be a list", file=sys.stderr)
        return 3
    if any(isinstance(item, dict) and item.get("id") == proposal_id for item in preferences):
        print(f"error: accepted preference '{proposal_id}' already exists", file=sys.stderr)
        return 3

    accepted = {
        "accepted_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "evidence": proposal.get("evidence", []),
        "id": proposal_id,
        "rule": proposal.get("rule"),
        "scope": proposal.get("scope"),
        "source_proposal": str(proposals_path),
    }
    preferences.append(accepted)
    preferences.sort(key=lambda item: str(item.get("id", "")))
    try:
        write_json_atomic_verified(profile, document, expected_sha256=profile_sha256)
    except (OSError, RuntimeError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 4

    proposal["status"] = "accepted"
    proposal["accepted_at"] = accepted["accepted_at"]
    try:
        write_json_atomic_verified(proposals_path, proposals_doc, expected_sha256=proposals_sha256)
    except (OSError, RuntimeError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 4
    print(json.dumps({"accepted": accepted, "profile": str(profile), "proposals": str(proposals_path), "write_guarantee": "same_directory_temp_fsync_replace_readback"}, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
