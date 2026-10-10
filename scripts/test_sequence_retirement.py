#!/usr/bin/env python3
"""Real 0.11 -> 0.12 upgrade across the sequence-commitment retirement.

Usage: test_sequence_retirement.py OLD_REAL_BINARY NEW_REAL_BINARY

OLD still manages mozak-sequence-commitment in four skill roots. NEW does not.
Accepted: a clean upgrade removes the retired files and reaches parity, and an
owner who already deleted them can still upgrade. Owner files are untouched.
Refused: a modified managed file blocks the upgrade.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

from test_delivery_update import build, extract, fixture, run

ROOTS = (".agents", ".jcode", ".claude", ".codex")


def scenario(old_binary: Path, new_binary: Path, mode: str) -> str:
    with tempfile.TemporaryDirectory(prefix="mozak-seq-retire-") as folder:
        root = Path(folder)
        old_release = build(old_binary, root, "stable", "4" * 40)
        old_bundle = extract(old_release, root / "old-extract")
        home, prefix, xdg = root / "home", root / "prefix", root / "xdg"
        for path in (home, prefix, xdg):
            path.mkdir()
        env = os.environ.copy()
        for key in ("MOZAK_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN", "MOZAK_RELEASE_FIXTURE"):
            env.pop(key, None)
        env.update(HOME=str(home), MOZAK_PREFIX=str(prefix), XDG_CONFIG_HOME=str(xdg), PATH="/usr/bin:/bin")
        subprocess.run([sys.executable, old_bundle / "install.py", "--prefix", prefix, "--home", home, "--disable-auto"],
                       env=env, check=True, capture_output=True)
        launcher = prefix / "bin/mozak"
        for skill_root in ROOTS:
            assert (home / skill_root / "skills/mozak-sequence-commitment/SKILL.md").is_file(), skill_root
        owner_skill = home / ".agents/skills/owner-own-skill/SKILL.md"
        owner_skill.parent.mkdir(parents=True)
        owner_skill.write_bytes(b"# owner skill\n")
        if mode == "already-removed":
            for skill_root in ROOTS:
                shutil.rmtree(home / skill_root / "skills/mozak-sequence-commitment")
        if mode == "drift":
            target = home / ".claude/skills/mozak-sequence-commitment/SKILL.md"
            target.write_bytes(target.read_bytes() + b"\nowner edit\n")

        new_release = build(new_binary, root, "stable", "5" * 40)
        env["MOZAK_RELEASE_FIXTURE"] = str(fixture(new_release, root / "new-release.json"))
        result = run(launcher, env, "update", "--channel", "stable", "--disable-auto", check=False)
        assert owner_skill.read_bytes() == b"# owner skill\n", "owner skill changed"
        if mode == "drift":
            assert result.returncode != 0, "a drifted managed file must refuse the upgrade"
            assert "drifted" in result.stderr + result.stdout, result.stderr
            return "drift refused"
        assert result.returncode == 0, result.stderr
        report = json.loads(run(launcher, env, "setup", "check", str(home)).stdout)
        assert report["parity"] is True and len(report["checks"]) == 120, (report["state"], len(report["checks"]))
        for skill_root in ROOTS:
            assert not (home / skill_root / "skills/mozak-sequence-commitment/SKILL.md").exists(), skill_root
        return f"{mode}: upgraded to 120-file generation"


def main() -> int:
    old_binary, new_binary = (Path(value).resolve(strict=True) for value in sys.argv[1:])
    results = [scenario(old_binary, new_binary, mode) for mode in ("clean", "already-removed", "drift")]
    print("ok: " + "; ".join(results) + "; owner skills untouched")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
