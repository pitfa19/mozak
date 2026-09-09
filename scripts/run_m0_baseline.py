#!/usr/bin/env python3
"""Run the deterministic M0 raw-file and lexical retrieval baselines."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import platform
import re
import resource
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = ROOT / "spec" / "m0" / "evaluation" / "run-config.json"
RECORDED = ROOT / "spec" / "m0" / "evaluation" / "results" / "recorded-baseline.json"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def git_revision() -> str:
    try:
        revision = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, check=True,
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
        ).stdout.strip()
        dirty = subprocess.run(
            ["git", "status", "--porcelain"], cwd=ROOT, check=True,
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
        ).stdout
        return revision + ("+dirty" if dirty else "")
    except (OSError, subprocess.CalledProcessError):
        return "unavailable"


def validate_config(config: dict[str, Any], config_path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    required = {"config_version", "fixture_version", "corpus_manifest", "adapters", "seed", "evidence_budget", "tokenizer", "queries"}
    missing = required - config.keys()
    if missing:
        raise ValueError(f"config missing fields: {sorted(missing)}")
    if config["adapters"] != ["raw_file_scan", "lexical"]:
        raise ValueError("adapters must be pinned to raw_file_scan then lexical")
    manifest_path = (config_path.parent / config["corpus_manifest"]).resolve()
    if config_path.parent.resolve() not in manifest_path.parents:
        raise ValueError("corpus manifest escapes evaluation directory")
    manifest = load_json(manifest_path)
    if manifest.get("redistribution") != "permitted" or not manifest.get("license"):
        raise ValueError("corpus must record a redistributable license")
    documents: list[dict[str, Any]] = []
    ids: set[str] = set()
    for entry in manifest.get("documents", []):
        document_id = entry["id"]
        path = (manifest_path.parent / entry["path"]).resolve()
        if manifest_path.parent not in path.parents or not path.is_file():
            raise ValueError(f"invalid corpus path for {document_id}")
        if document_id in ids:
            raise ValueError(f"duplicate document id: {document_id}")
        ids.add(document_id)
        data = path.read_bytes()
        documents.append({"id": document_id, "path": entry["path"], "text": data.decode("utf-8"), "sha256": sha256(data), "bytes": len(data)})
    if not documents:
        raise ValueError("corpus is empty")
    for query in config["queries"]:
        unknown = set(query["relevant_documents"]) - ids
        if unknown:
            raise ValueError(f"query {query['id']} references unknown documents: {sorted(unknown)}")
    return manifest, documents


def raw_score(query: str, text: str) -> float:
    terms = query.lower().split()
    lowered = text.lower()
    return float(sum(lowered.count(term) for term in terms))


def lexical_scores(query: str, documents: list[dict[str, Any]], pattern: re.Pattern[str]) -> dict[str, float]:
    query_terms = pattern.findall(query.lower())
    tokenized = {doc["id"]: pattern.findall(doc["text"].lower()) for doc in documents}
    scores: dict[str, float] = {}
    count = len(documents)
    for document_id, tokens in tokenized.items():
        score = 0.0
        for term in query_terms:
            frequency = tokens.count(term)
            if not frequency:
                continue
            document_frequency = sum(term in candidate for candidate in tokenized.values())
            score += (1.0 + math.log(frequency)) * (math.log((count + 1) / (document_frequency + 1)) + 1.0)
        scores[document_id] = score
    return scores


def snippet(text: str, query: str, maximum: int) -> dict[str, Any]:
    lowered = text.lower()
    positions = [lowered.find(term) for term in query.lower().split() if lowered.find(term) >= 0]
    center = min(positions) if positions else 0
    start = max(0, center - maximum // 4)
    end = min(len(text), start + maximum)
    return {"start_char": start, "end_char": end, "text": text[start:end]}


def deterministic_projection(result: dict[str, Any]) -> dict[str, Any]:
    return {
        "format_version": result["format_version"],
        "run_config": result["run_config"],
        "corpus": result["corpus"],
        "adapters": [
            {"name": adapter["name"], "metrics": {key: value for key, value in adapter["metrics"].items() if key != "query_latency_ms"}, "queries": adapter["queries"]}
            for adapter in result["adapters"]
        ],
    }


def run(config_path: Path) -> dict[str, Any]:
    started = datetime.now(timezone.utc).isoformat()
    config_bytes = config_path.read_bytes()
    config = json.loads(config_bytes)
    manifest, documents = validate_config(config, config_path)
    pattern = re.compile(config["tokenizer"]["pattern"])
    top_k = int(config["evidence_budget"]["top_k"])
    maximum = int(config["evidence_budget"]["max_snippet_chars"])
    adapter_results = []
    for adapter_name in config["adapters"]:
        query_results = []
        latencies = []
        for query in config["queries"]:
            before = time.perf_counter_ns()
            if adapter_name == "raw_file_scan":
                scores = {doc["id"]: raw_score(query["text"], doc["text"]) for doc in documents}
            else:
                scores = lexical_scores(query["text"], documents, pattern)
            ranked = sorted(((score, document_id) for document_id, score in scores.items() if score > 0), key=lambda item: (-item[0], item[1]))[:top_k]
            latencies.append((time.perf_counter_ns() - before) / 1_000_000)
            hits = []
            for score, document_id in ranked:
                document = next(doc for doc in documents if doc["id"] == document_id)
                hits.append({"document_id": document_id, "score": round(score, 6), "citation": snippet(document["text"], query["text"], maximum)})
            relevant = set(query["relevant_documents"])
            retrieved = {hit["document_id"] for hit in hits}
            query_results.append({
                "id": query["id"], "hits": hits,
                "precision_at_k": round(len(relevant & retrieved) / len(hits), 6) if hits else 0.0,
                "recall_at_k": round(len(relevant & retrieved) / len(relevant), 6),
                "citation_correct": all(hit["citation"]["text"] == next(doc["text"] for doc in documents if doc["id"] == hit["document_id"])[hit["citation"]["start_char"]:hit["citation"]["end_char"]] for hit in hits),
            })
        adapter_results.append({
            "name": adapter_name,
            "metrics": {
                "mean_precision_at_k": round(sum(item["precision_at_k"] for item in query_results) / len(query_results), 6),
                "mean_recall_at_k": round(sum(item["recall_at_k"] for item in query_results) / len(query_results), 6),
                "citation_correctness": round(sum(item["citation_correct"] for item in query_results) / len(query_results), 6),
                "unsupported_acceptance_count": 0,
                "query_latency_ms": {"mean": round(sum(latencies) / len(latencies), 6), "max": round(max(latencies), 6)},
            },
            "queries": query_results,
        })
    snapshot_material = "".join(f"{doc['id']}\0{doc['sha256']}\n" for doc in documents).encode()
    return {
        "format_version": 1,
        "started_at": started,
        "run_config": {"path": str(config_path.relative_to(ROOT)), "sha256": sha256(config_bytes), "fixture_version": config["fixture_version"], "seed": config["seed"], "evidence_budget": config["evidence_budget"]},
        "corpus": {"id": manifest["corpus_id"], "version": manifest["version"], "license": manifest["license"], "manifest_sha256": sha256((config_path.parent / config["corpus_manifest"]).read_bytes()), "snapshot_sha256": sha256(snapshot_material), "document_count": len(documents), "disk_bytes": sum(doc["bytes"] for doc in documents), "documents": [{key: doc[key] for key in ("id", "path", "sha256", "bytes")} for doc in documents]},
        "host": {"platform": platform.platform(), "python": platform.python_version(), "cpu_count": os.cpu_count(), "peak_memory_kib": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss},
        "software_revision": git_revision(),
        "model": None,
        "prompt": None,
        "external_cost": 0,
        "adapters": adapter_results,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--output", type=Path, help="write JSON here; stdout when omitted")
    parser.add_argument("--check-recorded", action="store_true", help="compare deterministic output with the recorded baseline")
    parser.add_argument("--record", action="store_true", help="write the repository's recorded baseline")
    parser.add_argument("--force", action="store_true", help="required with --record")
    args = parser.parse_args()
    if args.record and (not args.force or args.output or args.check_recorded):
        parser.error("--record requires --force and cannot be combined with --output or --check-recorded")
    result = run(args.config.resolve())
    if args.check_recorded:
        recorded = load_json(RECORDED)
        if deterministic_projection(result) != deterministic_projection(recorded):
            print("recorded M0 baseline differs from current deterministic result", file=sys.stderr)
            return 1
        print("ok: recorded M0 baseline matches deterministic metrics and hashes")
        return 0
    destination = RECORDED if args.record else args.output
    rendered = json.dumps(result, indent=2, sort_keys=True) + "\n"
    if destination:
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(rendered, encoding="utf-8")
    else:
        sys.stdout.write(rendered)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, json.JSONDecodeError) as error:
        print(f"M0 baseline failed: {error}", file=sys.stderr)
        raise SystemExit(1)
