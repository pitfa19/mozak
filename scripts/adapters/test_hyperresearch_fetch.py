"""Tests for the HyperResearch adapter's request handling and retention.

The vault CLI is not invoked, so these tests cover the adapter's own logic:
which requests it refuses, which notes it selects, and what it refuses to
retain out of a note it did select.
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import hyperresearch_fetch as adapter  # noqa: E402


def vault() -> Path:
    """A real vault shape: its config marker plus its research directory."""
    root = Path(tempfile.mkdtemp())
    (root / "research" / "notes").mkdir(parents=True)
    (root / ".hyperresearch").mkdir()
    return root


def write(value: dict) -> Path:
    path = Path(tempfile.mkdtemp()) / "request.json"
    path.write_text(json.dumps(value))
    return path


def request(**overrides) -> dict:
    value = {
        "schema_version": 1,
        "scope_id": "topic-test",
        "vault_root": str(vault()),
        "select": {"note_ids": [], "tags": []},
        "max_records": 10,
        "question": "what did the harness read?",
    }
    value.update(overrides)
    return value


def note(**overrides) -> dict:
    value = {
        "id": "somenote",
        "title": "A Source",
        "source": "https://example.org/a",
        "body": "the full fetched text of a third-party page",
        "word_count": 7,
        "status": "draft",
        "created": "2026-09-14T00:00:00+00:00",
        "tags": [],
    }
    value.update(overrides)
    return value


class RequestValidation(unittest.TestCase):
    def test_accepts_a_well_formed_request(self):
        loaded = adapter.load_request(write(request()))
        self.assertEqual(loaded["scope_id"], "topic-test")
        self.assertEqual(loaded["max_records"], 10)

    def test_rejects_a_vault_that_is_not_a_vault(self):
        empty = Path(tempfile.mkdtemp())
        with self.assertRaises(adapter.AdapterError) as caught:
            adapter.load_request(write(request(vault_root=str(empty))))
        self.assertIn("not a hyperresearch vault", str(caught.exception))

    def test_rejects_a_lookalike_directory_without_the_vault_marker(self):
        # A bare `research/` folder is not a vault. Accepting one made the CLI
        # fail later with its own traceback instead of a usable message.
        lookalike = Path(tempfile.mkdtemp())
        (lookalike / "research").mkdir()
        with self.assertRaises(adapter.AdapterError) as caught:
            adapter.load_request(write(request(vault_root=str(lookalike))))
        self.assertIn("hyperresearch init", str(caught.exception))

    def test_rejects_a_relative_vault_root(self):
        with self.assertRaises(adapter.AdapterError) as caught:
            adapter.load_request(write(request(vault_root="relative/vault")))
        self.assertIn("absolute", str(caught.exception))

    def test_rejects_unknown_fields_and_wrong_schema(self):
        with self.assertRaises(adapter.AdapterError):
            adapter.load_request(write(request(retain_bodies=True)))
        with self.assertRaises(adapter.AdapterError):
            adapter.load_request(write(request(schema_version=2)))

    def test_rejects_an_unsafe_note_id_or_tag(self):
        # A selector becomes a lookup key. Anything path-shaped in it would let
        # a request reach outside the notes the vault exported.
        with self.assertRaises(adapter.AdapterError) as caught:
            adapter.load_request(
                write(request(select={"note_ids": ["../../etc/passwd"], "tags": []}))
            )
        self.assertIn("safe vault identifier", str(caught.exception))

        with self.assertRaises(adapter.AdapterError):
            adapter.load_request(write(request(select={"note_ids": [], "tags": ["../x"]})))

    def test_rejects_an_out_of_range_cap(self):
        with self.assertRaises(adapter.AdapterError):
            adapter.load_request(write(request(max_records=0)))
        with self.assertRaises(adapter.AdapterError):
            adapter.load_request(write(request(max_records=adapter.MAX_RECORDS_CEILING + 1)))


class Selection(unittest.TestCase):
    def test_no_selector_takes_the_whole_vault_newest_first(self):
        loaded = adapter.load_request(write(request()))
        notes = [
            note(id="older", created="2026-01-01T00:00:00+00:00"),
            note(id="newer", created="2026-09-01T00:00:00+00:00"),
        ]
        kept, total = adapter.selected(notes, loaded)
        self.assertEqual([n["id"] for n in kept], ["newer", "older"])
        self.assertEqual(total, 2)

    def test_note_ids_and_tags_narrow_the_selection(self):
        by_id = adapter.load_request(write(request(select={"note_ids": ["wanted"], "tags": []})))
        notes = [note(id="wanted"), note(id="other")]
        kept, total = adapter.selected(notes, by_id)
        self.assertEqual([n["id"] for n in kept], ["wanted"])
        self.assertEqual(total, 1)

        by_tag = adapter.load_request(write(request(select={"note_ids": [], "tags": ["rna"]})))
        tagged = [note(id="a", tags=["rna"]), note(id="b", tags=["other"])]
        kept, _ = adapter.selected(tagged, by_tag)
        self.assertEqual([n["id"] for n in kept], ["a"])

    def test_the_cap_truncates_and_reports_the_true_total(self):
        loaded = adapter.load_request(write(request(max_records=1)))
        kept, total = adapter.selected([note(id="a"), note(id="b")], loaded)
        self.assertEqual(len(kept), 1)
        self.assertEqual(total, 2, "the total must stay honest when the cap bites")


class Retention(unittest.TestCase):
    def test_a_record_hashes_the_body_and_keeps_none_of_it(self):
        text = adapter.record_text(note(), "whole vault")
        self.assertNotIn("the full fetched text", text)
        self.assertIn("body_sha256: ", text)
        self.assertIn("source: https://example.org/a", text)
        self.assertIn("note body prose not retained", text)

    def test_record_fields_are_in_the_contract_order_the_normalizer_expects(self):
        lines = adapter.record_text(note(), "whole vault").splitlines()
        prefixes = [
            "note: ",
            "title: ",
            "source: ",
            "body_sha256: ",
            "words: ",
            "tier: ",
            "content_type: ",
            "status: ",
            "created: ",
            "matched: ",
            "retention: ",
        ]
        self.assertEqual(len(lines), len(prefixes))
        for line, prefix in zip(lines, prefixes):
            self.assertTrue(line.startswith(prefix), f"{line!r} should start with {prefix!r}")

    def test_a_note_with_no_source_is_still_addressable(self):
        text = adapter.record_text(note(source=None), "whole vault")
        self.assertIn("source: unrecorded", text)


class Fixture(unittest.TestCase):
    def test_an_untruncated_fixture_declares_no_network_and_stays_proposal_only(self):
        loaded = adapter.load_request(write(request()))
        built = adapter.build_fixture(loaded, [note()], 1, "a" * 64, "2026-09-14T00:00:00Z")
        self.assertFalse(built["effects"]["network_used"])
        self.assertFalse(built["truncated"])
        self.assertTrue(built["run"]["pipeline"]["output_authority"]["planning_inputs_are_proposals"])
        self.assertFalse(built["run"]["source_profile"]["may_authorize_actions"])

    def test_a_truncated_fixture_records_a_high_impact_gap(self):
        loaded = adapter.load_request(write(request(max_records=1)))
        built = adapter.build_fixture(loaded, [note()], 5, "a" * 64, "2026-09-14T00:00:00Z")
        self.assertTrue(built["truncated"])
        truncation = [g for g in built["run"]["gaps"] if g["id"] == "gap-truncated"]
        self.assertEqual(len(truncation), 1)
        self.assertEqual(truncation[0]["impact"], "high")
        self.assertNotEqual(built["run"]["synthesis"]["overall_claim"], "supported")

    def test_every_required_disclosure_is_present(self):
        loaded = adapter.load_request(write(request()))
        built = adapter.build_fixture(loaded, [note()], 1, "a" * 64, "2026-09-14T00:00:00Z")
        ids = {gap["id"] for gap in built["run"]["gaps"]}
        for required in (
            "gap-agent-selected-corpus",
            "gap-body-not-retained",
            "gap-untrusted-web-text",
            "gap-retrieval-happened-elsewhere",
        ):
            self.assertIn(required, ids)


if __name__ == "__main__":
    unittest.main()


class FailureLeavesNothingBehind(unittest.TestCase):
    """A failed fetch must not leave a directory that blocks every retry."""

    def run_fetch(self, vault_root: Path, out: Path) -> int:
        req = write(request(vault_root=str(vault_root)))
        return adapter.main(["hyperresearch_fetch.py", "fetch", str(req), str(out)])

    def test_an_empty_vault_writes_no_run_directory(self):
        out = Path(tempfile.mkdtemp()) / "run"
        self.assertEqual(self.run_fetch(vault(), out), 1)
        self.assertFalse(out.exists(), "a refused fetch must leave no run directory")

    def test_a_failed_export_writes_no_run_directory(self):
        # The vault passes validation but the CLI cannot export it, which is
        # the path that previously left a half-written directory behind.
        broken = vault()
        out = Path(tempfile.mkdtemp()) / "run"
        original = adapter.export_vault
        adapter.export_vault = lambda *_: (_ for _ in ()).throw(
            adapter.AdapterError("export failed")
        )
        try:
            self.assertEqual(self.run_fetch(broken, out), 1)
        finally:
            adapter.export_vault = original
        self.assertFalse(out.exists(), "a failed export must leave no run directory")

    def test_a_refused_fetch_can_be_retried_at_the_same_path(self):
        out = Path(tempfile.mkdtemp()) / "run"
        self.assertEqual(self.run_fetch(vault(), out), 1)
        second = self.run_fetch(vault(), out)
        self.assertEqual(second, 1, "the retry must reach the real cause, not a stale directory")
