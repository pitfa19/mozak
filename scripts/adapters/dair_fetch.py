#!/usr/bin/env python3
"""DAIR.AI Papers of the Week research adapter for MOZAK.

The adapter reads DAIR.AI's official public GitHub repository at an exact commit.
Because that repository currently declares no license, DAIR.AI's prose summaries
are used only transiently for matching and are never copied into durable records.

Usage:
  dair_fetch.py plan  REQUEST_JSON
  dair_fetch.py fetch REQUEST_JSON OUTPUT_DIR
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPOSITORY = "dair-ai/AI-Papers-of-the-Week"
REPOSITORY_URL = f"https://github.com/{REPOSITORY}"
COMMITS_API = f"https://api.github.com/repos/{REPOSITORY}/commits/main"
RAW_ROOT = f"https://raw.githubusercontent.com/{REPOSITORY}"
ADAPTER_ID = "adapter-dair-ai-v1"
PIPELINE_ID = "pipeline-dair-ai-v1"
SOURCE_PROFILE_ID = "source-dair-ai-v1"
CONTRACT_VERSION = 1
MAX_RECORDS_CEILING = 250
USER_AGENT = "mozak-dair-ai-adapter/1 (curated research metadata)"
EFFECTS = {
    "network_used": True,
    "external_writes": [],
    "mutations_performed": "none",
    "irreversible_effects": [],
    "dry_run_available": True,
    "owner_approval_required": False,
}


class AdapterError(Exception):
    pass


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical_json_bytes(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load_request(path: Path) -> dict:
    try:
        request = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise AdapterError(f"cannot read request {path}: {error}") from error
    allowed = {"schema_version", "scope_id", "weeks", "year", "clusters", "max_records", "question"}
    unknown = set(request) - allowed
    if unknown:
        raise AdapterError(f"unknown request fields: {sorted(unknown)}")
    if request.get("schema_version") != 1:
        raise AdapterError("request schema_version must be 1")
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", request.get("scope_id", "")):
        raise AdapterError("request must name a lowercase-hyphenated scope_id")
    weeks = int(request.get("weeks", 1))
    if not 1 <= weeks <= 12:
        raise AdapterError("weeks must be between 1 and 12")
    request["weeks"] = weeks
    year = int(request.get("year", datetime.now(timezone.utc).year))
    if not 2023 <= year <= datetime.now(timezone.utc).year:
        raise AdapterError("year is outside the Papers of the Week archive")
    request["year"] = year
    cap = int(request.get("max_records", 100))
    if not 1 <= cap <= MAX_RECORDS_CEILING:
        raise AdapterError(f"max_records must be between 1 and {MAX_RECORDS_CEILING}")
    request["max_records"] = cap
    names: set[str] = set()
    for cluster in request.get("clusters", []):
        if set(cluster) != {"name", "terms"}:
            raise AdapterError("a cluster has exactly a name and terms")
        name = cluster["name"]
        if not re.fullmatch(r"[a-z0-9-]+", name) or name in names:
            raise AdapterError(f"invalid or duplicate cluster name: {name!r}")
        names.add(name)
        if not cluster["terms"] or not all(isinstance(term, str) and term.strip() for term in cluster["terms"]):
            raise AdapterError(f"cluster {name} must have non-empty terms")
    return request


def request_bytes(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/vnd.github+json"})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.read()
    except Exception as error:  # noqa: BLE001
        raise AdapterError(f"GitHub request failed: {error}") from error


def resolve_revision() -> tuple[str, bytes]:
    body = request_bytes(COMMITS_API)
    try:
        revision = json.loads(body)["sha"]
    except (json.JSONDecodeError, KeyError, TypeError) as error:
        raise AdapterError("GitHub commit response did not contain a revision") from error
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise AdapterError("GitHub returned an invalid commit revision")
    return revision, body


def parse_weekly_markdown(markdown: str) -> list[dict]:
    """Parse weekly rows. Prose is returned only for transient matching."""
    issues: list[dict] = []
    heading = re.compile(r"^## Top AI Papers of the Week \((.+?)\) - (\d{4})\s*$", re.M)
    matches = list(heading.finditer(markdown))
    for index, match in enumerate(matches):
        section = markdown[match.end() : matches[index + 1].start() if index + 1 < len(matches) else len(markdown)]
        week = f"{match.group(1)} {match.group(2)}"
        papers: list[dict] = []
        # A row ends at its links cell. DOTALL is needed because curated summaries span lines.
        row_pattern = re.compile(
            r"^\|\s*\d+\)\s*\*\*(.+?)\*\*\s*-\s*(.*?)\|\s*((?:\[[^\]]+\]\([^\)]+\)[, ]*)+)\|\s*$",
            re.M | re.S,
        )
        for row in row_pattern.finditer(section):
            title = " ".join(row.group(1).split())
            prose = " ".join(row.group(2).split())
            links = re.findall(r"\[([^\]]+)\]\((https?://[^\)]+)\)", row.group(3))
            paper_url = next((url for label, url in links if label.lower() == "paper"), None)
            if paper_url:
                papers.append({"title": title, "paper_url": paper_url, "matching_text": f"{title} {prose}"})
        issues.append({"week": week, "papers": papers})
    return issues


def match_clusters(text: str, clusters: list[dict]) -> list[str]:
    folded = text.casefold()
    return [cluster["name"] for cluster in clusters if any(term.casefold() in folded for term in cluster["terms"])]


def select_records(issues: list[dict], request: dict) -> tuple[list[dict], int, list[dict]]:
    selected_issues = issues[: request["weeks"]]
    records: list[dict] = []
    reports = [{"name": c["name"], "terms": c["terms"], "records_matched": 0} for c in request.get("clusters", [])]
    for issue in selected_issues:
        for paper in issue["papers"]:
            clusters = match_clusters(paper["matching_text"], request.get("clusters", []))
            for report in reports:
                if report["name"] in clusters:
                    report["records_matched"] += 1
            # DAIR.AI is already a bounded curated list. Keep every curated title,
            # while clusters provide target relevance signals and ordering.
            records.append({
                "title": paper["title"],
                "paper_url": paper["paper_url"],
                "week": issue["week"],
                "clusters": clusters,
            })
    records.sort(key=lambda item: -len(item["clusters"]))
    total = len(records)
    return records[: request["max_records"]], total, reports


def record_text(entry: dict, revision: str, year: int) -> str:
    source_url = f"{REPOSITORY_URL}/blob/{revision}/years/{year}.md"
    return (
        f"{entry['title']}\n"
        f"paper_url: {entry['paper_url']}\n"
        f"week: {entry['week']}\n"
        f"curated_by: DAIR.AI Papers of the Week\n"
        f"source_url: {source_url}\n"
        f"source_revision: {revision}\n"
        f"clusters: {', '.join(entry['clusters'])}"
    )


def build_fixture(request: dict, revision: str, response_hashes: list[str], entries: list[dict], total: int, reports: list[dict], started_at: str) -> dict:
    records, evidence = [], []
    for index, entry in enumerate(entries):
        text = record_text(entry, revision, request["year"])
        record_id = f"raw-{index:04d}"
        records.append({
            "id": record_id,
            "source_uri": f"recorded:dair-ai:{revision}:{index}",
            "media_type": "text/plain",
            "acquired_at": started_at,
            "content": text,
            "content_sha256": sha256_hex(text.encode()),
            "immutable": True,
            "trust": "untrusted_data",
        })
        evidence.append({"id": f"ev-{index:04d}", "raw_record_id": record_id, "byte_start": 0, "byte_end": len(entry["title"].encode()), "quote": entry["title"], "stance": "context"})
    truncated = len(entries) < total
    gaps = [{"id": "gap-curator-boundary", "description": "DAIR.AI is a selective editorial source, so papers not chosen by its curators are outside this retrieval.", "impact": "medium"}, {"id": "gap-no-upstream-license", "description": "The upstream repository declares no license. MOZAK records titles, links and provenance only; DAIR.AI prose summaries are not retained.", "impact": "medium"}]
    if truncated:
        gaps.append({"id": "gap-truncated", "description": f"The selected issues contained {total} papers and this run kept {len(entries)} at the requested cap.", "impact": "high"})
    for report in reports:
        if report["records_matched"] == 0:
            gaps.append({"id": f"gap-empty-{report['name']}", "description": f"No curated paper matched cluster {report['name']} in the selected issues.", "impact": "medium"})
    status = "failed" if not entries else "qualified" if truncated else "supported"
    stages = [{"id": "stage-acquire", "operation": "acquire"}, {"id": "stage-evidence", "operation": "extract_evidence"}, {"id": "stage-gaps", "operation": "identify_gaps"}, {"id": "stage-synthesis", "operation": "synthesize"}, {"id": "stage-audit", "operation": "audit"}, {"id": "stage-export", "operation": "export_planning_inputs"}]
    pipeline_revision = sha256_hex(canonical_json_bytes({"id": PIPELINE_ID, "stages": stages, "adapter": ADAPTER_ID}))
    input_hash = sha256_hex(canonical_json_bytes({"scope_id": request["scope_id"], "year": request["year"], "weeks": request["weeks"], "clusters": request.get("clusters", []), "max_records": request["max_records"], "source_revision": revision, "response_files": response_hashes}))
    run_id = f"run-{sha256_hex(f'{started_at}{pipeline_revision}{input_hash}'.encode())[:24]}"
    overall = status
    run = {
        "contract_version": CONTRACT_VERSION,
        "run_id": run_id,
        "created_at": started_at,
        "source_profile": {"version": 1, "id": SOURCE_PROFILE_ID, "allowed_schemes": ["recorded"], "max_records": request["max_records"], "max_bytes_per_record": 16384, "content_is_untrusted": True, "may_authorize_actions": False},
        "pipeline": {"version": 1, "id": PIPELINE_ID, "revision": pipeline_revision, "source_profile_id": SOURCE_PROFILE_ID, "stages": stages, "budgets": {"max_sources": request["max_records"], "max_raw_bytes": 16384 * request["max_records"], "max_claims": 8, "max_planning_inputs": 8}, "required_artifacts": ["scope", "plan", "raw_records", "evidence", "gaps", "synthesis", "audit", "receipt"], "output_authority": {"planning_inputs_are_proposals": True, "may_mutate_accepted_plans": False}},
        "scope": {"question": request.get("question") or f"Which DAIR.AI curated papers from the latest {request['weeks']} issue(s) are candidate reading for {request['scope_id']}?", "included": [f"DAIR.AI Papers of the Week year {request['year']}", f"latest {request['weeks']} issue(s) at revision {revision}"], "excluded": ["papers not selected by DAIR.AI", "DAIR.AI prose summaries", "paper full text"]},
        "plan": {"steps": ["Resolve the official repository to an exact commit", "Fetch the requested year file at that immutable commit", "Use curator prose transiently for cluster matching", "Record only paper titles, links, issue labels and provenance"], "source_profile_id": SOURCE_PROFILE_ID, "pipeline_id": PIPELINE_ID},
        "raw_records": records,
        "evidence": evidence,
        "gaps": gaps,
        "synthesis": {"summary": f"Recorded {len(entries)} of {total} papers from {request['weeks']} DAIR.AI curated issue(s). Curator prose was not retained.", "claims": [{"id": "claim-inventory", "text": f"The pinned DAIR.AI source listed {total} papers in the selected issues and this run records {len(entries)} title-and-link candidates.", "evidence_ids": [item["id"] for item in evidence[:8]], "status": status}], "overall_claim": overall},
        "audit": {"failures": [], "audited_claim_ids": ["claim-inventory"]},
        "receipt": {"run_id": run_id, "pipeline_id": PIPELINE_ID, "pipeline_revision": pipeline_revision, "adapter_id": ADAPTER_ID, "started_at": started_at, "finished_at": utc_now(), "input_hash": input_hash, "artifact_hash": "", "capabilities": ["network_read", "github_public_repository", "curated_paper_metadata", "metadata_only"], "status": {"supported": "passed", "qualified": "qualified", "failed": "failed"}[overall]},
    }
    run["receipt"]["artifact_hash"] = sha256_hex(canonical_json_bytes(run))
    return {"adapter": ADAPTER_ID, "adapter_version": "1", "capability": "curated_research_metadata_retrieval", "scope_id": request["scope_id"], "effects": EFFECTS, "repository": REPOSITORY, "source_revision": revision, "source_year": request["year"], "weeks_requested": request["weeks"], "clusters": reports, "response_files": response_hashes, "total_curated": total, "records_kept": len(entries), "truncated": truncated, "run": run}


def main(argv: list[str]) -> int:
    if len(argv) < 3 or argv[1] not in {"plan", "fetch"}:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    try:
        request = load_request(Path(argv[2]))
        if argv[1] == "plan":
            print(json.dumps({"schema_version": 1, "command": "dair-ai plan", "adapter": ADAPTER_ID, "repository": REPOSITORY, "scope_id": request["scope_id"], "year": request["year"], "weeks": request["weeks"], "clusters": request.get("clusters", []), "max_records": request["max_records"], "network_performed": False, "effects": EFFECTS}, indent=2, sort_keys=True))
            return 0
        if len(argv) != 4:
            raise AdapterError("fetch requires an output directory")
        output = Path(argv[3])
        if output.exists():
            raise AdapterError(f"refusing to overwrite existing output: {output}")
        started_at = utc_now()
        revision, commit_body = resolve_revision()
        year_url = f"{RAW_ROOT}/{revision}/years/{request['year']}.md"
        year_body = request_bytes(year_url)
        markdown = year_body.decode("utf-8", "strict")
        issues = parse_weekly_markdown(markdown)
        if len(issues) < request["weeks"]:
            raise AdapterError(f"requested {request['weeks']} issues but source contains {len(issues)}")
        entries, total, reports = select_records(issues, request)
        if not entries:
            raise AdapterError("selected DAIR.AI issues contained no parseable papers")
        response_hashes = [sha256_hex(commit_body), sha256_hex(year_body)]
        fixture = build_fixture(request, revision, response_hashes, entries, total, reports, started_at)
        staging = output.with_name(output.name + ".staging")
        if staging.exists():
            raise AdapterError(f"refusing existing staging path: {staging}")
        staging.mkdir(parents=True)
        responses = staging / "responses"
        responses.mkdir()
        (responses / response_hashes[0]).write_bytes(commit_body)
        (responses / response_hashes[1]).write_bytes(year_body)
        (staging / "fixture.json").write_text(json.dumps(fixture, indent=2, sort_keys=True, ensure_ascii=False) + "\n")
        staging.rename(output)
        print(json.dumps({"schema_version": 1, "command": "dair-ai fetch", "fixture": str(output / "fixture.json"), "source_revision": revision, "issues_examined": request["weeks"], "total_curated": total, "records_kept": len(entries), "truncated": len(entries) < total}, indent=2, sort_keys=True))
        return 0
    except AdapterError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
