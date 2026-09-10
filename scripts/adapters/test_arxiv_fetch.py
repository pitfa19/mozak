"""Offline tests for the arXiv adapter. No test here touches the network."""

import json
import sys
import tempfile
import unittest
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import arxiv_fetch as adapter  # noqa: E402


def write(directory: Path, request: dict) -> Path:
    path = directory / "request.json"
    path.write_text(json.dumps(request))
    return path


BASE = {
    "schema_version": 1,
    "topic_id": "topic-agentic-systems",
    "mode": "query",
    "categories": ["cs.AI"],
    "terms": ["agentic"],
    "days": 7,
    "max_records": 10,
}


class RequestValidation(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.dir = Path(self.temp.name)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_accepts_a_reviewed_request(self) -> None:
        request = adapter.load_request(write(self.dir, BASE))
        self.assertEqual(request["max_records"], 10)

    def test_rejects_unknown_fields(self) -> None:
        bad = dict(BASE, surprise=True)
        with self.assertRaises(adapter.AdapterError):
            adapter.load_request(write(self.dir, bad))

    def test_rejects_query_mode_without_terms(self) -> None:
        bad = dict(BASE)
        bad["terms"] = []
        with self.assertRaises(adapter.AdapterError):
            adapter.load_request(write(self.dir, bad))

    def test_rejects_a_malformed_category(self) -> None:
        bad = dict(BASE, categories=["artificial-intelligence"])
        with self.assertRaises(adapter.AdapterError):
            adapter.load_request(write(self.dir, bad))

    def test_rejects_an_unbounded_cap(self) -> None:
        bad = dict(BASE, max_records=99999)
        with self.assertRaises(adapter.AdapterError):
            adapter.load_request(write(self.dir, bad))

    def test_requires_a_topic(self) -> None:
        bad = dict(BASE)
        del bad["topic_id"]
        with self.assertRaises(adapter.AdapterError):
            adapter.load_request(write(self.dir, bad))


class WindowAndQuery(unittest.TestCase):
    def test_window_is_explicit_and_ordered(self) -> None:
        start, end = adapter.resolve_window(dict(BASE))
        self.assertLess(start, end)
        self.assertTrue(end.endswith("Z"))

    def test_reversed_explicit_window_is_refused(self) -> None:
        request = dict(BASE)
        request["window"] = {"start": "2026-09-04T00:00:00Z", "end": "2026-09-01T00:00:00Z"}
        with self.assertRaises(adapter.AdapterError):
            adapter.resolve_window(request)

    def test_catchup_query_has_no_term_clause(self) -> None:
        request = dict(BASE, mode="catchup")
        query = adapter.build_search_query(request, "2026-09-01T00:00:00Z", "2026-09-02T00:00:00Z")
        self.assertIn("submittedDate:[202609010000 TO 202609020000]", query)
        self.assertNotIn("abs:", query)

    def test_query_mode_matches_title_and_abstract(self) -> None:
        query = adapter.build_search_query(
            dict(BASE), "2026-09-01T00:00:00Z", "2026-09-02T00:00:00Z"
        )
        self.assertIn('abs:"agentic"', query)
        self.assertIn('ti:"agentic"', query)


class Effects(unittest.TestCase):
    def test_effects_declare_read_only_network_use(self) -> None:
        self.assertTrue(adapter.EFFECTS["network_used"])
        self.assertTrue(adapter.EFFECTS["dry_run_available"])
        self.assertEqual(adapter.EFFECTS["mutations_performed"], "none")
        self.assertEqual(adapter.EFFECTS["external_writes"], [])
        self.assertEqual(adapter.EFFECTS["irreversible_effects"], [])
        self.assertFalse(adapter.EFFECTS["owner_approval_required"])

    def test_rate_limit_respects_the_published_guidance(self) -> None:
        self.assertGreaterEqual(adapter.MIN_REQUEST_INTERVAL_SECONDS, 3.0)


class Canonicalization(unittest.TestCase):
    def test_non_ascii_is_not_escaped(self) -> None:
        # MOZAK hashes raw UTF-8, so escaping would break every artifact hash.
        self.assertEqual(
            adapter.canonical_json_bytes({"t": "Bézier"}), '{"t":"Bézier"}'.encode()
        )

    def test_keys_are_sorted_and_compact(self) -> None:
        self.assertEqual(
            adapter.canonical_json_bytes({"b": 1, "a": 2}), b'{"a":2,"b":1}'
        )


class FixtureShape(unittest.TestCase):
    def build(self, total: int, entries: int) -> dict:
        parsed = [
            {
                "arxiv_id": f"2609.{index:05d}v1",
                "url": f"http://arxiv.org/abs/2609.{index:05d}v1",
                "title": f"Paper {index}",
                "abstract": "An abstract.",
                "published": "2026-09-03T00:00:00Z",
                "updated": "2026-09-03T00:00:00Z",
                "authors": ["A. Author"],
                "categories": ["cs.AI"],
            }
            for index in range(entries)
        ]
        return adapter.build_fixture(
            dict(BASE),
            "2026-09-01T00:00:00Z",
            "2026-09-04T00:00:00Z",
            "query",
            total,
            parsed,
            ["a" * 64],
            "2026-09-04T00:00:00Z",
        )

    def test_untruncated_run_is_supported(self) -> None:
        fixture = self.build(total=2, entries=2)
        self.assertFalse(fixture["truncated"])
        self.assertEqual(fixture["run"]["synthesis"]["overall_claim"], "supported")
        self.assertEqual(fixture["run"]["receipt"]["status"], "passed")

    def test_truncated_run_is_qualified_with_a_high_impact_gap(self) -> None:
        fixture = self.build(total=500, entries=2)
        self.assertTrue(fixture["truncated"])
        self.assertEqual(fixture["run"]["synthesis"]["overall_claim"], "qualified")
        self.assertEqual(fixture["run"]["receipt"]["status"], "qualified")
        self.assertTrue(
            any(gap["impact"] == "high" for gap in fixture["run"]["gaps"]),
            "truncation must be a declared high-impact gap",
        )

    def test_empty_result_fails_rather_than_claiming_nothing_exists(self) -> None:
        fixture = self.build(total=0, entries=0)
        self.assertEqual(fixture["run"]["synthesis"]["overall_claim"], "failed")

    def test_records_are_untrusted_recorded_snapshots(self) -> None:
        fixture = self.build(total=2, entries=2)
        for record in fixture["run"]["raw_records"]:
            self.assertEqual(record["trust"], "untrusted_data")
            self.assertTrue(record["immutable"])
            self.assertTrue(record["source_uri"].startswith("recorded:arxiv:"))
        self.assertEqual(
            fixture["run"]["source_profile"]["allowed_schemes"], ["recorded"]
        )

    def test_evidence_byte_range_matches_the_recorded_title(self) -> None:
        fixture = self.build(total=2, entries=2)
        record = fixture["run"]["raw_records"][0]
        evidence = fixture["run"]["evidence"][0]
        quoted = record["content"].encode()[evidence["byte_start"] : evidence["byte_end"]]
        self.assertEqual(quoted.decode(), evidence["quote"])

    def test_authority_is_proposal_only(self) -> None:
        fixture = self.build(total=2, entries=2)
        authority = fixture["run"]["pipeline"]["output_authority"]
        self.assertTrue(authority["planning_inputs_are_proposals"])
        self.assertFalse(authority["may_mutate_accepted_plans"])


class Clusters(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.dir = Path(self.temp.name)
        self.request = {
            "schema_version": 1,
            "topic_id": "topic-agentic-systems",
            "mode": "query",
            "categories": ["cs.AI"],
            "clusters": [
                {"name": "budgets", "terms": ["token budget"]},
                {"name": "context-memory", "terms": ["prompt cache", "agent memory"]},
            ],
            "days": 7,
            "max_records": 100,
        }

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_accepts_named_clusters(self) -> None:
        request = adapter.load_request(write(self.dir, self.request))
        self.assertEqual(len(request["clusters"]), 2)
        self.assertEqual(request["max_records_per_cluster"], 50)

    def test_rejects_mixing_flat_terms_with_clusters(self) -> None:
        bad = dict(self.request, terms=["agentic"])
        with self.assertRaises(adapter.AdapterError):
            adapter.load_request(write(self.dir, bad))

    def test_rejects_duplicate_and_malformed_cluster_names(self) -> None:
        duplicate = dict(self.request)
        duplicate["clusters"] = [
            {"name": "budgets", "terms": ["a"]},
            {"name": "budgets", "terms": ["b"]},
        ]
        with self.assertRaises(adapter.AdapterError):
            adapter.load_request(write(self.dir, duplicate))
        shouty = dict(self.request)
        shouty["clusters"] = [{"name": "Budgets", "terms": ["a"]}]
        with self.assertRaises(adapter.AdapterError):
            adapter.load_request(write(self.dir, shouty))

    def test_rejects_a_cluster_without_terms(self) -> None:
        bad = dict(self.request)
        bad["clusters"] = [{"name": "budgets", "terms": []}]
        with self.assertRaises(adapter.AdapterError):
            adapter.load_request(write(self.dir, bad))

    def test_one_bounded_query_per_cluster(self) -> None:
        request = adapter.load_request(write(self.dir, self.request))
        queries = adapter.build_cluster_queries(
            request, "2026-09-01T00:00:00Z", "2026-09-04T00:00:00Z"
        )
        self.assertEqual([q["name"] for q in queries], ["budgets", "context-memory"])
        # Each cluster carries its own filter, so the server returns only matches.
        self.assertIn('abs:"token budget"', queries[0]["search_query"])
        self.assertNotIn("token budget", queries[1]["search_query"])
        for query in queries:
            self.assertIn("submittedDate:[202609010000 TO 202609040000]", query["search_query"])

    def test_an_empty_cluster_is_reported_as_a_gap(self) -> None:
        # A cluster matching nothing may simply use vocabulary the field does not.
        fixture = adapter.build_fixture(
            self.request,
            "2026-09-01T00:00:00Z",
            "2026-09-04T00:00:00Z",
            "query",
            1,
            [
                {
                    "arxiv_id": "2609.00001v1",
                    "url": "http://arxiv.org/abs/2609.00001v1",
                    "title": "A Paper",
                    "abstract": "An abstract.",
                    "published": "2026-09-03T00:00:00Z",
                    "updated": "2026-09-03T00:00:00Z",
                    "authors": ["A. Author"],
                    "categories": ["cs.AI"],
                    "clusters": ["budgets"],
                }
            ],
            ["a" * 64],
            "2026-09-04T00:00:00Z",
            clusters=[
                {
                    "name": "budgets",
                    "terms": ["token budget"],
                    "search_query": "q",
                    "total_matched": 1,
                    "records_kept": 1,
                    "truncated": False,
                },
                {
                    "name": "containment",
                    "terms": ["blast radius"],
                    "search_query": "q",
                    "total_matched": 0,
                    "records_kept": 0,
                    "truncated": False,
                },
            ],
        )
        gap_ids = [gap["id"] for gap in fixture["run"]["gaps"]]
        self.assertIn("gap-empty-containment", gap_ids)
        self.assertNotIn("gap-empty-budgets", gap_ids)

    def test_matching_clusters_are_inside_the_hashed_record(self) -> None:
        entry = {
            "arxiv_id": "2609.00001v1",
            "url": "http://arxiv.org/abs/2609.00001v1",
            "title": "A Paper",
            "abstract": "An abstract.",
            "published": "2026-09-03T00:00:00Z",
            "updated": "2026-09-03T00:00:00Z",
            "authors": ["A. Author"],
            "categories": ["cs.AI"],
            "clusters": ["budgets", "context-memory"],
        }
        text = adapter.record_text(entry)
        self.assertIn("clusters: budgets, context-memory", text)


class TransientFailureRetry(unittest.TestCase):
    """A transient rate limit must not discard a whole retrieval window."""

    def setUp(self) -> None:
        self.original_urlopen = urllib.request.urlopen
        self.original_backoff = adapter.RETRY_BACKOFF_SECONDS
        adapter.RETRY_BACKOFF_SECONDS = 0.0
        self.calls = 0

    def tearDown(self) -> None:
        urllib.request.urlopen = self.original_urlopen
        adapter.RETRY_BACKOFF_SECONDS = self.original_backoff

    def _respond(self, codes: list[int], body: bytes = b"<feed/>"):
        """Fail with each status in turn, then succeed."""

        pending = list(codes)

        class Response:
            def read(self_inner) -> bytes:
                return body

            def __enter__(self_inner):
                return self_inner

            def __exit__(self_inner, *args) -> bool:
                return False

        def fake(request, timeout=60):
            self.calls += 1
            if pending:
                raise urllib.error.HTTPError(
                    request.full_url, pending.pop(0), "denied", {}, None
                )
            return Response()

        urllib.request.urlopen = fake

    def test_transient_429_is_retried_then_succeeds(self) -> None:
        self._respond([429, 429])
        self.assertEqual(adapter.fetch_page("cat:cs.AI", 0, 1), b"<feed/>")
        self.assertEqual(self.calls, 3)

    def test_transient_503_is_retried(self) -> None:
        self._respond([503])
        self.assertEqual(adapter.fetch_page("cat:cs.AI", 0, 1), b"<feed/>")
        self.assertEqual(self.calls, 2)

    def test_persistent_rate_limit_fails_closed(self) -> None:
        self._respond([429] * adapter.MAX_REQUEST_ATTEMPTS)
        with self.assertRaises(adapter.AdapterError) as caught:
            adapter.fetch_page("cat:cs.AI", 0, 1)
        self.assertEqual(self.calls, adapter.MAX_REQUEST_ATTEMPTS)
        self.assertIn("429", str(caught.exception))

    def test_client_error_is_not_retried(self) -> None:
        self._respond([400] * adapter.MAX_REQUEST_ATTEMPTS)
        with self.assertRaises(adapter.AdapterError) as caught:
            adapter.fetch_page("cat:cs.AI", 0, 1)
        self.assertEqual(self.calls, 1)
        self.assertIn("after 1 attempt", str(caught.exception))


class RetryDelay(unittest.TestCase):
    @staticmethod
    def error(headers: dict) -> urllib.error.HTTPError:
        return urllib.error.HTTPError("u", 429, "denied", headers, None)

    def test_server_stated_retry_after_wins(self) -> None:
        delay = adapter.retry_delay_seconds(self.error({"Retry-After": "12"}), 1)
        self.assertEqual(delay, 12.0)

    def test_retry_after_never_undercuts_the_courtesy_floor(self) -> None:
        delay = adapter.retry_delay_seconds(self.error({"Retry-After": "0"}), 1)
        self.assertEqual(delay, adapter.RETRY_AFTER_FLOOR_SECONDS)

    def test_short_retry_after_is_honoured_over_our_pacing(self) -> None:
        """The server may release us sooner than our own pacing interval."""
        delay = adapter.retry_delay_seconds(self.error({"Retry-After": "5"}), 1)
        self.assertEqual(delay, 5.0)

    def test_backoff_is_capped(self) -> None:
        delay = adapter.retry_delay_seconds(self.error({}), 99)
        self.assertEqual(delay, adapter.MAX_RETRY_BACKOFF_SECONDS)

    def test_first_backoff_is_patient_enough_for_the_penalty_box(self) -> None:
        """An eager retry observably extends arXiv's throttle."""
        self.assertGreaterEqual(adapter.retry_delay_seconds(self.error({}), 1), 20.0)

    def test_unparseable_retry_after_falls_back_to_backoff(self) -> None:
        delay = adapter.retry_delay_seconds(self.error({"Retry-After": "soon"}), 1)
        self.assertEqual(delay, adapter.RETRY_BACKOFF_SECONDS)

    def test_backoff_grows_exponentially(self) -> None:
        delays = [adapter.retry_delay_seconds(self.error({}), n) for n in (1, 2)]
        base = adapter.RETRY_BACKOFF_SECONDS
        self.assertEqual(delays, [base, min(base * 2, adapter.MAX_RETRY_BACKOFF_SECONDS)])


class Endpoint(unittest.TestCase):
    def test_api_uses_https(self) -> None:
        self.assertTrue(adapter.API.startswith("https://"))


class Pacing(unittest.TestCase):
    def test_request_interval_clears_observed_throttling(self) -> None:
        """arXiv throttled this adapter at the documented three seconds."""
        self.assertGreaterEqual(adapter.MIN_REQUEST_INTERVAL_SECONDS, 20.0)


if __name__ == "__main__":
    unittest.main()
