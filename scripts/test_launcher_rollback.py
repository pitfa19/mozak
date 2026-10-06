"""Rollback must use the installer that understands the active payload."""

import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("mozak_launcher", ROOT / "scripts/mozak_launcher.py")
launcher = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(launcher)


class RollbackGenerationTests(unittest.TestCase):
    def test_rollback_uses_active_installer_to_activate_predecessor(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            prefix = Path(directory) / "prefix"
            home = Path(directory) / "home"
            home.mkdir()
            root = prefix / "lib/mozak"
            versions = root / "versions"
            old, new = versions / "old", versions / "new"
            old.mkdir(parents=True)
            new.mkdir()
            (old / "build.json").write_text(json.dumps({
                "schema_version": 1, "build_id": "old", "version": "0.7.1",
                "revision": "1" * 40, "channel": "stable",
                "platform": "linux-x86_64", "repository": "pitfa19/mozak",
            }))
            (root / "previous").symlink_to("versions/old")
            (root / "current").symlink_to("versions/new")
            result = subprocess.CompletedProcess([], 0, "restored old payload", "")
            with patch.object(launcher.subprocess, "run", return_value=result) as invoke:
                self.assertEqual(launcher.rollback(prefix, home), 0)
            argv = invoke.call_args.args[0]
            self.assertEqual(argv[1], str(new / "install.py"))
            self.assertEqual(argv[-2:], ["--activate-existing", "old"])


if __name__ == "__main__":
    unittest.main()
