#!/usr/bin/env python3
"""Verify the recorded independent PF-0026 acceptance decision."""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / ".mozak/planning/evidence/PF-0026-independent-review.json"

report = json.loads(EVIDENCE.read_text())
assert report["schema_version"] == 1
assert report["packet_id"] == "PF-0026"
assert report["decision"] == "go"
assert report["reviewer_role"] == "independent_read_only_verifier"
assert report["reviewed_revision"]
assert report["public_checks"] == {
    "context": "passed",
    "graph_termaid": "passed",
    "list": "passed",
    "overview": "passed",
    "tamper_binding": "passed",
}
assert report["source_of_truth_alignment"] == "passed"

print("PF-0026 independent review evidence valid")
