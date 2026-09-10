#!/usr/bin/env python3
"""arXiv research adapter for MOZAK.

MOZAK performs no networking and must stay reproducible, so this adapter is the
only component that touches the network. It fetches from the public arXiv API,
stores the exact returned bytes content-addressed, and emits a provider fixture
that `mozak research normalize arxiv` validates into a research run.

The adapter proposes. It never accepts, promotes, or mutates project state, and
every fetched abstract is untrusted data whose byte range backs each citation.

Two modes:

  catchup  every submission in a date window, so nothing published is missed
  query    submissions matching bounded terms, for relevance

Usage:
  arxiv_fetch.py plan    REQUEST_JSON                 # dry run, no network
  arxiv_fetch.py fetch   REQUEST_JSON OUTPUT_DIR      # network, writes fixture
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
import time
import urllib.parse
import urllib.request
import urllib.error
from datetime import datetime, timedelta, timezone
from pathlib import Path

API = "https://export.arxiv.org/api/query"
# arXiv asks callers to leave at least three seconds between requests.
MIN_REQUEST_INTERVAL_SECONDS = 3.0
# arXiv rate-limits bursts with HTTP 429 and occasionally returns a transient
# 5xx. A retrieval that gives up on the first one loses the whole window, so
# retry a bounded number of times with exponential backoff. The budget is small
# and fixed: it smooths a transient refusal without hammering the source.
MAX_REQUEST_ATTEMPTS = 5
RETRY_BACKOFF_SECONDS = 5.0
RETRYABLE_STATUS = frozenset({429, 500, 502, 503, 504})
PAGE_SIZE = 100
MAX_RECORDS_CEILING = 2000
CONTRACT_VERSION = 1
ADAPTER_ID = "adapter-arxiv-v1"
PIPELINE_ID = "pipeline-arxiv-v1"
SOURCE_PROFILE_ID = "source-arxiv-v1"
USER_AGENT = "mozak-arxiv-adapter/1 (research metadata; contact via repository)"

# Declared effects. arXiv is a read-only public API, but the declaration is
# explicit because a research adapter that silently causes an external effect is
# the failure this field exists to prevent.
EFFECTS = {
    "network_used": True,
    "external_writes": [],
    "mutations_performed": "none",
    "irreversible_effects": [],
    "dry_run_available": True,
    "owner_approval_required": False,
}


class AdapterError(Exception):
    """A bounded adapter failure with no partial output."""


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical_json_bytes(value: object) -> bytes:
    """Matches the canonical form MOZAK hashes: compact, key-sorted UTF-8.

    `ensure_ascii` must stay false: MOZAK emits raw UTF-8 rather than escaped
    sequences, and paper titles routinely contain non-ASCII characters.
    """
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load_request(path: Path) -> dict:
    """Loads the owner-reviewed request. Nothing is fetched from unreviewed input."""
    try:
        request = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise AdapterError(f"cannot read request {path}: {error}") from error

    allowed = {
        "schema_version",
        "topic_id",
        "mode",
        "categories",
        "terms",
        "clusters",
        "days",
        "window",
        "max_records",
        "max_records_per_cluster",
        "question",
    }
    unknown = set(request) - allowed
    if unknown:
        raise AdapterError(f"unknown request fields: {sorted(unknown)}")
    if request.get("schema_version") != 1:
        raise AdapterError("request schema_version must be 1")
    if request.get("mode") not in {"catchup", "query"}:
        raise AdapterError("mode must be catchup or query")
    if not request.get("topic_id"):
        raise AdapterError("request must name the topic_id it serves")
    categories = request.get("categories") or []
    if not categories or not all(re.fullmatch(r"[a-z\-]+\.[A-Z]{2}", c) for c in categories):
        raise AdapterError("categories must be arXiv category codes such as cs.AI")
    if request["mode"] == "query" and not (request.get("terms") or request.get("clusters")):
        raise AdapterError("query mode requires terms or clusters")
    if request.get("clusters"):
        if request.get("terms"):
            raise AdapterError("use either flat terms or named clusters, not both")
        names = set()
        for cluster in request["clusters"]:
            if set(cluster) - {"name", "terms"}:
                raise AdapterError("a cluster has only a name and terms")
            name = cluster.get("name", "")
            if not re.fullmatch(r"[a-z0-9\-]+", name):
                raise AdapterError(f"cluster name must be lowercase-hyphenated: {name!r}")
            if name in names:
                raise AdapterError(f"duplicate cluster name: {name}")
            names.add(name)
            if not cluster.get("terms"):
                raise AdapterError(f"cluster {name} has no terms")
        per_cluster = int(request.get("max_records_per_cluster", 50))
        if not 1 <= per_cluster <= 500:
            raise AdapterError("max_records_per_cluster must be between 1 and 500")
        request["max_records_per_cluster"] = per_cluster
    cap = int(request.get("max_records", 200))
    if not 1 <= cap <= MAX_RECORDS_CEILING:
        raise AdapterError(f"max_records must be between 1 and {MAX_RECORDS_CEILING}")
    request["max_records"] = cap
    return request


def resolve_window(request: dict) -> tuple[str, str]:
    """Returns an explicit UTC window, so a run records exactly what it covered."""
    if "window" in request:
        window = request["window"]
        try:
            start, end = window["start"], window["end"]
        except (KeyError, TypeError) as error:
            raise AdapterError("window must have start and end") from error
    else:
        days = int(request.get("days", 1))
        if not 1 <= days <= 90:
            raise AdapterError("days must be between 1 and 90")
        end_dt = datetime.now(timezone.utc)
        start_dt = end_dt - timedelta(days=days)
        start = start_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        end = end_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    for value in (start, end):
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", value):
            raise AdapterError(f"window bound is not an exact UTC timestamp: {value}")
    if start >= end:
        raise AdapterError("window start must precede its end")
    return start, end


def arxiv_stamp(timestamp: str) -> str:
    return timestamp.replace("-", "").replace(":", "").replace("T", "").replace("Z", "")[:12]


def term_clause(terms: list[str]) -> str:
    """Matches title or abstract, quoted so multi-word terms stay phrases."""
    return " OR ".join(f'abs:"{term}" OR ti:"{term}"' for term in terms)


def build_cluster_queries(request: dict, start: str, end: str) -> list[dict]:
    """One bounded query per interest cluster.

    Searching per cluster is what keeps retrieval small: the server filters, so
    only matching papers are downloaded, and each cluster reports its own count
    including zero.
    """
    categories = " OR ".join(f"cat:{c}" for c in request["categories"])
    window = f"submittedDate:[{arxiv_stamp(start)} TO {arxiv_stamp(end)}]"
    return [
        {
            "name": cluster["name"],
            "terms": cluster["terms"],
            "search_query": (
                f"({categories}) AND {window} AND ({term_clause(cluster['terms'])})"
            ),
        }
        for cluster in request["clusters"]
    ]


def build_search_query(request: dict, start: str, end: str) -> str:
    categories = " OR ".join(f"cat:{c}" for c in request["categories"])
    window = f"submittedDate:[{arxiv_stamp(start)} TO {arxiv_stamp(end)}]"
    clause = f"({categories}) AND {window}"
    if request["mode"] == "query" and request.get("terms"):
        # Match either the title or the abstract, quoted so multi-word terms stay
        # phrases rather than becoming implicit disjunctions.
        clause = f"{clause} AND ({term_clause(request['terms'])})"
    return clause


def retry_delay_seconds(error: urllib.error.HTTPError, attempt: int) -> float:
    """Seconds to wait before retrying. A server-stated Retry-After wins."""
    stated = error.headers.get("Retry-After") if error.headers else None
    if stated:
        try:
            return max(MIN_REQUEST_INTERVAL_SECONDS, float(stated.strip()))
        except ValueError:
            pass
    return RETRY_BACKOFF_SECONDS * (2 ** (attempt - 1))


def fetch_page(search_query: str, start_index: int, page_size: int) -> bytes:
    parameters = urllib.parse.urlencode(
        {
            "search_query": search_query,
            "start": start_index,
            "max_results": page_size,
            "sortBy": "submittedDate",
            "sortOrder": "descending",
        }
    )
    request = urllib.request.Request(
        f"{API}?{parameters}", headers={"User-Agent": USER_AGENT}
    )
    last_error: Exception | None = None
    attempts_made = 0
    for attempt in range(1, MAX_REQUEST_ATTEMPTS + 1):
        attempts_made = attempt
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            last_error = error
            if error.code not in RETRYABLE_STATUS or attempt == MAX_REQUEST_ATTEMPTS:
                break
            delay = retry_delay_seconds(error, attempt)
            print(
                f"warning: arXiv returned HTTP {error.code}; "
                f"retrying in {delay:.0f}s (attempt {attempt} of "
                f"{MAX_REQUEST_ATTEMPTS - 1})",
                file=sys.stderr,
            )
            time.sleep(delay)
        except Exception as error:  # noqa: BLE001 - reported, never swallowed
            raise AdapterError(f"arXiv request failed: {error}") from error
    plural = "attempt" if attempts_made == 1 else "attempts"
    raise AdapterError(
        f"arXiv request failed after {attempts_made} {plural}: {last_error}"
    ) from last_error


def parse_entries(xml: str) -> tuple[int, list[dict]]:
    total_match = re.search(r"<opensearch:totalResults[^>]*>(\d+)<", xml)
    total = int(total_match.group(1)) if total_match else 0
    entries = []
    for block in re.findall(r"<entry>(.*?)</entry>", xml, re.S):

        def field(name: str, default: str = "") -> str:
            found = re.search(rf"<{name}[^>]*>(.*?)</{name}>", block, re.S)
            return " ".join(found.group(1).split()) if found else default

        identifier = field("id")
        if not identifier:
            continue
        entries.append(
            {
                "arxiv_id": identifier.rsplit("/", 1)[-1],
                "url": identifier,
                "title": unescape(field("title")),
                "abstract": unescape(field("summary")),
                "published": field("published"),
                "updated": field("updated"),
                "authors": [
                    unescape(" ".join(name.split()))
                    for name in re.findall(r"<author>\s*<name>(.*?)</name>", block, re.S)
                ],
                "categories": re.findall(r'<category[^>]*term="([^"]+)"', block),
            }
        )
    return total, entries


def unescape(text: str) -> str:
    for entity, character in (
        ("&amp;", "&"),
        ("&lt;", "<"),
        ("&gt;", ">"),
        ("&quot;", '"'),
        ("&apos;", "'"),
    ):
        text = text.replace(entity, character)
    return text


def collect(search_query: str, cap: int, raw_dir: Path | None) -> tuple[int, list[dict], list[str]]:
    """Pages through results, storing each exact response body when a directory is given."""
    total = 0
    entries: list[dict] = []
    pages: list[str] = []
    start_index = 0
    while len(entries) < cap:
        if start_index:
            time.sleep(MIN_REQUEST_INTERVAL_SECONDS)
        page_size = min(PAGE_SIZE, cap - len(entries))
        body = fetch_page(search_query, start_index, page_size)
        digest = sha256_hex(body)
        if raw_dir is not None:
            raw_dir.mkdir(parents=True, exist_ok=True)
            (raw_dir / digest).write_bytes(body)
        pages.append(digest)
        page_total, page_entries = parse_entries(body.decode("utf-8", "replace"))
        total = page_total or total
        if not page_entries:
            break
        entries.extend(page_entries)
        start_index += len(page_entries)
        if start_index >= total:
            break
    return total, entries[:cap], pages


def collect_clusters(queries: list[dict], per_cluster: int,
                     raw_dir: Path) -> tuple[list[dict], list[str], list[dict]]:
    """Retrieves each cluster separately and merges without duplicating papers.

    A paper matching several clusters is stored once and records every cluster
    that matched it, which is the signal worth keeping: overlap across interests
    is stronger evidence of relevance than a single term hit.
    """
    by_id: dict[str, dict] = {}
    pages: list[str] = []
    reports: list[dict] = []
    for index, query in enumerate(queries):
        if index:
            time.sleep(MIN_REQUEST_INTERVAL_SECONDS)
        total, entries, cluster_pages = collect(
            query["search_query"], per_cluster, raw_dir
        )
        pages.extend(cluster_pages)
        for entry in entries:
            existing = by_id.get(entry["arxiv_id"])
            if existing is None:
                entry = dict(entry, clusters=[query["name"]])
                by_id[entry["arxiv_id"]] = entry
            elif query["name"] not in existing["clusters"]:
                existing["clusters"].append(query["name"])
        reports.append(
            {
                "name": query["name"],
                "terms": query["terms"],
                "search_query": query["search_query"],
                "total_matched": total,
                "records_kept": len(entries),
                "truncated": len(entries) < total,
            }
        )
    # Sort by cluster breadth, then recency: a paper several interests touch is
    # the one worth reading first.
    merged = sorted(
        by_id.values(),
        key=lambda entry: (-len(entry["clusters"]), entry["published"]),
    )
    return merged, pages, reports


def record_text(entry: dict) -> str:
    """The stored record text. Evidence byte ranges index into this exact string."""
    return (
        f"{entry['title']}\n"
        f"{entry['abstract']}\n"
        f"authors: {', '.join(entry['authors'])}\n"
        f"categories: {', '.join(entry['categories'])}\n"
        f"published: {entry['published']}\n"
        f"url: {entry['url']}\n"
        f"clusters: {', '.join(entry.get('clusters', []))}"
    )


def build_fixture(request: dict, start: str, end: str, search_query: str,
                  total: int, entries: list[dict], pages: list[str],
                  started_at: str, clusters: list[dict] | None = None) -> dict:
    records = []
    evidence = []
    for index, entry in enumerate(entries):
        text = record_text(entry)
        record_id = f"raw-{index:04d}"
        records.append(
            {
                "id": record_id,
                "source_uri": f"recorded:arxiv:{entry['arxiv_id']}",
                "media_type": "text/plain",
                "acquired_at": started_at,
                "content": text,
                "content_sha256": sha256_hex(text.encode("utf-8")),
                "immutable": True,
                "trust": "untrusted_data",
            }
        )
        # The title is the first line, so its byte range is exact and checkable.
        title_bytes = len(entry["title"].encode("utf-8"))
        evidence.append(
            {
                "id": f"ev-{index:04d}",
                "raw_record_id": record_id,
                "byte_start": 0,
                "byte_end": title_bytes,
                "quote": entry["title"],
                "stance": "context",
            }
        )

    truncated = len(entries) < total
    gaps = []
    if truncated:
        gaps.append(
            {
                "id": "gap-truncated",
                "description": (
                    f"The window matched {total} submissions and this run kept "
                    f"{len(entries)} at the requested cap, so the remainder was "
                    "not examined."
                ),
                "impact": "high",
            }
        )
    if request["mode"] == "query":
        gaps.append(
            {
                "id": "gap-term-recall",
                "description": (
                    "Term matching is literal over title and abstract, so relevant "
                    "work using different vocabulary is absent from this run."
                ),
                "impact": "medium",
            }
        )
    else:
        gaps.append(
            {
                "id": "gap-category-boundary",
                "description": (
                    "Only the requested categories were searched, so cross-listed "
                    "work outside them is absent from this run."
                ),
                "impact": "medium",
            }
        )
    # A cluster that matched nothing is a reportable result, not silence: the
    # vocabulary may simply not be the field's.
    for report in clusters or []:
        if report["total_matched"] == 0:
            gaps.append(
                {
                    "id": f"gap-empty-{report['name']}",
                    "description": (
                        f"Cluster {report['name']} matched no submissions in this "
                        "window, so either nothing was published or its terms do "
                        "not match the vocabulary the field uses."
                    ),
                    "impact": "medium",
                }
            )
        elif report["truncated"]:
            gaps.append(
                {
                    "id": f"gap-truncated-{report['name']}",
                    "description": (
                        f"Cluster {report['name']} matched {report['total_matched']} "
                        f"submissions and kept {report['records_kept']} at its cap."
                    ),
                    "impact": "high",
                }
            )
    gaps.append(
        {
            "id": "gap-metadata-only",
            "description": (
                "Only titles, abstracts and metadata were retrieved. No claim here "
                "rests on a paper's full text, method or results."
            ),
            "impact": "medium",
        }
    )

    # The claim's own status carries the limitation, because the receipt must
    # transparently reflect claim-level support rather than a separately
    # asserted overall verdict.
    if not entries:
        claim_status = "failed"
    elif truncated:
        claim_status = "qualified"
    else:
        claim_status = "supported"
    claims = [
        {
            "id": "claim-inventory",
            "text": (
                f"The arXiv API reported {total} submissions matching the requested "
                f"categories and window, and this run records {len(entries)} of them "
                "as candidate reading."
            ),
            "evidence_ids": [item["id"] for item in evidence[:8]],
            "status": claim_status,
        }
    ]
    overall = {"failed": "failed", "qualified": "qualified", "supported": "supported"}[
        claim_status
    ]

    profile = {
        "version": 1,
        "id": SOURCE_PROFILE_ID,
        # MOZAK validates recorded bytes, never a live resource. The network
        # access happened here, in the adapter; what crosses the boundary is an
        # immutable snapshot, so the scheme is `recorded` and the live URL is
        # preserved in the evidence locator instead.
        "allowed_schemes": ["recorded"],
        "max_records": request["max_records"],
        "max_bytes_per_record": 65536,
        "content_is_untrusted": True,
        "may_authorize_actions": False,
    }
    stages = [
        {"id": "stage-acquire", "operation": "acquire"},
        {"id": "stage-evidence", "operation": "extract_evidence"},
        {"id": "stage-gaps", "operation": "identify_gaps"},
        {"id": "stage-synthesis", "operation": "synthesize"},
        {"id": "stage-audit", "operation": "audit"},
        {"id": "stage-export", "operation": "export_planning_inputs"},
    ]
    pipeline_revision = sha256_hex(
        canonical_json_bytes({"id": PIPELINE_ID, "stages": stages, "adapter": ADAPTER_ID})
    )
    pipeline = {
        "version": 1,
        "id": PIPELINE_ID,
        "revision": pipeline_revision,
        "source_profile_id": SOURCE_PROFILE_ID,
        "stages": stages,
        "budgets": {
            "max_sources": request["max_records"],
            "max_raw_bytes": 65536 * request["max_records"],
            "max_claims": 8,
            "max_planning_inputs": 8,
        },
        "required_artifacts": [
            "scope",
            "plan",
            "raw_records",
            "evidence",
            "gaps",
            "synthesis",
            "audit",
            "receipt",
        ],
        "output_authority": {
            "planning_inputs_are_proposals": True,
            "may_mutate_accepted_plans": False,
        },
    }

    input_hash = sha256_hex(
        canonical_json_bytes(
            {
                "search_query": search_query,
                "window": {"start": start, "end": end},
                "mode": request["mode"],
                "categories": request["categories"],
                "terms": request.get("terms", []),
                "max_records": request["max_records"],
                "response_pages": pages,
            }
        )
    )
    run_id = f"run-{sha256_hex(f'{started_at}\n{pipeline_revision}\n{input_hash}'.encode())[:24]}"

    question = request.get("question") or (
        f"Which {'/'.join(request['categories'])} submissions between {start} and {end} "
        "are candidate reading for this topic?"
    )
    run = {
        "contract_version": CONTRACT_VERSION,
        "run_id": run_id,
        "created_at": started_at,
        "source_profile": profile,
        "pipeline": pipeline,
        "scope": {
            "question": question,
            "included": [f"arXiv API submissions in {start} to {end}"]
            + [f"category {c}" for c in request["categories"]],
            "excluded": [
                "full paper text",
                "categories not requested",
                "submissions outside the window",
            ],
        },
        "plan": {
            "steps": [
                "Query the arXiv API for the requested categories and window",
                "Store each exact response body content-addressed",
                "Record one untrusted metadata record per submission",
                "Cite each title by exact byte range",
            ],
            "source_profile_id": SOURCE_PROFILE_ID,
            "pipeline_id": PIPELINE_ID,
        },
        "raw_records": records,
        "evidence": evidence,
        "gaps": gaps,
        "synthesis": {
            "summary": (
                f"{len(entries)} candidate submissions recorded from {total} matches "
                f"for {'/'.join(request['categories'])} between {start} and {end}. "
                "Titles and abstracts only; relevance remains an owner judgement."
            ),
            "claims": claims,
            "overall_claim": overall,
        },
        "audit": {"failures": [], "audited_claim_ids": ["claim-inventory"]},
        "receipt": {
            "run_id": run_id,
            "pipeline_id": PIPELINE_ID,
            "pipeline_revision": pipeline_revision,
            "adapter_id": ADAPTER_ID,
            "started_at": started_at,
            "finished_at": utc_now(),
            "input_hash": input_hash,
            "artifact_hash": "",
            "capabilities": ["network_read", "arxiv_api", "metadata_only"],
            "status": {"supported": "passed", "qualified": "qualified", "failed": "failed"}[
                overall
            ],
        },
    }
    run["receipt"]["artifact_hash"] = sha256_hex(canonical_json_bytes(run))
    return {
        "adapter": ADAPTER_ID,
        "adapter_version": "1",
        "capability": "research_metadata_retrieval",
        "topic_id": request["topic_id"],
        "effects": EFFECTS,
        "request": {
            "mode": request["mode"],
            "categories": request["categories"],
            "terms": request.get("terms", []),
            "window": {"start": start, "end": end},
            "search_query": search_query,
            "max_records": request["max_records"],
        },
        "clusters": clusters or [],
        "response_pages": pages,
        "total_matched": total,
        "records_kept": len(entries),
        "truncated": truncated,
        "run": run,
    }


def main(argv: list[str]) -> int:
    if len(argv) < 3 or argv[1] not in {"plan", "fetch"}:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    command = argv[1]
    request = load_request(Path(argv[2]))
    start, end = resolve_window(request)
    search_query = build_search_query(request, start, end)

    if command == "plan":
        # Dry run: report exactly what would be requested, touching no network.
        print(
            json.dumps(
                {
                    "schema_version": 1,
                    "command": "arxiv plan",
                    "adapter": ADAPTER_ID,
                    "topic_id": request["topic_id"],
                    "mode": request["mode"],
                    "categories": request["categories"],
                    "terms": request.get("terms", []),
                    "window": {"start": start, "end": end},
                    "search_query": search_query,
                    "clusters": build_cluster_queries(request, start, end)
                    if request.get("clusters")
                    else [],
                    "max_records": request["max_records"],
                    "effects": EFFECTS,
                    "network_performed": False,
                },
                indent=2,
                sort_keys=True,
            )
        )
        return 0

    if len(argv) < 4:
        raise AdapterError("fetch requires an output directory")
    output_dir = Path(argv[3])
    if output_dir.exists() and any(output_dir.iterdir()):
        raise AdapterError(f"output directory is not empty: {output_dir}")
    started_at = utc_now()
    raw_dir = output_dir / "responses"
    if request.get("clusters"):
        queries = build_cluster_queries(request, start, end)
        entries, pages, reports = collect_clusters(
            queries, request["max_records_per_cluster"], raw_dir
        )
        # The total is the distinct union across clusters, since a paper matching
        # two interests is one paper.
        total = len(entries)
        entries = entries[: request["max_records"]]
        search_query = " ;; ".join(query["search_query"] for query in queries)
        fixture = build_fixture(
            request, start, end, search_query, total, entries, pages, started_at,
            clusters=reports,
        )
    else:
        total, entries, pages = collect(search_query, request["max_records"], raw_dir)
        reports = []
        fixture = build_fixture(
            request, start, end, search_query, total, entries, pages, started_at
        )
    fixture_path = output_dir / "fixture.json"
    fixture_path.write_text(json.dumps(fixture, indent=2, sort_keys=True) + "\n")
    print(
        json.dumps(
            {
                "schema_version": 1,
                "command": "arxiv fetch",
                "adapter": ADAPTER_ID,
                "fixture": str(fixture_path),
                "run_id": fixture["run"]["run_id"],
                "total_matched": total,
                "records_kept": len(entries),
                "truncated": fixture["truncated"],
                "response_pages": len(pages),
                "clusters": [
                    {
                        "name": report["name"],
                        "total_matched": report["total_matched"],
                        "records_kept": report["records_kept"],
                    }
                    for report in reports
                ],
                "authority": "proposal_only",
            },
            indent=2,
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv))
    except AdapterError as error:
        print(f"error: {error}", file=sys.stderr)
        sys.exit(1)
