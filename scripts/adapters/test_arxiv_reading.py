"""Offline tests for the digest and pull tools. No test here touches the network."""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import arxiv_digest as digest  # noqa: E402
import arxiv_pull as pull  # noqa: E402


def record(arxiv_id: str, title: str, clusters: list[str]) -> dict:
    content = (
        f"{title}\nAn abstract.\nauthors: A. Author\ncategories: cs.AI\n"
        f"published: 2026-09-03T00:00:00Z\nurl: http://arxiv.org/abs/{arxiv_id}\n"
        f"clusters: {', '.join(clusters)}"
    )
    return {"source_uri": f"recorded:arxiv:{arxiv_id}", "content": content}


RUN = {
    "run_id": "run-test",
    "raw_records": [
        record("2609.00001v1", "Broad Paper", ["budgets", "context-memory", "skills"]),
        record("2609.00002v1", "Narrow Paper", ["budgets"]),
        record("2609.00003v1", "Other Paper", ["containment"]),
    ],
}


class Digest(unittest.TestCase):
    def test_parses_fields_back_out_of_the_hashed_record(self) -> None:
        parsed = digest.parse_record(RUN["raw_records"][0])
        self.assertEqual(parsed["arxiv_id"], "2609.00001v1")
        self.assertEqual(parsed["title"], "Broad Paper")
        self.assertEqual(parsed["clusters"], ["budgets", "context-memory", "skills"])
        self.assertEqual(parsed["url"], "http://arxiv.org/abs/2609.00001v1")

    def run_digest(self, *args: str) -> str:
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "run.json"
            path.write_text(json.dumps(RUN))
            result = subprocess.run(
                [sys.executable, str(HERE / "arxiv_digest.py"), str(path), *args],
                capture_output=True,
                text=True,
                check=True,
            )
            return result.stdout

    def test_ids_format_is_pipeable_into_a_pull(self) -> None:
        output = self.run_digest("--format", "ids", "--min-clusters", "3")
        self.assertEqual(output.split(), ["2609.00001v1"])

    def test_cluster_filter_selects_one_interest(self) -> None:
        output = self.run_digest("--format", "ids", "--cluster", "containment")
        self.assertEqual(output.split(), ["2609.00003v1"])

    def test_markdown_leads_with_the_broadest_overlap(self) -> None:
        output = self.run_digest()
        self.assertLess(
            output.index("Matching 3 clusters"), output.index("Matching 1 cluster")
        )
        self.assertIn("metadata only", output)

    def test_tsv_carries_id_clusters_title_and_link(self) -> None:
        row = self.run_digest("--format", "tsv").splitlines()[0].split("\t")
        self.assertEqual(row[0], "2609.00001v1")
        self.assertEqual(row[1], "budgets+context-memory+skills")
        self.assertEqual(row[2], "Broad Paper")
        self.assertTrue(row[3].startswith("http"))


class Pull(unittest.TestCase):
    def test_rejects_anything_that_is_not_an_arxiv_identifier(self) -> None:
        for bad in ["latest", "../etc/passwd", "2609", "http://x"]:
            with self.assertRaises(pull.PullError):
                pull.valid_id(bad)
        self.assertEqual(pull.valid_id("2609.02074v1"), "2609.02074v1")
        self.assertEqual(pull.valid_id("2609.02074"), "2609.02074")

    def test_refuses_a_bulk_pull(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaises(pull.PullError):
                pull.pull(Path(temp), [f"2609.{index:05d}" for index in range(pull.MAX_PULL + 1)])

    def test_refuses_to_delete_a_directory_it_did_not_create(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            target = Path(temp) / "mine"
            target.mkdir()
            (target / "important.txt").write_text("keep me")
            with self.assertRaises(pull.PullError):
                pull.clean(target)
            self.assertTrue((target / "important.txt").exists())

    def test_cleaning_a_missing_directory_is_not_an_error(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            self.assertEqual(pull.clean(Path(temp) / "absent"), 0)

    def test_effects_declare_a_disposable_local_write(self) -> None:
        self.assertTrue(pull.EFFECTS["network_used"])
        self.assertEqual(pull.EFFECTS["mutations_performed"], "none")
        self.assertEqual(pull.EFFECTS["external_writes"], [])
        self.assertIn("disposable", pull.EFFECTS["local_writes"])

    def test_rate_limit_respects_the_published_guidance(self) -> None:
        self.assertGreaterEqual(pull.MIN_REQUEST_INTERVAL_SECONDS, 3.0)


if __name__ == "__main__":
    unittest.main()
