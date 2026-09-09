#!/usr/bin/env python3
"""Inject one defect at a time into each committed diagram source and require
archify's showcase gate to refuse it.

The committed diagrams pass their gate. That says nothing on its own: a gate
that accepts everything would report the same result. These probes establish
that the gate discriminates, by mutating the real sources rather than a fixture
and requiring a diagnostic for each defect.

Usage: diagram_mutations.py ARCHIFY_CLI DIAGRAMS_DIR
"""

from __future__ import annotations

import copy
import json
import os
import subprocess
import sys
import tempfile

SOURCES = {
    "architecture": "mozak-modules.architecture.json",
    "workflow": "mozak-improve-lab.workflow.json",
    "dataflow": "mozak-kb-and-meta.dataflow.json",
}


def validate(cli: str, kind: str, spec: dict) -> tuple[bool | None, list[str]]:
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as handle:
        json.dump(spec, handle)
        path = handle.name
    try:
        result = subprocess.run(
            ["node", cli, "validate", kind, path, "--quality", "showcase", "--json"],
            capture_output=True,
            text=True,
        )
    finally:
        os.unlink(path)
    try:
        report = json.loads(result.stdout)
    except json.JSONDecodeError:
        return None, [result.stderr.strip()[:160]]
    return report.get("ok"), [d.get("code") for d in report.get("diagnostics", [])]


def mutants(sources: dict[str, dict]) -> list[tuple[str, str, dict]]:
    """One named defect per entry, each a plausible authoring mistake."""
    out: list[tuple[str, str, dict]] = []

    architecture = sources["architecture"]
    stacked = copy.deepcopy(architecture)
    stacked["components"][1]["pos"] = stacked["components"][0]["pos"]
    out.append(("two components at one position", "architecture", stacked))

    dangling = copy.deepcopy(architecture)
    dangling["connections"][0]["to"] = "ghost"
    out.append(("edge to an unknown component", "architecture", dangling))

    stale_view = copy.deepcopy(architecture)
    stale_view["meta"]["views"][0]["focus"] = ["ghost"]
    out.append(("guided view focusing an unknown id", "architecture", stale_view))

    workflow = sources["workflow"]
    collided = copy.deepcopy(workflow)
    for node in collided["nodes"]:
        if node["id"] == "select":
            node["col"] = 1  # start already occupies col 1 in the run lane
    out.append(("two nodes in one lane cell", "workflow", collided))

    backward = copy.deepcopy(workflow)
    for node in backward["nodes"]:
        if node["id"] == "plans":
            node["col"] = 1
    out.append(("main path moving backward", "workflow", backward))

    dataflow = sources["dataflow"]
    cramped = copy.deepcopy(dataflow)
    cramped["meta"]["viewBox"] = [400, 300]
    out.append(("viewBox too small to contain the scene", "dataflow", cramped))

    unreadable = copy.deepcopy(dataflow)
    unreadable["meta"]["viewBox"] = [3000, 520]
    out.append(("node text unreadable at a 1440px desktop", "dataflow", unreadable))

    return out


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    cli, diagrams = argv[1], argv[2]

    sources = {
        kind: json.load(open(os.path.join(diagrams, name)))
        for kind, name in SOURCES.items()
    }

    # A refusal only means something if the unmutated source is accepted.
    for kind, spec in sources.items():
        ok, codes = validate(cli, kind, spec)
        if not ok:
            print(f"  BASELINE FAILED {kind}: {codes[:3]}")
            return 1

    escaped = []
    for name, kind, spec in mutants(sources):
        ok, codes = validate(cli, kind, spec)
        if ok is False and codes:
            print(f"  refused  {name} [{codes[0]}]")
        else:
            print(f"  ESCAPED  {name} (ok={ok})")
            escaped.append(name)

    total = len(mutants(sources))
    print(f"  {total - len(escaped)} of {total} injected defects refused")
    return 1 if escaped else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
