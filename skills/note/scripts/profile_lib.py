#!/usr/bin/env python3
"""Shared profile, precedence, and atomic-write helpers for the note skill."""

from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any

SCHEMA_VERSION = 1
TRIM_LEVELS = {"low", "medium", "high"}
READINESS_EXIT_CODES = {"ready": 0, "needs_input": 2, "invalid": 3, "blocked": 4}
STYLE_DOC_NAMES = ("writing_style.md", "CLAUDE.md", "AGENTS.md")
STYLE_DIRECTIVE_FIELDS = {"trim", "obsidian"}
GENERIC_ROUTING_WORDS = {
    "add",
    "my",
    "note",
    "notes",
    "recap",
    "save",
    "this",
    "write",
}


def issue(field: str, code: str, message: str) -> dict[str, str]:
    return {"field": field, "code": code, "message": message}


def profile_path(explicit: str | None = None) -> Path:
    if explicit:
        return Path(explicit).expanduser()
    config_home = os.environ.get("XDG_CONFIG_HOME", "").strip()
    base = Path(config_home).expanduser() if config_home else Path.home() / ".config"
    return base / "notes" / "profile.json"


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def file_sha256(path: Path) -> str | None:
    return sha256_bytes(path.read_bytes()) if path.exists() and not path.is_symlink() else None


def _safe_relative_path(value: str) -> bool:
    path = Path(value)
    return bool(value.strip()) and not path.is_absolute() and ".." not in path.parts


def _has_symlink_ancestor(path: Path) -> bool:
    probe = path if path.exists() else path.parent
    for item in [probe, *probe.parents]:
        if item.is_symlink():
            return True
    return False


def _inside(child: Path, parent: Path) -> bool:
    try:
        child.resolve(strict=False).relative_to(parent.resolve(strict=True))
        return True
    except (OSError, ValueError):
        return False


def _string_list(value: Any) -> bool:
    return isinstance(value, list) and all(isinstance(item, str) for item in value)


def _check_preferences(value: Any) -> list[dict[str, str]]:
    if value is None:
        return []
    if not isinstance(value, list):
        return [issue("preferences", "not_a_list", "Expected a list.")]
    problems: list[dict[str, str]] = []
    seen: set[str] = set()
    for index, preference in enumerate(value):
        where = f"preferences[{index}]"
        if not isinstance(preference, dict):
            problems.append(issue(where, "not_an_object", "Expected a preference object."))
            continue
        for name in sorted(set(preference) - {"id", "scope", "rule", "evidence", "accepted_at", "source_proposal"}):
            problems.append(issue(f"{where}.{name}", "unknown_field", "Field is not part of the schema."))
        identifier = preference.get("id")
        if not isinstance(identifier, str) or not identifier.strip():
            problems.append(issue(f"{where}.id", "missing", "A preference needs a non-empty id."))
        elif identifier in seen:
            problems.append(issue(f"{where}.id", "duplicate", "Preference ids must be unique."))
        else:
            seen.add(identifier)
        if not isinstance(preference.get("rule"), str) or not preference.get("rule", "").strip():
            problems.append(issue(f"{where}.rule", "missing", "A preference needs a rule."))
        if not isinstance(preference.get("scope"), dict):
            problems.append(issue(f"{where}.scope", "missing", "A preference needs a scope object."))
        evidence = preference.get("evidence", [])
        if not _string_list(evidence):
            problems.append(issue(f"{where}.evidence", "not_a_string_list", "Expected a list of strings."))
    return problems


