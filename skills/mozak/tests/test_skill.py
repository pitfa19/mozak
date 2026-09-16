from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / "SKILL.md"
INSTALLER = ROOT / "install.py"
TEXT = SKILL.read_text()


class SkillContractTests(unittest.TestCase):
    def test_portable_frontmatter(self) -> None:
        self.assertTrue(TEXT.startswith("---\nname: mozak\n"))
        frontmatter = TEXT.split("---", 2)[1]
        self.assertIn("description:", frontmatter)
        for trigger in (
            "onboarding", "status", "research", "planning", "next-goal",
            "packet", "execution", "evaluation", "release", "graph", "meta kb",
        ):
            self.assertIn(trigger, frontmatter.lower())

    def test_routes_cover_only_current_command_families(self) -> None:
        routes = (
            "mozak --version", "setup install HOME", "setup check HOME",
            "doctor HOME [KB_ROOT]",
            "project init", "project status", "project validate", "project release",
            "project overview", "project list", "project graph-source", "project graph",
            "project context PROJECT_ID",
            "project discover KB_ROOT WORKSPACE_ROOT [WORKSPACE_ROOT ...]",
            "project review DISCOVERY_JSON",
            "project register DISCOVERY_JSON APPROVAL_JSON",
            "project refresh DISCOVERY_JSON APPROVAL_JSON",
            "research validate RUN_JSON",
            "planning next ACCEPTED_INPUTS_JSON PLAN_JSON",
            "execution validate BUNDLE_JSON OBSERVED_REVISION OBSERVED_AT",
            "package validate PACKAGE_ROOT", "package list PACKAGE_ROOT",
            "package history validate PACKAGE_ROOT [PACKAGE_ROOT ...]",
            "meta validate META_KB_ROOT", "meta list META_KB_ROOT",
            "meta graph-source META_KB_ROOT", "meta graph META_KB_ROOT",
            "kb validate REGISTRY_ROOT", "kb list REGISTRY_ROOT",
            "kb tree REGISTRY_ROOT", "kb graph-source REGISTRY_ROOT",
            "kb graph REGISTRY_ROOT",
            "kb concept candidates TARGET_SCOPE_ID [RESEARCH_RUN_JSON ...]",
            "kb concept translation-packet TARGET_SCOPE_ID CONCEPT_ID CONCEPT_SHA256",
            "mozak kb validate", "mozak kb list", "mozak kb tree",
            "mozak kb graph-source", "mozak kb graph",
            "kb parity REGISTRY_ROOT OBSERVATIONS_JSON",
            "kb import-package PACKAGE_ROOT INPUT_REGISTRY_ROOT APPROVAL_JSON OUTPUT_KB_ROOT",
            "scope ingest-links SCOPE_ROOT SOURCE_ROOT OBSERVED_REVISION PLAN_JSON OUTPUT_ROOT",
        )
        for route in routes:
            self.assertIn(route, TEXT)
        self.assertIn("cargo run -q -p mozak-cli --", TEXT)
        self.assertIn("mozak --help", TEXT)

    def test_production_setup_is_bounded_and_honest(self) -> None:
        lower = TEXT.lower()
        for phrase in ("embedded managed skill payload", "refuses drift", "symlink/path hazards", "ready/0", "incomplete/2", "invalid/3"):
            self.assertIn(phrase, lower)
        self.assertIn("automatic trust, authority, discovery", lower)

    def test_registry_refresh_is_explicit_and_fail_closed(self) -> None:
        lower = TEXT.lower()
        for phrase in ("registration is create-only", "intent: \"project refresh\"", "entire reviewed replacement", "never auto-discovers or transfers trust", "preserve the prior config on failure"):
            self.assertIn(phrase, lower)

    def test_fresh_machine_registration_requires_exact_review_and_approval(self) -> None:
        lower = TEXT.lower()
        for phrase in (
            "run `project review`", "present the exact review json",
            "separate strict owner approval", "review is read-only",
            "action: \"none\"", "stop without requesting approval or invoking a mutation",
            "no automatic\ndiscovery, trust transfer, or mutation",
        ):
            self.assertIn(phrase, lower)

    def run_installer(self, home: Path, *args: str) -> subprocess.CompletedProcess[str]:
        environment = os.environ.copy()
        environment["HOME"] = str(home)
        return subprocess.run(
            [sys.executable, str(INSTALLER), *args],
            env=environment,
            capture_output=True,
            text=True,
        )

    def test_source_installer_is_idempotent_and_fails_closed_on_drift(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            first = self.run_installer(home)
            self.assertEqual(first.returncode, 0, first.stdout + first.stderr)
            second = self.run_installer(home)
            self.assertEqual(second.returncode, 0, second.stdout + second.stderr)
            self.assertEqual(json.loads(first.stdout), json.loads(second.stdout))
            target = home / ".agents/skills/mozak/SKILL.md"
            target.write_bytes(b"owner bytes\n")
            refused = self.run_installer(home)
            self.assertNotEqual(refused.returncode, 0)
            self.assertEqual(target.read_bytes(), b"owner bytes\n")

    def test_source_installer_refuses_symlink_and_non_regular_hazards(self) -> None:
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory() as outside_dir:
            home, outside = Path(directory), Path(outside_dir)
            (home / ".agents").symlink_to(outside, target_is_directory=True)
            result = self.run_installer(home)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(list(outside.iterdir()), [])
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            target = home / ".agents/skills/mozak/SKILL.md"
            target.mkdir(parents=True)
            result = self.run_installer(home)
            self.assertNotEqual(result.returncode, 0)
            self.assertTrue(target.is_dir())

    def test_lifecycle_routes_use_exact_implemented_signatures(self) -> None:
        signatures = (
            "mozak research validate RUN_JSON",
            "mozak planning next ACCEPTED_INPUTS_JSON PLAN_JSON",
            "mozak execution validate BUNDLE_JSON OBSERVED_REVISION OBSERVED_AT",
        )
        for signature in signatures:
            self.assertIn(f"`{signature}`", TEXT)

        rejected_shorthand = (
            "mozak research validate [PROJECT]",
            "mozak planning next [PROJECT]",
            "mozak execution validate [PROJECT]",
        )
        for shorthand in rejected_shorthand:
            self.assertNotIn(shorthand, TEXT)

    def test_fresh_agents_use_context_first_and_registration_is_owner_gated(self) -> None:
        lower = TEXT.lower()
        self.assertIn("for every fresh project request, first run", lower)
        self.assertIn("resolve exact registered ids only", lower)
        self.assertIn("present the exact review json", lower)
        self.assertIn("explicit owner approval artifact", lower)
        self.assertIn("invocation, discovery, review, setup, or general permission is not approval", lower)
        self.assertIn("atomically creates only an absent local config", lower)
        self.assertIn("never delete or replace it", lower)
        self.assertIn("compatibility-only legacy execution validation", lower)
        self.assertIn("do not treat execution bundle as the current core architecture", lower)

    def test_fresh_agents_use_configured_meta_kb_without_path_search(self) -> None:
        lower = TEXT.lower()
        self.assertIn("for “my meta kb”, “current meta kb”", lower)
        self.assertIn("run `mozak kb tree` directly", lower)
        self.assertIn("never search the filesystem for the kb path first", lower)
        self.assertIn("fail closed when the config is missing, malformed, or hash-drifted", lower)

    def test_lifecycle_routing_inspects_overview_and_observation_boundary_first(self) -> None:
        examples = TEXT.split("## Request routing examples", 1)[1].split(
            "## Bounded external-agent workflow", 1
        )[0]
        self.assertGreaterEqual(examples.count("first run `mozak project overview [PROJECT]`"), 2)
        self.assertGreaterEqual(examples.count("explicit observation boundary"), 2)
        for signature in (
            "exact argv `mozak research validate RUN_JSON`",
            "exact argv `mozak planning next ACCEPTED_INPUTS_JSON PLAN_JSON`",
        ):
            self.assertIn(signature, examples)
        self.assertIn("compatibility-only `mozak execution validate", examples)

    def test_lifecycle_routes_reject_project_shorthand(self) -> None:
        for invalid in (
            "research validate [PROJECT]",
            "planning next [PROJECT]",
            "execution validate [PROJECT]",
        ):
            self.assertNotIn(invalid, TEXT)
        self.assertGreaterEqual(TEXT.count("project overview"), 5)

    def test_mutation_gates_and_safety(self) -> None:
        lower = TEXT.lower()
        self.assertIn("before every mutation", lower)
        self.assertGreaterEqual(lower.count("explicit owner acceptance"), 2)
        self.assertIn("never overwrite", lower)
        self.assertIn("read-only routes", lower)
        self.assertIn("mutating routes", lower)
        self.assertIn("source_vault_remains_authoritative", TEXT)
        self.assertIn("never run a real pilot", lower)
        self.assertIn("exact `scope_id`", TEXT)
        self.assertIn("decision: true", TEXT)
        self.assertIn("target `kb.json` SHA-256", TEXT)
        self.assertIn("rejects exact duplicates explicitly", TEXT)
        self.assertIn("latest/official/trusted", TEXT)

    def test_rejects_unsupported_claims(self) -> None:
        lower = TEXT.lower()
        self.assertIn("does not claim autonomous research", lower)
        self.assertIn("background agents", lower)
        self.assertIn("automatic meta kb ingestion", lower)
        self.assertIn("local meta kb", lower)
        self.assertIn("does not yet implement automatic import", lower)
        self.assertIn("self-improvement", lower)

    def test_local_meta_kb_is_read_only_and_does_not_transfer_truth(self) -> None:
        lower = TEXT.lower()
        for route in (
            "mozak meta validate meta_kb_root",
            "mozak meta list meta_kb_root",
            "mozak meta graph-source meta_kb_root",
            "mozak meta graph meta_kb_root",
        ):
            self.assertIn(route, lower)
        self.assertIn("current meta kb commands are read-only", lower)
        self.assertIn("not automatically another project's truth", lower)
        self.assertIn("hosted discovery", lower)

    def test_meta_kb_transfer_is_inventory_then_target_owned_translation(self) -> None:
        lower = TEXT.lower()
        for phrase in (
            "mozak kb concept candidates target_scope_id [research_run_json ...]",
            "mozak kb concept translation-packet target_scope_id concept_id concept_sha256",
            "deterministic inventory, not a recommendation",
            "proposal_only",
            "accepted: false",
            "target must then author its own translation",
            "target-side evidence",
            "packet itself is never an adoption record",
            "not discovered by scanning",
        ):
            self.assertIn(phrase, lower)

    def test_explicit_kb_registry_never_infers_parity_or_discovers_roots(self) -> None:
        lower = TEXT.lower()
        for route in (
            "mozak kb validate registry_root",
            "mozak kb list registry_root",
            "mozak kb tree registry_root",
            "mozak kb graph-source registry_root",
            "mozak kb graph registry_root",
            "mozak kb parity registry_root observations_json",
        ):
            self.assertIn(route, lower)
        self.assertIn("never scans for unregistered roots", lower)
        self.assertIn("parity was not demonstrated", lower)
        self.assertIn("remain authoritative", lower)
        self.assertIn("must not be archived or deleted", lower)

    def test_package_routing_is_read_only_and_rejects_unsupported_authority(self) -> None:
        lower = TEXT.lower()
        for route in (
            "mozak package validate package_root",
            "mozak package list package_root",
            "mozak package history validate package_root [package_root ...]",
        ):
            self.assertIn(route, lower)
        for boundary in (
            "do not publish", "download", "choose trust",
            "transfer authority", "self-improve", "do not select a head",
        ):
            self.assertIn(boundary, lower)
        self.assertIn("import is supported only through the separate exact owner-approved", lower)
        self.assertIn("latest, official, preferred, or canonical branch", lower)

    def test_terminal_and_termaid_output_only(self) -> None:
        lower = TEXT.lower()
        self.assertIn("terminal bullet lists", lower)
        self.assertIn("fenced `text` block", lower)
        self.assertIn("never present mermaid source", lower)
        self.assertIn("never direct the user to a web dashboard", lower)

    def test_validated_project_context_is_delivered_to_agents(self) -> None:
        lower = TEXT.lower()
        self.assertIn("project overview` is the authority", lower)
        self.assertIn("read every listed `context_note`", lower)
        self.assertIn("include the relevant context-note path", lower)
        self.assertIn("not authorization", lower)


class InstallerTests(unittest.TestCase):
    def run_installer(self, home: Path, *arguments: str) -> subprocess.CompletedProcess[str]:
        environment = os.environ.copy()
        environment["HOME"] = str(home)
        return subprocess.run(
            [sys.executable, str(INSTALLER), *arguments],
            check=False, capture_output=True, text=True, env=environment,
        )

    def test_installs_to_temporary_home_and_preserves_unrelated_files(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            unrelated = home / ".agents/skills/mozak/notes.txt"
            unrelated.parent.mkdir(parents=True)
            unrelated.write_text("keep me")
            result = self.run_installer(home)
            self.assertEqual(result.returncode, 0, result.stderr)
            payload = json.loads(result.stdout)
            self.assertTrue(payload["parity"])
            self.assertEqual(unrelated.read_text(), "keep me")
            for relative in (".agents", ".jcode", ".claude", ".codex"):
                destination = home / relative / "skills/mozak"
                self.assertEqual((destination / "SKILL.md").read_bytes(), SKILL.read_bytes())

    def test_check_detects_hash_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            self.assertEqual(self.run_installer(home).returncode, 0)
            target = home / ".codex/skills/mozak/SKILL.md"
            target.write_text("changed")
            result = self.run_installer(home, "--check")
            self.assertEqual(result.returncode, 1)
            self.assertFalse(json.loads(result.stdout)["parity"])

    def test_all_installed_managed_files_have_source_hash_parity(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            result = self.run_installer(home)
            payload = json.loads(result.stdout)
            source = payload["source"]
            for hashes in payload["installed"].values():
                self.assertEqual(hashes, source)
            for name, expected in source.items():
                self.assertEqual(hashlib.sha256((ROOT / name).read_bytes()).hexdigest(), expected)


if __name__ == "__main__":
    unittest.main()
