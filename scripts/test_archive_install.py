from __future__ import annotations

import importlib.util
import json
import shutil
import stat
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("archive_install", ROOT / "scripts/archive_install.py")
archive_install = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(archive_install)

MOZAK_FILES = ["SKILL.md", "install.py", "mcp.json", "tests/test_skill.py", "evals/evals.json", "companion-recommendations.json", "tool-stack.json"]
ROOTS = [".agents", ".jcode", ".claude", ".codex"]


def managed_paths(home: Path) -> list[Path]:
    paths = []
    for root in ROOTS:
        paths.extend(home / root / "skills/mozak" / name for name in MOZAK_FILES)
        paths.append(home / root / "skills/i-have-adhd/SKILL.md")
    return paths


def write_binary(path: Path, mode: str, payload: bytes = b"new", roots: list[str] | None = None, mozak_files: list[str] | None = None) -> None:
    roots = roots or ROOTS
    mozak_files = MOZAK_FILES if mozak_files is None else mozak_files
    rels = [f"{root}/skills/mozak/{name}" for root in ROOTS for name in mozak_files]
    rels += [f"{root}/skills/i-have-adhd/SKILL.md" for root in roots]
    script = f"""#!/usr/bin/env python3
import json, pathlib, sys
home = pathlib.Path(sys.argv[3])
paths = {rels!r}
checks = [{{'path': p, 'status': 'ok'}} for p in paths]
state = pathlib.Path({str(path.parent / 'state.json')!r})
count = json.loads(state.read_text()) if state.exists() else {{'check': 0}}
if sys.argv[2] == 'check':
    count['check'] = count.get('check', 0) + 1
    state.write_text(json.dumps(count))
    if {mode!r} == 'old' or count['check'] == 2:
        print(json.dumps({{'state':'ready','checks':checks}})); sys.exit(0)
    print(json.dumps({{'state':'incomplete','checks':checks}})); sys.exit(2)
if {mode!r} == 'fail_install':
    print(json.dumps({{'state':'invalid','checks':checks}})); sys.exit(3)
if {mode!r} == 'new':
    for rel in paths:
        target = home / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes({payload!r})
    print(json.dumps({{'state':'ready','checks':checks}})); sys.exit(0)
print(json.dumps({{'state':'ready','checks':checks}})); sys.exit(0)
"""
    path.write_text(script)
    path.chmod(path.stat().st_mode | stat.S_IXUSR)


