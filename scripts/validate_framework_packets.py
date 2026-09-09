#!/usr/bin/env python3
"""Validate the bootstrap Project Framework goal and packet roadmap."""

from __future__ import annotations

import json
import re
import sys
from collections import defaultdict, deque
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CONTROL_ROOT = ROOT / ".mozak" / "planning"
PACKET_ID = re.compile(r"^PF-[0-9]{4}$")
GOAL_ID = re.compile(r"^G-[0-9]{2}$")
CHECK_ID = re.compile(r"^AC-[0-9]{2}$")
PACKET_STATES = {"completed", "in_progress", "ready", "planned", "blocked"}
PACKET_KINDS = {"decision", "implementation", "integration"}
GOAL_STATES = {"completed", "active", "planned", "blocked"}
REQUIRED_PACKET_FIELDS = {
    "id",
    "version",
    "title",
    "kind",
    "state",
    "goal_id",
    "objective",
    "dependencies",
    "deliverables",
    "constraints",
    "acceptance_checks",
    "tests",
    "risks",
}
OPTIONAL_PACKET_FIELDS = {"blocker", "completion_evidence"}


class ValidationError(ValueError):
    pass


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValidationError(f"{path}: {error}") from error


def require_nonempty_string(value: Any, location: str) -> None:
    if not isinstance(value, str) or not value.strip():
        raise ValidationError(f"{location} must be a non-empty string")


def require_string_list(value: Any, location: str, *, nonempty: bool = False) -> None:
    if not isinstance(value, list) or (nonempty and not value):
        qualifier = "non-empty " if nonempty else ""
        raise ValidationError(f"{location} must be a {qualifier}list")
    if any(not isinstance(item, str) or not item.strip() for item in value):
        raise ValidationError(f"{location} must contain non-empty strings")
    if len(value) != len(set(value)):
        raise ValidationError(f"{location} must not contain duplicates")


def load_roadmap(control_root: Path = CONTROL_ROOT) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    goals_document = load_json(control_root / "goals.json")
    if not isinstance(goals_document, dict) or set(goals_document) != {"version", "goals"}:
        raise ValidationError("goals.json must contain exactly version and goals")
    if (
        not isinstance(goals_document["version"], int)
        or isinstance(goals_document["version"], bool)
        or goals_document["version"] != 1
        or not isinstance(goals_document["goals"], list)
    ):
        raise ValidationError("goals.json must use version 1 and a goals list")

    packets: dict[str, dict[str, Any]] = {}
    packets_directory = control_root / "packets"
    all_json_files = sorted(packets_directory.glob("*.json"))
    packet_files = [path for path in all_json_files if PACKET_ID.fullmatch(path.stem)]
    stray_files = sorted(path.name for path in all_json_files if path not in packet_files)
    if stray_files:
        raise ValidationError(f"unexpected packet JSON files {stray_files}")
    if not packet_files:
        raise ValidationError("at least one packet file is required")
    for path in packet_files:
        packet = load_json(path)
        if not isinstance(packet, dict):
            raise ValidationError(f"{path}: packet must be an object")
        packet_id = packet.get("id")
        if packet_id in packets:
            raise ValidationError(f"duplicate packet id {packet_id}")
        if path.stem != packet_id:
            raise ValidationError(f"{path}: filename must match packet id {packet_id}")
        packets[packet_id] = packet
    return goals_document, packets


