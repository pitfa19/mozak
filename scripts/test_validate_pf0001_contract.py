#!/usr/bin/env python3
from __future__ import annotations

import json
import shutil
import tempfile
import unittest
from pathlib import Path

from scripts.validate_pf0001_contract import CONTRACT, SPEC, ContractError, validate_contract

class PF0001ContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.spec = self.root / "spec"
        self.packets = self.root / "packets"
        shutil.copytree(SPEC, self.spec)
        self.packets.mkdir()
        for number in range(2, 9):
            packet_id = f"PF-{number:04d}"
            (self.packets / f"{packet_id}.json").write_text(
                json.dumps({"id": packet_id}) + "\n",
                encoding="utf-8",
            )
        self.contract = self.spec / "contract.json"

    def tearDown(self) -> None:
        self.temp.cleanup()

    def mutate(self, callback) -> None:
        data = json.loads(self.contract.read_text(encoding="utf-8"))
        callback(data)
        self.contract.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")

    def assert_invalid(self, message: str) -> None:
        with self.assertRaisesRegex(ContractError, message):
            validate_contract(self.contract, self.spec, self.packets)

    def test_committed_contract_is_valid(self) -> None:
        self.assertEqual(validate_contract(self.contract, self.spec, self.packets), (36, 12, 8))

    def test_undefined_packet_term_fails_closed(self) -> None:
        self.mutate(lambda d: d["packet_term_coverage"]["PF-0005"].append("magic edge"))
        self.assert_invalid("undefined normative terms.*magic edge")

    def test_invariant_without_adversarial_example_fails_closed(self) -> None:
        self.mutate(lambda d: d["invariants"][0].update(adversarial=""))
        self.assert_invalid("PF-I01.adversarial must be a non-empty string")

    def test_missing_m0_safety_lineage_fails_closed(self) -> None:
        def remove_adr(data):
            for invariant in data["invariants"]:
                invariant["preserves"] = [value for value in invariant["preserves"] if value != "ADR-0006"]
        self.mutate(remove_adr)
        self.assert_invalid("does not preserve M0 ADRs.*ADR-0006")

    def test_missing_adr_disposition_fails_closed(self) -> None:
        path = self.spec / "adr-0001-project-framework-terminology.md"
        path.write_text("\n".join(line for line in path.read_text().splitlines() if not line.startswith("| ADR-0008 ")) + "\n")
        self.assert_invalid("ADR disposition must cover exactly")

    def test_rendered_examples_must_match_catalog(self) -> None:
        self.mutate(lambda d: d["invariants"][0].update(positive="A different positive fixture."))
        self.assert_invalid("rendered examples diverge for PF-I01")

if __name__ == "__main__":
    unittest.main()
