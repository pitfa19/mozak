#!/usr/bin/env python3
"""Embedded, offline, explicit opt-in Jcode setup. Python 3.11+, no dependencies."""
from __future__ import annotations

import copy
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
import tomllib

SETTINGS = {
    "provider": {
        "default_provider": "openai",
        "default_model": "gpt-6.1-sol",
        "openai_reasoning_effort": "low",
        "anthropic_reasoning_effort": "medium",
        "same_provider_account_failover": True,
        "cross_provider_failover": "off",
    },
    "agents": {
        "swarm_model": "claude-oauth:claude-sonnet-5-5",
        "swarm_effort": "medium",
        "swarm_root_effort": "low",
        "swarm_deep_root_effort": "low",
    },
}
BEGIN = "<!-- MOZAK Jcode agent-work begin -->\n"
END = "<!-- MOZAK Jcode agent-work end -->\n"
LIMIT = 2 * 1024 * 1024


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def safe(path: Path, directory: bool = False) -> None:
    # Inspect every ancestor, including HOME, without following links.
    for parent in [*reversed(path.parents), path]:
        try:
            mode = parent.lstat().st_mode
        except FileNotFoundError:
            continue
        if stat.S_ISLNK(mode):
            raise ValueError("symlink component refused")
        if parent != path or directory:
            if not stat.S_ISDIR(mode):
                raise ValueError("non-directory component refused")
        elif not stat.S_ISREG(mode):
            raise ValueError("non-regular target refused")


def read(path: Path) -> bytes | None:
    safe(path)
    if not path.exists():
        return None
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
            raise ValueError("non-regular target refused")
        data = stream.read(LIMIT + 1)
    if len(data) > LIMIT:
        raise ValueError("target exceeds bounded size")
    return data


def merge_config(original: bytes | None) -> bytes:
    text = (original or b"").decode("utf-8")
    try:
        before = tomllib.loads(text)
    except tomllib.TOMLDecodeError:
        raise ValueError("invalid TOML config") from None
    expected = copy.deepcopy(before)
    for table, values in SETTINGS.items():
        if table in before and not isinstance(before[table], dict):
            raise ValueError("config table has an incompatible type")
        for key, value in values.items():
            if key in before.get(table, {}) and type(before[table][key]) is not type(value):
                raise ValueError("owned config field has an incompatible type")
        expected.setdefault(table, {}).update(values)
    if before == expected:
        return original or b""
    # Only edit unambiguous plain table headers and single-line scalar fields.
    # Reject inline/dotted representations when they need changing.
    lines = text.splitlines(keepends=True)
    for table, values in SETTINGS.items():
        header = re.compile(r"^\s*\[" + table + r"\]\s*(?:#.*)?$")
        indices = [i for i, line in enumerate(lines) if header.fullmatch(line.rstrip("\r\n"))]
        if len(indices) > 1 or (table in before and not indices):
            raise ValueError("config needs manual normalization of table headers")
        if not indices:
            if lines and not lines[-1].endswith("\n"):
                lines[-1] += "\n"
            lines.extend(["\n", f"[{table}]\n"])
            start = len(lines) - 1
        else:
            start = indices[0]
        end = next((i for i in range(start + 1, len(lines)) if lines[i].lstrip().startswith("[")), len(lines))
        for key, value in values.items():
            if before.get(table, {}).get(key) == value:
                continue
            field = re.compile(r"^(\s*" + key + r"\s*=\s*)(\"[^\"\n]*\"|'[^'\n]*'|true|false)(\s*(?:#.*)?)(\r?\n)?$")
            candidates = [i for i in range(start + 1, end) if re.match(r"\s*" + key + r"\s*=", lines[i])]
            rendered = json.dumps(value)
            if key in before.get(table, {}) and len(candidates) != 1:
                raise ValueError("config needs manual normalization of owned fields")
            if candidates:
                i = candidates[0]
                match = field.fullmatch(lines[i])
                if match is None:
                    raise ValueError("config owned field is not a simple scalar")
                lines[i] = match[1] + rendered + match[3] + (match[4] or "\n")
            else:
                if end and not lines[end - 1].endswith("\n"):
                    lines[end - 1] += "\n"
                lines.insert(end, f"{key} = {rendered}\n")
                end += 1
    merged = "".join(lines)
    try:
        after = tomllib.loads(merged)
    except tomllib.TOMLDecodeError:
        raise ValueError("config merge failed validation") from None
    if after != expected:
        raise ValueError("config merge changed unrelated settings")
    return merged.encode("utf-8")


def merge_overlay(original: bytes | None, payload: bytes) -> bytes:
    if original is None or original == payload:
        return payload
    text = original.decode("utf-8")
    block = BEGIN.encode() + payload + END.encode()
    if BEGIN.strip() in text or END.strip() in text:
        if original.count(block) != 1 or text.count(BEGIN.strip()) != 1 or text.count(END.strip()) != 1:
            raise ValueError("managed overlay block drifted")
        return original
    # Do not append a second policy over an earlier customized agent-work policy.
    if any(term in text for term in ("swarm-low", "swarm-normal", "Teacher mode", "Swarm work profiles")):
        raise ValueError("existing agent-work overlay requires owner reconciliation")
    return original + (b"\n" if original.endswith(b"\n") else b"\n\n") + block


