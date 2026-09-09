#!/usr/bin/env python3
"""Exercise MOZAK's privacy-safe repository-owned planning workflow."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BIN = ROOT / "target/debug/mozak"


def run(root: Path, command: str, *, success: bool = True) -> subprocess.CompletedProcess[bytes]:
    result = subprocess.run(
        [str(BIN), "project", command, str(root)], capture_output=True, check=False
    )
    if success != (result.returncode == 0):
        raise AssertionError(
            f"project {command} returned {result.returncode}: {result.stderr.decode()}"
        )
    return result


def main() -> int:
    overview = json.loads(run(ROOT, "overview").stdout)
    assert overview["state"] == "valid"
    planning = overview["artifact_counts"]["planning"]
    assert planning["invalid"] == 0 and planning["unknown"] == 0
    assert planning["recognized"] == planning["valid"] == 2
    assert overview["latest_valid_plan"]["id"] == "plan-public-root"
    assert overview["ready_goals"] == []
    assert [goal["id"] for goal in overview["goals"]] == [
        "prepare-privacy-safe-public-root"
    ]
    assert overview["goals"][0]["status"] == "completed"

    listing = run(ROOT, "list").stdout.decode()
    assert "[completed] prepare-privacy-safe-public-root" in listing

    graph_source = run(ROOT, "graph-source").stdout.decode()
    assert "prepare-privacy-safe-public-root" in graph_source

    with tempfile.TemporaryDirectory(prefix="mozak-self-hosted-") as temporary:
        copy = Path(temporary) / "mozak"
        shutil.copytree(ROOT / ".mozak", copy / ".mozak")
        plan_path = copy / ".mozak/planning/plans/goal-dag-public-root-001.json"
        plan = json.loads(plan_path.read_text())
        plan["input_set_id"] = "missing-input-set"
        plan_path.write_text(json.dumps(plan, sort_keys=True))
        invalid = run(copy, "overview", success=False)
        assert invalid.returncode == 3
        report = json.loads(invalid.stdout)
        assert report["state"] == "invalid"
        assert any(
            "accepted planning input set is missing" in item["message"]
            for item in report["findings"]
        )

    print("privacy-safe self-hosted workflow acceptance passed")
    return 0


if __name__ == "__main__":
    if len(sys.argv) > 1:
        BIN = Path(sys.argv[1]).resolve()
    raise SystemExit(main())
