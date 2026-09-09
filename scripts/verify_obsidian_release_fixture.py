#!/usr/bin/env python3
"""Verify the deterministic, transcript-free human-readable Obsidian release fixture."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "spec/project-framework/fixtures/pf-0007/canonical-release.json"
EXPECTED = ROOT / "spec/project-framework/fixtures/pf-0007/obsidian-import.md"
SECTIONS = [
    ("accepted_findings", "Accepted findings"),
    ("decisions", "Decisions"),
    ("reusable_patterns", "Reusable patterns"),
    ("open_gaps", "Open gaps"),
    ("implementation_state", "Implementation state"),
]


def render(release: dict) -> str:
    lines = [
        f"# Project release: {release['release_id']}",
        "",
        f"- Project: **{release['project']['name']}** (`{release['project']['id']}`)",
        f"- Generated at (accepted input): `{release['generated_at']}`",
        f"- Accepted state SHA-256: `{release['accepted_state_sha256']}`",
        "- Truth scopes: `project_local` is authoritative only here; `cross_project_inference` is reusable inference, not another project's truth.",
        "",
    ]
    for key, heading in SECTIONS:
        lines.extend([f"## {heading}", ""])
        for item in release[key]:
            title = item.get("title", item.get("component"))
            lines.extend([
                f"### {title} (`{item['id']}`)",
                "",
                f"{item['summary']}",
                "",
                f"- Truth scope: `{item['truth_scope']}`",
            ])
            if "state" in item:
                lines.append(f"- State: `{item['state']}`")
            predecessors = item.get("supersedes", [])
            lines.append("- Supersedes: " + (", ".join(f"[[{entry}]]" for entry in predecessors) if predecessors else "none"))
            lines.append("- Provenance:")
            for provenance in item["provenance"]:
                lines.append(
                    f"  - [{provenance['id']}]({provenance['uri']}) at `{provenance['locator']}` (SHA-256 `{provenance['sha256']}`)"
                )
            lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def main() -> None:
    raw = FIXTURE.read_bytes()
    release = json.loads(raw)
    forbidden = {"transcript", "raw_content", "raw_text", "raw_record", "content"}

    def inspect(value: object) -> None:
        if isinstance(value, dict):
            assert not (forbidden & {key.lower().replace("-", "_") for key in value})
            for child in value.values():
                inspect(child)
        elif isinstance(value, list):
            for child in value:
                inspect(child)

    inspect(release)
    rendered = render(release)
    assert rendered.encode() == EXPECTED.read_bytes(), "Obsidian fixture is not deterministic"
    for _, heading in SECTIONS:
        assert f"## {heading}" in rendered
    assert "[[finding-001]]" in rendered
    assert "repo:" in rendered and "SHA-256" in rendered
    assert "project_local" in rendered and "cross_project_inference" in rendered
    print(f"ok: Obsidian release fixture {hashlib.sha256(rendered.encode()).hexdigest()}")


if __name__ == "__main__":
    main()
