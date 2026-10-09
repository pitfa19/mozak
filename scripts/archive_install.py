#!/usr/bin/env python3
"""Install or activate a versioned MOZAK build without touching user knowledge state."""

from __future__ import annotations

import argparse
import base64
import hashlib
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
MOZAK_MANAGED_FILENAMES = {"SKILL.md", "install.py", "mcp.json", "tests/test_skill.py", "evals/evals.json", "companion-recommendations.json", "tool-stack.json"}
ADHD_MANAGED_FILENAMES = {"SKILL.md"}
NOTE_MANAGED_FILENAMES = {
    "SKILL.md",
    "evals/evals.json",
    "evals/live-eval-2026-09-23.json",
    "references/note-blocks.md",
    "references/preference-learning.md",
    "references/profile.md",
    "references/supplements.md",
    "scripts/accept_preference.py",
    "scripts/inspect_profile.py",
    "scripts/profile_lib.py",
    "scripts/propose_preference.py",
}
NOTE_HEALTHCHECK_MANAGED_FILENAMES = {
    "SKILL.md",
    "evals/evals.json",
    "references/repair-boundary.md",
    "references/report-schema.md",
    "references/trust-metadata.md",
    "scripts/healthcheck.py",
}
NOTE_VOICE_CENSUS_MANAGED_FILENAMES = {
    "SKILL.md",
    "evals/evals.json",
    "references/default-thresholds.json",
    "references/privacy.md",
    "scripts/voice_census.py",
}
SEQUENCE_MANAGED_FILENAMES = {"SKILL.md", "scripts/check_sequence.py", "tests/test_sequence.py"}
JCODE_MANAGED_SKILLS = {"swarm-low", "swarm-normal", "teacher", "mozak-jcode"}
# MOZAK 0.11 retired the opt-in Jcode profile skills. A build that no longer
# manages them must still upgrade an install whose owner already removed them,
# so their absence (never their modification) is accepted for this one set.
RETIRED_JCODE_SKILLS = JCODE_MANAGED_SKILLS
LEGACY_ALIAS = Path(".claude/skills/i-have-adhd")
LEGACY_ALIAS_TARGET = Path(".agents/skills/i-have-adhd")


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


def allowed_legacy_alias(home: Path, path: Path) -> bool:
    if path != home / LEGACY_ALIAS:
        return False
    try:
        return path.resolve(strict=True) == (home / LEGACY_ALIAS_TARGET).resolve(strict=True)
    except OSError:
        return False


def snapshot_managed_path(home: Path, path: Path) -> tuple[str, bytes | str, int]:
    alias = home / LEGACY_ALIAS
    if (path == alias or alias in path.parents) and alias.is_symlink():
        metadata = alias.lstat()
        if not stat.S_ISLNK(metadata.st_mode) or not allowed_legacy_alias(home, alias):
            raise RuntimeError(f"managed skill path is unsafe: {alias}")
        return ("symlink", os.readlink(alias), stat.S_IMODE(metadata.st_mode))
    parent = path.parent
    while parent != home:
        try:
            parent_metadata = parent.lstat()
        except OSError as error:
            raise RuntimeError(f"cannot inspect managed skill path {parent}: {error}") from error
        if stat.S_ISLNK(parent_metadata.st_mode) or not stat.S_ISDIR(parent_metadata.st_mode):
            raise RuntimeError(f"managed skill path is unsafe: {parent}")
        parent = parent.parent
    metadata = path.lstat()
    if stat.S_ISLNK(metadata.st_mode):
        if not allowed_legacy_alias(home, path):
            raise RuntimeError(f"managed skill path is unsafe: {path}")
        return ("symlink", os.readlink(path), stat.S_IMODE(metadata.st_mode))
    if not stat.S_ISREG(metadata.st_mode):
        raise RuntimeError(f"managed skill path is unsafe: {path}")
    return ("file", path.read_bytes(), stat.S_IMODE(metadata.st_mode))


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


def setup_report(binary: Path, operation: str, home: Path, owner: str | None = None, kb_root: Path | None = None) -> tuple[subprocess.CompletedProcess[str], dict[str, Any] | None]:
    command = [str(binary), "setup", operation, str(home)]
    if owner is not None and kb_root is not None:
        command.extend(["--owner", owner, "--kb-root", str(kb_root)])
    result = subprocess.run(command, capture_output=True, text=True)
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
        if not allowed_managed_report_path(path):
            raise RuntimeError(f"setup report contains an unexpected managed path: {relative}")
        target = home / path
        if target in paths:
            raise RuntimeError("setup report repeats a managed path")
        paths.append(target)
    # Legacy generations remain supported for offline rollback. The stack
    # catalog adds four files; sequence commitment adds three files per host;
    # opt-in Jcode support adds four invocation skills only under .jcode.
    if len(paths) not in {16, 20, 24, 28, 32, 116, 120, 132, 136}:
        raise RuntimeError("setup report must declare a recognized managed file generation")
    return paths