def validate_packet_shape(packet: dict[str, Any]) -> None:
    packet_id = packet.get("id", "<unknown>")
    fields = set(packet)
    missing = REQUIRED_PACKET_FIELDS - fields
    unknown = fields - REQUIRED_PACKET_FIELDS - OPTIONAL_PACKET_FIELDS
    if missing:
        raise ValidationError(f"{packet_id}: missing fields {sorted(missing)}")
    if unknown:
        raise ValidationError(f"{packet_id}: unknown fields {sorted(unknown)}")
    if not isinstance(packet_id, str) or not PACKET_ID.fullmatch(packet_id):
        raise ValidationError(f"invalid packet id {packet_id!r}")
    if not isinstance(packet["version"], int) or isinstance(packet["version"], bool) or packet["version"] < 1:
        raise ValidationError(f"{packet_id}: version must be a positive integer")
    for field in ("title", "objective"):
        require_nonempty_string(packet[field], f"{packet_id}.{field}")
    if packet["kind"] not in PACKET_KINDS:
        raise ValidationError(f"{packet_id}: invalid kind {packet['kind']!r}")
    if packet["state"] not in PACKET_STATES:
        raise ValidationError(f"{packet_id}: invalid state {packet['state']!r}")
    if not isinstance(packet["goal_id"], str) or not GOAL_ID.fullmatch(packet["goal_id"]):
        raise ValidationError(f"{packet_id}: invalid goal_id")
    require_string_list(packet["dependencies"], f"{packet_id}.dependencies")
    require_string_list(packet["deliverables"], f"{packet_id}.deliverables", nonempty=True)
    require_string_list(packet["constraints"], f"{packet_id}.constraints")
    require_string_list(packet["risks"], f"{packet_id}.risks")
    if packet_id in packet["dependencies"]:
        raise ValidationError(f"{packet_id}: packet cannot depend on itself")
    if packet["state"] == "blocked":
        require_nonempty_string(packet.get("blocker"), f"{packet_id}.blocker")
    elif "blocker" in packet:
        raise ValidationError(f"{packet_id}: only blocked packets may declare blocker")
    if packet["state"] == "completed":
        require_string_list(packet.get("completion_evidence"), f"{packet_id}.completion_evidence", nonempty=True)
    elif "completion_evidence" in packet:
        raise ValidationError(f"{packet_id}: only completed packets may declare completion_evidence")

    checks = packet["acceptance_checks"]
    if not isinstance(checks, list) or not checks:
        raise ValidationError(f"{packet_id}.acceptance_checks must be a non-empty list")
    check_ids: set[str] = set()
    for index, check in enumerate(checks):
        if not isinstance(check, dict) or set(check) != {"id", "behavior", "evidence"}:
            raise ValidationError(f"{packet_id}.acceptance_checks[{index}] has invalid fields")
        check_id = check["id"]
        if not isinstance(check_id, str) or not CHECK_ID.fullmatch(check_id):
            raise ValidationError(f"{packet_id}: invalid acceptance check id {check_id!r}")
        if check_id in check_ids:
            raise ValidationError(f"{packet_id}: duplicate acceptance check {check_id}")
        check_ids.add(check_id)
        require_nonempty_string(check["behavior"], f"{packet_id}.{check_id}.behavior")
        require_nonempty_string(check["evidence"], f"{packet_id}.{check_id}.evidence")

    tests = packet["tests"]
    if not isinstance(tests, list) or not tests:
        raise ValidationError(f"{packet_id}.tests must be a non-empty list")
    covered: set[str] = set()
    for index, test in enumerate(tests):
        if not isinstance(test, dict) or set(test) != {"command", "covers"}:
            raise ValidationError(f"{packet_id}.tests[{index}] has invalid fields")
        require_nonempty_string(test["command"], f"{packet_id}.tests[{index}].command")
        command_parts = test["command"].split()
        if command_parts[:2] == ["cargo", "test"] and "--test" not in command_parts and "--lib" not in command_parts:
            raise ValidationError(
                f"{packet_id}.tests[{index}].command must select an explicit Cargo test target"
            )
        require_string_list(test["covers"], f"{packet_id}.tests[{index}].covers", nonempty=True)
        unknown_checks = set(test["covers"]) - check_ids
        if unknown_checks:
            raise ValidationError(f"{packet_id}: tests cover unknown checks {sorted(unknown_checks)}")
        covered.update(test["covers"])
    if covered != check_ids:
        raise ValidationError(f"{packet_id}: acceptance checks without tests {sorted(check_ids - covered)}")


def validate_acyclic(packets: dict[str, dict[str, Any]]) -> None:
    dependents: dict[str, list[str]] = defaultdict(list)
    indegree = {packet_id: 0 for packet_id in packets}
    for packet_id, packet in packets.items():
        for dependency in packet["dependencies"]:
            if dependency not in packets:
                raise ValidationError(f"{packet_id}: missing dependency {dependency}")
            dependents[dependency].append(packet_id)
            indegree[packet_id] += 1
    ready = deque(sorted(packet_id for packet_id, degree in indegree.items() if degree == 0))
    visited = 0
    while ready:
        current = ready.popleft()
        visited += 1
        for dependent in sorted(dependents[current]):
            indegree[dependent] -= 1
            if indegree[dependent] == 0:
                ready.append(dependent)
    if visited != len(packets):
        cycle_nodes = sorted(packet_id for packet_id, degree in indegree.items() if degree > 0)
        raise ValidationError(f"packet dependency cycle involving {cycle_nodes}")