class ArchiveInstallRegressionTests(unittest.TestCase):
    def test_jcode_invocation_skills_are_managed_only_for_jcode(self) -> None:
        for name in ("swarm-low", "swarm-normal", "teacher", "mozak-jcode"):
            self.assertTrue(archive_install.allowed_managed_report_path(
                Path(".jcode/skills") / name / "SKILL.md"))
            for root in (".agents", ".claude", ".codex"):
                self.assertFalse(archive_install.allowed_managed_report_path(
                    Path(root) / "skills" / name / "SKILL.md"))
            for suffix in ("setup_jcode.py", "auth.json", "../mozak/SKILL.md"):
                self.assertFalse(archive_install.allowed_managed_report_path(
                    Path(".jcode/skills") / name / suffix))
        for path in (".jcode/config.toml", ".jcode/swarm-prompt.md", ".jcode/prompt-overlay.md", ".jcode/auth.json"):
            self.assertFalse(archive_install.allowed_managed_report_path(Path(path)))

    def test_jcode_generation_accepts_136_and_rejects_partial_or_repeated_paths(self) -> None:
        paths = []
        for root in ROOTS:
            groups = {
                "mozak": archive_install.MOZAK_MANAGED_FILENAMES,
                "i-have-adhd": archive_install.ADHD_MANAGED_FILENAMES,
                "note": archive_install.NOTE_MANAGED_FILENAMES,
                "note-healthcheck": archive_install.NOTE_HEALTHCHECK_MANAGED_FILENAMES,
                "note-voice-census": archive_install.NOTE_VOICE_CENSUS_MANAGED_FILENAMES,
                "mozak-sequence-commitment": archive_install.SEQUENCE_MANAGED_FILENAMES,
            }
            for skill, names in groups.items():
                paths.extend(str(Path(root) / "skills" / skill / name) for name in sorted(names))
        paths.extend(f".jcode/skills/{skill}/SKILL.md" for skill in sorted(archive_install.JCODE_MANAGED_SKILLS))
        report = {"checks": [{"path": path} for path in paths]}
        self.assertEqual(len(archive_install.report_paths(report, Path("/owned/home"))), 136)
        with self.assertRaises(RuntimeError):
            archive_install.report_paths({"checks": report["checks"][:-1]}, Path("/owned/home"))
        with self.assertRaises(RuntimeError):
            archive_install.report_paths({"checks": report["checks"][:-1] + [report["checks"][0]]}, Path("/owned/home"))

    def test_sequence_companion_exact_paths_are_managed(self) -> None:
        for root in ROOTS:
            for name in ("SKILL.md", "scripts/check_sequence.py", "tests/test_sequence.py"):
                self.assertTrue(archive_install.allowed_managed_report_path(
                    Path(root) / "skills/mozak-sequence-commitment" / name))
            for name in ("secret.json", "scripts/other.py", "../mozak/SKILL.md"):
                self.assertFalse(archive_install.allowed_managed_report_path(
                    Path(root) / "skills/mozak-sequence-commitment" / name))
        self.assertFalse(archive_install.allowed_managed_report_path(
            Path("/tmp/.jcode/skills/mozak-sequence-commitment/SKILL.md")))

    def test_sequence_generation_report_keeps_exact_scope(self) -> None:
        paths = []
        for root in ROOTS:
            groups = {
                "mozak": archive_install.MOZAK_MANAGED_FILENAMES,
                "i-have-adhd": archive_install.ADHD_MANAGED_FILENAMES,
                "note": archive_install.NOTE_MANAGED_FILENAMES,
                "note-healthcheck": archive_install.NOTE_HEALTHCHECK_MANAGED_FILENAMES,
                "note-voice-census": archive_install.NOTE_VOICE_CENSUS_MANAGED_FILENAMES,
                "mozak-sequence-commitment": archive_install.SEQUENCE_MANAGED_FILENAMES,
            }
            for skill, names in groups.items():
                paths.extend(str(Path(root) / "skills" / skill / name) for name in sorted(names))
        report = {"checks": [{"path": path} for path in paths]}
        self.assertEqual(len(archive_install.report_paths(report, Path("/owned/home"))), 132)
        report["checks"].pop()
        with self.assertRaises(RuntimeError):
            archive_install.report_paths(report, Path("/owned/home"))

    def test_failed_upgrade_preserves_preexisting_new_companion(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            old_path = home / ".jcode/skills/mozak/SKILL.md"
            new_path = home / ".jcode/skills/mozak-sequence-commitment/SKILL.md"
            for path, data in ((old_path, b"old managed bytes"), (new_path, b"owner companion bytes")):
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
            observations = [
                (SimpleNamespace(returncode=2), {"state": "incomplete"}),
                (SimpleNamespace(returncode=0), {"state": "ready"}),
                (SimpleNamespace(returncode=3), {"state": "invalid"}),
            ]
            with mock.patch.object(archive_install, "setup_report", side_effect=observations), \
                 mock.patch.object(archive_install, "report_paths", side_effect=[[old_path, new_path], [old_path]]):
                with self.assertRaises(RuntimeError):
                    archive_install.migrate_skills(Path("old-binary"), Path("new-binary"), home)
            self.assertEqual(old_path.read_bytes(), b"old managed bytes")
            self.assertEqual(new_path.read_bytes(), b"owner companion bytes")

    def test_catalog_upgrade_and_offline_rollback_preserve_payload_generations(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            home = root / "home"
            home.mkdir()
            old = root / "old"
            new = root / "new"
            old.mkdir()
            new.mkdir()
            legacy_files = [name for name in MOZAK_FILES if name != "tool-stack.json"]
            write_binary(old / "mozak", "old", b"old-bytes", mozak_files=legacy_files)
            write_binary(new / "mozak", "new", b"new-bytes")
            old_paths = [path for path in managed_paths(home) if path.name != "tool-stack.json"]
            for path in old_paths:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b"old-bytes")
            backup = archive_install.migrate_skills(old / "mozak", new / "mozak", home)
            self.assertTrue(all(path.read_bytes() == b"new-bytes" for path in managed_paths(home)))
            archive_install.restore_files(backup, managed_paths(home))
            self.assertTrue(all(path.read_bytes() == b"old-bytes" for path in old_paths))
            self.assertTrue(all(not (home / host / "skills/mozak/tool-stack.json").exists() for host in ROOTS))

    def test_migration_accepts_real_adhd_skill_directories(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); home = root / "home"; home.mkdir()
            old = root / "old"; new = root / "new"; old.mkdir(); new.mkdir()
            write_binary(old / "mozak", "old", b"old-bytes")
            write_binary(new / "mozak", "new", b"new-bytes")
            for path in managed_paths(home):
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b"old-bytes")

            archive_install.migrate_skills(old / "mozak", new / "mozak", home)

            self.assertTrue(all(path.read_bytes() == b"new-bytes" for path in managed_paths(home)))
            self.assertFalse((home / ".claude/skills/i-have-adhd").is_symlink())

    def test_first_install_failure_preserves_pre_existing_skill_bytes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); home = root / "home"; home.mkdir()
            old_bytes = {}
            for path in managed_paths(home):
                path.parent.mkdir(parents=True, exist_ok=True)
                data = b"matching-mozak" if "mozak" in path.parts and "i-have-adhd" not in path.parts else b"drifted-adhd"
                path.write_bytes(data); old_bytes[path] = data
            new = root / "new"; new.mkdir(); write_binary(new / "mozak", "fail_install", b"new-bytes")
            with self.assertRaises(RuntimeError):
                archive_install.migrate_skills(None, new / "mozak", home)
            self.assertEqual({p: p.read_bytes() for p in old_bytes}, old_bytes)

    def test_failed_activation_after_migration_restores_old_skill_payload(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); home = root / "home"; prefix = root / "prefix"
            home.mkdir(); (prefix / "lib/mozak/versions").mkdir(parents=True); (prefix / "bin").mkdir(parents=True)
            old = prefix / "lib/mozak/versions/old"; new = root / "new"; old.mkdir(); new.mkdir()
            for version, build_id in ((old, "old"), (new, "new")):
                (version / "build.json").write_text(json.dumps({'schema_version':1,'build_id':build_id,'version':'v','revision':'0'*40,'channel':'stable','platform':'linux-x86_64','repository':'repo'}))
                (version / "mozak-mcp").write_bytes(b"mcp")
                (version / "install.py").write_bytes(b"install")
                (version / "launcher.py").write_bytes(b"MOZAK_MANAGED_LAUNCHER_V1")
            write_binary(old / "mozak", "old", b"old-bytes"); write_binary(new / "mozak", "new", b"new-bytes")
            for path in managed_paths(home):
                path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(b"old-bytes")
            (prefix / "lib/mozak/current").symlink_to("versions/old")
            (prefix / "bin/mozak").write_bytes(b"MOZAK_MANAGED_LAUNCHER_V1 old")
            (prefix / "bin/mozak-mcp").write_bytes(b"MOZAK_MANAGED_LAUNCHER_V1 old")
            with self.assertRaises(RuntimeError):
                archive_install.activate(new, prefix, home, None, None, None, None, None)
            self.assertEqual((prefix / "lib/mozak/current").resolve(), old.resolve())
            self.assertTrue(all(path.read_bytes() == b"old-bytes" for path in managed_paths(home)))

    def test_failed_activation_restores_legacy_adhd_alias_and_target_bytes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); home = root / "home"; prefix = root / "prefix"
            home.mkdir(); (prefix / "lib/mozak/versions").mkdir(parents=True); (prefix / "bin").mkdir(parents=True)
            old = prefix / "lib/mozak/versions/old"; new = root / "new"; old.mkdir(); new.mkdir()
            for version, build_id in ((old, "old"), (new, "new")):
                (version / "build.json").write_text(json.dumps({'schema_version':1,'build_id':build_id,'version':'v','revision':'0'*40,'channel':'stable','platform':'linux-x86_64','repository':'repo'}))
                (version / "mozak-mcp").write_bytes(b"mcp")
                (version / "install.py").write_bytes(b"install")
                (version / "launcher.py").write_bytes(b"MOZAK_MANAGED_LAUNCHER_V1")
            write_binary(old / "mozak", "old", b"old-bytes")
            write_binary(new / "mozak", "new", b"new-bytes")
            for path in managed_paths(home):
                if ".claude" in path.parts and "i-have-adhd" in path.parts:
                    continue
                path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(b"old-bytes")
            alias = home / ".claude/skills/i-have-adhd"
            alias.parent.mkdir(parents=True, exist_ok=True)
            alias.symlink_to(home / ".agents/skills/i-have-adhd")
            (prefix / "lib/mozak/current").symlink_to("versions/old")
            (prefix / "bin/mozak").write_bytes(b"MOZAK_MANAGED_LAUNCHER_V1 old")
            (prefix / "bin/mozak-mcp").write_bytes(b"MOZAK_MANAGED_LAUNCHER_V1 old")
            with self.assertRaises(RuntimeError):
                archive_install.activate(new, prefix, home, None, None, None, None, None)
            self.assertTrue(alias.is_symlink())
            self.assertEqual(alias.resolve(strict=True), (home / ".agents/skills/i-have-adhd").resolve(strict=True))
            self.assertEqual((home / ".agents/skills/i-have-adhd/SKILL.md").read_bytes(), b"old-bytes")

    def test_archive_migration_refuses_malicious_external_and_different_aliases(self) -> None:
        cases = [
            (".claude/skills/i-have-adhd", "outside/i-have-adhd"),
            (".jcode/skills/i-have-adhd", "home/.agents/skills/i-have-adhd"),
            (".claude/skills/mozak", "home/.agents/skills/mozak"),
        ]
        for alias_rel, target_rel in cases:
            with self.subTest(alias=alias_rel, target=target_rel):
                with tempfile.TemporaryDirectory() as directory:
                    root = Path(directory); home = root / "home"; home.mkdir()
                    old = root / "old"; new = root / "new"; old.mkdir(); new.mkdir()
                    write_binary(old / "mozak", "old", b"old-bytes")
                    write_binary(new / "mozak", "new", b"new-bytes")
                    for path in managed_paths(home):
                        path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(b"old-bytes")
                    alias = home / alias_rel
                    if alias.exists() and not alias.is_symlink():
                        if alias.is_dir():
                            shutil.rmtree(alias)
                        else:
                            alias.unlink()
                    target = root / target_rel
                    target.mkdir(parents=True, exist_ok=True)
                    alias.symlink_to(target)
                    with self.assertRaises(RuntimeError):
                        archive_install.migrate_skills(old / "mozak", new / "mozak", home)