def allowed_managed_report_path(path: Path) -> bool:
    if path.is_absolute() or ".." in path.parts:
        return False
    parts = path.parts
    if len(parts) < 4 or parts[1] != "skills":
        return False
    if parts[0] not in {".agents", ".jcode", ".claude", ".codex"}:
        return False
    skill = parts[2]
    suffix = "/".join(parts[3:])
    if skill == "mozak":
        return suffix in MOZAK_MANAGED_FILENAMES
    if skill == "i-have-adhd":
        return suffix in ADHD_MANAGED_FILENAMES
    if skill == "note":
        return suffix in NOTE_MANAGED_FILENAMES
    if skill == "note-healthcheck":
        return suffix in NOTE_HEALTHCHECK_MANAGED_FILENAMES
    if skill == "note-voice-census":
        return suffix in NOTE_VOICE_CENSUS_MANAGED_FILENAMES
    if skill == "mozak-sequence-commitment":
        return suffix in SEQUENCE_MANAGED_FILENAMES
    if skill in JCODE_MANAGED_SKILLS:
        return parts[0] == ".jcode" and suffix == "SKILL.md"
    return False


def restore_files(backup: dict[Path, tuple[str, bytes | str, int]], new_paths: list[Path]) -> None:
    for path in new_paths:
        if path.exists() and path.is_file() and not path.is_symlink():
            path.unlink()
    for path, (kind, data, mode) in backup.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        if kind == "symlink":
            if path.exists() or path.is_symlink():
                if path.is_dir() and not path.is_symlink():
                    shutil.rmtree(path)
                else:
                    path.unlink()
            elif path.is_dir():
                shutil.rmtree(path)
            path.symlink_to(data)
        else:
            atomic_regular_file(path, data, mode)


def migrate_skills(old_binary: Path | None, new_binary: Path, home: Path, owner: str | None = None, kb_root: Path | None = None) -> dict[Path, tuple[str, bytes | str, int]]:
    new_check, new_report = setup_report(new_binary, "check", home)
    if new_check.returncode == 0 and new_report and new_report.get("state") == "ready":
        if old_binary is None and owner is not None and kb_root is not None:
            install, report = setup_report(new_binary, "install", home, owner, kb_root)
            if install.returncode != 0 or not report or report.get("state") != "ready":
                raise RuntimeError("new embedded skill installation failed")
        return {}
    new_paths = report_paths(new_report, home)
    backup: dict[Path, tuple[str, bytes | str, int]] = {}
    # Newly managed paths can already contain an owner-installed companion.
    # Preserve them too, even when the previous binary did not know their names.
    for path in new_paths:
        if path.exists() or path.is_symlink():
            alias = home / LEGACY_ALIAS
            backup_path = alias if alias.is_symlink() and (path == alias or alias in path.parents) else path
            backup[backup_path] = snapshot_managed_path(home, backup_path)
    if old_binary is not None:
        old_check, old_report = setup_report(old_binary, "check", home)
        if old_check.returncode not in (0, 2) or not old_report_ready(old_report, new_report):
            raise RuntimeError("installed managed skills drifted; refusing automatic migration")
        old_paths = present_paths(old_report, home)
        alias = home / LEGACY_ALIAS
        alias_is_link = alias.is_symlink()
        for path in old_paths:
            backup_path = alias if alias_is_link and (path == alias or alias in path.parents) else path
            backup[backup_path] = snapshot_managed_path(home, backup_path)
        for path in old_paths:
            if alias_is_link and (path == alias or alias in path.parents):
                alias.unlink(missing_ok=True)
            else:
                path.unlink()
    try:
        install, report = setup_report(new_binary, "install", home, owner if old_binary is None else None, kb_root if old_binary is None else None)
        if install.returncode != 0 or not report or report.get("state") != "ready":
            raise RuntimeError("new embedded skill installation failed")
        check, checked = setup_report(new_binary, "check", home)
        if check.returncode != 0 or not checked or checked.get("state") != "ready":
            raise RuntimeError("new embedded skill parity check failed")
    except Exception:
        if old_binary is not None:
            restore_files(backup, new_paths)
        raise
    return backup


def jcode_custody_paths(report: dict[str, Any], home: Path) -> set[Path]:
    return {path for path in report_paths(report, home)
            if path.relative_to(home).parts[:2] == (".jcode", "skills")
            and path.relative_to(home).parts[2] in JCODE_MANAGED_SKILLS}


