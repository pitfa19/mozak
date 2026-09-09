#!/usr/bin/env python3
"""Discover and watch agentic tooling repositories on GitHub.

usage:
  github_tooling_fetch.py plan  REQUEST_JSON
  github_tooling_fetch.py fetch REQUEST_JSON OUTPUT_DIR

Two modes, one contract:

  discover  runs owner-declared topic and keyword queries to surface
            repositories the owner has not seen. Output is a proposal list.
  watch     tracks an explicit owner-curated repository list, regardless of
            whether anything is trending.

Discovery never promotes. Moving a repository from discovered to watched is an
owner decision recorded in the request, which is why this adapter reports
candidates rather than adding them itself.

MOZAK performs no networking. This adapter does, outside MOZAK, and MOZAK
validates the snapshot it returned.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

API = "https://api.github.com"
ADAPTER_ID = "adapter-github-tooling-v1"
PIPELINE_ID = "pipeline-github-tooling-v1"
SOURCE_PROFILE_ID = "source-github-tooling-v1"
CONTRACT_VERSION = 1
MAX_RECORDS_CEILING = 250
MAX_QUERIES = 12
MAX_WATCHLIST = 100
SEARCH_PAGE = 50
USER_AGENT = "mozak-github-tooling-adapter/1 (repository release metadata)"
REPO_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._-]*$")

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


def token() -> str | None:
    """Resolves a token without requiring one; public data needs none.

    A token only raises the rate limit here. It is never recorded in a run.
    """
    for name in ("MOZAK_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"):
        value = os.environ.get(name)
        if value:
            return value
    gh = shutil.which("gh")
    if gh:
        result = subprocess.run([gh, "auth", "token"], capture_output=True, text=True, check=False)
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
    return None


def load_request(path: Path) -> dict:
    try:
        request = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise AdapterError(f"cannot read request {path}: {error}") from error
    allowed = {
        "schema_version",
        "scope_id",
        "mode",
        "queries",
        "watchlist",
        "pushed_since",
        "min_stars",
        "max_records",
        "question",
    }
    unknown = set(request) - allowed
    if unknown:
        raise AdapterError(f"unknown request fields: {sorted(unknown)}")
    if request.get("schema_version") != 1:
        raise AdapterError("request schema_version must be 1")
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", request.get("scope_id", "")):
        raise AdapterError("request must name a lowercase-hyphenated scope_id")

    mode = request.get("mode")
    if mode not in {"discover", "watch"}:
        raise AdapterError("mode must be discover or watch")

    max_records = int(request.get("max_records", 40))
    if not 1 <= max_records <= MAX_RECORDS_CEILING:
        raise AdapterError(f"max_records must be between 1 and {MAX_RECORDS_CEILING}")
    request["max_records"] = max_records

    since = request.get("pushed_since")
    if since is not None and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", since):
        raise AdapterError("pushed_since must be a YYYY-MM-DD date")

    min_stars = int(request.get("min_stars", 0))
    if min_stars < 0:
        raise AdapterError("min_stars must not be negative")
    request["min_stars"] = min_stars

    queries = request.get("queries", [])
    watchlist = request.get("watchlist", [])
    if not isinstance(queries, list) or not isinstance(watchlist, list):
        raise AdapterError("queries and watchlist must be lists")

    if mode == "discover":
        if not queries:
            raise AdapterError("discover mode requires at least one query")
        if len(queries) > MAX_QUERIES:
            raise AdapterError(f"discover mode allows at most {MAX_QUERIES} queries")
        normalized = []
        for entry in queries:
            if not isinstance(entry, dict):
                raise AdapterError("each query must be an object")
            name = entry.get("name", "")
            terms = entry.get("terms", [])
            if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", name):
                raise AdapterError("query name must be lowercase-hyphenated")
            if not isinstance(terms, list) or not terms:
                raise AdapterError(f"query {name} must declare terms")
            for term in terms:
                if not isinstance(term, str) or not term.strip():
                    raise AdapterError(f"query {name} has an empty term")
                # GitHub search qualifiers are the whole expressive surface
                # here. Anything else would let a request smuggle in an
                # arbitrary URL.
                if not re.fullmatch(r"[A-Za-z0-9 :._+#/-]+", term):
                    raise AdapterError(f"query {name} term has unsupported characters: {term}")
            normalized.append({"name": name, "terms": [t.strip() for t in terms]})
        request["queries"] = normalized
        request["watchlist"] = []
    else:
        if not watchlist:
            raise AdapterError("watch mode requires a non-empty watchlist")
        if len(watchlist) > MAX_WATCHLIST:
            raise AdapterError(f"watch mode allows at most {MAX_WATCHLIST} repositories")
        seen = set()
        for repo in watchlist:
            if not isinstance(repo, str) or not REPO_PATTERN.fullmatch(repo):
                raise AdapterError(f"watchlist entries must be OWNER/NAME: {repo!r}")
            if repo.lower() in seen:
                raise AdapterError(f"duplicate watchlist entry: {repo}")
            seen.add(repo.lower())
        request["watchlist"] = list(watchlist)
        request["queries"] = []
    return request


def request_json(url: str, auth: str | None) -> tuple[object, bytes]:
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": USER_AGENT,
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if auth:
        headers["Authorization"] = f"Bearer {auth}"
    call = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(call, timeout=30) as response:
            body = response.read()
    except urllib.error.HTTPError as error:
        raise AdapterError(f"GitHub returned HTTP {error.code} for {url}") from error
    except (urllib.error.URLError, TimeoutError) as error:
        raise AdapterError(f"GitHub request failed for {url}: {error}") from error
    try:
        return json.loads(body), body
    except json.JSONDecodeError as error:
        raise AdapterError(f"GitHub returned invalid JSON for {url}: {error}") from error


def search_url(request: dict, terms: list[str]) -> str:
    parts = list(terms)
    if request.get("pushed_since"):
        parts.append(f"pushed:>={request['pushed_since']}")
    if request["min_stars"] > 0:
        parts.append(f"stars:>={request['min_stars']}")
    query = urllib.parse.urlencode(
        {"q": " ".join(parts), "sort": "updated", "order": "desc", "per_page": str(SEARCH_PAGE)}
    )
    return f"{API}/search/repositories?{query}"


def repo_url(full_name: str) -> str:
    return f"{API}/repos/{full_name}"


def write_response(responses: Path, label: str, body: bytes) -> str:
    digest = sha256_hex(body)
    (responses / f"{label}-{digest[:12]}.json").write_bytes(body)
    return digest


def latest_marker(full_name: str, auth: str | None, responses: Path, index: int) -> dict:
    """Resolves what 'newest' means for one repository.

    A release is the clearest signal, but many active projects publish none.
    Falling back to the head commit is what keeps a repository like
    deeplethe/utopia, pushed daily with no releases, from looking dormant.
    """
    try:
        release, body = request_json(f"{repo_url(full_name)}/releases/latest", auth)
    except AdapterError:
        release, body = None, None
    if isinstance(release, dict) and release.get("tag_name"):
        digest = write_response(responses, f"release-{index:03d}", body or b"")
        return {
            "kind": "release",
            "identifier": str(release["tag_name"]),
            "at": str(release.get("published_at") or ""),
            "response_sha256": digest,
        }
    commits, body = request_json(f"{repo_url(full_name)}/commits?per_page=1", auth)
    if not isinstance(commits, list) or not commits:
        raise AdapterError(f"{full_name} exposed neither a release nor a commit")
    digest = write_response(responses, f"commit-{index:03d}", body or b"")
    commit = commits[0]
    return {
        "kind": "commit",
        "identifier": str(commit.get("sha", ""))[:40],
        "at": str(((commit.get("commit") or {}).get("committer") or {}).get("date") or ""),
        "response_sha256": digest,
    }


def collect(request: dict, output: Path) -> tuple[list[dict], list[str], list[dict], int, bool]:
    """Gathers repositories for either mode, recording every response body."""
    auth = token()
    responses = output / "responses"
    responses.mkdir(parents=True, exist_ok=True)
    hashes: list[str] = []
    found: dict[str, dict] = {}
    reports: list[dict] = []
    truncated_search = False

    if request["mode"] == "discover":
        for index, query in enumerate(request["queries"]):
            url = search_url(request, query["terms"])
            value, body = request_json(url, auth)
            hashes.append(write_response(responses, f"search-{index:03d}", body))
            items = value.get("items", []) if isinstance(value, dict) else []
            total = value.get("total_count", 0) if isinstance(value, dict) else 0
            if total > len(items):
                truncated_search = True
            for item in items:
                name = item.get("full_name")
                if not isinstance(name, str) or not REPO_PATTERN.fullmatch(name):
                    continue
                record = found.setdefault(name, {"repo": item, "queries": []})
                if query["name"] not in record["queries"]:
                    record["queries"].append(query["name"])
            reports.append(
                {"name": query["name"], "terms": query["terms"], "records_matched": len(items)}
            )
    else:
        for index, name in enumerate(request["watchlist"]):
            value, body = request_json(repo_url(name), auth)
            hashes.append(write_response(responses, f"repo-{index:03d}", body))
            if not isinstance(value, dict) or not value.get("full_name"):
                raise AdapterError(f"watchlist repository is unavailable: {name}")
            found[str(value["full_name"])] = {"repo": value, "queries": ["watchlist"]}
        reports.append(
            {
                "name": "watchlist",
                "terms": list(request["watchlist"]),
                "records_matched": len(found),
            }
        )

    ordered = sorted(
        found.values(), key=lambda entry: str(entry["repo"].get("pushed_at") or ""), reverse=True
    )
    total_found = len(ordered)
    kept = ordered[: request["max_records"]]
    for index, entry in enumerate(kept):
        entry["marker"] = latest_marker(str(entry["repo"]["full_name"]), auth, responses, index)
        hashes.append(entry["marker"]["response_sha256"])
    return kept, hashes, reports, total_found, truncated_search


def record_text(entry: dict) -> str:
    """Renders retained facts only: identity, activity, licence, topics.

    A repository description is prose its owner controls. It is not retained,
    so a record states what was released rather than how it was pitched.
    """
    repo = entry["repo"]
    marker = entry["marker"]
    license_id = ((repo.get("license") or {}).get("spdx_id")) or "none-declared"
    topics = sorted(repo.get("topics") or [])
    lines = [
        f"repository: {repo.get('full_name')}",
        f"url: {repo.get('html_url')}",
        f"latest_{marker['kind']}: {marker['identifier']}",
        f"latest_at: {marker['at']}",
        f"pushed_at: {repo.get('pushed_at')}",
        f"stars: {repo.get('stargazers_count', 0)}",
        f"language: {repo.get('language') or 'unspecified'}",
        f"license: {license_id}",
        f"archived: {bool(repo.get('archived'))}",
        f"topics: {', '.join(topics) if topics else 'none declared'}",
        f"matched: {', '.join(entry['queries'])}",
        "retention: identity, activity, licence and topics only; repository prose not retained",
    ]
    return "\n".join(lines)


def build_fixture(
    request: dict,
    entries: list[dict],
    reports: list[dict],
    hashes: list[str],
    total_found: int,
    search_incomplete: bool,
    started_at: str,
) -> dict:
    records, evidence = [], []
    for index, entry in enumerate(entries):
        text = record_text(entry)
        record_id = f"raw-{index:04d}"
        full_name = str(entry["repo"]["full_name"])
        records.append(
            {
                "id": record_id,
                "source_uri": f"recorded:github-tooling:{full_name}@{entry['marker']['identifier']}",
                "media_type": "text/plain",
                "acquired_at": started_at,
                "content": text,
                "content_sha256": sha256_hex(text.encode()),
                "immutable": True,
                "trust": "untrusted_data",
            }
        )
        prefix = len(b"repository: ")
        evidence.append(
            {
                "id": f"ev-{index:04d}",
                "raw_record_id": record_id,
                "byte_start": prefix,
                "byte_end": prefix + len(full_name.encode()),
                "quote": full_name,
                "stance": "context",
            }
        )

    mode = request["mode"]
    capped = len(entries) < total_found
    truncated = capped or search_incomplete
    gaps = [
        {
            "id": "gap-stars-are-attention",
            "description": "Stars and recent pushes measure attention and activity, not quality, security or fitness. Nothing here assesses whether a repository is worth adopting.",
            "impact": "medium",
        },
        {
            "id": "gap-license-varies",
            "description": "Repository licences differ and some declare none. Only identity, activity, licence and topic metadata is retained, never repository prose or code.",
            "impact": "medium",
        },
    ]
    if mode == "discover":
        gaps.append(
            {
                "id": "gap-discovery-is-proposal-only",
                "description": "Discovery reports candidates for owner review. A repository becomes watched only when the owner adds it to a watch request, so nothing here is promoted, adopted or accepted.",
                "impact": "high",
            }
        )
        gaps.append(
            {
                "id": "gap-topic-dependent",
                "description": "Discovery relies on declared GitHub topics and search terms, so a relevant repository that declares no matching topic is invisible to this retrieval.",
                "impact": "high",
            }
        )
    else:
        gaps.append(
            {
                "id": "gap-watchlist-is-closed",
                "description": "Watch mode observes exactly the repositories the owner listed. It performs no discovery, so anything absent from the watchlist is outside this retrieval.",
                "impact": "high",
            }
        )
    if truncated:
        if search_incomplete:
            reason = (
                f"A search matched more repositories than one page returns, so the result set was not fully observed. "
                f"Of the {total_found} repositories seen, this run kept {len(entries)}; unseen results may include others."
            )
        else:
            reason = (
                f"{total_found} repositories were found and this run kept the {len(entries)} "
                f"most recently pushed at the requested cap of {request['max_records']}."
            )
        gaps.append({"id": "gap-truncated", "description": reason, "impact": "high"})
    for report in reports:
        if report["records_matched"] == 0:
            gaps.append(
                {
                    "id": f"gap-empty-{report['name']}",
                    "description": f"No repository matched {report['name']} in this retrieval.",
                    "impact": "medium",
                }
            )

    status = "failed" if not entries else "qualified" if truncated else "supported"
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
                "mode": mode,
                "queries": request["queries"],
                "watchlist": request["watchlist"],
                "pushed_since": request.get("pushed_since"),
                "min_stars": request["min_stars"],
                "max_records": request["max_records"],
                "response_files": hashes,
            }
        )
    )
    run_id = f"run-{sha256_hex(f'{started_at}{pipeline_revision}{input_hash}'.encode())[:24]}"
    subject = (
        f"{len(request['queries'])} declared queries"
        if mode == "discover"
        else f"{len(request['watchlist'])} watched repositories"
    )
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
            or (
                f"Which agentic tooling repositories matching {subject} are candidates for {request['scope_id']}?"
                if mode == "discover"
                else f"What have the {subject} for {request['scope_id']} released recently?"
            ),
            "included": [
                f"GitHub {'repository search' if mode == 'discover' else 'repository metadata'} at the recorded time",
                subject,
            ],
            "excluded": [
                "repository descriptions and README prose",
                "source code and release assets",
                "any judgement of quality, security or fitness",
            ]
            + (
                ["repositories declaring no matching topic or term"]
                if mode == "discover"
                else ["repositories absent from the owner's watchlist"]
            ),
        },
        "plan": {
            "steps": [
                "Run only the owner-declared queries or watchlist",
                "Write every exact response body before interpreting it",
                "Resolve each repository's latest release, or its head commit when it publishes none",
                "Record identity, activity, licence and topics only",
            ],
            "source_profile_id": SOURCE_PROFILE_ID,
            "pipeline_id": PIPELINE_ID,
        },
        "raw_records": records,
        "evidence": evidence,
        "gaps": gaps,
        "synthesis": {
            "summary": f"Recorded {len(entries)} repositories from {subject} in {mode} mode. Repository prose was not retained, and no repository was promoted, adopted or assessed.",
            "claims": [
                {
                    "id": "claim-inventory",
                    "text": f"This {mode} run records {len(entries)} repositories with their latest release or head commit as candidate tooling evidence.",
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
                "github_public_api",
                "repository_release_metadata",
                "metadata_only",
            ],
            "status": {"supported": "passed", "qualified": "qualified", "failed": "failed"}[status],
        },
    }
    run["receipt"]["artifact_hash"] = sha256_hex(canonical_json_bytes(run))
    return {
        "adapter": ADAPTER_ID,
        "adapter_version": "1",
        "capability": "repository_release_metadata_retrieval",
        "scope_id": request["scope_id"],
        "effects": EFFECTS,
        "mode": mode,
        "queries": reports if mode == "discover" else [],
        "watchlist": request["watchlist"],
        "pushed_since": request.get("pushed_since"),
        "min_stars": request["min_stars"],
        "response_files": hashes,
        "total_found": total_found,
        "records_kept": len(entries),
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
            planned = (
                [search_url(request, q["terms"]) for q in request["queries"]]
                if request["mode"] == "discover"
                else [repo_url(name) for name in request["watchlist"]]
            )
            print(
                json.dumps(
                    {
                        "schema_version": 1,
                        "command": f"github-tooling plan ({request['mode']})",
                        "network_access": False,
                        "scope_id": request["scope_id"],
                        "mode": request["mode"],
                        "would_request": planned,
                        "max_records": request["max_records"],
                        "authenticated": token() is not None,
                        "effects": EFFECTS,
                        "retention": "identity, activity, licence and topics only",
                        "authority": "proposal_only",
                        "promotion": "discovery never adds to the watchlist; the owner does",
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
        entries, hashes, reports, total_found, search_incomplete = collect(request, output)
        fixture = build_fixture(
            request, entries, reports, hashes, total_found, search_incomplete, started_at
        )
        (output / "fixture.json").write_bytes(canonical_json_bytes(fixture) + b"\n")
        print(
            json.dumps(
                {
                    "schema_version": 1,
                    "command": f"github-tooling fetch ({request['mode']})",
                    "output": str(output),
                    "responses_recorded": len(hashes),
                    "records_kept": fixture["records_kept"],
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
