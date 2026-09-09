#!/usr/bin/env python3
"""Install the portable MOZAK skill without touching unrelated files."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import stat
import tempfile
from pathlib import Path


MANAGED_FILES = (
    "SKILL.md",
    "install.py",
    "mcp.json",
    "tests/test_skill.py",
    "evals/evals.json",
)
DESTINATIONS = (
    ".agents/skills/mozak",
    ".jcode/skills/mozak",
    ".claude/skills/mozak",
    ".codex/skills/mozak",
)


def digest_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def regular_bytes(path: Path, label: str) -> bytes:
    try:
        metadata = path.lstat()
    except OSError as error:
        raise RuntimeError(f"cannot inspect {label} {path}: {error}") from error
    if stat.S_ISLNK(metadata.st_mode):
        raise RuntimeError(f"{label} is a symlink: {path}")
    if not stat.S_ISREG(metadata.st_mode):
        raise RuntimeError(f"{label} is not a regular file: {path}")
    try:
        return path.read_bytes()
    except OSError as error:
        raise RuntimeError(f"cannot read {label} {path}: {error}") from error


def inspect_component(path: Path) -> None:
    try:
        metadata = path.lstat()
    except FileNotFoundError:
        return
    except OSError as error:
        raise RuntimeError(f"cannot inspect path component {path}: {error}") from error
    if stat.S_ISLNK(metadata.st_mode):
        raise RuntimeError(f"path component is a symlink: {path}")
    if not stat.S_ISDIR(metadata.st_mode):
        raise RuntimeError(f"path component is not a directory: {path}")


def safe_directory(root: Path, relative: Path) -> Path:
    current = root
    inspect_component(current)
    for component in relative.parts:
        current = current / component
        inspect_component(current)
    return current


def ensure_directory(root: Path, relative: Path) -> Path:
    current = root
    inspect_component(current)
    for component in relative.parts:
        current = current / component
        try:
            current.mkdir(mode=0o755)
        except FileExistsError:
            pass
        except OSError as error:
            raise RuntimeError(f"cannot create directory {current}: {error}") from error
        inspect_component(current)
    return current


def source_payload(source: Path) -> dict[str, tuple[bytes, int]]:
    payload = {}
    for name in MANAGED_FILES:
        path = source / name
        data = regular_bytes(path, "managed source")
        payload[name] = (data, path.lstat().st_mode & 0o777)
    return payload


def inspect_target(target: Path, expected: bytes) -> str:
    try:
        metadata = target.lstat()
    except FileNotFoundError:
        return "missing"
    except OSError as error:
        raise RuntimeError(f"cannot inspect managed target {target}: {error}") from error
    if stat.S_ISLNK(metadata.st_mode):
        raise RuntimeError(f"managed target is a symlink: {target}")
    if not stat.S_ISREG(metadata.st_mode):
        raise RuntimeError(f"managed target is not a regular file: {target}")
    actual = regular_bytes(target, "managed target")
    return "ok" if actual == expected else "drift"


def preflight(home: Path, payload: dict[str, tuple[bytes, int]]) -> list[tuple[Path, str, bytes, int]]:
    checks = []
    for destination_name in DESTINATIONS:
        destination = safe_directory(home, Path(destination_name))
        for name, (expected, mode) in payload.items():
            target = destination / name
            safe_directory(home, target.parent.relative_to(home))
            status = inspect_target(target, expected)
            checks.append((target, status, expected, mode))
    return checks


def publish_absent(target: Path, data: bytes, mode: int, home: Path) -> None:
    ensure_directory(home, target.parent.relative_to(home))
    status = inspect_target(target, data)
    if status == "ok":
        return
    if status != "missing":
        raise RuntimeError(f"managed target drifted before publish: {target}")
    fd, temporary = tempfile.mkstemp(prefix=f".{target.name}.mozak-new.", dir=target.parent)
    temp_path = Path(temporary)
    try:
        with os.fdopen(fd, "wb") as staged:
            staged.write(data)
            staged.flush()
            os.fsync(staged.fileno())
        os.chmod(temp_path, mode)
        try:
            os.link(temp_path, target, follow_symlinks=False)
        except FileExistsError as error:
            raise RuntimeError(f"managed target appeared during install: {target}") from error
        directory_fd = os.open(target.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        temp_path.unlink(missing_ok=True)


def report(home: Path, payload: dict[str, tuple[bytes, int]]) -> tuple[dict[str, object], bool]:
    installed: dict[str, dict[str, str | None]] = {}
    parity = True
    for destination_name in DESTINATIONS:
        destination = home / destination_name
        hashes: dict[str, str | None] = {}
        for name, (expected, _) in payload.items():
            target = destination / name
            status = inspect_target(target, expected)
            hashes[name] = digest_bytes(expected) if status == "ok" else None
            parity = parity and status == "ok"
        installed[str(destination)] = hashes
    return installed, parity


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="verify installed byte parity")
    args = parser.parse_args()
    source = Path(__file__).resolve().parent
    home = Path.home()
    try:
        if not home.is_absolute():
            raise RuntimeError("HOME must be absolute")
        home_metadata = home.lstat()
        if stat.S_ISLNK(home_metadata.st_mode) or not stat.S_ISDIR(home_metadata.st_mode):
            raise RuntimeError("HOME must be an existing real directory")
        payload = source_payload(source)
        checks = preflight(home, payload)
        drift = [str(target) for target, status, _, _ in checks if status == "drift"]
        if drift:
            raise RuntimeError("refusing to overwrite drifted managed targets: " + ", ".join(drift))
        if not args.check:
            for target, status, data, mode in checks:
                if status == "missing":
                    publish_absent(target, data, mode, home)
        installed, parity = report(home, payload)
        print(json.dumps({"source": {name: digest_bytes(data) for name, (data, _) in payload.items()}, "installed": installed, "parity": parity}, sort_keys=True))
        return 0 if parity else 1
    except (OSError, RuntimeError) as error:
        print(json.dumps({"error": str(error), "parity": False}, sort_keys=True))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
