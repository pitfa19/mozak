#!/usr/bin/env python3
"""Executable M0 proof that fixture replay and scenario adaptation are equivalent."""

from __future__ import annotations

import copy
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
M0 = ROOT / "spec" / "m0"
CONTRACT_PATH = M0 / "scenarios" / "contract.json"
FIXTURE_PATH = M0 / "fixtures" / "canonical-state.json"
sys.path.insert(0, str(ROOT / "scripts"))
from m0_disposable_replay import canonical_hash, replay  # noqa: E402


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def digest(value: Any) -> str:
    return hashlib.sha256(canonical_bytes(value)).hexdigest()


class ScenarioAdapter:
    """Adapter constrained to public fixture fields, never verifier answers."""

    def __init__(self, contract: dict[str, Any]) -> None:
        self.contract = contract
        self.state: dict[str, Any] = {}
        self.fixture_id = ""
        self.fixture_case = ""
        self.scenario_id = ""

    def reset(self, public_fixture: dict[str, Any]) -> dict[str, Any]:
        if set(public_fixture) != {"id", "case", "events"}:
            raise AssertionError("adapter boundary exposes fields other than id, case, events")
        identity = {
            "contract": self.contract["contract"],
            "version": self.contract["version"],
            "fixture_id": public_fixture["id"],
            "fixture_case": public_fixture["case"],
        }
        self.scenario_id = digest(identity)
        self.fixture_id = public_fixture["id"]
        self.fixture_case = public_fixture["case"]
        self.state = copy.deepcopy(self.contract["initial_state"])
        self.state["expected_steps"] = len(public_fixture["events"])
        return self.observe()

    def step(self, event: dict[str, Any]) -> dict[str, Any]:
        if not self.scenario_id:
            raise AssertionError("reset is required before step")
        generation = event.get("generation")
        if not isinstance(generation, int) or generation <= self.state["generation"]:
            raise AssertionError("Rule requires strictly increasing positive generations")
        self.state["event_log"].append(copy.deepcopy(event))
        self.state["generation"] = generation
        projection = replay(self.state["event_log"])
        for key in self.contract["canonical_outcome_fields"]:
            self.state[key] = copy.deepcopy(projection[key])
        if len(self.state["event_log"]) == self.state["expected_steps"]:
            replay_digest = canonical_hash(projection)
            self.state["links"] = [
                {"rel": "fixture", "target": self.fixture_id},
                {"rel": "replay_sha256", "target": replay_digest},
            ]
        return self.observe()

    def observe(self) -> dict[str, Any]:
        return {
            "scenario_id": self.scenario_id,
            "generation": self.state.get("generation", 0),
            "accepted": copy.deepcopy(self.state.get("accepted", {})),
            "history": copy.deepcopy(self.state.get("history", {})),
            "conflicts": copy.deepcopy(self.state.get("conflicts", {})),
            "snapshots": copy.deepcopy(self.state.get("snapshots", {})),
            "quarantine": copy.deepcopy(self.state.get("quarantine", {})),
            "rejected_patches": copy.deepcopy(self.state.get("rejected_patches", [])),
            "event_count": len(self.state.get("event_log", [])),
            "links": copy.deepcopy(self.state.get("links", [])),
            "terminal": bool(self.state) and len(self.state["event_log"]) == self.state["expected_steps"],
        }

    def save(self) -> bytes:
        checkpoint = {
            "scenario_id": self.scenario_id,
            "fixture_id": self.fixture_id,
            "fixture_case": self.fixture_case,
            "state": self.state,
        }
        return canonical_bytes(checkpoint)

    def restore(self, saved: bytes) -> dict[str, Any]:
        checkpoint = json.loads(saved)
        identity = {
            "contract": self.contract["contract"],
            "version": self.contract["version"],
            "fixture_id": checkpoint["fixture_id"],
            "fixture_case": checkpoint["fixture_case"],
        }
        if checkpoint["scenario_id"] != digest(identity):
            raise AssertionError("checkpoint has an invalid sealed identity")
        state = checkpoint["state"]
        expected_links = [
            {"rel": "fixture", "target": checkpoint["fixture_id"]},
            {"rel": "replay_sha256", "target": canonical_hash(replay(state["event_log"]))},
        ]
        if state["links"] and state["links"] != expected_links:
            raise AssertionError("checkpoint replay link does not match its event log")
        self.scenario_id = checkpoint["scenario_id"]
        self.fixture_id = checkpoint["fixture_id"]
        self.fixture_case = checkpoint["fixture_case"]
        self.state = state
        return self.observe()