def is_retired_jcode_path(path: Path) -> bool:
    parts = path.parts
    return (len(parts) == 4 and parts[:2] == (".jcode", "skills")
            and parts[2] in RETIRED_JCODE_SKILLS and parts[3] == "SKILL.md")


def old_report_ready(old_report: dict[str, Any] | None, new_report: dict[str, Any] | None) -> bool:
    """True when the old install is intact apart from retired files it lost.

    A missing file is tolerated only if it is a retired Jcode skill AND the new
    build no longer manages it. Any drifted file, any other missing file, or a
    malformed report still refuses the migration.
    """
    if not isinstance(old_report, dict) or not isinstance(old_report.get("checks"), list):
        return False
    if old_report.get("state") == "ready":
        return True
    new_managed = set()
    if isinstance(new_report, dict) and isinstance(new_report.get("checks"), list):
        new_managed = {check.get("path") for check in new_report["checks"] if isinstance(check, dict)}
    for check in old_report["checks"]:
        if not isinstance(check, dict) or not isinstance(check.get("path"), str):
            return False
        status = check.get("status")
        if status == "ok":
            continue
        relative = Path(check["path"])
        if status == "missing" and is_retired_jcode_path(relative) and check["path"] not in new_managed:
            continue
        return False
    return True


def present_paths(report: dict[str, Any], home: Path) -> list[Path]:
    """Managed paths from a report, excluding retired files already absent."""
    missing = {home / Path(check["path"]) for check in report["checks"]
               if isinstance(check, dict) and check.get("status") == "missing"
               and isinstance(check.get("path"), str) and is_retired_jcode_path(Path(check["path"]))}
    return [path for path in report_paths(report, home) if path not in missing]


def custody_record(old: Path, target: Path, home: Path, paths: set[Path]) -> bytes:
    records = []
    for path in sorted(paths):
        if path.exists() or path.is_symlink():
            kind, data, mode = snapshot_managed_path(home, path)
            if kind != "file":
                raise RuntimeError("new Jcode custody requires a regular skill file")
            records.append({"path": str(path.relative_to(home)), "kind": "file",
                            "data": base64.b64encode(data).decode("ascii"),
                            "sha256": hashlib.sha256(data).hexdigest(), "mode": mode})
        else:
            records.append({"path": str(path.relative_to(home)), "kind": "absent"})
    return (json.dumps({"schema_version": 1, "from": old.name, "to": target.name,
                       "home_sha256": hashlib.sha256(str(home).encode()).hexdigest(),
                       "files": records}, sort_keys=True, separators=(",", ":")) + "\n").encode()


