"""Tests for the MCP registry adapter's request handling and selection.

Network access is stubbed, so these tests describe the adapter's own logic:
what it refuses to request, and how it chooses what to keep.
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import mcp_registry_fetch as adapter  # noqa: E402


def request(**overrides) -> dict:
    value = {
        "schema_version": 1,
        "scope_id": "topic-test",
        "updated_since": "2026-08-01T00:00:00Z",
        "max_records": 5,
        "interests": [{"name": "memory", "terms": ["memory", "recall"]}],
    }
    value.update(overrides)
    return value


def write(value: dict) -> Path:
    path = Path(tempfile.mkdtemp()) / "request.json"
    path.write_text(json.dumps(value))
    return path


def server(name: str, version: str, updated: str, description: str = "", status: str = "active") -> dict:
    return {
        "server": {"name": name, "version": version, "description": description},
        "_meta": {
            "io.modelcontextprotocol.registry/official": {
                "status": status,
                "updatedAt": updated,
                "publishedAt": updated,
                "isLatest": True,
            }
        },
    }


class RequestTests(unittest.TestCase):
    def test_a_valid_request_is_normalized(self) -> None:
        value = adapter.load_request(write(request()))
        self.assertEqual(value["max_records"], 5)
        self.assertEqual(value["interests"][0]["terms"], ["memory", "recall"])

    def test_unsafe_or_unbounded_requests_are_refused(self) -> None:
        for override, reason in [
            ({"schema_version": 2}, "schema_version"),
            ({"scope_id": "Topic Test"}, "scope_id"),
            ({"max_records": 0}, "max_records"),
            ({"max_records": adapter.MAX_RECORDS_CEILING + 1}, "max_records"),
            ({"updated_since": "last tuesday"}, "updated_since"),
            ({"interests": [{"name": "x", "terms": []}]}, "terms"),
            ({"interests": [{"name": "Bad Name", "terms": ["x"]}]}, "lowercase"),
        ]:
            with self.assertRaises(adapter.AdapterError, msg=str(override)) as caught:
                adapter.load_request(write(request(**override)))
            self.assertIn(reason, str(caught.exception))

    def test_unknown_fields_are_refused(self) -> None:
        value = request()
        value["surprise"] = True
        with self.assertRaises(adapter.AdapterError):
            adapter.load_request(write(value))

    def test_the_planned_url_carries_the_window_and_no_secrets(self) -> None:
        value = adapter.load_request(write(request()))
        url = adapter.page_url(value, None)
        self.assertIn("updated_since=2026-08-01", url)
        self.assertIn("limit=", url)
        self.assertTrue(url.startswith(adapter.SERVERS_API))


class SelectionTests(unittest.TestCase):
    def test_selection_keeps_the_newest_not_the_first_page(self) -> None:
        # The registry paginates by name, so an adapter that trusted arrival
        # order would report an alphabetical prefix as "newest".
        value = adapter.load_request(write(request(max_records=2)))
        entries = [
            server("aaa.first/one", "1.0.0", "2026-08-02T00:00:00Z", "memory tool"),
            server("zzz.last/two", "1.0.0", "2026-09-06T00:00:00Z", "memory tool"),
            server("mmm.middle/three", "1.0.0", "2026-09-01T00:00:00Z", "memory tool"),
        ]
        kept, total, _ = adapter.select(entries, value)
        self.assertEqual(total, 3)
        names = [item["entry"]["server"]["name"] for item in kept]
        self.assertEqual(names, ["zzz.last/two", "mmm.middle/three"])

    def test_non_active_entries_and_unmatched_interests_are_dropped(self) -> None:
        value = adapter.load_request(write(request()))
        entries = [
            server("a/deleted", "1.0.0", "2026-09-06T00:00:00Z", "memory", status="deleted"),
            server("b/offtopic", "1.0.0", "2026-09-06T00:00:00Z", "unrelated thing"),
            server("c/keep", "1.0.0", "2026-09-05T00:00:00Z", "recall engine"),
        ]
        kept, total, reports = adapter.select(entries, value)
        self.assertEqual([i["entry"]["server"]["name"] for i in kept], ["c/keep"])
        self.assertEqual(total, 1)
        self.assertEqual(reports[0]["records_matched"], 1)

    def test_duplicate_name_and_version_is_recorded_once(self) -> None:
        value = adapter.load_request(write(request()))
        entries = [
            server("a/same", "1.0.0", "2026-09-06T00:00:00Z", "memory"),
            server("a/same", "1.0.0", "2026-09-06T00:00:00Z", "memory"),
        ]
        kept, total, _ = adapter.select(entries, value)
        self.assertEqual(len(kept), 1)
        self.assertEqual(total, 1)


class RecordTests(unittest.TestCase):
    def test_a_record_retains_metadata_and_not_publisher_prose(self) -> None:
        value = adapter.load_request(write(request()))
        entry = server("a/tool", "2.1.0", "2026-09-06T00:00:00Z", "BUY NOW best memory tool")
        kept, _, _ = adapter.select([entry], value)
        text = adapter.record_text(kept[0])
        self.assertIn("server: a/tool", text)
        self.assertIn("version: 2.1.0", text)
        self.assertNotIn("BUY NOW", text)
        self.assertNotIn("description:", text)
        self.assertEqual(len(text.splitlines()), 11)

    def test_an_incomplete_window_is_disclosed_as_a_high_impact_gap(self) -> None:
        value = adapter.load_request(write(request(max_records=1)))
        entry = server("a/tool", "1.0.0", "2026-09-06T00:00:00Z", "memory")
        kept, total, reports = adapter.select([entry], value)
        fixture = adapter.build_fixture(
            value, kept, total, reports, ["0" * 64], True, "2026-09-06T00:00:00Z"
        )
        self.assertTrue(fixture["truncated"])
        gap = next(g for g in fixture["run"]["gaps"] if g["id"] == "gap-truncated")
        self.assertEqual(gap["impact"], "high")
        self.assertIn("page ceiling", gap["description"])
        self.assertNotEqual(fixture["run"]["synthesis"]["overall_claim"], "supported")

    def test_declared_effects_are_read_only(self) -> None:
        self.assertTrue(adapter.EFFECTS["network_used"])
        self.assertEqual(adapter.EFFECTS["external_writes"], [])
        self.assertEqual(adapter.EFFECTS["mutations_performed"], "none")
        self.assertEqual(adapter.EFFECTS["irreversible_effects"], [])
        self.assertTrue(adapter.EFFECTS["dry_run_available"])


if __name__ == "__main__":
    unittest.main()
