import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/check_sequence.py"
spec = importlib.util.spec_from_file_location("check_sequence", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CompletionTests(unittest.TestCase):
    def setUp(self):
        self.contract = {"sequence_id": "approved-five", "requirements": [
            {"id": str(i), "checks": [{"id": "accept", "real_required": True}]}
            for i in range(1, 6)]}
        self.data = json.dumps(self.contract).encode()
        self.checkpoint = {"sequence_id": "approved-five",
                           "contract_sha256": hashlib.sha256(self.data).hexdigest(),
                           "requirements": [
                               {"id": str(i), "status": "verified", "checks": [
                                   {"id": "accept", "passed": True, "observation": "real",
                                    "evidence": "observed public-interface result"}]}
                               for i in range(1, 6)]}

    def audit(self):
        return module.audit(self.data, self.contract, self.checkpoint)

    def test_all_original_checks_required(self):
        self.assertEqual(self.audit()["state"], "declared_complete")

    def test_genome_candidate_is_not_the_five_step_finish(self):
        for item in self.checkpoint["requirements"][2:4]:
            item["status"] = "pending"
        self.checkpoint["requirements"][4]["status"] = "blocked"
        self.assertEqual(self.audit()["remaining"], ["3", "4", "5"])

    def test_dropped_scope_is_invalid(self):
        self.checkpoint["requirements"].pop()
        with self.assertRaises(ValueError):
            self.audit()

    def test_cancelled_and_deferred_do_not_close(self):
        for status in ("cancelled", "deferred", "completed"):
            self.checkpoint["requirements"][0]["status"] = status
            with self.assertRaises(ValueError):
                self.audit()

    def test_substituted_parent_invalid(self):
        self.checkpoint["sequence_id"] = "candidate-only"
        with self.assertRaises(ValueError):
            self.audit()

    def test_contract_drift_invalid(self):
        self.data += b" "
        with self.assertRaises(ValueError):
            self.audit()

    def test_synthetic_and_inspection_cannot_replace_real(self):
        for kind in ("synthetic", "inspection"):
            self.checkpoint["requirements"][0]["checks"][0]["observation"] = kind
            self.assertIn("1:accept", self.audit()["remaining"])

    def test_failed_or_unreferenced_checks_incomplete(self):
        check = self.checkpoint["requirements"][0]["checks"][0]
        for change in ({"passed": False}, {"evidence": ""}, {"passed": 1}):
            previous = copy.deepcopy(check)
            check.update(change)
            self.assertIn("1:accept", self.audit()["remaining"])
            check.clear()
            check.update(previous)

    def test_missing_checks_invalid(self):
        self.checkpoint["requirements"][0]["checks"] = []
        with self.assertRaises(ValueError):
            self.audit()

    def test_duplicate_json_keys_invalid(self):
        with self.assertRaises(ValueError):
            json.loads('{"id":1,"id":2}', object_pairs_hook=module.unique_object)

    def test_real_cli_exit_codes_and_no_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            contract = Path(directory) / "contract.json"
            checkpoint = Path(directory) / "checkpoint.json"
            contract.write_bytes(self.data)
            for incomplete, expected in ((False, 0), (True, 2)):
                self.checkpoint["requirements"][4]["status"] = "blocked" if incomplete else "verified"
                checkpoint.write_text(json.dumps(self.checkpoint))
                before = (contract.read_bytes(), checkpoint.read_bytes())
                result = subprocess.run([sys.executable, str(SCRIPT), str(contract), str(checkpoint)],
                                        capture_output=True, text=True, timeout=3)
                self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
                self.assertEqual(before, (contract.read_bytes(), checkpoint.read_bytes()))
            contract.unlink()
            contract.symlink_to(checkpoint)
            result = subprocess.run([sys.executable, str(SCRIPT), str(contract), str(checkpoint)],
                                    capture_output=True, timeout=3)
            self.assertEqual(result.returncode, 3)

    def test_policy_covers_semantic_trigger_and_partial_blocker(self):
        text = (ROOT / "SKILL.md").read_text()
        for phrase in ("Synonyms and misspellings", "NOT execution authorization",
                       "A blocker on one branch", "forced session interruption",
                       "Only the owner", "cannot substitute", "cannot authenticate"):
            self.assertIn(phrase, text)


if __name__ == "__main__":
    unittest.main()
