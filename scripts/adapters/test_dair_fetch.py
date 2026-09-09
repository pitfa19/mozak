import json
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import dair_fetch as dair  # noqa: E402

SAMPLE = """# AI Papers of the Week — 2026
## Top AI Papers of the Week (August 24 - August 30) - 2026
| **Paper** | **Links** |
| --- | --- |
| 1) **Context Agent** - This prose mentions persistent state and a long-horizon agent. | [Paper](https://arxiv.org/abs/2608.1), [Tweet](https://x.com/x) |
| 2) **Vision Model** - A computer vision system. | [Paper](https://example.org/paper) |
## Top AI Papers of the Week (August 17 - August 23) - 2026
| **Paper** | **Links** |
| --- | --- |
| 1) **Skill Agent** - A self-improving skill library. | [Paper](https://arxiv.org/abs/2608.2) |
"""


def request() -> dict:
    return {"schema_version": 1, "scope_id": "topic-agentic-systems", "weeks": 1, "year": 2026, "clusters": [{"name": "memory", "terms": ["persistent state", "long-horizon"]}], "max_records": 10}


class RequestValidation(unittest.TestCase):
    def load(self, value: dict) -> dict:
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "request.json"
            path.write_text(json.dumps(value))
            return dair.load_request(path)

    def test_accepts_scope_bound_request(self):
        self.assertEqual(self.load(request())["scope_id"], "topic-agentic-systems")

    def test_rejects_unknown_fields_and_duplicate_clusters(self):
        bad = request() | {"surprise": True}
        with self.assertRaises(dair.AdapterError):
            self.load(bad)
        bad = request()
        bad["clusters"] *= 2
        with self.assertRaises(dair.AdapterError):
            self.load(bad)

    def test_bounds_weeks_and_record_cap(self):
        for field, value in [("weeks", 13), ("max_records", 251)]:
            bad = request() | {field: value}
            with self.assertRaises(dair.AdapterError):
                self.load(bad)


class ParsingAndSelection(unittest.TestCase):
    def test_parses_week_boundaries_and_paper_links(self):
        issues = dair.parse_weekly_markdown(SAMPLE)
        self.assertEqual(len(issues), 2)
        self.assertEqual([len(issue["papers"]) for issue in issues], [2, 1])
        self.assertEqual(issues[0]["papers"][0]["title"], "Context Agent")

    def test_uses_prose_for_matching_but_does_not_persist_it(self):
        issues = dair.parse_weekly_markdown(SAMPLE)
        records, total, reports = dair.select_records(issues, request())
        self.assertEqual(total, 2)
        self.assertEqual(reports[0]["records_matched"], 1)
        text = dair.record_text(records[0], "a" * 40, 2026)
        self.assertIn("clusters: memory", text)
        self.assertNotIn("This prose mentions", text)
        self.assertEqual(len(text.splitlines()), 7)

    def test_keeps_curated_nonmatches_and_orders_matches_first(self):
        records, total, _ = dair.select_records(dair.parse_weekly_markdown(SAMPLE), request())
        self.assertEqual(total, 2)
        self.assertEqual(records[0]["title"], "Context Agent")
        self.assertEqual(records[1]["clusters"], [])

    def test_cap_is_honest_truncation(self):
        bounded = request() | {"max_records": 1}
        records, total, _ = dair.select_records(dair.parse_weekly_markdown(SAMPLE), bounded)
        fixture = dair.build_fixture(bounded, "a" * 40, ["b" * 64, "c" * 64], records, total, [{"name": "memory", "terms": ["persistent state"], "records_matched": 1}], "2026-09-04T00:00:00Z")
        self.assertTrue(fixture["truncated"])
        self.assertEqual(fixture["run"]["synthesis"]["overall_claim"], "qualified")
        self.assertIn("gap-truncated", {gap["id"] for gap in fixture["run"]["gaps"]})


if __name__ == "__main__":
    unittest.main()
