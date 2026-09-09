#!/usr/bin/env python3
"""End-to-end acceptance for versioned install, update, auto-check, and rollback."""

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
BUILDER = ROOT / "scripts/build_linux_release.sh"
REV1 = "1" * 40
REV2 = "2" * 40
REV3 = "3" * 40


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build(binary: Path, root: Path, channel: str, revision: str) -> Path:
    output = root / f"release-{channel}-{revision[0]}"
    output.mkdir()
    subprocess.run(
        [str(BUILDER), str(binary), str(output), channel, revision, "pitfa19/mozak"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return output


def archive_path(release: Path) -> Path:
    manifest = json.loads((release / "release-manifest.json").read_text(encoding="utf-8"))
    return release / manifest["archive"]


def extract(release: Path, output: Path) -> Path:
    output.mkdir()
    with tarfile.open(archive_path(release), "r:gz") as bundle:
        bundle.extractall(output, filter="data")
    return next(output.iterdir())


def fixture(release: Path, output: Path) -> Path:
    manifest = json.loads((release / "release-manifest.json").read_text(encoding="utf-8"))
    value = {
        "assets": [
            {"name": "release-manifest.json", "path": str(release / "release-manifest.json")},
            {"name": manifest["archive"], "path": str(release / manifest["archive"])},
        ]
    }
    output.write_text(json.dumps(value), encoding="utf-8")
    return output


def run(launcher: Path, env: dict[str, str], *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run([str(launcher), *args], env=env, capture_output=True, text=True)
    if check and result.returncode != 0:
        raise AssertionError(f"{' '.join(args)} failed\nstdout={result.stdout}\nstderr={result.stderr}")
    return result


def main() -> int:
    if len(sys.argv) != 2:
        raise SystemExit("usage: test_delivery_update.py RELEASE_BINARY")
    binary = Path(sys.argv[1]).resolve(strict=True)
    with tempfile.TemporaryDirectory(prefix="mozak-delivery-") as directory:
        root = Path(directory)
        home, prefix, xdg = root / "home", root / "prefix", root / "xdg"
        home.mkdir(); prefix.mkdir(); xdg.mkdir()
        env = os.environ.copy()
        # This test must never reach the real GitHub repository. Ambient
        # credentials would let an auto-update check install the published
        # release mid-test and silently invalidate every build assertion.
        for name in ("MOZAK_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"):
            env.pop(name, None)
        no_gh = root / "no-gh-bin"
        no_gh.mkdir()
        env.update({
            "HOME": str(home),
            "XDG_CONFIG_HOME": str(xdg),
            "MOZAK_PREFIX": str(prefix),
            "LC_ALL": "C",
            # Keep a usable interpreter but remove gh from discovery.
            "PATH": f"{no_gh}{os.pathsep}/usr/bin{os.pathsep}/bin",
        })

        release1 = build(binary, root, "stable", REV1)
        release2 = build(binary, root, "stable", REV2)
        release3 = build(binary, root, "main", REV3)
        bundle1 = extract(release1, root / "extract-1")
        install = subprocess.run(
            [sys.executable, str(bundle1 / "install.py"), "--prefix", str(prefix), "--home", str(home), "--channel", "stable", "--disable-auto"],
            env=env,
            capture_output=True,
            text=True,
        )
        assert install.returncode == 0, install.stderr
        launcher = prefix / "bin/mozak"
        assert run(launcher, env, "--version").stdout.startswith("mozak ")
        first_status = json.loads(run(launcher, env, "delivery", "status").stdout)
        assert first_status["active_build"].endswith(REV1[:12])
        assert first_status["auto_update"] is False and first_status["channel"] == "stable"

        managed = json.loads(subprocess.run(
            [str((prefix / "lib/mozak/current").resolve(strict=True) / "mozak"), "delivery", "status"],
            env=env, capture_output=True, text=True, check=True,
        ).stdout)["state"]
        assert managed["installation"] == "managed"
        assert managed["build_id"].endswith(REV1[:12])
        assert Path(managed["launcher"]) == launcher and launcher.is_file()
        refused = subprocess.run(
            [str((prefix / "lib/mozak/current").resolve(strict=True) / "mozak"), "update"],
            env=env, capture_output=True, text=True,
        )
        assert refused.returncode != 0 and "installed launcher" in refused.stderr

        sentinels = {
            home / "project/.mozak/project.yml": b"project-owned-state\n",
            xdg / "mozak/config.json": b"project-registry\n",
            xdg / "mozak/adapters.json": b"adapter-registry\n",
            home / "kb/kb.json": b"kb-registry\n",
            home / "scope/scope.json": b"scope-state\n",
        }
        for path, data in sentinels.items():
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        before = {path: digest(path) for path in sentinels}

        env2 = dict(env)
        env2["MOZAK_RELEASE_FIXTURE"] = str(fixture(release2, root / "release2.json"))
        updated = run(launcher, env2, "update")
        assert "installed and activated" in updated.stdout
        second_status = json.loads(run(launcher, env, "delivery", "status").stdout)
        assert second_status["active_build"].endswith(REV2[:12])
        assert second_status["previous_build"].endswith(REV1[:12])
        assert {path: digest(path) for path in sentinels} == before

        rolled = run(launcher, env, "rollback")
        assert "installed and activated" in rolled.stdout
        rolled_status = json.loads(run(launcher, env, "delivery", "status").stdout)
        assert rolled_status["active_build"].endswith(REV1[:12])
        assert rolled_status["previous_build"].endswith(REV2[:12])
        assert {path: digest(path) for path in sentinels} == before

        env3 = dict(env)
        env3["MOZAK_RELEASE_FIXTURE"] = str(fixture(release3, root / "release3.json"))
        run(launcher, env3, "update", "--channel", "main")
        main_status = json.loads(run(launcher, env, "delivery", "status").stdout)
        assert main_status["active_build"].endswith(f"main-{REV3[:12]}")
        assert main_status["channel"] == "main"

        bad_manifest = json.loads((release2 / "release-manifest.json").read_text(encoding="utf-8"))
        bad_manifest["channel"] = "main"
        bad_manifest["archive_sha256"] = "0" * 64
        bad_manifest_path = root / "bad-manifest.json"
        bad_manifest_path.write_text(json.dumps(bad_manifest), encoding="utf-8")
        bad_fixture = root / "bad-release.json"
        bad_fixture.write_text(json.dumps({"assets": [
            {"name": "release-manifest.json", "path": str(bad_manifest_path)},
            {"name": bad_manifest["archive"], "path": str(release2 / bad_manifest["archive"])},
        ]}), encoding="utf-8")
        bad_env = dict(env)
        bad_env["MOZAK_RELEASE_FIXTURE"] = str(bad_fixture)
        failed = run(launcher, bad_env, "update", check=False)
        assert failed.returncode != 0 and "checksum mismatch" in failed.stderr
        assert json.loads(run(launcher, env, "delivery", "status").stdout)["active_build"] == main_status["active_build"]

        config_path = xdg / "mozak/delivery.json"
        config = json.loads(config_path.read_text(encoding="utf-8"))
        config["auto_update"] = True
        config["last_checked_at"] = 0
        config_path.write_text(json.dumps(config), encoding="utf-8")
        auto = run(launcher, bad_env, "--version")
        assert auto.stdout.startswith("mozak ")
        assert "automatic MOZAK update check failed" in auto.stderr
        assert {path: digest(path) for path in sentinels} == before

        # Auto-update must actually fire on an interval, but only against a
        # pinned fixture so the check cannot reach a real release.
        auto_env = dict(env)
        auto_env["MOZAK_RELEASE_FIXTURE"] = str(fixture(release2, root / "release-auto.json"))
        run(launcher, auto_env, "update", "--channel", "stable", "--enable-auto")
        run(launcher, auto_env, "rollback")
        auto_config = json.loads((xdg / "mozak/delivery.json").read_text(encoding="utf-8"))
        auto_config["last_checked_at"] = 0
        (xdg / "mozak/delivery.json").write_text(json.dumps(auto_config), encoding="utf-8")
        before_auto = json.loads(run(launcher, auto_env, "delivery", "status").stdout)["active_build"]
        run(launcher, auto_env, "--version")
        after_auto = json.loads(run(launcher, auto_env, "delivery", "status").stdout)["active_build"]
        assert after_auto.endswith(REV2[:12]), f"auto-update did not fire: {after_auto}"
        assert after_auto != before_auto, "auto-update did not change the active build"
        assert {path: digest(path) for path in sentinels} == before

        # Without a fixture the launcher must reach GitHub. Force a resolution
        # failure and confirm the message stays actionable for both visibilities
        # and that a failed explicit update never changes the active build.
        offline = dict(env)
        offline.pop("MOZAK_RELEASE_FIXTURE", None)
        for name in ("MOZAK_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"):
            offline.pop(name, None)
        # Point gh discovery and the network at nothing resolvable, but keep a
        # usable PATH so the launcher interpreter itself still runs.
        empty_bin = root / "empty-bin"
        empty_bin.mkdir()
        offline["PATH"] = f"{empty_bin}{os.pathsep}/usr/bin{os.pathsep}/bin"
        before_offline = json.loads(run(launcher, env, "delivery", "status").stdout)["active_build"]
        blocked = subprocess.run(
            [str(launcher), "update"],
            env={**offline, "https_proxy": "http://127.0.0.1:1", "HTTPS_PROXY": "http://127.0.0.1:1"},
            capture_output=True, text=True,
        )
        assert blocked.returncode != 0
        assert "gh auth login" in blocked.stderr or "download failed" in blocked.stderr, blocked.stderr
        after_offline = json.loads(run(launcher, env, "delivery", "status").stdout)["active_build"]
        assert after_offline == before_offline
        assert {path: digest(path) for path in sentinels} == before

    print("delivery install/update/rollback acceptance passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