def load_custody(path: Path, old: Path, target: Path, home: Path, expected: set[Path]) -> dict[Path, tuple[str, bytes, int]] | None:
    if not path.exists() and not path.is_symlink():
        return None
    raw = regular_bytes(path, "Jcode custody record")
    if len(raw) > 2 * 1024 * 1024:
        raise RuntimeError("Jcode custody record exceeds bounded size")
    record = json.loads(raw)
    if (not isinstance(record, dict) or set(record) != {"schema_version", "from", "to", "home_sha256", "files"}
            or record["schema_version"] != 1 or record["from"] != target.name
            or record["to"] != old.name
            or record["home_sha256"] != hashlib.sha256(str(home).encode()).hexdigest()
            or not isinstance(record["files"], list)):
        raise RuntimeError("Jcode custody identity mismatch")
    restored = {}
    for item in record["files"]:
        if not isinstance(item, dict) or not isinstance(item.get("path"), str):
            raise RuntimeError("invalid Jcode custody entry")
        relative = Path(item["path"])
        candidate = home / relative
        if (relative.is_absolute() or ".." in relative.parts or candidate not in expected
                or candidate in restored or not allowed_managed_report_path(relative)):
            raise RuntimeError("unsafe or repeated Jcode custody path")
        if item.get("kind") == "absent" and set(item) == {"path", "kind"}:
            restored[candidate] = ("absent", b"", 0o600)
        elif item.get("kind") == "file" and set(item) == {"path", "kind", "data", "sha256", "mode"}:
            try:
                data = base64.b64decode(item["data"], validate=True)
            except (ValueError, TypeError):
                raise RuntimeError("invalid Jcode custody bytes") from None
            if (hashlib.sha256(data).hexdigest() != item["sha256"]
                    or type(item["mode"]) is not int or not 0 <= item["mode"] <= 0o777):
                raise RuntimeError("Jcode custody hash or mode mismatch")
            restored[candidate] = ("file", data, item["mode"])
        else:
            raise RuntimeError("invalid Jcode custody entry")
    if set(restored) != expected:
        raise RuntimeError("Jcode custody coverage mismatch")
    return restored


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
            "auto_update": True,
            "check_interval_seconds": 86400,
            "last_checked_at": 0,
        }
    if channel is not None:
        value["channel"] = channel
    if auto is not None:
        value["auto_update"] = auto
    path.parent.mkdir(parents=True, exist_ok=True)
    atomic_regular_file(path, (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode(), 0o600)


def activate(source: Path, prefix: Path, home: Path, expected_build_id: str | None, channel: str | None, auto: bool | None, owner: str | None, kb_root: Path | None) -> dict[str, Any]:
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
    custody_path = None
    custody_before = None
    custody_bytes = None
    custody_restore = None
    dropped_backup = {}
    if old is not None:
        old_check, old_report = setup_report(old_binary, "check", home)
        _, new_report = setup_report(target / "mozak", "check", home)
        if old_check.returncode not in (0, 2) or not old_report_ready(old_report, new_report):
            raise RuntimeError("installed managed skills drifted; refusing automatic migration")
        old_jcode = jcode_custody_paths(old_report, home) & set(present_paths(old_report, home))
        new_jcode = jcode_custody_paths(new_report, home)
        gained, dropped = new_jcode - old_jcode, old_jcode - new_jcode
        if gained:
            custody_path = target / f"jcode-custody-{old.name}.json"
            if custody_path.exists() or custody_path.is_symlink():
                custody_before = regular_bytes(custody_path, "previous Jcode custody")
            custody_bytes = custody_record(old, target, home, gained)
        if dropped:
            custody_restore = load_custody(old / f"jcode-custody-{target.name}.json", old, target, home, dropped)
            if custody_restore is None:
                raise RuntimeError("missing Jcode custody for downgrade; refusing to erase owner skill files")
            dropped_backup = {path: snapshot_managed_path(home, path) for path in dropped}
    launchers = [bin_directory / name for name in ("mozak", "mozak-mcp")]
    old_launchers: dict[Path, bytes] = {}
    for launcher in launchers:
        if launcher.exists() or launcher.is_symlink():
            if launcher.is_symlink() or not launcher.is_file():
                raise RuntimeError("installed launcher path is unsafe")
            old_launchers[launcher] = launcher.read_bytes()
            if LAUNCHER_MARKER not in old_launchers[launcher]:
                raise RuntimeError("refusing to replace a non-MOZAK launcher")

    skill_backup = migrate_skills(old_binary, target / "mozak", home, owner, kb_root)
    skill_backup.update(dropped_backup)
    try:
        if custody_restore is not None:
            for path, (kind, data, mode) in custody_restore.items():
                if kind == "file":
                    atomic_regular_file(path, data, mode)
                elif path.exists():
                    path.unlink()
        if custody_path is not None:
            atomic_regular_file(custody_path, custody_bytes, 0o600)
        if old is not None:
            atomic_link(root / "previous", f"versions/{old.name}")
        atomic_link(root / "current", f"versions/{target.name}")
        for launcher in launchers:
            atomic_regular_file(launcher, regular_bytes(target / "launcher.py", "version launcher"), 0o755)
        check, report = setup_report(target / "mozak", "check", home)
        if check.returncode != 0 or not report or report.get("state") != "ready":
            raise RuntimeError("activated build failed final managed-skill verification")
    except Exception:
        if custody_path is not None:
            if custody_before is None:
                custody_path.unlink(missing_ok=True)
            else:
                atomic_regular_file(custody_path, custody_before, 0o600)
        if old is not None:
            atomic_link(root / "current", f"versions/{old.name}")
            if skill_backup:
                new_check, new_report = setup_report(target / "mozak", "check", home)
                restore_files(skill_backup, report_paths(new_report, home))
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
    parser.add_argument("--owner", default=os.environ.get("MOZAK_OWNER") or None)
    parser.add_argument("--kb-root", type=Path, default=Path(os.environ["MOZAK_KB_ROOT"]) if os.environ.get("MOZAK_KB_ROOT") else None)
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--enable-auto", action="store_true")
    group.add_argument("--disable-auto", action="store_true")
    args = parser.parse_args()
    try:
        home = existing_real_directory(args.home if args.home is not None else default_home(), "HOME")
        if (args.owner is None) != (args.kb_root is None):
            raise RuntimeError("--owner/MOZAK_OWNER and --kb-root/MOZAK_KB_ROOT must be supplied together")
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
        build = activate(source, prefix, home, args.expected_build_id, args.channel, auto, args.owner, args.kb_root)
        print(f"installed and activated MOZAK {build['build_id']} at {prefix / 'bin' / 'mozak'}")
        if str(prefix / "bin") not in os.environ.get("PATH", "").split(os.pathsep):
            print(f'note: add it to PATH with: export PATH="{prefix / "bin"}:$PATH"')
        return 0
    except (OSError, RuntimeError, subprocess.SubprocessError, json.JSONDecodeError) as error:
        print(f"install failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
