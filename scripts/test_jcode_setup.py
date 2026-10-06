"""Supplementary installer fault checks plus real CLI lock/drift acceptance."""
from __future__ import annotations

import fcntl
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("jcode_setup", ROOT / "skills/mozak-jcode/setup_jcode.py")
SETUP = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SETUP)


def payload():
    result = {f".jcode/skills/{name}/SKILL.md": (ROOT / f"skills/{name}/SKILL.md").read_text() for name in ("swarm-low", "swarm-normal", "teacher", "mozak-jcode")}
    for name in ("swarm-prompt.md", "prompt-overlay.md"):
        result[f".jcode/{name}"] = (ROOT / f"skills/mozak-jcode/{name}").read_text()
    return result


class JcodeSafety(unittest.TestCase):
    def test_read_only_preflight_and_backup_corruption(self):
        with tempfile.TemporaryDirectory() as folder:
            home = Path(folder)
            SETUP.preflight(home, payload())
            self.assertEqual(list(home.iterdir()), [])
            root = home / ".jcode"
            root.mkdir()
            old = b"[other]\nkeep = true\n"
            (root / "config.toml").write_bytes(old)
            backup = root / "settings-backups/mozak-agent-work" / SETUP.digest(old)
            backup.parent.mkdir(parents=True)
            backup.write_bytes(b"corrupt")
            before = SETUP.preflight(home, payload())
            with self.assertRaises(ValueError):
                SETUP.install(home, payload(), before)
            self.assertEqual((root / "config.toml").read_bytes(), old)
            self.assertFalse((root / "skills").exists())

    def test_partial_commit_failure_rolls_back_real_files(self):
        with tempfile.TemporaryDirectory() as folder:
            home = Path(folder)
            root = home / ".jcode"
            root.mkdir()
            old = b"# owner\n[other]\nkeep = true\n"
            (root / "config.toml").write_bytes(old)
            before = SETUP.preflight(home, payload())
            real = SETUP.atomic
            calls = 0

            def fail_once(path, data, mode=0o600):
                nonlocal calls
                if "settings-backups" not in path.parts:
                    calls += 1
                    if calls == 3:
                        raise OSError("injected commit failure")
                return real(path, data, mode)

            with patch.object(SETUP, "atomic", side_effect=fail_once):
                with self.assertRaises(OSError):
                    SETUP.install(home, payload(), before)
            for path, original, _ in before:
                self.assertEqual(SETUP.read(path), original)
            self.assertEqual((root / "config.toml").read_bytes(), old)

    def test_changed_preflight_is_refused(self):
        with tempfile.TemporaryDirectory() as folder:
            home = Path(folder)
            expected = SETUP.preflight(home, payload())
            (home / ".jcode").mkdir()
            (home / ".jcode/config.toml").write_bytes(b"[other]\nowner_edit = true\n")
            with self.assertRaises(ValueError):
                SETUP.install(home, payload(), expected)
            self.assertFalse((home / ".jcode/skills").exists())

    def test_wrong_types_and_complex_owned_fields_are_refused(self):
        for text in (b"[provider]\nsame_provider_account_failover = 1\n", b"[provider]\ndefault_model = '''multi\nline'''\n"):
            with self.assertRaises(ValueError):
                SETUP.merge_config(text)

    def test_existing_overlay_block_drift_refused(self):
        value = payload()[".jcode/prompt-overlay.md"].encode()
        original = b"Owner prose\n"
        merged = SETUP.merge_overlay(original, value)
        self.assertTrue(merged.startswith(original))
        self.assertEqual(SETUP.merge_overlay(merged, value), merged)
        with self.assertRaises(ValueError):
            SETUP.merge_overlay(merged.replace(b"Teacher mode is OFF", b"Teacher mode is ON"), value)

    def test_actual_cli_locked_install_has_no_target_writes(self):
        binary = ROOT / "target/debug/mozak"
        if not binary.exists():
            self.skipTest("real CLI not built, Rust public acceptance still covers CLI")
        with tempfile.TemporaryDirectory() as folder:
            home = Path(folder)
            root = home / ".jcode"
            root.mkdir()
            with (root / "mozak-agent-work.lock").open("wb") as lock:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                result = subprocess.run([binary, "setup", "jcode", "install", str(home)], capture_output=True, text=True)
                self.assertEqual(result.returncode, 3, result.stderr)
                self.assertEqual(json.loads(result.stdout)["state"], "invalid")
                self.assertFalse((root / "skills").exists())
                self.assertFalse((root / "config.toml").exists())


if __name__ == "__main__":
    unittest.main()