def _check_destination(index: int, value: Any, *, require_existing_roots: bool) -> list[dict[str, str]]:
    where = f"destinations[{index}]"
    if not isinstance(value, dict):
        return [issue(where, "not_an_object", "Expected a destination object.")]
    problems: list[dict[str, str]] = []
    allowed = {"id", "root", "purpose", "default", "routing_signals", "trim", "obsidian", "excluded_paths"}
    for name in sorted(set(value) - allowed):
        problems.append(issue(f"{where}.{name}", "unknown_field", "Field is not part of the schema."))
    identifier = value.get("id")
    if not isinstance(identifier, str) or not identifier.strip():
        problems.append(issue(f"{where}.id", "missing", "A destination needs a non-empty string id."))
    elif not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", identifier):
        problems.append(issue(f"{where}.id", "invalid_format", "Use letters, numbers, dot, underscore, or hyphen."))
    root = value.get("root")
    root_path: Path | None = None
    if not isinstance(root, str) or not root.strip():
        problems.append(issue(f"{where}.root", "missing", "A destination needs a root."))
    else:
        root_path = Path(root).expanduser()
        if not root_path.is_absolute():
            problems.append(issue(f"{where}.root", "not_absolute", "Expected an absolute path."))
        elif require_existing_roots:
            if root_path.is_symlink() or _has_symlink_ancestor(root_path):
                problems.append(issue(f"{where}.root", "symlink_hazard", "Root and ancestors must not be symlinks."))
            elif not root_path.is_dir():
                problems.append(issue(f"{where}.root", "missing_directory", "Root is not an existing directory."))
    purpose = value.get("purpose")
    if not isinstance(purpose, str) or not purpose.strip():
        problems.append(issue(f"{where}.purpose", "missing", "A destination needs a human-written purpose."))
    trim = value.get("trim", "medium")
    if trim not in TRIM_LEVELS:
        problems.append(issue(f"{where}.trim", "invalid_enum", "Expected low, medium, or high."))
    for name in ("routing_signals", "excluded_paths"):
        listed = value.get(name, [])
        if not _string_list(listed):
            problems.append(issue(f"{where}.{name}", "not_a_string_list", "Expected a list of strings."))
            continue
        for item_index, item in enumerate(listed):
            if not item.strip():
                problems.append(issue(f"{where}.{name}[{item_index}]", "empty", "Expected a non-empty value."))
            if name == "excluded_paths":
                if not _safe_relative_path(item):
                    problems.append(issue(f"{where}.{name}[{item_index}]", "unsafe_relative_path", "Expected a safe relative path."))
                elif require_existing_roots and root_path and root_path.is_dir():
                    excluded = root_path / item
                    if not _inside(excluded, root_path) or excluded.is_symlink():
                        problems.append(issue(f"{where}.{name}[{item_index}]", "path_escape", "Excluded path must stay inside the destination root."))
    for name in ("default", "obsidian"):
        if not isinstance(value.get(name, False), bool):
            problems.append(issue(f"{where}.{name}", "not_a_boolean", "Expected true or false."))
    return problems


def destination_summary(destination: dict[str, Any]) -> dict[str, Any]:
    root = str(Path(str(destination.get("root", ""))).expanduser())
    return {
        "id": str(destination.get("id", "")),
        "root": root,
        "purpose": str(destination.get("purpose", "")),
        "default": bool(destination.get("default", False)),
        "routing_signals": list(destination.get("routing_signals", [])),
        "excluded_paths": list(destination.get("excluded_paths", [])),
        "trim": destination.get("trim", "medium"),
        "obsidian": bool(destination.get("obsidian", False)),
    }


def validate_profile_document(document: Any, *, require_existing_roots: bool = True) -> tuple[list[dict[str, str]], list[dict[str, Any]]]:
    if not isinstance(document, dict):
        return [issue("profile", "not_an_object", "Expected a JSON object.")], []
    problems: list[dict[str, str]] = []
    for name in sorted(set(document) - {"schema_version", "destinations", "preferences", "_comment"}):
        problems.append(issue(name, "unknown_field", "Field is not part of the schema."))
    if document.get("schema_version") != SCHEMA_VERSION:
        problems.append(issue("schema_version", "unsupported", f"Expected schema_version {SCHEMA_VERSION}."))
    destinations = document.get("destinations", [])
    if not isinstance(destinations, list):
        return problems + [issue("destinations", "not_a_list", "Expected a list.")], []
    seen: set[str] = set()
    defaults = 0
    for index, destination in enumerate(destinations):
        problems.extend(_check_destination(index, destination, require_existing_roots=require_existing_roots))
        if isinstance(destination, dict):
            identifier = destination.get("id")
            if isinstance(identifier, str) and identifier.strip():
                if identifier in seen:
                    problems.append(issue(f"destinations[{index}].id", "duplicate", "Destination ids must be unique."))
                seen.add(identifier)
            if destination.get("default") is True:
                defaults += 1
    if defaults > 1:
        problems.append(issue("destinations", "multiple_defaults", "At most one destination may be the default."))
    problems.extend(_check_preferences(document.get("preferences")))
    return problems, [destination_summary(d) for d in destinations if isinstance(d, dict)]


