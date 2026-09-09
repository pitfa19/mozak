#!/usr/bin/env python3

from __future__ import annotations

import copy
import json
import tempfile
import unittest
from pathlib import Path

from scripts.validate_framework_packets import (
    OPTIONAL_PACKET_FIELDS,
    PACKET_KINDS,
    PACKET_STATES,
    REQUIRED_PACKET_FIELDS,
    ValidationError,
    validate_roadmap,
)


def make_packet(packet_id: str, goal_id: str, dependencies: list[str]) -> dict:
    return {
        "id": packet_id,
        "version": 1,
        "title": f"Synthetic packet {packet_id}",
        "kind": "implementation",
        "state": "completed",
        "goal_id": goal_id,
        "objective": "Exercise the legacy packet-roadmap validator without project-private state.",
        "dependencies": dependencies,
        "deliverables": ["synthetic deliverable"],
        "constraints": ["test fixture only"],
        "acceptance_checks": [
            {"id": "AC-01", "behavior": "shape validates", "evidence": "unit test"},
            {"id": "AC-02", "behavior": "dependencies validate", "evidence": "unit test"},
            {"id": "AC-03", "behavior": "coverage validates", "evidence": "unit test"},
        ],
        "tests": [
            {
                "command": "cargo test --lib",
                "covers": ["AC-01", "AC-02", "AC-03"],
            }
        ],
        "risks": [],
        "completion_evidence": ["synthetic test evidence"],
    }


def make_roadmap() -> tuple[dict, dict[str, dict]]:
    goal_packets = [
        ["PF-0000", "PF-0001"],
        ["PF-0002", "PF-0003"],
        ["PF-0004"],
        ["PF-0005"],
        ["PF-0006", "PF-0007"],
        ["PF-0008"],
    ]
    goals = {
        "version": 1,
        "goals": [
            {
                "id": f"G-{index:02d}",
                "title": f"Synthetic goal {index}",
                "outcome": "Validator behavior is covered by a public-safe fixture.",
                "packet_ids": packet_ids,
                "status": "completed",
            }
            for index, packet_ids in enumerate(goal_packets)
        ],
    }
    dependencies = {
        "PF-0000": [],
        "PF-0001": ["PF-0000"],
        "PF-0002": [],
        "PF-0003": ["PF-0002"],
        "PF-0004": [],
        "PF-0005": [],
        "PF-0006": [],
        "PF-0007": ["PF-0006"],
        "PF-0008": [],
    }
    packets = {
        packet_id: make_packet(packet_id, f"G-{goal_index:02d}", dependencies[packet_id])
        for goal_index, packet_ids in enumerate(goal_packets)
        for packet_id in packet_ids
    }
    return goals, packets


def make_schema() -> dict:
    properties = {field: {} for field in REQUIRED_PACKET_FIELDS | OPTIONAL_PACKET_FIELDS}
    properties["id"]["pattern"] = r"^PF-[0-9]{4}$"
    properties["goal_id"]["pattern"] = r"^G-[0-9]{2}$"
    properties["kind"]["enum"] = sorted(PACKET_KINDS)
    properties["state"]["enum"] = sorted(PACKET_STATES)
    return {
        "type": "object",
        "properties": properties,
        "required": sorted(REQUIRED_PACKET_FIELDS),
        "additionalProperties": False,
    }


class PacketRoadmapValidationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name) / "planning"
        (self.root / "packets").mkdir(parents=True)
        goals, packets = make_roadmap()
        self.goals = goals
        self.packets = packets
        self.write_roadmap()

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def write_roadmap(self) -> None:
        (self.root / "goals.json").write_text(json.dumps(self.goals, indent=2) + "\n", encoding="utf-8")
        schema = make_schema()
        (self.root / "packet.schema.json").write_text(json.dumps(schema, indent=2) + "\n", encoding="utf-8")
        for old_path in (self.root / "packets").glob("*.json"):
            old_path.unlink()
        for packet_id, packet in self.packets.items():
            (self.root / "packets" / f"{packet_id}.json").write_text(json.dumps(packet, indent=2) + "\n", encoding="utf-8")

    def assert_invalid(self, message: str) -> None:
        self.write_roadmap()
        with self.assertRaisesRegex(ValidationError, message):
            validate_roadmap(self.root)

    def test_committed_roadmap_is_valid(self) -> None:
        self.assertEqual(validate_roadmap(self.root), (6, 9))

    def test_missing_dependency_fails_closed(self) -> None:
        self.packets["PF-0001"]["dependencies"] = ["PF-9999"]
        self.assert_invalid("missing dependency PF-9999")

    def test_dependency_cycle_fails_closed(self) -> None:
        self.packets["PF-0000"]["dependencies"] = ["PF-0001"]
        self.assert_invalid("dependency cycle")

    def test_uncovered_acceptance_check_fails_closed(self) -> None:
        self.packets["PF-0001"]["tests"][0]["covers"] = ["AC-01", "AC-02"]
        self.assert_invalid("acceptance checks without tests.*AC-03")

    def test_blocked_packet_requires_blocker(self) -> None:
        self.packets["PF-0008"]["state"] = "blocked"
        self.packets["PF-0008"].pop("blocker", None)
        self.goals["goals"][5]["status"] = "blocked"
        self.assert_invalid("PF-0008.blocker must be a non-empty string")

    def test_ready_packet_requires_completed_dependencies(self) -> None:
        self.packets["PF-0002"]["state"] = "blocked"
        self.packets["PF-0002"]["blocker"] = "synthetic blocker"
        del self.packets["PF-0002"]["completion_evidence"]
        self.packets["PF-0003"]["state"] = "ready"
        del self.packets["PF-0003"]["completion_evidence"]
        self.goals["goals"][1]["status"] = "active"
        self.assert_invalid("PF-0003: ready packet has incomplete dependencies")

    def test_packet_may_not_belong_to_two_goals(self) -> None:
        duplicate = copy.deepcopy(self.goals["goals"][1]["packet_ids"][0])
        self.goals["goals"][2]["packet_ids"].append(duplicate)
        self.assert_invalid("belongs to multiple goals")

    def test_stray_packet_json_fails_closed(self) -> None:
        self.write_roadmap()
        (self.root / "packets" / "notes.json").write_text("{}\n", encoding="utf-8")
        with self.assertRaisesRegex(ValidationError, "unexpected packet JSON files.*notes.json"):
            validate_roadmap(self.root)

    def test_completed_packet_requires_completed_dependencies(self) -> None:
        self.packets["PF-0001"]["state"] = "completed"
        self.packets["PF-0001"]["completion_evidence"] = ["synthetic test evidence"]
        self.packets["PF-0000"]["state"] = "blocked"
        self.packets["PF-0000"]["blocker"] = "synthetic blocker"
        del self.packets["PF-0000"]["completion_evidence"]
        self.goals["goals"][0]["status"] = "active"
        self.assert_invalid("PF-0001: completed packet has incomplete dependencies")

    def test_boolean_goal_version_fails_closed(self) -> None:
        self.goals["version"] = True
        self.assert_invalid("goals.json must use version 1")

    def test_schema_runtime_divergence_fails_closed(self) -> None:
        self.write_roadmap()
        schema_path = self.root / "packet.schema.json"
        schema = json.loads(schema_path.read_text(encoding="utf-8"))
        schema["properties"]["state"]["enum"].append("pretend-complete")
        schema_path.write_text(json.dumps(schema, indent=2) + "\n", encoding="utf-8")
        with self.assertRaisesRegex(ValidationError, "state enum diverges"):
            validate_roadmap(self.root)

    def test_fully_completed_roadmap_is_valid(self) -> None:
        for packet in self.packets.values():
            packet["state"] = "completed"
            packet.pop("blocker", None)
            packet["completion_evidence"] = ["synthetic test evidence"]
        for goal in self.goals["goals"]:
            goal["status"] = "completed"
        self.write_roadmap()
        self.assertEqual(validate_roadmap(self.root), (6, 9))

    def test_loose_cargo_filter_fails_closed(self) -> None:
        self.packets["PF-0002"]["tests"][0]["command"] = "cargo test --workspace nonexistent_filter"
        self.assert_invalid("must select an explicit Cargo test target")

    def test_goal_status_must_match_packet_states(self) -> None:
        self.goals["goals"][1]["status"] = "planned"
        self.assert_invalid("G-01: status 'planned' disagrees.*expected 'completed'")


if __name__ == "__main__":
    unittest.main()
