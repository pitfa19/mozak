#!/usr/bin/env python3
"""Validate the delivery GitHub Actions workflows without invoking GitHub."""

from __future__ import annotations

import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CI = ROOT / ".github/workflows/ci.yml"
RELEASE = ROOT / ".github/workflows/release.yml"


def load(path: Path) -> dict:
    try:
        import yaml
    except ImportError:
        return {}
    return yaml.safe_load(path.read_text(encoding="utf-8"))


class WorkflowTests(unittest.TestCase):
    def test_workflows_exist_and_parse(self) -> None:
        for path in (CI, RELEASE):
            self.assertTrue(path.is_file(), path)
            value = load(path)
            if value:
                self.assertIn("jobs", value)
                self.assertTrue(value["jobs"])

    def test_ci_runs_delivery_and_package_acceptance(self) -> None:
        text = CI.read_text(encoding="utf-8")
        for command in (
            "cargo fmt --all -- --check",
            "cargo clippy --workspace --all-targets -- -D warnings",
            "cargo test --workspace",
            "python3 -m unittest discover -s scripts -p 'test_*.py'",
            "python3 scripts/test_fresh_machine_release.py target/release/mozak",
            "python3 scripts/test_delivery_update.py target/release/mozak",
            "python3 scripts/test_github_bootstrap.py target/release/mozak",
        ):
            self.assertIn(command, text, command)
        self.assertIn("permissions:\n  contents: read", text)

    def test_release_publishes_both_channels_with_verified_version(self) -> None:
        text = RELEASE.read_text(encoding="utf-8")
        self.assertIn("tags: ['v*.*.*']", text)
        self.assertIn("branches: [main]", text)
        self.assertIn("x86_64-unknown-linux-musl", text)
        self.assertIn("does not match Cargo version", text)
        self.assertIn("sha256sum -c SHA256SUMS", text)
        self.assertIn("gh release create \"$GITHUB_REF_NAME\" dist/* --verify-tag", text)
        self.assertIn("gh release create main dist/*", text)
        self.assertIn("--prerelease", text)
        # The rolling release must name its commit rather than relying on tag
        # propagation, which raced and failed in run 34077926006.
        self.assertIn('--target "$GITHUB_SHA"', text)
        self.assertIn("permissions:\n  contents: write", text)

    def test_release_shell_snippets_are_syntactically_valid(self) -> None:
        text = RELEASE.read_text(encoding="utf-8")
        blocks = re.findall(r"run: \|\n((?:[ ]{10}.*\n|\n)+)", text)
        self.assertTrue(blocks)
        for block in blocks:
            script = "".join(line[10:] if line.startswith(" " * 10) else line for line in block.splitlines(keepends=True))
            script = re.sub(r"\$\{\{[^}]*\}\}", "placeholder", script)
            result = subprocess.run(["bash", "-n"], input=script, text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, f"{script}\n{result.stderr}")

    def test_release_version_extraction_matches_cargo(self) -> None:
        script = 'sed -n \'s/^version = "\\(.*\\)"$/\\1/p\' crates/mozak-cli/Cargo.toml | head -1'
        result = subprocess.run(["bash", "-c", script], cwd=ROOT, capture_output=True, text=True, check=True)
        extracted = result.stdout.strip()
        binary = subprocess.run([ROOT / "target/release/mozak", "--version"], capture_output=True, text=True)
        if binary.returncode == 0:
            self.assertEqual(binary.stdout.strip(), f"mozak {extracted}")
        self.assertRegex(extracted, r"^\d+\.\d+\.\d+$")


if __name__ == "__main__":
    unittest.main()
