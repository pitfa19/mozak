#!/usr/bin/env python3
"""Real old-to-new archive migration, custody and rollback acceptance.

Usage: test_jcode_upgrade.py OLD_REAL_BINARY NEW_REAL_BINARY
Network lookup alone uses a local release fixture. Both binaries and all
installation, update, parity and rollback operations are the real public paths.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

from test_delivery_update import ROOT, build, extract, fixture, run


def main() -> int:
    old_binary, new_binary = (Path(value).resolve(strict=True) for value in sys.argv[1:])
    with tempfile.TemporaryDirectory(prefix="mozak-jcode-upgrade-") as folder:
        root = Path(folder)
        old_release = build(old_binary, root, "stable", "4" * 40)
        new_release = build(new_binary, root, "stable", "5" * 40)
        old_bundle = extract(old_release, root / "old-extract")
        home, prefix, xdg = root / "home", root / "prefix", root / "xdg"
        for path in (home, prefix, xdg):
            path.mkdir()
        env = os.environ.copy()
        for key in ("MOZAK_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN", "MOZAK_RELEASE_FIXTURE"):
            env.pop(key, None)
        env.update(HOME=str(home), MOZAK_PREFIX=str(prefix), XDG_CONFIG_HOME=str(xdg), PATH="/usr/bin:/bin")
        subprocess.run([sys.executable, old_bundle / "install.py", "--prefix", prefix, "--home", home, "--disable-auto"], env=env, check=True, capture_output=True)
        launcher = prefix / "bin/mozak"
        old_check = json.loads(run(launcher, env, "setup", "check", str(home)).stdout)
        old_count = len(old_check["checks"])
        assert old_count in (120, 132), old_count
        # Exact pre-existing owner profiles must be adopted on upgrade and
        # restored (not erased) by rollback custody snapshots.
        sentinels = {}
        for name in ("swarm-low", "swarm-normal", "teacher"):
            path = home / f".jcode/skills/{name}/SKILL.md"
            path.parent.mkdir(parents=True)
            path.write_bytes((ROOT / f"skills/{name}/SKILL.md").read_bytes())
            sentinels[path] = path.read_bytes()
        for name, data in {
            "config.toml": b"# owner config\n[other]\nretain = true\n",
            "prompt-overlay.md": b"# unrelated owner prose\n",
            "swarm-prompt.md": b"# unrelated owner swarm policy\n",
            "credentials.json": b"sentinel-not-a-real-secret",
        }.items():
            path = home / ".jcode" / name
            path.write_bytes(data)
            sentinels[path] = data
        env["MOZAK_RELEASE_FIXTURE"] = str(fixture(new_release, root / "new-release.json"))
        run(launcher, env, "update", "--channel", "stable", "--disable-auto")
        updated = json.loads(run(launcher, env, "setup", "check", str(home)).stdout)
        assert updated["parity"] is True and len(updated["checks"]) == 136
        for path, data in sentinels.items():
            assert path.read_bytes() == data, path
        # Opt-in correctly refuses conflicting owner swarm policy without writes.
        refused = run(launcher, env, "setup", "jcode", "install", str(home), check=False)
        assert refused.returncode == 3 and json.loads(refused.stdout)["state"] == "invalid"
        for path, data in sentinels.items():
            assert path.read_bytes() == data, path
        custody = next((prefix / "lib/mozak/current").resolve().glob("jcode-custody-*.json"))
        custody_bytes = custody.read_bytes()
        damaged = json.loads(custody_bytes)
        damaged["home_sha256"] = "0" * 64
        custody.write_text(json.dumps(damaged))
        refused_rollback = run(launcher, env, "rollback", check=False)
        assert refused_rollback.returncode != 0
        assert len(json.loads(run(launcher, env, "setup", "check", str(home)).stdout)["checks"]) == 136
        for path, data in sentinels.items():
            assert path.read_bytes() == data, path
        custody.write_bytes(custody_bytes)
        run(launcher, env, "rollback")
        restored = json.loads(run(launcher, env, "setup", "check", str(home)).stdout)
        assert restored["parity"] is True and len(restored["checks"]) == old_count
        for path, data in sentinels.items():
            assert path.read_bytes() == data, path
        assert not (home / ".jcode/skills/mozak-jcode/SKILL.md").exists()
        print(f"ok: real {old_count}-to-136 generation upgrade and rollback preserve owner profiles, policy, config and credentials")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
