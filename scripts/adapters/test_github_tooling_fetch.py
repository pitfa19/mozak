"""Tests for the GitHub tooling adapter's request handling and rendering.

Network access is stubbed out, so these tests cover the adapter's own logic:
what it refuses to request, and what it refuses to retain.
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import github_tooling_fetch as adapter  # noqa: E402


def write(value: dict) -> Path:
    path = Path(tempfile.mkdtemp()) / "request.json"
    path.write_text(json.dumps(value))
    return path


def discover(**overrides) -> dict:
    value = {
        "schema_version": 1,
        "scope_id": "topic-test",
        "mode": "discover",
        "pushed_since": "2026-08-01",
        "min_stars": 100,
        "max_records": 10,
        "queries": [{"name": "memory", "terms": ["topic:agent-memory"]}],
    }
    value.update(overrides)
    return value


def watch(**overrides) -> dict:
    value = {
        "schema_version": 1,
        "scope_id": "topic-test",
        "mode": "watch",
        "max_records": 10,
        "watchlist": ["deeplethe/utopia"],
    }
    value.update(overrides)
    return value


class ModeTests(unittest.TestCase):
    def test_each_mode_requires_its_own_subject(self) -> None:
        adapter.load_request(write(discover()))
        adapter.load_request(write(watch()))

        with self.assertRaises(adapter.AdapterError) as no_queries:
            adapter.load_request(write(discover(queries=[])))
        self.assertIn("at least one query", str(no_queries.exception))

        with self.assertRaises(adapter.AdapterError) as no_list:
            adapter.load_request(write(watch(watchlist=[])))
        self.assertIn("non-empty watchlist", str(no_list.exception))

    def test_a_mode_cannot_smuggle_in_the_other_modes_subject(self) -> None:
        # Discovery carrying a watchlist is how an accidental promotion would
        # look, so the request drops it rather than honouring it.
        value = adapter.load_request(write(discover(watchlist=["a/b"])))
        self.assertEqual(value["watchlist"], [])
        value = adapter.load_request(
            write(watch(queries=[{"name": "x", "terms": ["topic:y"]}]))
        )
        self.assertEqual(value["queries"], [])

    def test_an_unknown_mode_is_refused(self) -> None:
        with self.assertRaises(adapter.AdapterError):
            adapter.load_request(write(discover(mode="trending")))


class RequestSafetyTests(unittest.TestCase):
    def test_query_terms_are_restricted_to_search_syntax(self) -> None:
        # Without this an arbitrary string could reshape the request URL.
        for term in ["topic:x&q=evil", "topic:x\nnewline", "topic:x?a=b"]:
            with self.assertRaises(adapter.AdapterError, msg=term):
                adapter.load_request(
                    write(discover(queries=[{"name": "bad", "terms": [term]}]))
                )

    def test_watchlist_entries_must_be_owner_name(self) -> None:
        for repo in ["notaslug", "too/many/parts", "../escape", "owner/"]:
            with self.assertRaises(adapter.AdapterError, msg=repo):
                adapter.load_request(write(watch(watchlist=[repo])))

    def test_duplicate_watchlist_entries_are_refused(self) -> None:
        with self.assertRaises(adapter.AdapterError):
            adapter.load_request(write(watch(watchlist=["a/b", "A/B"])))

    def test_bounds_and_unknown_fields_are_enforced(self) -> None:
        for override in [
            {"max_records": 0},
            {"max_records": adapter.MAX_RECORDS_CEILING + 1},
            {"min_stars": -1},
            {"pushed_since": "August"},
            {"schema_version": 2},
            {"scope_id": "Topic Test"},
        ]:
            with self.assertRaises(adapter.AdapterError, msg=str(override)):
                adapter.load_request(write(discover(**override)))

        value = discover()
        value["extra"] = 1
        with self.assertRaises(adapter.AdapterError):
            adapter.load_request(write(value))

    def test_too_many_queries_or_watched_repositories_are_refused(self) -> None:
        many = [{"name": f"q{i}", "terms": ["topic:x"]} for i in range(adapter.MAX_QUERIES + 1)]
        with self.assertRaises(adapter.AdapterError):
            adapter.load_request(write(discover(queries=many)))
        repos = [f"owner{i}/repo" for i in range(adapter.MAX_WATCHLIST + 1)]
        with self.assertRaises(adapter.AdapterError):
            adapter.load_request(write(watch(watchlist=repos)))

    def test_the_search_url_carries_the_declared_filters(self) -> None:
        value = adapter.load_request(write(discover()))
        url = adapter.search_url(value, value["queries"][0]["terms"])
        self.assertIn("agent-memory", url)
        self.assertIn("pushed", url)
        self.assertIn("stars", url)
        self.assertTrue(url.startswith(adapter.API))


class RenderingTests(unittest.TestCase):
    def entry(self, *, release: bool, description: str = "BUY THIS NOW") -> dict:
        marker = (
            {"kind": "release", "identifier": "v1.2.3", "at": "2026-09-01T00:00:00Z", "response_sha256": "0" * 64}
            if release
            else {"kind": "commit", "identifier": "a" * 40, "at": "2026-09-06T00:00:00Z", "response_sha256": "0" * 64}
        )
        return {
            "repo": {
                "full_name": "owner/tool",
                "html_url": "https://github.com/owner/tool",
                "description": description,
                "pushed_at": "2026-09-06T00:00:00Z",
                "stargazers_count": 1234,
                "language": "Rust",
                "license": {"spdx_id": "Apache-2.0"},
                "archived": False,
                "topics": ["rag", "agent-memory"],
            },
            "queries": ["memory"],
            "marker": marker,
        }

    def test_a_record_retains_facts_and_not_prose(self) -> None:
        text = adapter.record_text(self.entry(release=True))
        self.assertIn("repository: owner/tool", text)
        self.assertIn("latest_release: v1.2.3", text)
        self.assertIn("license: Apache-2.0", text)
        self.assertNotIn("BUY THIS NOW", text)
        self.assertNotIn("description:", text)
        self.assertEqual(len(text.splitlines()), 12)

    def test_a_repository_without_releases_records_its_commit(self) -> None:
        text = adapter.record_text(self.entry(release=False))
        self.assertIn("latest_commit: " + "a" * 40, text)
        self.assertNotIn("latest_release:", text)

    def test_an_undeclared_licence_is_reported_rather_than_omitted(self) -> None:
        entry = self.entry(release=True)
        entry["repo"]["license"] = None
        self.assertIn("license: none-declared", adapter.record_text(entry))

    def test_discovery_declares_it_proposes_and_never_promotes(self) -> None:
        request = adapter.load_request(write(discover(max_records=1)))
        entries = [self.entry(release=True)]
        fixture = adapter.build_fixture(
            request, entries, [{"name": "memory", "terms": ["topic:agent-memory"], "records_matched": 1}],
            ["0" * 64], 5, False, "2026-09-06T00:00:00Z",
        )
        ids = {g["id"] for g in fixture["run"]["gaps"]}
        self.assertIn("gap-discovery-is-proposal-only", ids)
        self.assertIn("gap-topic-dependent", ids)
        self.assertEqual(fixture["watchlist"], [])
        self.assertTrue(fixture["truncated"])
        self.assertNotEqual(fixture["run"]["synthesis"]["overall_claim"], "supported")

    def test_watch_declares_that_it_discovers_nothing(self) -> None:
        request = adapter.load_request(write(watch()))
        fixture = adapter.build_fixture(
            request, [self.entry(release=True)], [{"name": "watchlist", "terms": ["deeplethe/utopia"], "records_matched": 1}],
            ["0" * 64], 1, False, "2026-09-06T00:00:00Z",
        )
        ids = {g["id"] for g in fixture["run"]["gaps"]}
        self.assertIn("gap-watchlist-is-closed", ids)
        self.assertNotIn("gap-discovery-is-proposal-only", ids)
        self.assertFalse(fixture["truncated"])

    def test_declared_effects_are_read_only(self) -> None:
        self.assertEqual(adapter.EFFECTS["external_writes"], [])
        self.assertEqual(adapter.EFFECTS["mutations_performed"], "none")
        self.assertEqual(adapter.EFFECTS["irreversible_effects"], [])
        self.assertTrue(adapter.EFFECTS["dry_run_available"])


if __name__ == "__main__":
    unittest.main()
