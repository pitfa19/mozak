#!/usr/bin/env python3
"""Real old-to-new archive migration across the 0.11 Jcode retirement.

Usage: test_jcode_upgrade.py OLD_REAL_BINARY NEW_REAL_BINARY

OLD is a build that still manages the four Jcode profile skills (0.9 or 0.10).
NEW is a build that retired them. Network lookup alone uses a local release
fixture. Installation, update, parity and rollback are the real public paths.

Accepted: an owner who already deleted the retired skills can upgrade, and the
owner's other Jcode files are never touched.
Refused: a drifted managed file still blocks the upgrade.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

from test_delivery_update import build, extract, fixture, run

RETIRED = ("swarm-low", "swarm-normal", "teacher", "mozak-jcode")


def install_old(old_binary: Path, root: Path) -> tuple[Path, Path, dict[str, str]]:
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
    return home, prefix, env


def old_generation_has_retired_skills(launcher: Path, env: dict[str, str], home: Path) -> bool:
    checks = json.loads(run(launcher, env, "setup", "check", str(home)).stdout)["checks"]
    return any(check["path"] == f".jcode/skills/{RETIRED[0]}/SKILL.md" for check in checks)


def scenario(old_binary: Path, new_binary: Path, drift: bool) -> str:
    with tempfile.TemporaryDirectory(prefix="mozak-jcode-retire-") as folder:
        root = Path(folder)
        home, prefix, env = install_old(old_binary, root)
        launcher = prefix / "bin/mozak"
        # Owner Jcode files that are NOT MOZAK-managed must survive untouched.
        sentinels = {}
        for name, data in {
            "config.toml": b"# owner config\n",
            "swarm-prompt.md": b"# owner swarm policy\n",
            "prompt-overlay.md": b"# owner overlay\n",
            "credentials.json": b"sentinel-not-a-real-secret",
        }.items():
            path = home / ".jcode" / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            sentinels[path] = data
        if old_generation_has_retired_skills(launcher, env, home):
            for name in RETIRED:
                skill = home / f".jcode/skills/{name}/SKILL.md"
                if skill.exists():
                    skill.unlink()
        mozak_skill = home / ".agents/skills/mozak/SKILL.md"
        if drift:
            mozak_skill.write_bytes(mozak_skill.read_bytes() + b"\nowner edit\n")
        drifted_bytes = mozak_skill.read_bytes()

        new_release = build(new_binary, root, "stable", "5" * 40)
        env["MOZAK_RELEASE_FIXTURE"] = str(fixture(new_release, root / "new-release.json"))
        result = run(launcher, env, "update", "--channel", "stable", "--disable-auto", check=False)
        for path, data in sentinels.items():
            assert path.read_bytes() == data, f"owner file changed: {path}"
        if drift:
            assert result.returncode != 0, "a drifted managed file must still refuse the upgrade"
            assert "drifted" in (result.stderr + result.stdout), result.stderr
            assert mozak_skill.read_bytes() == drifted_bytes, "refused upgrade must not rewrite owner bytes"
            return "drift refused"
        assert result.returncode == 0, result.stderr
        updated = json.loads(run(launcher, env, "setup", "check", str(home)).stdout)
        assert updated["parity"] is True, updated
        assert not any(".jcode/skills/" + name in check["path"]
                       for name in RETIRED for check in updated["checks"]), "retired skills still managed"
        for name in RETIRED:
            assert not (home / f".jcode/skills/{name}/SKILL.md").exists()
        return f"upgrade to {len(updated['checks'])}-file generation succeeded"


def main() -> int:
    old_binary, new_binary = (Path(value).resolve(strict=True) for value in sys.argv[1:])
    ok = scenario(old_binary, new_binary, drift=False)
    refused = scenario(old_binary, new_binary, drift=True)
    print(f"ok: {ok}; {refused}; owner Jcode config, policy and credentials untouched")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
