"""Automatic updates default on without silently overriding saved opt-outs."""

import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


def load(name: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / f"scripts/{name}.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


installer = load("archive_install")
launcher = load("mozak_launcher")
BUILD = {"repository": "pitfa19/mozak"}


class AutomaticUpdateDefaultTests(unittest.TestCase):
    def test_launcher_missing_config_defaults_to_enabled_stable(self):
        with tempfile.TemporaryDirectory() as directory:
            config = launcher.load_config(Path(directory) / "missing.json", BUILD)
            self.assertTrue(config["auto_update"])
            self.assertEqual(config["channel"], "stable")
            self.assertEqual(config["check_interval_seconds"], 86400)

    def test_fresh_archive_install_defaults_to_enabled_stable(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"XDG_CONFIG_HOME": directory}):
            home = Path(directory)
            installer.configure_delivery(home, BUILD, None, None)
            config = json.loads(installer.delivery_config_path(home).read_text())
            self.assertTrue(config["auto_update"])
            self.assertEqual(config["channel"], "stable")
            self.assertEqual(config["check_interval_seconds"], 86400)

    def test_fresh_archive_explicit_disable_is_honored(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"XDG_CONFIG_HOME": directory}):
            home = Path(directory)
            installer.configure_delivery(home, BUILD, "stable", False)
            self.assertFalse(json.loads(installer.delivery_config_path(home).read_text())["auto_update"])

    def test_reinstallation_preserves_both_saved_preferences(self):
        for enabled in (False, True):
            with self.subTest(enabled=enabled), tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"XDG_CONFIG_HOME": directory}):
                home = Path(directory)
                installer.configure_delivery(home, BUILD, "main", enabled)
                path = installer.delivery_config_path(home)
                original = json.loads(path.read_text())
                original["last_checked_at"] = 123
                original["check_interval_seconds"] = 3600
                path.write_text(json.dumps(original))
                installer.configure_delivery(home, BUILD, None, None)
                self.assertEqual(json.loads(path.read_text()), original)
                self.assertEqual(launcher.load_config(path, BUILD), original)

    def test_explicit_enable_overrides_saved_opt_out(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"XDG_CONFIG_HOME": directory}):
            home = Path(directory)
            installer.configure_delivery(home, BUILD, "stable", False)
            installer.configure_delivery(home, BUILD, None, True)
            self.assertTrue(json.loads(installer.delivery_config_path(home).read_text())["auto_update"])

    def test_explicit_disable_overrides_saved_enabled_preference(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"XDG_CONFIG_HOME": directory}):
            home = Path(directory)
            installer.configure_delivery(home, BUILD, "stable", True)
            installer.configure_delivery(home, BUILD, None, False)
            self.assertFalse(json.loads(installer.delivery_config_path(home).read_text())["auto_update"])


if __name__ == "__main__":
    unittest.main()
