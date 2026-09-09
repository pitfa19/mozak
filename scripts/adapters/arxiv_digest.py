#!/usr/bin/env python3
"""Reading digest for a validated arXiv research run.

A retrieval keeps metadata only, which is the durable part. This turns a run
into a decision list: titles, links and which interest clusters matched, so a
paper can be chosen for full text deliberately rather than in bulk.

The optional companion `arxiv_pull.py` fetches chosen PDFs into a scratch
directory. Those files are disposable; the pinned run record is not.

Usage:
  arxiv_digest.py RUN_JSON [--cluster NAME] [--min-clusters N] [--format md|ids|tsv]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def parse_record(record: dict) -> dict:
    """Reads one pinned metadata record back into its fields.

    The record text is the hashed evidence, so parsing rather than restructuring
    keeps the digest honest: every field shown here is inside the bytes MOZAK
    validated.
    """
    lines = record["content"].split("\n")
    fields = {"title": lines[0] if lines else "", "abstract": lines[1] if len(lines) > 1 else ""}
    for line in lines[2:]:
        for key in ("authors", "categories", "published", "url", "clusters"):
            prefix = f"{key}: "
            if line.startswith(prefix):
                fields[key] = line[len(prefix) :]
    fields["clusters"] = [
        item for item in (fields.get("clusters", "") or "").split(", ") if item
    ]
    fields["arxiv_id"] = record["source_uri"].removeprefix("recorded:arxiv:")
    return fields


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run")
    parser.add_argument("--cluster", help="only papers matching this interest cluster")
    parser.add_argument(
        "--min-clusters",
        type=int,
        default=1,
        help="only papers matching at least this many clusters",
    )
    parser.add_argument("--format", choices=["md", "ids", "tsv"], default="md")
    parser.add_argument(
        "--abstract", action="store_true", help="include the abstract in md output"
    )
    arguments = parser.parse_args(argv[1:])

    try:
        run = json.loads(Path(arguments.run).read_text())
    except (OSError, json.JSONDecodeError) as error:
        print(f"error: cannot read run: {error}", file=sys.stderr)
        return 1

    papers = [parse_record(record) for record in run.get("raw_records", [])]
    if arguments.cluster:
        papers = [p for p in papers if arguments.cluster in p["clusters"]]
    papers = [p for p in papers if len(p["clusters"]) >= arguments.min_clusters]

    if arguments.format == "ids":
        for paper in papers:
            print(paper["arxiv_id"])
        return 0
    if arguments.format == "tsv":
        for paper in papers:
            print(
                "\t".join(
                    [
                        paper["arxiv_id"],
                        "+".join(paper["clusters"]),
                        paper["title"],
                        paper.get("url", ""),
                    ]
                )
            )
        return 0

    # Markdown, grouped by how many interests a paper touches. Overlap across
    # clusters is the strongest available relevance signal, so it leads.
    print(f"# Reading digest: {run.get('run_id', 'unknown run')}\n")
    print(f"{len(papers)} papers, metadata only. Links resolve to arXiv abstracts.\n")
    by_breadth: dict[int, list[dict]] = {}
    for paper in papers:
        by_breadth.setdefault(len(paper["clusters"]), []).append(paper)
    for breadth in sorted(by_breadth, reverse=True):
        group = by_breadth[breadth]
        label = "cluster" if breadth == 1 else "clusters"
        print(f"## Matching {breadth} {label} ({len(group)})\n")
        for paper in group:
            print(f"- **{paper['title']}**")
            print(
                f"  `{paper['arxiv_id']}` [{'+'.join(paper['clusters'])}] "
                f"{paper.get('url', '')}"
            )
            if arguments.abstract and paper.get("abstract"):
                print(f"  > {paper['abstract'][:300]}")
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