def validate_goals(goals_document: dict[str, Any], packets: dict[str, dict[str, Any]]) -> None:
    goals: dict[str, dict[str, Any]] = {}
    referenced_packets: set[str] = set()
    for index, goal in enumerate(goals_document["goals"]):
        if not isinstance(goal, dict) or set(goal) != {"id", "title", "outcome", "packet_ids", "status"}:
            raise ValidationError(f"goals[{index}] has invalid fields")
        goal_id = goal["id"]
        if not isinstance(goal_id, str) or not GOAL_ID.fullmatch(goal_id):
            raise ValidationError(f"invalid goal id {goal_id!r}")
        if goal_id in goals:
            raise ValidationError(f"duplicate goal id {goal_id}")
        goals[goal_id] = goal
        require_nonempty_string(goal["title"], f"{goal_id}.title")
        require_nonempty_string(goal["outcome"], f"{goal_id}.outcome")
        if goal["status"] not in GOAL_STATES:
            raise ValidationError(f"{goal_id}: invalid status {goal['status']!r}")
        require_string_list(goal["packet_ids"], f"{goal_id}.packet_ids", nonempty=True)
        goal_packets: list[dict[str, Any]] = []
        for packet_id in goal["packet_ids"]:
            if packet_id not in packets:
                raise ValidationError(f"{goal_id}: missing packet {packet_id}")
            if packet_id in referenced_packets:
                raise ValidationError(f"packet {packet_id} belongs to multiple goals")
            referenced_packets.add(packet_id)
            if packets[packet_id]["goal_id"] != goal_id:
                raise ValidationError(f"{packet_id}: goal_id disagrees with goals.json")
            goal_packets.append(packets[packet_id])
        packet_states = {packet["state"] for packet in goal_packets}
        if packet_states == {"completed"}:
            expected_status = "completed"
        elif "in_progress" in packet_states or "ready" in packet_states or "completed" in packet_states:
            expected_status = "active"
        elif "blocked" in packet_states:
            expected_status = "blocked"
        else:
            expected_status = "planned"
        if goal["status"] != expected_status:
            raise ValidationError(
                f"{goal_id}: status {goal['status']!r} disagrees with packet states; expected {expected_status!r}"
            )
    if referenced_packets != set(packets):
        raise ValidationError(f"packets without goals {sorted(set(packets) - referenced_packets)}")
    for packet_id, packet in packets.items():
        if packet["state"] in {"ready", "in_progress"} and any(packets[dependency]["state"] != "completed" for dependency in packet["dependencies"]):
            raise ValidationError(f"{packet_id}: {packet['state']} packet has incomplete dependencies")
        if packet["state"] == "completed" and any(packets[dependency]["state"] != "completed" for dependency in packet["dependencies"]):
            raise ValidationError(f"{packet_id}: completed packet has incomplete dependencies")
        if (
            packet["state"] == "planned"
            and all(packets[dependency]["state"] == "completed" for dependency in packet["dependencies"])
        ):
            raise ValidationError(f"{packet_id}: planned packet with completed dependencies must be ready")


def validate_schema_contract(control_root: Path = CONTROL_ROOT) -> None:
    schema = load_json(control_root / "packet.schema.json")
    if not isinstance(schema, dict):
        raise ValidationError("packet.schema.json must contain an object")
    expected_properties = REQUIRED_PACKET_FIELDS | OPTIONAL_PACKET_FIELDS
    properties = schema.get("properties")
    if not isinstance(properties, dict) or set(properties) != expected_properties:
        raise ValidationError("packet.schema.json properties diverge from runtime validator")
    if set(schema.get("required", [])) != REQUIRED_PACKET_FIELDS:
        raise ValidationError("packet.schema.json required fields diverge from runtime validator")
    if schema.get("additionalProperties") is not False:
        raise ValidationError("packet.schema.json must reject additional properties")
    expected_enums = {
        "kind": PACKET_KINDS,
        "state": PACKET_STATES,
    }
    for field, expected in expected_enums.items():
        actual = properties.get(field, {}).get("enum")
        if not isinstance(actual, list) or set(actual) != expected:
            raise ValidationError(f"packet.schema.json {field} enum diverges from runtime validator")
    expected_patterns = {
        "id": PACKET_ID.pattern,
        "goal_id": GOAL_ID.pattern,
    }
    for field, expected in expected_patterns.items():
        if properties.get(field, {}).get("pattern") != expected:
            raise ValidationError(f"packet.schema.json {field} pattern diverges from runtime validator")


def validate_roadmap(control_root: Path = CONTROL_ROOT) -> tuple[int, int]:
    validate_schema_contract(control_root)
    goals_document, packets = load_roadmap(control_root)
    for packet in packets.values():
        validate_packet_shape(packet)
    validate_acyclic(packets)
    validate_goals(goals_document, packets)
    return len(goals_document["goals"]), len(packets)


def main() -> int:
    try:
        goal_count, packet_count = validate_roadmap()
    except ValidationError as error:
        print(f"packet roadmap invalid: {error}", file=sys.stderr)
        return 1
    print(f"validated {goal_count} goals and {packet_count} packets")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