class HeldOutVerifier:
    """Owns expected outcomes and releases them only after terminal replay."""

    def __init__(self, fixtures: list[dict[str, Any]], contract: dict[str, Any]) -> None:
        self.fields = contract["canonical_outcome_fields"]
        self.oracle: dict[str, dict[str, Any]] = {}
        for fixture in fixtures:
            identity = {
                "contract": contract["contract"],
                "version": contract["version"],
                "fixture_id": fixture["id"],
                "fixture_case": fixture["case"],
            }
            self.oracle[digest(identity)] = copy.deepcopy(fixture["expected"]["projection"])

    def verify(self, adapter: ScenarioAdapter) -> tuple[dict[str, Any], str]:
        observation = adapter.observe()
        if not observation["terminal"]:
            raise AssertionError("verifier cannot resolve a non-terminal scenario")
        outcome = self.oracle[observation["scenario_id"]]
        if set(outcome) != set(self.fields):
            raise AssertionError("oracle outcome does not match canonical outcome fields")
        return outcome, digest(outcome)


def run_equivalence() -> int:
    contract = json.loads(CONTRACT_PATH.read_text())
    fixtures = json.loads(FIXTURE_PATH.read_text())
    verifier = HeldOutVerifier(fixtures, contract)
    for fixture in fixtures:
        public_fixture = {key: copy.deepcopy(fixture[key]) for key in ("id", "case", "events")}
        adapter = ScenarioAdapter(contract)
        adapter.reset(public_fixture)
        for event in public_fixture["events"]:
            adapter.step(event)
        before_save = adapter.observe()
        saved = adapter.save()
        restored = ScenarioAdapter(contract)
        after_restore = restored.restore(saved)
        if before_save != after_restore:
            raise AssertionError(f"{fixture['id']}: save/restore changed observation")

        direct_projection = replay(public_fixture["events"])
        direct_outcome = {key: copy.deepcopy(direct_projection[key]) for key in contract["canonical_outcome_fields"]}
        adapted_outcome, adapted_hash = verifier.verify(restored)
        direct_hash = digest(direct_outcome)
        if canonical_bytes(direct_outcome) != canonical_bytes(adapted_outcome):
            raise AssertionError(f"{fixture['id']}: canonical outcomes differ")
        if direct_hash != adapted_hash:
            raise AssertionError(f"{fixture['id']}: canonical hashes differ")
        print(f"ok: {fixture['id']} {direct_hash}")

    sample = fixtures[0]
    public_sample = {key: copy.deepcopy(sample[key]) for key in ("id", "case", "events")}
    incomplete = ScenarioAdapter(contract)
    incomplete.reset(public_sample)
    try:
        verifier.verify(incomplete)
    except AssertionError:
        pass
    else:
        raise AssertionError("held-out verifier accepted a non-terminal scenario")

    complete = ScenarioAdapter(contract)
    complete.reset(public_sample)
    for event in public_sample["events"]:
        complete.step(event)
    checkpoint = json.loads(complete.save())
    checkpoint["fixture_case"] = "tampered_case"
    try:
        ScenarioAdapter(contract).restore(canonical_bytes(checkpoint))
    except AssertionError:
        pass
    else:
        raise AssertionError("restore accepted a changed sealed identity")

    checkpoint = json.loads(complete.save())
    checkpoint["state"]["event_log"][0]["type"] = "tampered_event"
    try:
        ScenarioAdapter(contract).restore(canonical_bytes(checkpoint))
    except (AssertionError, ValueError):
        pass
    else:
        raise AssertionError("restore accepted a replay digest mismatch")

    print("ok: held-out and checkpoint tamper boundaries")
    print(f"scenario adapter equivalence passed: {len(fixtures)} fixtures")
    return 0


if __name__ == "__main__":
    raise SystemExit(run_equivalence())