def preflight(home: Path, payload: dict) -> list[tuple[Path, bytes | None, bytes]]:
    safe(home, directory=True)
    if not home.is_dir():
        raise ValueError("HOME must be an existing real directory")
    result = []
    for relative, content in payload.items():
        path = home / relative
        original = read(path)
        target = content.encode("utf-8")
        if relative.endswith("prompt-overlay.md"):
            target = merge_overlay(original, target)
        elif original is not None and original != target:
            raise ValueError("existing managed skill or swarm policy drifted")
        result.append((path, original, target))
    config = home / ".jcode/config.toml"
    original = read(config)
    result.append((config, original, merge_config(original)))
    safe(home / ".jcode/mozak-agent-work.lock")
    safe(home / ".jcode/settings-backups/mozak-agent-work", directory=True)
    return result


def atomic(path: Path, data: bytes, mode: int = 0o600) -> None:
    safe(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    safe(path.parent, directory=True)
    fd, name = tempfile.mkstemp(prefix=".mozak-jcode-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            os.fchmod(stream.fileno(), mode)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        safe(path)
        os.replace(name, path)
        fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def install(home: Path, payload: dict, expected: list) -> tuple[list, list[str]]:
    root = home / ".jcode"
    root.mkdir(exist_ok=True)
    safe(root, directory=True)
    lock = root / "mozak-agent-work.lock"
    safe(lock)
    fd = os.open(lock, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    backups = []
    completed = []
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError("another Jcode setup holds the lock") from None
        current = preflight(home, payload)
        if current != expected:
            raise ValueError("setup targets changed after preflight")
        # Prepare all backups before mutating targets. Existing backups must match.
        for path, original, target in current:
            if original is None or original == target:
                continue
            backup = root / "settings-backups/mozak-agent-work" / digest(original)
            saved = read(backup)
            if saved is not None and saved != original:
                raise ValueError("backup digest mismatch")
            if saved is None:
                atomic(backup, original)
            backups.append(str(backup.relative_to(home)))
        try:
            for path, original, target in current:
                if original == target:
                    continue
                if read(path) != original:
                    raise ValueError("setup target changed before commit")
                mode = stat.S_IMODE(path.stat().st_mode) if original is not None else 0o600
                # Record before write so even a directory-fsync failure rolls back.
                completed.append((path, original, target, mode))
                atomic(path, target, mode)
            if any(original != target for _, original, target in preflight(home, payload)):
                raise ValueError("installed readback did not match")
        except Exception:
            for path, original, target, mode in reversed(completed):
                observed = read(path)
                if observed not in (original, target):
                    raise ValueError("rollback blocked by concurrent target modification") from None
                if original is None:
                    if observed is not None:
                        path.unlink()
                else:
                    atomic(path, original, mode)
            raise
        return current, sorted(set(backups))
    finally:
        os.close(fd)


def main() -> int:
    action, supplied_home = sys.argv[1:]
    if action not in ("plan", "install", "check"):
        raise ValueError("unknown Jcode setup action")
    if ".." in Path(supplied_home).parts:
        raise ValueError("parent traversal in HOME refused")
    home = Path(os.path.abspath(supplied_home))
    payload = json.load(sys.stdin)
    targets = preflight(home, payload)
    changes = [str(path.relative_to(home)) for path, original, target in targets if original != target]
    backups = []
    if action == "install" and changes:
        targets, backups = install(home, payload, targets)
    ready = action == "install" or not changes
    report = {
        "schema_version": 1, "operation": f"setup jcode {action}",
        "state": "ready" if ready else ("planned" if action == "plan" else "incomplete"),
        "default_profile": "low", "teacher_default": "off", "settings": SETTINGS,
        "changes": changes, "backups": backups,
        "checks": [{"path": str(p.relative_to(home)), "state": "matching" if ready or old == new else "change_required", "target_sha256": digest(new)} for p, old, new in targets],
        "effects": {"mutation": action == "install" and bool(changes), "network": False, "credentials": "untouched", "starts_agents": False},
        "runtime": {"verified": False, "fresh_session_required": True, "teacher_prerequisite": "/effort swarm-deep", "requirements": ["Python 3.11+", "compatible Jcode and declared models", "owner-configured Claude OAuth accounts"]},
    }
    print(json.dumps(report, sort_keys=True, indent=2))
    return 0 if action == "plan" or ready else 2


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError, UnicodeError, TypeError):
        # Never echo config bytes, credential values or exception source lines.
        print(json.dumps({"schema_version": 1, "state": "invalid", "error": "Jcode setup refused: invalid, drifted, unsafe, locked or concurrently changed target. Normalize owned fields and inspect plan before retrying."}, sort_keys=True))
        sys.exit(3)