class JcodeCustodyTests(unittest.TestCase):
    def test_custody_roundtrip_and_invalid_records_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            old, new = home / "old-build", home / "new-build"
            skill = home / ".jcode/skills/swarm-low/SKILL.md"
            skill.parent.mkdir(parents=True)
            skill.write_bytes(b"owner profile")
            missing = home / ".jcode/skills/teacher/SKILL.md"
            expected = {skill, missing}
            raw = archive_install.custody_record(old, new, home, expected)
            receipt = home / "custody.json"
            receipt.write_bytes(raw)
            restored = archive_install.load_custody(receipt, new, old, home, expected)
            self.assertEqual(restored[skill][1], b"owner profile")
            self.assertEqual(restored[missing][0], "absent")
            for mutation in ("home", "hash", "duplicate", "escape", "coverage", "type"):
                record = json.loads(raw)
                if mutation == "home":
                    record["home_sha256"] = "0" * 64
                elif mutation == "hash":
                    next(item for item in record["files"] if item["kind"] == "file")["sha256"] = "0" * 64
                elif mutation == "duplicate":
                    record["files"].append(record["files"][0])
                elif mutation == "escape":
                    record["files"][0]["path"] = "../outside"
                elif mutation == "coverage":
                    record["files"].pop()
                else:
                    record = []
                receipt.write_text(json.dumps(record))
                with self.assertRaises(RuntimeError):
                    archive_install.load_custody(receipt, new, old, home, expected)
            self.assertEqual(skill.read_bytes(), b"owner profile")


if __name__ == "__main__":
    unittest.main()
