#!/usr/bin/env python3
"""Validate the normative PF-0001 terminology, invariants, examples, and ADR disposition."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
SPEC = ROOT / "spec" / "project-framework"
CONTRACT = SPEC / "contract.json"
PACKETS = ROOT / ".mozak" / "planning" / "packets"
EXPECTED_PACKETS = {f"PF-{number:04d}" for number in range(2, 9)}
EXPECTED_ADRS = {f"ADR-{number:04d}" for number in range(1, 9)}
INVARIANT_ID = re.compile(r"^PF-I[0-9]{2}$")
NORMATIVE_WORD = re.compile(r"\b(?:MUST|MUST NOT|REQUIRED|SHALL|SHALL NOT)\b")

class ContractError(ValueError):
    pass

def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ContractError(f"{path}: {error}") from error

def nonempty(value: Any, where: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ContractError(f"{where} must be a non-empty string")
    return value.strip()

def validate_contract(contract_path: Path = CONTRACT, spec_root: Path = SPEC, packets_root: Path = PACKETS) -> tuple[int, int, int]:
    data = load_json(contract_path)
    if not isinstance(data, dict) or set(data) != {"version", "normative_language", "terms", "packet_term_coverage", "invariants"}:
        raise ContractError("contract must contain exactly version, normative_language, terms, packet_term_coverage, and invariants")
    if data["version"] != 1 or isinstance(data["version"], bool):
        raise ContractError("contract version must be 1")
    nonempty(data["normative_language"], "normative_language")

    terms = data["terms"]
    if not isinstance(terms, list) or not terms:
        raise ContractError("terms must be a non-empty list")
    definitions: dict[str, str] = {}
    folded: set[str] = set()
    for index, entry in enumerate(terms):
        if not isinstance(entry, dict) or set(entry) != {"term", "definition"}:
            raise ContractError(f"terms[{index}] must contain exactly term and definition")
        term = nonempty(entry["term"], f"terms[{index}].term")
        definition = nonempty(entry["definition"], f"terms[{index}].definition")
        key = term.casefold()
        if key in folded:
            raise ContractError(f"duplicate normative term {term!r}")
        folded.add(key)
        definitions[term] = definition

    coverage = data["packet_term_coverage"]
    if not isinstance(coverage, dict) or set(coverage) != EXPECTED_PACKETS:
        raise ContractError(f"packet term coverage must contain exactly {sorted(EXPECTED_PACKETS)}")
    for packet_id, used_terms in coverage.items():
        packet = load_json(packets_root / f"{packet_id}.json")
        if packet.get("id") != packet_id:
            raise ContractError(f"{packet_id} packet is missing or mismatched")
        if not isinstance(used_terms, list) or not used_terms or len(used_terms) != len(set(used_terms)):
            raise ContractError(f"{packet_id} term coverage must be a non-empty unique list")
        undefined = sorted(set(used_terms) - set(definitions))
        if undefined:
            raise ContractError(f"{packet_id} uses undefined normative terms {undefined}")

    invariants = data["invariants"]
    if not isinstance(invariants, list) or not invariants:
        raise ContractError("invariants must be a non-empty list")
    invariant_ids: set[str] = set()
    preserved_adrs: set[str] = set()
    required_fields = {"id", "title", "rule", "preserves", "positive", "adversarial"}
    for index, invariant in enumerate(invariants):
        if not isinstance(invariant, dict) or set(invariant) != required_fields:
            raise ContractError(f"invariants[{index}] has invalid fields")
        invariant_id = nonempty(invariant["id"], f"invariants[{index}].id")
        if not INVARIANT_ID.fullmatch(invariant_id) or invariant_id in invariant_ids:
            raise ContractError(f"invalid or duplicate invariant id {invariant_id!r}")
        invariant_ids.add(invariant_id)
        nonempty(invariant["title"], f"{invariant_id}.title")
        rule = nonempty(invariant["rule"], f"{invariant_id}.rule")
        if not NORMATIVE_WORD.search(rule):
            raise ContractError(f"{invariant_id}.rule lacks normative language")
        positive = nonempty(invariant["positive"], f"{invariant_id}.positive")
        adversarial = nonempty(invariant["adversarial"], f"{invariant_id}.adversarial")
        if positive == adversarial:
            raise ContractError(f"{invariant_id} positive and adversarial examples must differ")
        preserves = invariant["preserves"]
        if not isinstance(preserves, list) or not preserves or len(preserves) != len(set(preserves)):
            raise ContractError(f"{invariant_id}.preserves must be a non-empty unique list")
        unknown = set(preserves) - EXPECTED_ADRS
        if unknown:
            raise ContractError(f"{invariant_id} references unknown M0 ADRs {sorted(unknown)}")
        preserved_adrs.update(preserves)
    if preserved_adrs != EXPECTED_ADRS:
        raise ContractError(f"invariant catalog does not preserve M0 ADRs {sorted(EXPECTED_ADRS - preserved_adrs)}")

    glossary = (spec_root / "glossary.md").read_text(encoding="utf-8")
    invariant_doc = (spec_root / "invariants.md").read_text(encoding="utf-8")
    examples_doc = (spec_root / "examples.md").read_text(encoding="utf-8")
    adr_doc = (spec_root / "adr-0001-project-framework-terminology.md").read_text(encoding="utf-8")
    for term in definitions:
        if f"**{term}**" not in glossary:
            raise ContractError(f"glossary rendering omits term {term!r}")
    for invariant in invariants:
        iid = invariant["id"]
        if iid not in invariant_doc or f"### {iid}:" not in examples_doc:
            raise ContractError(f"rendered invariant documents omit {iid}")
        if invariant["positive"] not in examples_doc or invariant["adversarial"] not in examples_doc:
            raise ContractError(f"rendered examples diverge for {iid}")
    disposition_ids = set(re.findall(r"^\| (ADR-[0-9]{4})\b", adr_doc, flags=re.MULTILINE))
    if disposition_ids != EXPECTED_ADRS:
        raise ContractError(f"ADR disposition must cover exactly {sorted(EXPECTED_ADRS)}")
    if "brain" not in adr_doc.casefold() or "Project Framework" not in adr_doc:
        raise ContractError("ADR must explicitly reconcile brain-first and Project Framework terminology")

    return len(definitions), len(invariants), len(disposition_ids)

def main() -> int:
    try:
        terms, invariants, dispositions = validate_contract()
    except (ContractError, OSError) as error:
        print(f"PF-0001 contract invalid: {error}", file=sys.stderr)
        return 1
    print(f"validated PF-0001 contract: {terms} terms, {invariants} invariants, {dispositions} M0 ADR dispositions")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
