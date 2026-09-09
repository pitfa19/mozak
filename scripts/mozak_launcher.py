#!/usr/bin/env python3
"""MOZAK managed launcher: execute, update, auto-check, and roll back verified builds."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

MARKER = "MOZAK_MANAGED_LAUNCHER_V1"
DEFAULT_REPOSITORY = "pitfa19/mozak"
DEFAULT_INTERVAL_SECONDS = 86400


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def home_path() -> Path:
    value = os.environ.get("HOME", "")
    if not value:
        raise RuntimeError("HOME is not set")
    path = Path(value)
    if not path.is_absolute() or not path.is_dir() or path.is_symlink():
        raise RuntimeError("HOME must be an existing absolute real directory")
    return path


def prefix_path() -> Path:
    override = os.environ.get("MOZAK_PREFIX")
    if override:
        return Path(override)
    return Path(__file__).resolve().parent.parent


def install_root(prefix: Path) -> Path:
    return prefix / "lib" / "mozak"


def config_path(home: Path) -> Path:
    xdg = os.environ.get("XDG_CONFIG_HOME")
    base = Path(xdg) if xdg else home / ".config"
    return base / "mozak" / "delivery.json"


def current_build(prefix: Path) -> Path:
    current = install_root(prefix) / "current"
    if not current.is_symlink():
        raise RuntimeError(f"managed current link is missing: {current}")
    resolved = current.resolve(strict=True)
    versions = (install_root(prefix) / "versions").resolve(strict=True)
    if resolved.parent != versions:
        raise RuntimeError("managed current link escapes the versions directory")
    return resolved


def load_build(build_dir: Path) -> dict[str, Any]:
    try:
        value = json.loads((build_dir / "build.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"cannot read build identity from {build_dir}: {error}") from error
    required = {"schema_version", "build_id", "version", "revision", "channel", "platform", "repository"}
    if set(value) != required or value["schema_version"] != 1:
        raise RuntimeError("invalid build identity")
    return value


def default_config(build: dict[str, Any]) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "repository": build.get("repository", DEFAULT_REPOSITORY),
        "channel": "stable",
        "auto_update": False,
        "check_interval_seconds": DEFAULT_INTERVAL_SECONDS,
        "last_checked_at": 0,
    }


def load_config(path: Path, build: dict[str, Any]) -> dict[str, Any]:
    if not path.exists():
        return default_config(build)
    if path.is_symlink() or not path.is_file():
        raise RuntimeError(f"delivery config is not a regular file: {path}")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"cannot read delivery config: {error}") from error
    required = {
        "schema_version", "repository", "channel", "auto_update",
        "check_interval_seconds", "last_checked_at",
    }
    if set(value) != required or value["schema_version"] != 1:
        raise RuntimeError("unsupported delivery config")
    if value["channel"] not in {"stable", "main"}:
        raise RuntimeError("delivery channel must be stable or main")
    if not isinstance(value["auto_update"], bool):
        raise RuntimeError("auto_update must be boolean")
    if not isinstance(value["check_interval_seconds"], int) or value["check_interval_seconds"] < 60:
        raise RuntimeError("check_interval_seconds must be at least 60")
    if not isinstance(value["last_checked_at"], int) or value["last_checked_at"] < 0:
        raise RuntimeError("last_checked_at must be a non-negative integer")
    return value


def save_config(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.parent.is_symlink():
        raise RuntimeError("delivery config directory is a symlink")
    data = (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()
    fd, temporary = tempfile.mkstemp(prefix=".delivery-", dir=path.parent)
    staged = Path(temporary)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(staged, path)
    finally:
        staged.unlink(missing_ok=True)


def github_token() -> str | None:
    for name in ("MOZAK_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"):
        value = os.environ.get(name)
        if value:
            return value
    gh = shutil.which("gh")
    if gh:
        result = subprocess.run([gh, "auth", "token"], capture_output=True, text=True)
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
    return None


def request_bytes(url: str, *, token: str | None, accept: str, timeout: float = 15.0) -> bytes:
    headers = {"Accept": accept, "User-Agent": "mozak-delivery-v1", "X-GitHub-Api-Version": "2022-11-28"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.read()
    except (urllib.error.URLError, TimeoutError) as error:
        raise RuntimeError(f"download failed for {url}: {error}") from error


def release_assets(repository: str, channel: str) -> tuple[list[dict[str, Any]], str | None]:
    fixture = os.environ.get("MOZAK_RELEASE_FIXTURE")
    if fixture:
        value = json.loads(Path(fixture).read_text(encoding="utf-8"))
        return value["assets"], None
    token = github_token()
    suffix = "latest" if channel == "stable" else "tags/main"
    url = f"https://api.github.com/repos/{repository}/releases/{suffix}"
    try:
        value = json.loads(request_bytes(url, token=token, accept="application/vnd.github+json"))
    except RuntimeError as error:
        if token is None:
            raise RuntimeError(
                f"{error}; if this repository is private, authenticate with "
                "MOZAK_GITHUB_TOKEN, GH_TOKEN, GITHUB_TOKEN, or `gh auth login`"
            ) from error
        raise
    assets = value.get("assets")
    if not isinstance(assets, list):
        raise RuntimeError("GitHub release did not contain an asset list")
    return assets, token


def asset_bytes(assets: list[dict[str, Any]], name: str, token: str | None) -> bytes:
    matches = [asset for asset in assets if asset.get("name") == name]
    if len(matches) != 1:
        raise RuntimeError(f"release must contain exactly one {name} asset")
    asset = matches[0]
    fixture_path = asset.get("path")
    if fixture_path:
        return Path(fixture_path).read_bytes()
    url = asset.get("url")
    if not isinstance(url, str):
        raise RuntimeError(f"release asset {name} has no API URL")
    return request_bytes(url, token=token, accept="application/octet-stream", timeout=60.0)


def validate_manifest(value: Any, channel: str, repository: str) -> dict[str, Any]:
    required = {
        "schema_version", "repository", "channel", "version", "revision",
        "build_id", "platform", "archive", "archive_sha256",
    }
    if not isinstance(value, dict) or set(value) != required or value.get("schema_version") != 1:
        raise RuntimeError("invalid release manifest")
    if value["channel"] != channel or value["repository"] != repository:
        raise RuntimeError("release manifest channel or repository mismatch")
    if value["platform"] != "linux-x86_64":
        raise RuntimeError(f"unsupported release platform: {value['platform']}")
    revision = value["revision"]
    if not isinstance(revision, str) or len(revision) != 40 or any(c not in "0123456789abcdef" for c in revision):
        raise RuntimeError("release manifest revision is invalid")
    checksum = value["archive_sha256"]
    if not isinstance(checksum, str) or len(checksum) != 64 or any(c not in "0123456789abcdef" for c in checksum):
        raise RuntimeError("release manifest checksum is invalid")
    for key in ("version", "build_id", "archive"):
        if not isinstance(value[key], str) or not value[key] or "/" in value[key] or "\\" in value[key] or ".." in value[key]:
            raise RuntimeError(f"release manifest {key} is unsafe")
    return value


def safe_extract(archive: Path, output: Path) -> Path:
    with tarfile.open(archive, "r:gz") as bundle:
        members = bundle.getmembers()
        roots: set[str] = set()
        for member in members:
            path = Path(member.name)
            if path.is_absolute() or ".." in path.parts or not path.parts:
                raise RuntimeError("release archive contains an unsafe path")
            roots.add(path.parts[0])
            if not (member.isdir() or member.isfile()) or member.issym() or member.islnk():
                raise RuntimeError("release archive contains a non-regular entry")
        if len(roots) != 1:
            raise RuntimeError("release archive must contain exactly one root directory")
        bundle.extractall(output, filter="data")
    root = output / next(iter(roots))
    if not root.is_dir() or root.is_symlink():
        raise RuntimeError("release archive root is invalid")
    return root


def perform_update(prefix: Path, home: Path, config: dict[str, Any], explicit: bool) -> bool:
    assets, token = release_assets(config["repository"], config["channel"])
    manifest = validate_manifest(
        json.loads(asset_bytes(assets, "release-manifest.json", token)),
        config["channel"],
        config["repository"],
    )
    active = load_build(current_build(prefix))
    if manifest["build_id"] == active["build_id"]:
        if explicit:
            print(f"mozak is current: {active['build_id']}")
        return False
    archive_bytes = asset_bytes(assets, manifest["archive"], token)
    with tempfile.TemporaryDirectory(prefix="mozak-update-") as directory:
        scratch = Path(directory)
        archive = scratch / manifest["archive"]
        archive.write_bytes(archive_bytes)
        if sha256(archive) != manifest["archive_sha256"]:
            raise RuntimeError("release archive checksum mismatch")
        extracted = safe_extract(archive, scratch / "extract")
        installer = extracted / "install.py"
        if not installer.is_file() or installer.is_symlink():
            raise RuntimeError("release archive has no safe installer")
        command = [
            sys.executable, str(installer), "--prefix", str(prefix), "--home", str(home),
            "--expected-build-id", manifest["build_id"],
        ]
        result = subprocess.run(command, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or "release installer failed")
        if explicit and result.stdout:
            print(result.stdout.strip())
    return True


def update_command(prefix: Path, home: Path, config_file: Path, config: dict[str, Any], args: list[str]) -> int:
    channel: str | None = None
    auto: bool | None = None
    index = 0
    while index < len(args):
        arg = args[index]
        if arg == "--channel" and index + 1 < len(args):
            channel = args[index + 1]
            index += 2
        elif arg == "--enable-auto":
            auto = True
            index += 1
        elif arg == "--disable-auto":
            auto = False
            index += 1
        else:
            raise RuntimeError("usage: mozak update [--channel <stable|main>] [--enable-auto|--disable-auto]")
    if channel is not None:
        if channel not in {"stable", "main"}:
            raise RuntimeError("update channel must be stable or main")
        config["channel"] = channel
    if auto is not None:
        config["auto_update"] = auto
    changed = perform_update(prefix, home, config, explicit=True)
    config["last_checked_at"] = int(time.time())
    save_config(config_file, config)
    if not changed and auto is not None:
        print(f"automatic updates {'enabled' if auto else 'disabled'} on {config['channel']}")
    return 0


def rollback(prefix: Path, home: Path) -> int:
    root = install_root(prefix)
    previous = root / "previous"
    if not previous.is_symlink():
        raise RuntimeError("no previous MOZAK build is available")
    target = previous.resolve(strict=True)
    versions = (root / "versions").resolve(strict=True)
    if target.parent != versions:
        raise RuntimeError("previous build link escapes the versions directory")
    build = load_build(target)
    installer = target / "install.py"
    result = subprocess.run(
        [sys.executable, str(installer), "--prefix", str(prefix), "--home", str(home), "--activate-existing", build["build_id"]],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "rollback failed")
    print(result.stdout.strip())
    return 0


def status(prefix: Path, config: dict[str, Any]) -> int:
    active = load_build(current_build(prefix))
    previous_path = install_root(prefix) / "previous"
    previous = load_build(previous_path.resolve(strict=True))["build_id"] if previous_path.is_symlink() else None
    print(json.dumps({
        "schema_version": 1,
        "command": "delivery status",
        "active_build": active["build_id"],
        "previous_build": previous,
        "channel": config["channel"],
        "auto_update": config["auto_update"],
        "check_interval_seconds": config["check_interval_seconds"],
        "last_checked_at": config["last_checked_at"],
        "state_boundary": "projects, registries, scopes, adapters, and KB roots are not delivery state",
    }, sort_keys=True, separators=(",", ":")))
    return 0


def main() -> int:
    try:
        home = home_path()
        prefix = prefix_path()
        active_dir = current_build(prefix)
        build = load_build(active_dir)
        config_file = config_path(home)
        config = load_config(config_file, build)
        args = sys.argv[1:]
        requested_binary = "mozak-mcp" if Path(sys.argv[0]).name == "mozak-mcp" else "mozak"
        if requested_binary == "mozak-mcp":
            binary = active_dir / requested_binary
            os.execv(binary, [str(binary), *args])
        if args and args[0] == "update":
            return update_command(prefix, home, config_file, config, args[1:])
        if args == ["rollback"]:
            return rollback(prefix, home)
        if args == ["delivery", "status"]:
            return status(prefix, config)
        if config["auto_update"] and int(time.time()) - config["last_checked_at"] >= config["check_interval_seconds"]:
            try:
                perform_update(prefix, home, config, explicit=False)
            except RuntimeError as error:
                print(f"warning: automatic MOZAK update check failed: {error}", file=sys.stderr)
            finally:
                config["last_checked_at"] = int(time.time())
                save_config(config_file, config)
            active_dir = current_build(prefix)
        binary = active_dir / requested_binary
        os.execv(binary, [str(binary), *args])
    except (OSError, RuntimeError, json.JSONDecodeError) as error:
        print(f"mozak launcher failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
