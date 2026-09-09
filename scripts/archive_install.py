#!/usr/bin/env python3
"""Install or activate a versioned MOZAK build without touching user knowledge state."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

LAUNCHER_MARKER = b"MOZAK_MANAGED_LAUNCHER_V1"
BUILD_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$")
MANAGED_FILENAMES = {"SKILL.md", "install.py", "mcp.json", "tests/test_skill.py", "evals/evals.json"}


def existing_real_directory(path: Path, label: str) -> Path:
    if not path.is_absolute():
        raise RuntimeError(f"{label} must be an absolute path")
    try:
        metadata = path.lstat()
    except OSError as error:
        raise RuntimeError(f"cannot inspect {label} {path}: {error}") from error
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISDIR(metadata.st_mode):
        raise RuntimeError(f"{label} must be an existing real directory, not a symlink")
    return path.resolve(strict=True)


def ensure_real_directory(path: Path) -> None:
    missing: list[Path] = []
    current = path
    while not current.exists():
        missing.append(current)
        current = current.parent
    metadata = current.lstat()
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISDIR(metadata.st_mode):
        raise RuntimeError(f"unsafe path component: {current}")
    for directory in reversed(missing):
        directory.mkdir(mode=0o755)
    current = path
    while True:
        metadata = current.lstat()
        if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISDIR(metadata.st_mode):
            raise RuntimeError(f"unsafe directory: {current}")
        if current == current.parent or current == path.anchor:
            break
        if current == path:
            current = current.parent
            continue
        if current == path.parent.parent.parent:
            break
        current = current.parent


def regular_bytes(path: Path, label: str) -> bytes:
    try:
        metadata = path.lstat()
    except OSError as error:
        raise RuntimeError(f"cannot inspect {label} {path}: {error}") from error
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        raise RuntimeError(f"{label} must be a regular file: {path}")
    return path.read_bytes()


def load_build(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(regular_bytes(path, "build identity"))
    except json.JSONDecodeError as error:
        raise RuntimeError(f"invalid build identity JSON: {error}") from error
    required = {"schema_version", "build_id", "version", "revision", "channel", "platform", "repository"}
    if not isinstance(value, dict) or set(value) != required or value.get("schema_version") != 1:
        raise RuntimeError("invalid build identity")
    if not isinstance(value["build_id"], str) or not BUILD_ID.fullmatch(value["build_id"]):
        raise RuntimeError("unsafe build id")
    if value["channel"] not in {"stable", "main"} or value["platform"] != "linux-x86_64":
        raise RuntimeError("unsupported build channel or platform")
    revision = value["revision"]
    if not isinstance(revision, str) or len(revision) != 40 or any(c not in "0123456789abcdef" for c in revision):
        raise RuntimeError("invalid build revision")
    for key in ("version", "repository"):
        if not isinstance(value[key], str) or not value[key]:
            raise RuntimeError(f"invalid build {key}")
    return value


def atomic_regular_file(target: Path, data: bytes, mode: int) -> None:
    if target.exists() or target.is_symlink():
        metadata = target.lstat()
        if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
            raise RuntimeError(f"refusing unsafe managed file: {target}")
    fd, temporary = tempfile.mkstemp(prefix=f".{target.name}-", dir=target.parent)
    staged = Path(temporary)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(staged, mode)
        os.replace(staged, target)
    finally:
        staged.unlink(missing_ok=True)


def atomic_link(link: Path, target_name: str) -> None:
    temporary = link.parent / f".{link.name}-{os.getpid()}"
    temporary.unlink(missing_ok=True)
    temporary.symlink_to(target_name)
    os.replace(temporary, link)


def current_version(root: Path) -> Path | None:
    current = root / "current"
    if not current.exists() and not current.is_symlink():
        return None
    if not current.is_symlink():
        raise RuntimeError("managed current path is not a symlink")
    try:
        resolved = current.resolve(strict=True)
    except OSError as error:
        raise RuntimeError(f"invalid current build link: {error}") from error
    versions = (root / "versions").resolve(strict=True)
    if resolved.parent != versions:
        raise RuntimeError("current build link escapes versions directory")
    return resolved


def setup_report(binary: Path, operation: str, home: Path) -> tuple[subprocess.CompletedProcess[str], dict[str, Any] | None]:
    result = subprocess.run([str(binary), "setup", operation, str(home)], capture_output=True, text=True)
    try:
        report = json.loads(result.stdout) if result.stdout else None
    except json.JSONDecodeError:
        report = None
    return result, report


def report_paths(report: dict[str, Any] | None, home: Path) -> list[Path]:
    if not isinstance(report, dict) or not isinstance(report.get("checks"), list):
        raise RuntimeError("setup report did not declare managed files")
    paths: list[Path] = []
    for check in report["checks"]:
        relative = check.get("path") if isinstance(check, dict) else None
        if not isinstance(relative, str):
            raise RuntimeError("setup report contains an invalid managed path")
        path = Path(relative)
        if path.is_absolute() or ".." in path.parts or path.as_posix().split("skills/mozak/", 1)[-1] not in MANAGED_FILENAMES:
            raise RuntimeError(f"setup report contains an unexpected managed path: {relative}")
        target = home / path
        if target in paths:
            raise RuntimeError("setup report repeats a managed path")
        paths.append(target)
    if len(paths) not in {16, 20}:
        raise RuntimeError("setup report must declare exactly 16 legacy or 20 current managed files")
    return paths


def restore_files(backup: dict[Path, tuple[bytes, int]], new_paths: list[Path]) -> None:
    for path in new_paths:
        if path.exists() and path.is_file() and not path.is_symlink():
            path.unlink()
    for path, (data, mode) in backup.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        atomic_regular_file(path, data, mode)


def migrate_skills(old_binary: Path | None, new_binary: Path, home: Path) -> None:
    new_check, new_report = setup_report(new_binary, "check", home)
    if new_check.returncode == 0 and new_report and new_report.get("state") == "ready":
        return
    new_paths = report_paths(new_report, home)
    backup: dict[Path, tuple[bytes, int]] = {}
    if old_binary is not None:
        old_check, old_report = setup_report(old_binary, "check", home)
        if old_check.returncode != 0 or not old_report or old_report.get("state") != "ready":
            raise RuntimeError("installed managed skills drifted; refusing automatic migration")
        old_paths = report_paths(old_report, home)
        for path in old_paths:
            metadata = path.lstat()
            if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
                raise RuntimeError(f"managed skill path is unsafe: {path}")
            backup[path] = (path.read_bytes(), stat.S_IMODE(metadata.st_mode))
        for path in old_paths:
            path.unlink()
    try:
        install, report = setup_report(new_binary, "install", home)
        if install.returncode != 0 or not report or report.get("state") != "ready":
            raise RuntimeError("new embedded skill installation failed")
        check, checked = setup_report(new_binary, "check", home)
        if check.returncode != 0 or not checked or checked.get("state") != "ready":
            raise RuntimeError("new embedded skill parity check failed")
    except Exception:
        restore_files(backup, new_paths)
        raise


def publish_version(source: Path, versions: Path, build: dict[str, Any]) -> Path:
    target = versions / build["build_id"]
    names = ("mozak", "mozak-mcp", "build.json", "install.py", "launcher.py")
    expected = {name: regular_bytes(source / name, f"archive {name}") for name in names}
    if LAUNCHER_MARKER not in expected["launcher.py"]:
        raise RuntimeError("archive launcher is not MOZAK-managed")
    if target.exists() or target.is_symlink():
        if target.is_symlink() or not target.is_dir():
            raise RuntimeError("version target is unsafe")
        for name, data in expected.items():
            if regular_bytes(target / name, f"installed {name}") != data:
                raise RuntimeError("existing version directory differs from the archive")
        return target
    stage = Path(tempfile.mkdtemp(prefix=f".{build['build_id']}-", dir=versions))
    try:
        for name, data in expected.items():
            mode = 0o755 if name in {"mozak", "mozak-mcp", "install.py", "launcher.py"} else 0o644
            (stage / name).write_bytes(data)
            os.chmod(stage / name, mode)
        os.rename(stage, target)
    finally:
        if stage.exists():
            shutil.rmtree(stage)
    return target


def delivery_config_path(home: Path) -> Path:
    base = Path(os.environ["XDG_CONFIG_HOME"]) if os.environ.get("XDG_CONFIG_HOME") else home / ".config"
    return base / "mozak" / "delivery.json"


def configure_delivery(home: Path, build: dict[str, Any], channel: str | None, auto: bool | None) -> None:
    path = delivery_config_path(home)
    if path.exists():
        if path.is_symlink() or not path.is_file():
            raise RuntimeError("delivery config path is unsafe")
        value = json.loads(path.read_text(encoding="utf-8"))
    else:
        value = {
            "schema_version": 1,
            "repository": build["repository"],
            "channel": "stable",
            "auto_update": False,
            "check_interval_seconds": 86400,
            "last_checked_at": 0,
        }
    if channel is not None:
        value["channel"] = channel
    if auto is not None:
        value["auto_update"] = auto
    path.parent.mkdir(parents=True, exist_ok=True)
    atomic_regular_file(path, (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode(), 0o600)


def activate(source: Path, prefix: Path, home: Path, expected_build_id: str | None, channel: str | None, auto: bool | None) -> dict[str, Any]:
    root = prefix / "lib" / "mozak"
    versions = root / "versions"
    bin_directory = prefix / "bin"
    ensure_real_directory(versions)
    ensure_real_directory(bin_directory)
    build = load_build(source / "build.json")
    if expected_build_id is not None and build["build_id"] != expected_build_id:
        raise RuntimeError("release manifest and archive build identities differ")
    target = publish_version(source, versions, build)
    old = current_version(root)
    if old == target:
        migrate_skills(target / "mozak", target / "mozak", home)
        for launcher_name in ("mozak", "mozak-mcp"):
            launcher = bin_directory / launcher_name
            if launcher.exists() and LAUNCHER_MARKER not in regular_bytes(launcher, "installed launcher"):
                raise RuntimeError("refusing to replace a non-MOZAK launcher")
            atomic_regular_file(launcher, regular_bytes(target / "launcher.py", "version launcher"), 0o755)
        configure_delivery(home, build, channel, auto)
        return build

    old_binary = old / "mozak" if old is not None else None
    migrate_skills(old_binary, target / "mozak", home)

    launchers = [bin_directory / name for name in ("mozak", "mozak-mcp")]
    old_launchers: dict[Path, bytes] = {}
    for launcher in launchers:
        if launcher.exists() or launcher.is_symlink():
            if launcher.is_symlink() or not launcher.is_file():
                raise RuntimeError("installed launcher path is unsafe")
            old_launchers[launcher] = launcher.read_bytes()
            if LAUNCHER_MARKER not in old_launchers[launcher]:
                raise RuntimeError("refusing to replace a non-MOZAK launcher")

    try:
        if old is not None:
            atomic_link(root / "previous", f"versions/{old.name}")
        atomic_link(root / "current", f"versions/{target.name}")
        for launcher in launchers:
            atomic_regular_file(launcher, regular_bytes(target / "launcher.py", "version launcher"), 0o755)
        check, report = setup_report(target / "mozak", "check", home)
        if check.returncode != 0 or not report or report.get("state") != "ready":
            raise RuntimeError("activated build failed final managed-skill verification")
    except Exception:
        if old is not None:
            atomic_link(root / "current", f"versions/{old.name}")
        for launcher, old_launcher in old_launchers.items():
            atomic_regular_file(launcher, old_launcher, 0o755)
        raise
    configure_delivery(home, build, channel, auto)
    return build


def default_home() -> Path:
    value = os.environ.get("HOME", "")
    if not value:
        raise RuntimeError("HOME is not set; pass --home explicitly")
    return Path(value)


def default_prefix(home: Path) -> Path:
    prefix = home / ".local"
    prefix.mkdir(parents=True, exist_ok=True)
    return prefix


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prefix", type=Path, default=None)
    parser.add_argument("--home", type=Path, default=None)
    parser.add_argument("--expected-build-id")
    parser.add_argument("--activate-existing")
    parser.add_argument("--channel", choices=("stable", "main"))
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--enable-auto", action="store_true")
    group.add_argument("--disable-auto", action="store_true")
    args = parser.parse_args()
    try:
        home = existing_real_directory(args.home if args.home is not None else default_home(), "HOME")
        prefix_value = args.prefix if args.prefix is not None else default_prefix(home)
        prefix = existing_real_directory(prefix_value, "PREFIX")
        root = prefix / "lib" / "mozak"
        if args.activate_existing:
            if not BUILD_ID.fullmatch(args.activate_existing):
                raise RuntimeError("unsafe existing build id")
            source = root / "versions" / args.activate_existing
            if not source.is_dir() or source.is_symlink():
                raise RuntimeError("requested existing build is unavailable")
        else:
            source = Path(__file__).resolve().parent
        auto = True if args.enable_auto else False if args.disable_auto else None
        build = activate(source, prefix, home, args.expected_build_id, args.channel, auto)
        print(f"installed and activated MOZAK {build['build_id']} at {prefix / 'bin' / 'mozak'}")
        if str(prefix / "bin") not in os.environ.get("PATH", "").split(os.pathsep):
            print(f'note: add it to PATH with: export PATH="{prefix / "bin"}:$PATH"')
        return 0
    except (OSError, RuntimeError, subprocess.SubprocessError, json.JSONDecodeError) as error:
        print(f"install failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
