#!/usr/bin/env python3
"""Disposable, deterministic M0 replay reference model.

This module is executable specification code, not a production implementation.
It deliberately favors small, explicit projection rules over extensibility,
storage efficiency, authorization, concurrency, or operational hardening.
"""

from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from typing import Any


class ReplayError(ValueError):
    """Raised when an M0 fixture violates a replay invariant."""


def canonical_json(value: Any) -> str:
    """Return the one canonical JSON representation used by the M0 fixtures."""
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def canonical_hash(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def _claim_record(claim: dict[str, Any], state: str, generation: int) -> dict[str, Any]:
    record = deepcopy(claim)
    record["state"] = state
    record["last_generation"] = generation
    return record


def replay(events: list[dict[str, Any]]) -> dict[str, Any]:
    """Project an append-only event history into deterministic accepted state.

    The input is never mutated. Snapshot records are immutable: an existing
    snapshot identifier may only be replayed with byte-for-byte equal content.
    """
    projection: dict[str, Any] = {
        "generation": 0,
        "accepted": {},
        "history": {},
        "conflicts": {},
        "snapshots": {},
        "quarantine": {},
        "rejected_patches": [],
    }
    seen_event_ids: set[str] = set()

    for event in events:
        event = deepcopy(event)
        event_id = event["id"]
        generation = event["generation"]
        if event_id in seen_event_ids:
            raise ReplayError(f"duplicate event id: {event_id}")
        if generation <= projection["generation"]:
            raise ReplayError(f"non-increasing generation at {event_id}")
        if "base_generation" in event and event["type"] != "patch_rejected":
            if event["base_generation"] != projection["generation"]:
                raise ReplayError(f"stale event was not rejected: {event_id}")
        seen_event_ids.add(event_id)
        payload = event["payload"]
        event_type = event["type"]

        if event_type == "snapshot_created":
            snapshot = deepcopy(payload["snapshot"])
            snapshot_id = snapshot["id"]
            previous = projection["snapshots"].get(snapshot_id)
            if previous is not None and previous != snapshot:
                raise ReplayError(f"immutable snapshot changed: {snapshot_id}")
            projection["snapshots"][snapshot_id] = snapshot
        elif event_type == "source_availability_changed":
            snapshot_id = payload["snapshot_id"]
            if snapshot_id not in projection["snapshots"]:
                raise ReplayError(f"availability references unknown snapshot: {snapshot_id}")
            # Availability is metadata beside immutable captured content.
            projection["snapshots"][snapshot_id]["availability"] = payload["availability"]
        elif event_type == "claim_proposed":
            claim = payload["claim"]
            claim_id = claim["id"]
            record = _claim_record(claim, "candidate", generation)
            projection["history"][claim_id] = record
            if payload.get("quarantined", False):
                projection["quarantine"][claim_id] = payload["quarantine_reason"]
        elif event_type in {"claim_accepted", "decision_accepted"}:
            claim = payload["claim"]
            claim_id = claim["id"]
            supersedes = payload.get("supersedes")
            if supersedes:
                prior = projection["history"][supersedes]
                prior["state"] = "superseded"
                prior["last_generation"] = generation
                projection["accepted"].pop(supersedes, None)
            record = _claim_record(claim, "accepted", generation)
            projection["history"][claim_id] = record
            projection["accepted"][claim_id] = record
        elif event_type == "claim_disputed":
            conflict_id = payload["conflict_id"]
            claim_ids: list[str] = []
            for claim in payload["claims"]:
                claim_id = claim["id"]
                claim_ids.append(claim_id)
                record = _claim_record(claim, "disputed", generation)
                projection["history"][claim_id] = record
                projection["accepted"].pop(claim_id, None)
            projection["conflicts"][conflict_id] = sorted(claim_ids)
        elif event_type == "claim_superseded":
            prior_id = payload["prior_claim_id"]
            prior = projection["history"][prior_id]
            prior["state"] = "superseded"
            prior["last_generation"] = generation
            projection["accepted"].pop(prior_id, None)
            claim = payload["claim"]
            claim_id = claim["id"]
            record = _claim_record(claim, "accepted", generation)
            projection["history"][claim_id] = record
            projection["accepted"][claim_id] = record
        elif event_type == "claim_retracted":
            claim_id = payload["claim_id"]
            record = projection["history"][claim_id]
            record["state"] = "retracted"
            record["last_generation"] = generation
            projection["accepted"].pop(claim_id, None)
        elif event_type == "patch_rejected":
            base_generation = event["base_generation"]
            if base_generation >= projection["generation"]:
                raise ReplayError(f"patch is not stale: {event_id}")
            proposal = _claim_record(payload["proposal"], "rejected", generation)
            projection["history"][proposal["id"]] = proposal
            projection["rejected_patches"].append({
                "event_id": event_id,
                "base_generation": base_generation,
                "reason": payload["reason"],
            })
        else:
            raise ReplayError(f"unsupported event type: {event_type}")

        projection["generation"] = generation

    # Dict key order is immaterial, but lists are normalized before hashing.
    projection["rejected_patches"].sort(key=lambda item: item["event_id"])
    return projection


def replay_hash(events: list[dict[str, Any]]) -> tuple[dict[str, Any], str]:
    projection = replay(events)
    return projection, canonical_hash(projection)
