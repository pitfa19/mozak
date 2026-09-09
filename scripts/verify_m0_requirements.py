#!/usr/bin/env python3
"""Whole-result M0 verification with positive and negative integration checks."""

from __future__ import annotations

import copy
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
M0 = ROOT / "spec" / "m0"
sys.path.insert(0, str(ROOT / "scripts"))

from m0_disposable_replay import ReplayError, replay, replay_hash  # noqa: E402


def run(*args: str) -> None:
    subprocess.run([sys.executable, *args], cwd=ROOT, check=True)


def expect_replay_failure(name: str, events: list[dict]) -> None:
    try:
        replay(events)
    except (ReplayError, KeyError, ValueError):
        print(f"ok: negative replay boundary rejects {name}")
    else:
        raise AssertionError(f"negative replay boundary accepted {name}")


def verify_artifacts() -> None:
    required = [
        "product-contract.md", "non-goals.md", "glossary.md", "state-model.md",
        "lifecycle-diagrams.md", "threat-model.md", "permission-matrix.md",
        "resource-contract.md", "evaluation-contract.md",
        "phase-1-implementation-packet.md", "scenarios/contract.json",
        "evaluation/results/recorded-baseline.json",
    ]
    missing = [path for path in required if not (M0 / path).is_file()]
    if missing:
        raise AssertionError(f"required M0 artifacts missing: {missing}")
    schema_names = {path.name for path in (M0 / "schemas").glob("*.json")}
    expected_schemas = {
        "event.schema.json", "statement.schema.json", "evidence.schema.json",
        "claim.schema.json", "patch.schema.json", "temporal.schema.json",
        "packet.schema.json", "fixture.schema.json",
    }
    if schema_names != expected_schemas:
        raise AssertionError(f"schema set mismatch: {sorted(schema_names ^ expected_schemas)}")
    if len(list((M0 / "adrs").glob("*.md"))) < 8:
        raise AssertionError("ADR set is incomplete")
    print("ok: required M0 artifacts and public contracts are present")


def verify_replay_boundaries() -> None:
    fixtures = json.loads((M0 / "fixtures" / "canonical-state.json").read_text())
    for fixture in fixtures:
        projection, digest = replay_hash(fixture["events"])
        if projection != fixture["expected"]["projection"]:
            raise AssertionError(f"{fixture['id']}: projection differs")
        if digest != fixture["expected"]["canonical_hash"]:
            raise AssertionError(f"{fixture['id']}: hash differs")
    print(f"ok: {len(fixtures)} public fixture histories reproduce expected state and hashes")

    sample = copy.deepcopy(fixtures[0]["events"])
    duplicate = copy.deepcopy(sample)
    duplicate.append(copy.deepcopy(duplicate[-1]))
    duplicate[-1]["generation"] += 1
    expect_replay_failure("duplicate event id", duplicate)

    reordered = copy.deepcopy(sample)
    reordered[1]["generation"] = reordered[0]["generation"]
    expect_replay_failure("non-increasing generation", reordered)

    stale = copy.deepcopy(sample)
    stale[-1]["base_generation"] = 0
    expect_replay_failure("unrejected stale accepted event", stale)

    changed_snapshot = copy.deepcopy(sample)
    repeated = copy.deepcopy(changed_snapshot[0])
    repeated["id"] = "evt_snapshot_mutation"
    repeated["generation"] = changed_snapshot[-1]["generation"] + 1
    repeated["payload"]["snapshot"]["content_hash"] = "f" * 64
    changed_snapshot.append(repeated)
    expect_replay_failure("immutable snapshot mutation", changed_snapshot)

    unknown = copy.deepcopy(sample)
    unknown[-1]["type"] = "unknown_event"
    expect_replay_failure("unknown event type", unknown)


def main() -> int:
    verify_artifacts()
    run("scripts/validate_m0.py")
    verify_replay_boundaries()
    run("scripts/test_m0_scenario_adapter.py")
    run("scripts/run_m0_baseline.py", "--check-recorded")
    print("M0 whole-result requirement verification passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
