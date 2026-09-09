from __future__ import annotations

import hashlib
import os
import subprocess
import tarfile
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUILDER = ROOT / "scripts/build_linux_release.sh"
BINARY = ROOT / "target/release/mozak"


class LinuxReleaseBuilderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        subprocess.run(["cargo", "build", "--release", "--workspace"], cwd=ROOT, check=True)

    def test_bundle_is_normalized_complete_and_reproducible(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            outputs = []
            for name, mask in (("one", 0o002), ("two", 0o077)):
                output = root / name
                output.mkdir()
                result = subprocess.run(
                    [str(BUILDER), str(BINARY), str(output)],
                    cwd=ROOT,
                    check=True,
                    capture_output=True,
                    text=True,
                    preexec_fn=lambda mask=mask: os.umask(mask),
                )
                self.assertIn('"schema_version":1', result.stdout)
                archive = next(output.glob("*.tar.gz"))
                subprocess.run(["sha256sum", "-c", "SHA256SUMS"], cwd=output, check=True)
                outputs.append(archive)
            self.assertEqual(hashlib.sha256(outputs[0].read_bytes()).digest(), hashlib.sha256(outputs[1].read_bytes()).digest())
            with tarfile.open(outputs[0], "r:gz") as bundle:
                members = bundle.getmembers()
                names = [Path(member.name).name for member in members if member.isfile()]
                self.assertEqual(
                    names,
                    [
                        "INSTALL.md",
                        "LICENSE",
                        "README.md",
                        "build.json",
                        "install.py",
                        "launcher.py",
                        "mozak",
                        "mozak-mcp",
                    ],
                )
                for member in members:
                    self.assertEqual(member.mtime, 0)
                    self.assertEqual(member.uid, 0)
                    self.assertEqual(member.gid, 0)
                    self.assertEqual(member.uname, "")
                    self.assertEqual(member.gname, "")
                root = next(member for member in members if member.isdir())
                self.assertEqual(root.mode, 0o755)
                binary = next(member for member in members if member.name.endswith("/mozak"))
                self.assertEqual(binary.mode, 0o755)
                installer = next(member for member in members if member.name.endswith("/install.py"))
                self.assertEqual(installer.mode, 0o755)

    def test_existing_artifacts_are_not_overwritten(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            (output / "SHA256SUMS").write_text("owner bytes\n")
            result = subprocess.run([str(BUILDER), str(BINARY), str(output)], cwd=ROOT, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual((output / "SHA256SUMS").read_text(), "owner bytes\n")

    def extracted_bundle(self, root: Path) -> Path:
        output = root / "release"
        output.mkdir()
        subprocess.run([str(BUILDER), str(BINARY), str(output)], cwd=ROOT, check=True)
        archive = next(output.glob("*.tar.gz"))
        with tarfile.open(archive, "r:gz") as bundle:
            bundle.extractall(root / "extract", filter="data")
        return next((root / "extract").iterdir())

    def run_installer(self, bundle: Path, prefix: Path, home: Path) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [str(bundle / "install.py"), "--prefix", str(prefix), "--home", str(home)],
            capture_output=True,
            text=True,
        )

    def test_archive_installer_is_idempotent_and_refuses_non_mozak_launcher(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = self.extracted_bundle(root)
            prefix, home = root / "prefix", root / "home"
            prefix.mkdir(); home.mkdir()
            first = self.run_installer(bundle, prefix, home)
            self.assertEqual(first.returncode, 0, first.stderr)
            launcher = prefix / "bin/mozak"
            mcp_launcher = prefix / "bin/mozak-mcp"
            current = (prefix / "lib/mozak/current").resolve(strict=True)
            self.assertIn(b"MOZAK_MANAGED_LAUNCHER_V1", launcher.read_bytes())
            self.assertIn(b"MOZAK_MANAGED_LAUNCHER_V1", mcp_launcher.read_bytes())
            self.assertEqual((current / "mozak").read_bytes(), (bundle / "mozak").read_bytes())
            self.assertEqual((current / "mozak-mcp").read_bytes(), (bundle / "mozak-mcp").read_bytes())
            mcp = subprocess.run(
                [str(mcp_launcher)],
                input='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n',
                capture_output=True,
                text=True,
                env={**os.environ, "HOME": str(home), "MOZAK_PREFIX": str(prefix)},
            )
            self.assertEqual(mcp.returncode, 0, mcp.stderr)
            self.assertIn('"name":"mozak-mcp"', mcp.stdout)
            self.assertEqual((current / "build.json").read_bytes(), (bundle / "build.json").read_bytes())
            second = self.run_installer(bundle, prefix, home)
            self.assertEqual(second.returncode, 0, second.stderr)
            launcher.write_bytes(b"owner launcher\n")
            refused = self.run_installer(bundle, prefix, home)
            self.assertNotEqual(refused.returncode, 0)
            self.assertEqual(launcher.read_bytes(), b"owner launcher\n")

    def test_archive_installer_refuses_symlink_and_non_regular_hazards(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = self.extracted_bundle(root)
            home = root / "home"; home.mkdir()
            outside = root / "outside"; outside.mkdir()

            prefix = root / "prefix-symlink"; prefix.mkdir()
            (prefix / "bin").symlink_to(outside, target_is_directory=True)
            result = self.run_installer(bundle, prefix, home)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(list(outside.iterdir()), [])

            prefix = root / "prefix-directory"; (prefix / "bin/mozak").mkdir(parents=True)
            result = self.run_installer(bundle, prefix, home)
            self.assertNotEqual(result.returncode, 0)
            self.assertTrue((prefix / "bin/mozak").is_dir())

            prefix = root / "prefix-target-link"; (prefix / "bin").mkdir(parents=True)
            outside_binary = outside / "mozak"; outside_binary.write_bytes(b"outside\n")
            (prefix / "bin/mozak").symlink_to(outside_binary)
            result = self.run_installer(bundle, prefix, home)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(outside_binary.read_bytes(), b"outside\n")

    def test_archive_installer_requires_explicit_real_absolute_prefix_and_home(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = self.extracted_bundle(root)
            prefix, home = root / "prefix", root / "home"
            prefix.mkdir(); home.mkdir()
            linked_home = root / "linked-home"; linked_home.symlink_to(home, target_is_directory=True)
            result = self.run_installer(bundle, prefix, linked_home)
            self.assertNotEqual(result.returncode, 0)
            relative = subprocess.run(
                [str(bundle / "install.py"), "--prefix", "relative", "--home", str(home)],
                capture_output=True, text=True,
            )
            self.assertNotEqual(relative.returncode, 0)


if __name__ == "__main__":
    unittest.main()