def inspect_profile(path: Path) -> dict[str, Any]:
    base = {"schema_version": SCHEMA_VERSION, "profile_path": str(path)}
    if path.is_symlink():
        return {**base, "state": "blocked", "issues": [issue("profile", "symlink_hazard", "Profile path must not be a symlink.")], "destinations": []}
    if not path.exists():
        if _has_symlink_ancestor(path):
            return {**base, "state": "blocked", "issues": [issue("profile", "symlink_hazard", "Profile parent must not be a symlink.")], "destinations": []}
        return {**base, "state": "needs_input", "issues": [], "destinations": [], "message": "No profile exists yet. Route by explicit path and say routing is unconfigured."}
    try:
        raw = path.read_text(encoding="utf-8-sig")
    except OSError as error:
        return {**base, "state": "blocked", "issues": [issue("profile", "unreadable", str(error))], "destinations": []}
    try:
        document = json.loads(raw)
    except (json.JSONDecodeError, UnicodeError) as error:
        return {**base, "state": "invalid", "issues": [issue("profile", "malformed_json", str(error))], "destinations": []}
    problems, summary = validate_profile_document(document, require_existing_roots=True)
    if problems:
        return {**base, "state": "invalid", "issues": problems, "destinations": summary}
    if not summary:
        return {**base, "state": "needs_input", "issues": [], "destinations": [], "message": "The profile declares no destination. Routing is unconfigured."}
    return {**base, "state": "ready", "issues": [], "destinations": summary, "profile_sha256": file_sha256(path)}


