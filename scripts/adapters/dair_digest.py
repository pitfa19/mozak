#!/usr/bin/env python3
"""Render a DAIR.AI normalized run as a metadata-only reading list."""

import argparse
import json
from pathlib import Path


def parse_record(record: dict) -> dict:
    lines = record["content"].splitlines()
    fields = {"title": lines[0]}
    for line in lines[1:]:
        key, value = line.split(": ", 1)
        fields[key] = value
    fields["clusters"] = [item.strip() for item in fields.get("clusters", "").split(",") if item.strip()]
    return fields


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("run", type=Path)
    parser.add_argument("--cluster")
    parser.add_argument("--min-clusters", type=int, default=0)
    parser.add_argument("--format", choices=["markdown", "ids", "tsv"], default="markdown")
    args = parser.parse_args()
    run = json.loads(args.run.read_text())
    papers = [parse_record(record) for record in run["raw_records"]]
    papers = [paper for paper in papers if len(paper["clusters"]) >= args.min_clusters and (not args.cluster or args.cluster in paper["clusters"])]
    papers.sort(key=lambda paper: (-len(paper["clusters"]), paper["title"]))
    if args.format == "ids":
        for paper in papers:
            print(paper["paper_url"])
    elif args.format == "tsv":
        for paper in papers:
            print("\t".join([paper["week"], "+".join(paper["clusters"]), paper["title"], paper["paper_url"]]))
    else:
        print("# DAIR.AI curated candidate reading\n")
        print("Metadata and provenance only. DAIR.AI curator prose is not retained.\n")
        current = None
        for paper in papers:
            if paper["week"] != current:
                current = paper["week"]
                print(f"## {current}\n")
            clusters = ", ".join(paper["clusters"]) or "no target cluster match"
            print(f"- [{paper['title']}]({paper['paper_url']})  ")
            print(f"  Clusters: {clusters}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
