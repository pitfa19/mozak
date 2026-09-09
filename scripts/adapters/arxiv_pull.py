#!/usr/bin/env python3
"""Fetch chosen arXiv PDFs into a disposable scratch directory.

The pinned metadata record is the durable artifact. A PDF is working material:
pulled deliberately, read, then deleted. This tool therefore refuses to write
anywhere but an explicit scratch directory and records what it fetched so a
later reader can tell what was examined without keeping the bytes.

Usage:
  arxiv_pull.py SCRATCH_DIR ARXIV_ID [ARXIV_ID ...]
  arxiv_pull.py SCRATCH_DIR --from-digest IDS_FILE
  arxiv_pull.py SCRATCH_DIR --clean
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

PDF_BASE = "https://arxiv.org/pdf"
MIN_REQUEST_INTERVAL_SECONDS = 3.0
MAX_PULL = 40
USER_AGENT = "mozak-arxiv-adapter/1 (research reading; contact via repository)"

EFFECTS = {
    "network_used": True,
    "external_writes": [],
    "mutations_performed": "none",
    "irreversible_effects": [],
    "dry_run_available": False,
    "owner_approval_required": False,
    "local_writes": "one disposable scratch directory",
}


class PullError(Exception):
    """A bounded failure with no partial state left behind."""


def valid_id(value: str) -> str:
    if not re.fullmatch(r"\d{4}\.\d{4,5}(v\d+)?", value):
        raise PullError(f"not an arXiv identifier: {value}")
    return value


def clean(scratch: Path) -> int:
    """Removes the scratch directory. Pinned records are elsewhere and untouched."""
    if not scratch.exists():
        print(json.dumps({"command": "arxiv pull clean", "removed": 0, "path": str(scratch)}))
        return 0
    if not (scratch / "MANIFEST.json").exists():
        raise PullError(
            f"refusing to delete a directory this tool did not create: {scratch}"
        )
    count = len(list(scratch.glob("*.pdf")))
    shutil.rmtree(scratch)
    print(
        json.dumps(
            {"command": "arxiv pull clean", "removed": count, "path": str(scratch)},
            sort_keys=True,
        )
    )
    return 0


def pull(scratch: Path, identifiers: list[str]) -> int:
    if not identifiers:
        raise PullError("no identifiers given")
    if len(identifiers) > MAX_PULL:
        raise PullError(f"refusing to pull more than {MAX_PULL} papers at once")
    scratch.mkdir(parents=True, exist_ok=True)
    fetched = []
    for index, identifier in enumerate(identifiers):
        if index:
            time.sleep(MIN_REQUEST_INTERVAL_SECONDS)
        target = scratch / f"{identifier}.pdf"
        if target.exists():
            fetched.append({"arxiv_id": identifier, "status": "already_present"})
            continue
        request = urllib.request.Request(
            f"{PDF_BASE}/{identifier}", headers={"User-Agent": USER_AGENT}
        )
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                body = response.read()
        except Exception as error:  # noqa: BLE001 - reported, never swallowed
            fetched.append(
                {"arxiv_id": identifier, "status": "failed", "detail": str(error)}
            )
            continue
        if not body.startswith(b"%PDF"):
            fetched.append({"arxiv_id": identifier, "status": "not_a_pdf"})
            continue
        target.write_bytes(body)
        fetched.append(
            {
                "arxiv_id": identifier,
                "status": "fetched",
                "bytes": len(body),
                "sha256": hashlib.sha256(body).hexdigest(),
            }
        )

    # The manifest is what survives deletion: it records exactly which papers
    # were examined, so a later reader is not left guessing.
    manifest = {
        "schema_version": 1,
        "command": "arxiv pull",
        "pulled_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "effects": EFFECTS,
        "scratch": str(scratch),
        "papers": fetched,
        "note": (
            "These PDFs are disposable working material. The durable record is the "
            "pinned metadata run. Delete this directory with --clean when done."
        ),
    }
    (scratch / "MANIFEST.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    print(json.dumps(manifest, indent=2, sort_keys=True))
    return 0 if all(item["status"] in {"fetched", "already_present"} for item in fetched) else 1


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("scratch")
    parser.add_argument("ids", nargs="*")
    parser.add_argument("--from-digest", help="file of arXiv ids, one per line")
    parser.add_argument("--clean", action="store_true", help="delete the scratch directory")
    arguments = parser.parse_args(argv[1:])
    scratch = Path(arguments.scratch)

    if arguments.clean:
        return clean(scratch)
    identifiers = list(arguments.ids)
    if arguments.from_digest:
        try:
            lines = Path(arguments.from_digest).read_text().split("\n")
        except OSError as error:
            raise PullError(f"cannot read digest: {error}") from error
        identifiers.extend(line.strip() for line in lines if line.strip())
    return pull(scratch, [valid_id(item) for item in identifiers])


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv))
    except PullError as error:
        print(f"error: {error}", file=sys.stderr)
        sys.exit(1)
