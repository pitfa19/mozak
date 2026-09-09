#!/usr/bin/env python3
"""Offline packaged-binary fresh-machine acceptance for PF-0025."""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def run(binary: Path, env: dict[str, str], *args: str) -> dict:
    result = subprocess.run([binary, *args], env=env, capture_output=True, text=True)
    if result.returncode != 0:
        raise AssertionError(f"{' '.join(args)} failed: {result.stderr}")
    return json.loads(result.stdout)


def run_failure(binary: Path, env: dict[str, str], *args: str) -> subprocess.CompletedProcess[str]:
    result = subprocess.run([binary, *args], env=env, capture_output=True, text=True)
    assert result.returncode != 0, f"{' '.join(args)} unexpectedly succeeded"
    assert result.stdout == "", f"{' '.join(args)} emitted success output on failure"
    return result


def write_project(root: Path, project_id: str, title: str = "Packaged Project") -> None:
    control = root / ".mozak"
    control.mkdir(parents=True, exist_ok=True)
    (control / "project.yml").write_text(
        "version: 1\nframework_contract_version: 1\nproject:\n"
        f"  id: {project_id}\n  name: Packaged Project\nrepository:\n"
        "  revision: 0123456789abcdef0123456789abcdef01234567\n"
        "owned_paths:\n  - src\n",
        encoding="utf-8",
    )
    (control / "idea.md").write_text(
        f"# {title}\n\n## Intent\n\nExercise packaged setup.\n\n"
        "## Desired outcomes\n\n- Works.\n\n## Boundaries\n\n- Offline.\n\n"
        "## Assumptions\n\n- Local files.\n\n## Open questions\n\n- None.\n",
        encoding="utf-8",
    )


def approval(proposal: dict, refresh: bool) -> dict:
    value = {
        "schema_version": 1,
        "decision": True,
        "proposal_digest": proposal["proposal_digest"],
        "target_config_path": proposal["target_config_path"],
        "owner": "packaged-acceptance-owner",
        "approved_at": "2026-09-03T12:00:00Z",
        "rationale": "Exact reviewed packaged acceptance proposal.",
    }
    if refresh:
        value["intent"] = "project refresh"
    return value


def main() -> int:
    if len(sys.argv) != 2:
        raise SystemExit("usage: test_fresh_machine_release.py RELEASE_BINARY")
    source_binary = Path(sys.argv[1]).resolve(strict=True)
    with tempfile.TemporaryDirectory(prefix="mozak-pf0025-") as directory:
        base = Path(directory)
        dist = base / "dist"
        subprocess.run(
            [ROOT / "scripts/build_linux_release.sh", source_binary, dist],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        )
        archive = next(dist.glob("*.tar.gz"))
        extracted = base / "extracted"
        extracted.mkdir()
        with tarfile.open(archive, "r:gz") as bundle:
            bundle.extractall(extracted, filter="data")
        binary = next(extracted.glob("*/mozak"))

        home = base / "home"
        xdg = base / "xdg"
        home.mkdir()
        env = os.environ.copy()
        env.update({"HOME": str(home), "XDG_CONFIG_HOME": str(xdg), "LC_ALL": "C"})

        installed = run(binary, env, "setup", "install", str(home))
        checked = run(binary, env, "setup", "check", str(home))
        assert installed["parity"] is True and checked["parity"] is True
        run_failure(binary, env, "kb", "validate")

        scope = base / "scope"
        scope.mkdir()
        scope_bytes = json.dumps(
            {"schema_version": 2, "scopes": [{"id": "topic", "kind": "topic", "title": "Topic", "intent": "Bounded", "history": [{"id": "h-1", "at": "2026-09-03T00:00:00Z", "note": "Created"}]}], "promotions": [], "meta_goals": [], "inputs": []},
            sort_keys=True,
        ).encode()
        (scope / "scope.json").write_bytes(scope_bytes)
        kb = base / "kb"
        kb.mkdir()
        (kb / "kb.json").write_text(json.dumps({"schema_version": 1, "registrations": [{"id": "topic", "path": str(scope), "scope_manifest_sha256": sha(scope_bytes)}]}, sort_keys=True), encoding="utf-8")
        explicit_kb = run(binary, env, "kb", "validate", str(kb))
        assert explicit_kb["validity"] == "registry_valid"
        workspace = base / "workspace"
        project = workspace / "project"
        write_project(project, "packaged-project")

        proposal = run(binary, env, "project", "discover", str(kb), str(workspace))
        proposal_path = base / "proposal.json"
        proposal_path.write_text(json.dumps(proposal), encoding="utf-8")
        review = run(binary, env, "project", "review", str(proposal_path))
        assert review["action"] == "register" and review["additions"] == ["packaged-project"]
        assert review["mutation"] is False and review["trust_transfer"] is False
        config = Path(proposal["target_config_path"])
        assert not config.exists(), "discover/review mutated config before approval"

        approval_path = base / "approval.json"
        approval_path.write_text(json.dumps(approval(proposal, False)), encoding="utf-8")
        run(binary, env, "project", "register", str(proposal_path), str(approval_path))
        context = run(binary, env, "project", "context", "packaged-project")
        assert context["project"]["id"] == "packaged-project"
        current_kb = run(binary, env, "kb", "validate")
        assert current_kb["registry_root"] == str(kb)

        before_refresh = config.read_bytes()
        write_project(project, "packaged-project", "Changed Packaged Project")
        proposal2 = run(binary, env, "project", "discover", str(kb), str(workspace))
        proposal2_path = base / "proposal-refresh.json"
        proposal2_path.write_text(json.dumps(proposal2), encoding="utf-8")
        review2 = run(binary, env, "project", "review", str(proposal2_path))
        assert review2["action"] == "refresh" and review2["changed_pins"] == ["packaged-project"]
        assert config.read_bytes() == before_refresh, "discover/review mutated config before refresh approval"

        refresh_approval = base / "refresh-approval.json"
        refresh_approval.write_text(json.dumps(approval(proposal2, True)), encoding="utf-8")
        run(binary, env, "project", "refresh", str(proposal2_path), str(refresh_approval))
        assert config.read_bytes() != before_refresh
        context2 = run(binary, env, "project", "context", "packaged-project")
        assert context2["idea"]["title"] == "Changed Packaged Project"

        after_refresh = config.read_bytes()
        run_failure(binary, env, "project", "review", str(proposal2_path))
        run_failure(binary, env, "project", "refresh", str(proposal2_path), str(refresh_approval))
        assert config.read_bytes() == after_refresh

        proposal3 = run(binary, env, "project", "discover", str(kb), str(workspace))
        proposal3_path = base / "proposal-current.json"
        proposal3_path.write_text(json.dumps(proposal3), encoding="utf-8")
        review3 = run(binary, env, "project", "review", str(proposal3_path))
        assert review3["action"] == "none"
        assert review3["unchanged"] == ["packaged-project"]
        assert config.read_bytes() == after_refresh

    print("PF-0025 packaged fresh-machine acceptance passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
