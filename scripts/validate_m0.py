#!/usr/bin/env python3
"""Deterministic structural checks for the disposable M0 specification."""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

from m0_disposable_replay import ReplayError, canonical_hash, replay_hash

ROOT = Path(__file__).resolve().parents[1]
M0 = ROOT / "spec" / "m0"

REQUIRED_CASES = {
    "original_source_correction",
    "independent_source_conflict",
    "repeated_upstream_report",
    "paper_retraction",
    "validity_interval",
    "project_and_global_scope",
    "nary_experiment",
    "same_url_changed_content",
    "decision_dependency_change",
    "stale_worker_update",
    "embedded_malicious_instruction",
    "deleted_or_unreachable_source",
}

REQUIRED_DOCS = {
    "product-contract.md",
    "non-goals.md",
    "glossary.md",
    "state-model.md",
    "threat-model.md",
    "permission-matrix.md",
    "resource-contract.md",
    "evaluation-contract.md",
}


def fail(message: str) -> None:
    raise AssertionError(message)


def validate_schemas() -> None:
    schemas = list((M0 / "schemas").glob("*.json"))
    if not schemas:
        fail("no schemas found")
    for path in schemas:
        data = json.loads(path.read_text())
        if data.get("$schema") != "https://json-schema.org/draft/2020-12/schema":
            fail(f"{path.name}: unsupported or missing JSON Schema dialect")
        if data.get("type") != "object":
            fail(f"{path.name}: root must be an object")
        if not data.get("required"):
            fail(f"{path.name}: required fields are missing")


def validate_fixtures() -> None:
    path = M0 / "fixtures" / "canonical-state.json"
    fixtures = json.loads(path.read_text())
    if len(fixtures) < 10:
        fail("at least ten adversarial fixtures are required")
    ids: set[str] = set()
    cases: set[str] = set()
    for fixture in fixtures:
        fixture_id = fixture.get("id", "")
        if not re.fullmatch(r"fx_[0-9]{2}_[a-z0-9_]+", fixture_id):
            fail(f"invalid fixture id: {fixture_id}")
        if fixture_id in ids:
            fail(f"duplicate fixture id: {fixture_id}")
        ids.add(fixture_id)
        cases.add(fixture.get("case", ""))
        events = fixture.get("events")
        if not events:
            fail(f"{fixture_id}: no events")
        event_ids: set[str] = set()
        generations = [event.get("generation") for event in events]
        if any(not isinstance(value, int) or value < 1 for value in generations):
            fail(f"{fixture_id}: generations must be positive integers")
        if generations != sorted(generations) or len(generations) != len(set(generations)):
            fail(f"{fixture_id}: events are not strictly generation ordered")
        for event in events:
            missing_fields = {"id", "type", "actor", "transaction_time", "generation", "payload"} - event.keys()
            if missing_fields:
                fail(f"{fixture_id}: event missing fields: {sorted(missing_fields)}")
            if not re.fullmatch(r"evt_[a-z0-9_]+", event["id"]) or event["id"] in event_ids:
                fail(f"{fixture_id}: invalid or duplicate event id: {event['id']}")
            event_ids.add(event["id"])
            if not isinstance(event["payload"], dict) or not event["payload"]:
                fail(f"{fixture_id}: event payload must be a non-empty object")
        expected = fixture.get("expected", {})
        for key in ("projection", "canonical_hash", "human_diff"):
            if key not in expected:
                fail(f"{fixture_id}: missing expected.{key}")
        projection, digest = replay_hash(events)
        if projection != expected["projection"] or digest != expected["canonical_hash"]:
            fail(f"{fixture_id}: replay projection or canonical hash mismatch")
        if canonical_hash(json.loads(json.dumps(projection))) != digest:
            fail(f"{fixture_id}: canonical hash is not deterministic")
        if not fixture.get("forbidden_outcomes"):
            fail(f"{fixture_id}: forbidden outcomes are required")
        if fixture.get("case") == "stale_worker_update":
            stale = [event for event in events if "base_generation" in event]
            if not stale or stale[-1]["base_generation"] >= stale[-1]["generation"] - 1:
                fail(f"{fixture_id}: stale base generation is not demonstrated")
            if "accept stale proposal" not in fixture["forbidden_outcomes"]:
                fail(f"{fixture_id}: stale acceptance is not forbidden")
        if fixture.get("case") == "embedded_malicious_instruction" and expected["projection"]["accepted"]:
            fail(f"{fixture_id}: embedded instructions cannot be accepted")
        if fixture.get("case") == "paper_retraction" and expected["projection"]["accepted"]:
            fail(f"{fixture_id}: retracted claim cannot remain accepted")
    missing = REQUIRED_CASES - cases
    if missing:
        fail(f"missing adversarial cases: {sorted(missing)}")


def validate_docs() -> None:
    missing = [name for name in sorted(REQUIRED_DOCS) if not (M0 / name).is_file()]
    if missing:
        fail(f"missing required documents: {missing}")
    glossary = (M0 / "glossary.md").read_text().lower()
    for term in ("source", "snapshot", "span", "entity", "statement", "claim", "evidence", "event", "patch", "branch", "release", "packet", "policy", "job"):
        if f"| {term} |" not in glossary:
            fail(f"glossary term missing: {term}")


def validate_scenario_adapter() -> None:
    contract = M0 / "scenarios" / "contract.json"
    scenario_readme = M0 / "scenarios" / "README.md"
    if not contract.is_file() or not scenario_readme.is_file():
        fail("scenario contract files are missing")
    data = json.loads(contract.read_text())
    required = {"identity", "initial_state", "actions", "observations", "transformations", "verifier_boundary"}
    missing = required - set(data)
    if missing:
        fail(f"scenario contract sections missing: {sorted(missing)}")
    if set(data["actions"]) != {"reset", "step", "save", "restore"}:
        fail("scenario action vocabulary is not sealed")
    if set(data["transformations"]) != {"Setup", "Rule", "Link"}:
        fail("scenario transformations must be Setup, Rule, and Link")
    subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "test_m0_scenario_adapter.py")],
        cwd=ROOT,
        check=True,
    )


def validate_evaluation() -> None:
    required = (
        M0 / "evaluation" / "README.md",
        M0 / "evaluation" / "run-config.json",
        M0 / "evaluation" / "corpus" / "manifest.json",
        M0 / "evaluation" / "results" / "recorded-baseline.json",
        ROOT / "scripts" / "run_m0_baseline.py",
    )
    missing = [str(path.relative_to(ROOT)) for path in required if not path.is_file()]
    if missing:
        fail(f"missing evaluation files: {missing}")
    subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "run_m0_baseline.py"), "--check-recorded"],
        cwd=ROOT,
        check=True,
    )


def main() -> int:
    checks = (validate_docs, validate_schemas, validate_fixtures, validate_scenario_adapter, validate_evaluation)
    for check in checks:
        check()
        print(f"ok: {check.__name__}")
    print("M0 draft validation passed")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (AssertionError, json.JSONDecodeError, ReplayError, subprocess.CalledProcessError) as error:
        print(f"M0 validation failed: {error}", file=sys.stderr)
        raise SystemExit(1)
