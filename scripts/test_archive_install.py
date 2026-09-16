from __future__ import annotations

import importlib.util
import json
import shutil
import stat
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("archive_install", ROOT / "scripts/archive_install.py")
archive_install = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(archive_install)

MOZAK_FILES = ["SKILL.md", "install.py", "mcp.json", "tests/test_skill.py", "evals/evals.json", "companion-recommendations.json"]
ROOTS = [".agents", ".jcode", ".claude", ".codex"]


def managed_paths(home: Path) -> list[Path]:
    paths = []
    for root in ROOTS:
        paths.extend(home / root / "skills/mozak" / name for name in MOZAK_FILES)
        paths.append(home / root / "skills/i-have-adhd/SKILL.md")
    return paths


def write_binary(path: Path, mode: str, payload: bytes = b"new", roots: list[str] | None = None) -> None:
    roots = roots or ROOTS
    rels = [f"{root}/skills/mozak/{name}" for root in ROOTS for name in MOZAK_FILES]
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


if __name__ == "__main__":
    unittest.main()