def _tokens(value: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", value.lower())


def _contains_token_phrase(haystack: list[str], phrase: list[str]) -> bool:
    if not phrase or len(phrase) > len(haystack):
        return False
    return any(haystack[index : index + len(phrase)] == phrase for index in range(len(haystack) - len(phrase) + 1))


def _destination_route_score(destination: dict[str, Any], request: str | None) -> int:
    request_tokens = _tokens(request or "")
    if not request_tokens:
        return 0
    request_signal_tokens = {token for token in request_tokens if token not in GENERIC_ROUTING_WORDS}
    if not request_signal_tokens:
        return 0

    exact_signal_phrases = 0
    signal_word_hits = 0
    for signal in destination.get("routing_signals", []):
        signal_tokens = [token for token in _tokens(str(signal)) if token not in GENERIC_ROUTING_WORDS]
        if not signal_tokens:
            continue
        if _contains_token_phrase(request_tokens, signal_tokens):
            exact_signal_phrases += 1
        signal_word_hits += len(request_signal_tokens.intersection(signal_tokens))

    purpose_tokens = {token for token in _tokens(str(destination.get("purpose", ""))) if token not in GENERIC_ROUTING_WORDS}
    purpose_word_hits = len(request_signal_tokens.intersection(purpose_tokens))
    return exact_signal_phrases * 100 + signal_word_hits * 10 + purpose_word_hits


def find_destination(destinations: list[dict[str, Any]], *, explicit_destination: str | None, explicit_path: str | None, request: str | None) -> tuple[str, dict[str, Any] | None, list[dict[str, Any]], str | None]:
    if explicit_destination:
        matches = [d for d in destinations if d.get("id") == explicit_destination]
        return ("ready", matches[0] if len(matches) == 1 else None, matches, None if matches else "unknown_explicit_destination")
    if explicit_path:
        path = Path(explicit_path).expanduser().resolve(strict=False)
        matches = [d for d in destinations if _inside(path, Path(str(d.get("root", ""))))]
        return ("ready", matches[0] if len(matches) == 1 else None, matches, None if len(matches) == 1 else "explicit_path_outside_or_ambiguous")
    scored = [(destination, _destination_route_score(destination, request)) for destination in destinations]
    positive = [(destination, score) for destination, score in scored if score > 0]
    if positive:
        high_score = max(score for _, score in positive)
        winners = [destination for destination, score in positive if score == high_score]
        if len(winners) == 1:
            return ("ready", winners[0], [destination for destination, _ in positive], None)
        return ("needs_input", None, winners, "ambiguous_routing_signals")
    defaults = [d for d in destinations if d.get("default") is True]
    if len(defaults) == 1:
        return ("ready", defaults[0], [], None)
    return ("needs_input", None, [], "no_routing_candidate")


def find_nearest_style_doc(target: Path, root: Path) -> Path | None:
    root_resolved = root.resolve(strict=True)
    current = target.expanduser().resolve(strict=False)
    if not _inside(current, root_resolved):
        raise ValueError("target escapes selected destination root")
    directory = current if current.exists() and current.is_dir() else current.parent
    while True:
        if not _inside(directory, root_resolved):
            raise ValueError("style search escaped selected destination root")
        for name in STYLE_DOC_NAMES:
            candidate = directory / name
            if candidate.is_file():
                resolved = candidate.resolve(strict=True)
                if not _inside(resolved, root_resolved):
                    raise ValueError("style document escapes selected destination root")
                return resolved
        if directory == root_resolved:
            return None
        directory = directory.parent


def parse_style_directives(path: Path) -> dict[str, Any]:
    """Parse only documented per-field directives from a style document."""
    directives: dict[str, Any] = {}
    try:
        lines = path.read_text(encoding="utf-8-sig").splitlines()
    except (OSError, UnicodeError):
        return directives
    for raw in lines:
        line = raw.strip()
        if not line or line.startswith("#") or ":" not in line:
            continue
        field, value = [part.strip() for part in line.split(":", 1)]
        field = field.lower()
        value = value.lower()
        if field not in STYLE_DIRECTIVE_FIELDS:
            continue
        if field == "trim" and value in TRIM_LEVELS:
            directives["trim"] = value
        elif field == "obsidian" and value in {"true", "false"}:
            directives["obsidian"] = value == "true"
    return directives


def target_hits_excluded_path(target: Path, destination: dict[str, Any]) -> str | None:
    root = Path(str(destination.get("root", "")))
    for item in destination.get("excluded_paths", []):
        excluded = root / str(item)
        if _inside(target, excluded):
            return str(item)
    return None


def resolve_precedence(*, explicit: dict[str, Any] | None, target: Path | None, profile_report: dict[str, Any], request: str | None = None) -> dict[str, Any]:
    precedence = ["explicit_request", "nearest_style_doc", "device_local_profile", "portable_defaults"]
    if profile_report.get("state") in {"invalid", "blocked"}:
        return {"state": profile_report["state"], "precedence": precedence, "decision": None, "issues": profile_report.get("issues", [])}
    destinations = list(profile_report.get("destinations", []))
    explicit = explicit or {}
    route_state, destination, candidates, route_issue = find_destination(destinations, explicit_destination=explicit.get("destination_id"), explicit_path=explicit.get("path"), request=request)
    if route_state != "ready" and destinations:
        return {"state": "needs_input", "precedence": precedence, "decision": None, "issues": [issue("destination", route_issue or "ambiguous", "Destination could not be selected without input.")], "candidates": candidates}
    decision: dict[str, Any] = {"trim": "medium", "obsidian": False, "style_doc": None, "destination_id": None, "root": None}
    sources: dict[str, str] = {key: "portable_defaults" for key in decision}
    if destination:
        for key in ("destination_id", "root", "trim", "obsidian"):
            source_key = "id" if key == "destination_id" else key
            decision[key] = destination.get(source_key)
            sources[key] = "device_local_profile"
    if target and destination:
        if not explicit.get("path"):
            excluded = target_hits_excluded_path(target.expanduser().resolve(strict=False), destination)
            if excluded:
                return {"state": "needs_input", "precedence": precedence, "decision": None, "issues": [issue("target", "excluded_path", f"Target is under excluded path '{excluded}'. Use --explicit-path to confirm this target for the current operation.")]}
        try:
            style = find_nearest_style_doc(target, Path(str(destination["root"])))
        except ValueError as error:
            return {"state": "invalid", "precedence": precedence, "decision": None, "issues": [issue("target", "path_escape", str(error))]}
        if style:
            decision["style_doc"] = str(style)
            sources["style_doc"] = "nearest_style_doc"
            for key, value in parse_style_directives(style).items():
                decision[key] = value
                sources[key] = "nearest_style_doc"
    for key in ("destination_id", "path", "trim", "obsidian"):
        value = explicit.get(key)
        if value not in (None, ""):
            if key == "path":
                decision["target_path"] = str(Path(str(value)).expanduser())
                sources["target_path"] = "explicit_request"
            else:
                decision[key] = value
                sources[key] = "explicit_request"
    if explicit.get("path") and not destination:
        return {"state": "ready", "precedence": precedence, "decision": decision, "sources": sources, "candidates": candidates}
    return {"state": "ready" if destination else "needs_input", "precedence": precedence, "decision": decision, "sources": sources, "candidates": candidates}


def _ensure_safe_write_target(path: Path) -> None:
    if path.exists() and path.is_symlink():
        raise RuntimeError("target path is a symlink hazard")
    if _has_symlink_ancestor(path.parent):
        raise RuntimeError("target parent is a symlink hazard")


def write_json_atomic_verified(path: Path, document: dict[str, Any], *, expected_sha256: str | None = None) -> None:
    if expected_sha256 is not None and file_sha256(path) != expected_sha256:
        raise RuntimeError("concurrent update detected before write")
    path.parent.mkdir(parents=True, exist_ok=True)
    _ensure_safe_write_target(path)
    payload = json.dumps(document, indent=2, sort_keys=True) + "\n"
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temp_path = Path(temporary)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        if expected_sha256 is not None and file_sha256(path) != expected_sha256:
            raise RuntimeError("concurrent update detected before replace")
        os.replace(temp_path, path)
        directory_fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    except BaseException:
        temp_path.unlink(missing_ok=True)
        raise
    if path.read_text(encoding="utf-8") != payload:
        raise RuntimeError("readback did not match what was written")
