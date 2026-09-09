#!/usr/bin/env python3
"""Record newly published MCP servers from the official registry.

usage:
  mcp_registry_fetch.py plan  REQUEST_JSON
  mcp_registry_fetch.py fetch REQUEST_JSON OUTPUT_DIR

`plan` performs no network access and reports what a fetch would request.
`fetch` retrieves the registry pages and writes a fixture plus every exact
response body.

MOZAK performs no networking. This adapter does, outside MOZAK, and MOZAK
validates the snapshot it returned. Retrieved records are proposal-only
evidence: nothing here accepts a tool, endorses it, or promotes it.
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

REGISTRY = "https://registry.modelcontextprotocol.io"
SERVERS_API = f"{REGISTRY}/v0/servers"
ADAPTER_ID = "adapter-mcp-registry-v1"
PIPELINE_ID = "pipeline-mcp-registry-v1"
SOURCE_PROFILE_ID = "source-mcp-registry-v1"
CONTRACT_VERSION = 1
MAX_RECORDS_CEILING = 250
PAGE_LIMIT = 100
MAX_PAGES = 20
USER_AGENT = "mozak-mcp-registry-adapter/1 (tool release metadata)"

# Declared before anything runs, so MOZAK can refuse an adapter whose effects
# are unsafe rather than discovering them afterwards.
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
    allowed = {
        "schema_version",
        "scope_id",
        "updated_since",
        "max_records",
        "interests",
        "question",
    }
    unknown = set(request) - allowed
    if unknown:
        raise AdapterError(f"unknown request fields: {sorted(unknown)}")
    if request.get("schema_version") != 1:
        raise AdapterError("request schema_version must be 1")
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", request.get("scope_id", "")):
        raise AdapterError("request must name a lowercase-hyphenated scope_id")

    since = request.get("updated_since")
    if since is not None:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", since):
            raise AdapterError("updated_since must be an RFC3339 UTC instant such as 2026-09-01T00:00:00Z")
    max_records = int(request.get("max_records", 50))
    if not 1 <= max_records <= MAX_RECORDS_CEILING:
        raise AdapterError(f"max_records must be between 1 and {MAX_RECORDS_CEILING}")
    request["max_records"] = max_records

    interests = request.get("interests", [])
    if not isinstance(interests, list):
        raise AdapterError("interests must be a list of named clusters")
    normalized = []
    for cluster in interests:
        if not isinstance(cluster, dict):
            raise AdapterError("each interest cluster must be an object")
        name = cluster.get("name", "")
        terms = cluster.get("terms", [])
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", name):
            raise AdapterError("interest cluster name must be lowercase-hyphenated")
        if not isinstance(terms, list) or not terms or not all(isinstance(t, str) and t.strip() for t in terms):
            raise AdapterError(f"interest cluster {name} must declare non-empty terms")
        normalized.append({"name": name, "terms": [t.strip().lower() for t in terms]})
    request["interests"] = normalized
    return request


def request_bytes(url: str) -> bytes:
    call = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(call, timeout=30) as response:
            return response.read()
    except (urllib.error.URLError, TimeoutError) as error:
        raise AdapterError(f"registry request failed for {url}: {error}") from error


def page_url(request: dict, cursor: str | None) -> str:
    query = {"limit": str(PAGE_LIMIT)}
    if request.get("updated_since"):
        query["updated_since"] = request["updated_since"]
    if cursor:
        query["cursor"] = cursor
    return f"{SERVERS_API}?{urllib.parse.urlencode(query)}"


def fetch_pages(request: dict, output: Path) -> tuple[list[dict], list[str], bool]:
    """Retrieves the whole filtered window, writing every exact response body.

    The registry paginates by server name, not by date, so stopping early would
    return an alphabetical prefix while claiming to report the newest tooling.
    The window is therefore read to its end and the newest are selected
    afterwards. `updated_since` is what keeps that bounded; MAX_PAGES is a hard
    stop that records a truncation gap rather than silently reporting a prefix.
    """
    responses = output / "responses"
    responses.mkdir(parents=True, exist_ok=True)
    entries: list[dict] = []
    hashes: list[str] = []
    cursor: str | None = None
    window_incomplete = False
    for page in range(MAX_PAGES):
        url = page_url(request, cursor)
        body = request_bytes(url)
        digest = sha256_hex(body)
        (responses / f"page-{page:02d}-{digest[:12]}.json").write_bytes(body)
        hashes.append(digest)
        try:
            value = json.loads(body)
        except json.JSONDecodeError as error:
            raise AdapterError(f"registry returned invalid JSON: {error}") from error
        servers = value.get("servers")
        if not isinstance(servers, list):
            raise AdapterError("registry response did not contain a server list")
        entries.extend(servers)
        cursor = (value.get("metadata") or {}).get("nextCursor")
        if not cursor:
            break
    else:
        # The page ceiling was reached with pages still unread, so the window
        # itself was not fully observed.
        window_incomplete = bool(cursor)
    return entries, hashes, window_incomplete


def official_meta(entry: dict) -> dict:
    meta = entry.get("_meta") or {}
    return meta.get("io.modelcontextprotocol.registry/official") or {}


def match_interests(entry: dict, interests: list[dict]) -> list[str]:
    """Matches on prose transiently; the prose itself is never retained."""
    if not interests:
        return []
    server = entry.get("server") or {}
    haystack = " ".join(
        str(server.get(field, "")) for field in ("name", "title", "description")
    ).lower()
    return [cluster["name"] for cluster in interests if any(term in haystack for term in cluster["terms"])]


def select(entries: list[dict], request: dict) -> tuple[list[dict], int, list[dict]]:
    """Keeps the newest matching servers up to the requested cap."""
    seen: set[tuple[str, str]] = set()
    candidates = []
    for entry in entries:
        server = entry.get("server") or {}
        name = server.get("name")
        version = server.get("version")
        if not isinstance(name, str) or not isinstance(version, str) or not name or not version:
            continue
        identity = (name, version)
        if identity in seen:
            continue
        seen.add(identity)
        meta = official_meta(entry)
        if meta.get("status") not in {None, "active"}:
            # A deleted or deprecated publication is not a new tool.
            continue
        clusters = match_interests(entry, request["interests"])
        if request["interests"] and not clusters:
            continue
        candidates.append((entry, clusters, meta.get("updatedAt") or meta.get("publishedAt") or ""))

    total = len(candidates)
    # Newest first, so a cap keeps the most recent rather than an arbitrary page.
    candidates.sort(key=lambda item: item[2], reverse=True)
    kept = candidates[: request["max_records"]]

    reports = []
    for cluster in request["interests"]:
        matched = sum(1 for _, clusters, _ in kept if cluster["name"] in clusters)
        reports.append({"name": cluster["name"], "terms": cluster["terms"], "records_matched": matched})
    return [
        {"entry": entry, "clusters": clusters, "updated_at": updated}
        for entry, clusters, updated in kept
    ], total, reports


def record_text(item: dict) -> str:
    """Renders retained metadata only: identity, version, link, dates, status.

    The registry's descriptions are prose written by third-party publishers.
    They are used transiently for interest matching and are not retained, which
    keeps this adapter's durable output to facts about what was released.
    """
    server = item["entry"].get("server") or {}
    meta = official_meta(item["entry"])
    repository = (server.get("repository") or {}).get("url") or ""
    packages = server.get("packages") or []
    registries = sorted({str(p.get("registryType")) for p in packages if p.get("registryType")})
    lines = [
        f"server: {server.get('name')}",
        f"version: {server.get('version')}",
        f"repository: {repository}" if repository else "repository: (none declared)",
        f"website: {server.get('websiteUrl')}" if server.get("websiteUrl") else "website: (none declared)",
        f"distribution: {', '.join(registries) if registries else 'remote or unspecified'}",
        f"published_at: {meta.get('publishedAt', '')}",
        f"updated_at: {meta.get('updatedAt', '')}",
        f"is_latest: {bool(meta.get('isLatest'))}",
        f"registry_status: {meta.get('status', 'unknown')}",
        f"clusters: {', '.join(item['clusters']) if item['clusters'] else 'no target cluster match'}",
        "retention: identity, version, links and dates only; publisher prose not retained",
    ]
    return "\n".join(lines)


def build_fixture(
    request: dict,
    items: list[dict],
    total: int,
    reports: list[dict],
    response_hashes: list[str],
    window_incomplete: bool,
    started_at: str,
) -> dict:
    records, evidence = [], []
    for index, item in enumerate(items):
        text = record_text(item)
        record_id = f"raw-{index:04d}"
        server = item["entry"].get("server") or {}
        identity = f"{server.get('name')}@{server.get('version')}"
        records.append(
            {
                "id": record_id,
                "source_uri": f"recorded:mcp-registry:{identity}",
                "media_type": "text/plain",
                "acquired_at": started_at,
                "content": text,
                "content_sha256": sha256_hex(text.encode()),
                "immutable": True,
                "trust": "untrusted_data",
            }
        )
        quote = identity
        evidence.append(
            {
                "id": f"ev-{index:04d}",
                "raw_record_id": record_id,
                "byte_start": text.encode().index(b"server: ") + len(b"server: "),
                "byte_end": text.encode().index(b"server: ") + len(b"server: ") + len(str(server.get("name")).encode()),
                "quote": str(server.get("name")),
                "stance": "context",
            }
        )
    truncated = len(items) < total or window_incomplete

    gaps = [
        {
            "id": "gap-mcp-servers-only",
            "description": "The registry lists MCP servers, so agentic tooling that ships no MCP server is outside this retrieval entirely.",
            "impact": "high",
        },
        {
            "id": "gap-self-published",
            "description": "Registry entries are self-published by their authors. Presence records that someone published, not that anyone assessed quality, security or fitness.",
            "impact": "medium",
        },
        {
            "id": "gap-preview-registry",
            "description": "The registry is a preview release whose data may be reset, so this snapshot is the evidence rather than the live service.",
            "impact": "medium",
        },
        {
            "id": "gap-prose-not-retained",
            "description": "Publisher descriptions were used transiently for interest matching and are not retained, so recorded records carry identity and dates only.",
            "impact": "low",
        },
    ]
    if truncated:
        if window_incomplete:
            reason = (
                f"The requested window exceeded this adapter's {MAX_PAGES}-page ceiling, so it was not read to the end. "
                f"Of the {total} matched versions observed, this run kept {len(items)}; unread pages may contain newer entries."
            )
        else:
            reason = (
                f"The window was read to its end and matched {total} server versions, "
                f"of which this run kept the {len(items)} most recently updated at the requested cap."
            )
        gaps.append({"id": "gap-truncated", "description": reason, "impact": "high"})
    for report in reports:
        if report["records_matched"] == 0:
            gaps.append(
                {
                    "id": f"gap-empty-{report['name']}",
                    "description": f"No registry entry matched interest cluster {report['name']} in this retrieval.",
                    "impact": "medium",
                }
            )

    status = "failed" if not items else "qualified" if truncated else "supported"
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
    input_hash = sha256_hex(
        canonical_json_bytes(
            {
                "scope_id": request["scope_id"],
                "updated_since": request.get("updated_since"),
                "interests": request["interests"],
                "max_records": request["max_records"],
                "response_files": response_hashes,
            }
        )
    )
    run_id = f"run-{sha256_hex(f'{started_at}{pipeline_revision}{input_hash}'.encode())[:24]}"
    window = request.get("updated_since") or "the full registry"
    run = {
        "contract_version": CONTRACT_VERSION,
        "run_id": run_id,
        "created_at": started_at,
        "source_profile": {
            "version": 1,
            "id": SOURCE_PROFILE_ID,
            "allowed_schemes": ["recorded"],
            "max_records": request["max_records"],
            "max_bytes_per_record": 16384,
            "content_is_untrusted": True,
            "may_authorize_actions": False,
        },
        "pipeline": {
            "version": 1,
            "id": PIPELINE_ID,
            "revision": pipeline_revision,
            "source_profile_id": SOURCE_PROFILE_ID,
            "stages": stages,
            "budgets": {
                "max_sources": request["max_records"],
                "max_raw_bytes": 16384 * request["max_records"],
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
        },
        "scope": {
            "question": request.get("question")
            or f"Which MCP servers published or updated since {window} are candidate tooling for {request['scope_id']}?",
            "included": [
                "official MCP registry v0 server listings",
                f"entries updated since {window}",
            ],
            "excluded": [
                "agentic tooling that publishes no MCP server",
                "publisher description prose",
                "any judgement of tool quality, security or fitness",
            ],
        },
        "plan": {
            "steps": [
                "Request capped registry pages, following the explicit cursor",
                "Write every exact response body before interpreting it",
                "Use publisher prose transiently for interest matching only",
                "Record server identity, version, links, dates and registry status",
            ],
            "source_profile_id": SOURCE_PROFILE_ID,
            "pipeline_id": PIPELINE_ID,
        },
        "raw_records": records,
        "evidence": evidence,
        "gaps": gaps,
        "synthesis": {
            "summary": f"Recorded {len(items)} of {total} matching MCP server versions from the official registry. Publisher prose was not retained, and presence is publication rather than endorsement.",
            "claims": [
                {
                    "id": "claim-inventory",
                    "text": f"The pinned registry snapshot matched {total} server versions and this run records {len(items)} identity-and-date candidates.",
                    "evidence_ids": [item["id"] for item in evidence[:8]],
                    "status": status,
                }
            ],
            "overall_claim": status,
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
            "capabilities": [
                "network_read",
                "mcp_registry_public_api",
                "tool_release_metadata",
                "metadata_only",
            ],
            "status": {"supported": "passed", "qualified": "qualified", "failed": "failed"}[status],
        },
    }
    run["receipt"]["artifact_hash"] = sha256_hex(canonical_json_bytes(run))
    return {
        "adapter": ADAPTER_ID,
        "adapter_version": "1",
        "capability": "tool_release_metadata_retrieval",
        "scope_id": request["scope_id"],
        "effects": EFFECTS,
        "registry": REGISTRY,
        "updated_since": request.get("updated_since"),
        "interests": reports,
        "response_files": response_hashes,
        "total_matched": total,
        "records_kept": len(items),
        "truncated": truncated,
        "run": run,
    }


def main(argv: list[str]) -> int:
    if len(argv) < 3 or argv[1] not in {"plan", "fetch"}:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    try:
        request = load_request(Path(argv[2]))
        if argv[1] == "plan":
            print(
                json.dumps(
                    {
                        "schema_version": 1,
                        "command": "mcp-registry plan",
                        "network_access": False,
                        "registry": REGISTRY,
                        "would_request": page_url(request, None),
                        "scope_id": request["scope_id"],
                        "updated_since": request.get("updated_since"),
                        "max_records": request["max_records"],
                        "interest_clusters": [c["name"] for c in request["interests"]],
                        "effects": EFFECTS,
                        "retention": "identity, version, links, dates and registry status only",
                        "authority": "proposal_only",
                    },
                    sort_keys=True,
                )
            )
            return 0

        if len(argv) != 4:
            print(__doc__.strip(), file=sys.stderr)
            return 2
        output = Path(argv[3])
        if output.exists():
            raise AdapterError(f"refusing to overwrite an existing run directory: {output}")
        output.mkdir(parents=True)
        started_at = utc_now()
        entries, hashes, window_incomplete = fetch_pages(request, output)
        items, total, reports = select(entries, request)
        fixture = build_fixture(
            request, items, total, reports, hashes, window_incomplete, started_at
        )
        (output / "fixture.json").write_bytes(canonical_json_bytes(fixture) + b"\n")
        print(
            json.dumps(
                {
                    "schema_version": 1,
                    "command": "mcp-registry fetch",
                    "output": str(output),
                    "pages_recorded": len(hashes),
                    "servers_seen": len(entries),
                    "records_kept": fixture["records_kept"],
                    "total_matched": fixture["total_matched"],
                    "truncated": fixture["truncated"],
                    "authority": "proposal_only",
                },
                sort_keys=True,
            )
        )
        return 0
    except AdapterError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
