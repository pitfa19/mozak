#!/usr/bin/env python3
"""HyperResearch vault adapter for MOZAK.

usage:
  hyperresearch_fetch.py plan  REQUEST_JSON
  hyperresearch_fetch.py fetch REQUEST_JSON OUTPUT_DIR

HyperResearch is an external deep-research harness. It does the searching,
fetching, contradiction analysis and citation checking, and it keeps what it
read in a local markdown-plus-SQLite vault. This adapter reads that finished
vault and records what was gathered as bounded, proposal-only evidence.

Two boundaries make this adapter honest rather than a second research engine:

  retention  HyperResearch keeps full source bodies forever. MOZAK does not.
             Only identity, source, provenance and content hashes are retained,
             so a record states which source was read and how to re-read it,
             never the third-party prose itself.

  authority  A vault note is untrusted web text that an external agent chose to
             fetch. Presence in the vault records that something was read, not
             that it is true, complete, or worth adopting. Promotion to a Scope
             input or a planning input stays an owner decision.

This adapter performs no networking. HyperResearch already did that, outside
MOZAK, at fetch time. The adapter reads the local vault the harness left behind
and pins the exact bytes it observed.
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ADAPTER_ID = "adapter-hyperresearch-v1"
PIPELINE_ID = "pipeline-hyperresearch-v1"
SOURCE_PROFILE_ID = "source-hyperresearch-v1"
CONTRACT_VERSION = 1
MAX_RECORDS_CEILING = 250
MAX_BYTES_PER_RECORD = 16384
MAX_SELECTORS = 24
NOTE_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")

# Declared effects. The adapter shells out to the HyperResearch CLI in a
# read-only mode and writes only inside its own output directory, which is the
# same shape every MOZAK research adapter declares.
EFFECTS = {
    "network_used": False,
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
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode(
        "utf-8"
    )


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load_request(path: Path) -> dict:
    """Loads the owner-reviewed request. Nothing is read from unreviewed input."""
    try:
        request = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise AdapterError(f"cannot read request {path}: {error}") from error

    allowed = {
        "schema_version",
        "scope_id",
        "vault_root",
        "select",
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

    vault = request.get("vault_root")
    if not isinstance(vault, str) or not vault:
        raise AdapterError("request must name the vault_root it reads")
    vault_path = Path(vault).expanduser()
    if not vault_path.is_absolute():
        raise AdapterError("vault_root must be an absolute path")
    if not (vault_path / "research").is_dir():
        raise AdapterError(f"vault_root is not a hyperresearch vault: {vault_path}")
    request["vault_root"] = str(vault_path)

    max_records = int(request.get("max_records", 50))
    if not 1 <= max_records <= MAX_RECORDS_CEILING:
        raise AdapterError(f"max_records must be between 1 and {MAX_RECORDS_CEILING}")
    request["max_records"] = max_records

    select = request.get("select", {})
    if not isinstance(select, dict):
        raise AdapterError("select must be an object")
    if set(select) - {"note_ids", "tags"}:
        raise AdapterError("select accepts note_ids and tags only")
    note_ids = select.get("note_ids", [])
    tags = select.get("tags", [])
    if not isinstance(note_ids, list) or not isinstance(tags, list):
        raise AdapterError("note_ids and tags must be lists")
    if len(note_ids) > MAX_SELECTORS or len(tags) > MAX_SELECTORS:
        raise AdapterError(f"select accepts at most {MAX_SELECTORS} entries per field")
    for note_id in note_ids:
        if not isinstance(note_id, str) or not NOTE_ID_PATTERN.fullmatch(note_id):
            raise AdapterError(f"note id is not a safe vault identifier: {note_id!r}")
    for tag in tags:
        if not isinstance(tag, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._/-]*", tag):
            raise AdapterError(f"tag is not a safe vault tag: {tag!r}")
    request["select"] = {"note_ids": list(note_ids), "tags": list(tags)}
    return request


def cli() -> str:
    """Resolves the HyperResearch CLI. Its absence is a bounded failure."""
    found = shutil.which("hyperresearch") or shutil.which("hpr")
    if not found:
        raise AdapterError(
            "hyperresearch CLI not found on PATH; install it with `pipx install hyperresearch`"
        )
    return found


def export_vault(request: dict, output: Path) -> tuple[list[dict], str]:
    """Exports the vault once and pins the exact bytes that were read."""
    responses = output / "responses"
    responses.mkdir(parents=True, exist_ok=True)
    export_path = responses / "vault-export.json"
    result = subprocess.run(
        [cli(), "export", "json", "-o", str(export_path)],
        cwd=request["vault_root"],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise AdapterError(f"hyperresearch export failed: {result.stderr.strip() or 'no output'}")
    try:
        body = export_path.read_bytes()
        notes = json.loads(body)
    except (OSError, json.JSONDecodeError) as error:
        raise AdapterError(f"hyperresearch export is unreadable: {error}") from error
    if not isinstance(notes, list):
        raise AdapterError("hyperresearch export must be a list of notes")
    return notes, sha256_hex(body)


def selected(notes: list[dict], request: dict) -> tuple[list[dict], int]:
    """Applies the owner's declared selection. No selector means the whole vault."""
    select = request["select"]
    wanted_ids = set(select["note_ids"])
    wanted_tags = set(select["tags"])
    matched = []
    for note in notes:
        if not isinstance(note, dict) or not note.get("id"):
            continue
        if wanted_ids and str(note["id"]) not in wanted_ids:
            continue
        if wanted_tags and not wanted_tags & set(note.get("tags") or []):
            continue
        matched.append(note)
    matched.sort(key=lambda note: str(note.get("created") or ""), reverse=True)
    return matched[: request["max_records"]], len(matched)


def record_text(note: dict, matched: str) -> str:
    """Renders retained facts only: identity, source, provenance and hashes.

    The note body is hashed and discarded. HyperResearch keeps the prose so a
    reader can go back to it; MOZAK keeps the address and the hash so a claim
    can be re-checked without MOZAK becoming a store of third-party text.
    """
    body = str(note.get("body") or "")
    source = str(note.get("source") or "unrecorded")
    lines = [
        f"note: {note.get('id')}",
        f"title: {note.get('title') or 'untitled'}",
        f"source: {source}",
        f"body_sha256: {sha256_hex(body.encode('utf-8'))}",
        f"words: {int(note.get('word_count') or 0)}",
        f"tier: {note.get('tier') or 'unknown'}",
        f"content_type: {note.get('content_type') or 'unknown'}",
        f"status: {note.get('status') or 'unknown'}",
        f"created: {note.get('created') or 'unrecorded'}",
        f"matched: {matched}",
        "retention: identity, source, provenance and hashes only; note body prose not retained",
    ]
    return "\n".join(lines)


def build_fixture(
    request: dict,
    notes: list[dict],
    total_matched: int,
    export_hash: str,
    started_at: str,
) -> dict:
    records, evidence = [], []
    select = request["select"]
    matched = (
        "declared note ids"
        if select["note_ids"]
        else ("declared tags" if select["tags"] else "whole vault")
    )
    for index, note in enumerate(notes):
        text = record_text(note, matched)
        encoded = text.encode("utf-8")
        if len(encoded) > MAX_BYTES_PER_RECORD:
            raise AdapterError(f"record for note {note.get('id')} exceeds the retained byte budget")
        record_id = f"raw-{index:04d}"
        note_id = str(note["id"])
        records.append(
            {
                "id": record_id,
                "source_uri": f"recorded:hyperresearch:{note_id}",
                "media_type": "text/plain",
                "acquired_at": started_at,
                "content": text,
                "content_sha256": sha256_hex(encoded),
                "immutable": True,
                "trust": "untrusted_data",
            }
        )
        prefix = len(b"note: ")
        evidence.append(
            {
                "id": f"ev-{index:04d}",
                "raw_record_id": record_id,
                "byte_start": prefix,
                "byte_end": prefix + len(note_id.encode("utf-8")),
                "quote": note_id,
                "stance": "context",
            }
        )

    truncated = len(records) < total_matched
    gaps = [
        {
            "id": "gap-agent-selected-corpus",
            "description": (
                "HyperResearch chose which sources to fetch. This vault records what that external "
                "agent read, not a complete or unbiased survey, and presence here is not a judgement "
                "of quality, correctness or fitness."
            ),
            "impact": "high",
        },
        {
            "id": "gap-body-not-retained",
            "description": (
                "Only identity, source, provenance and content hashes are retained. Note bodies are "
                "hashed and discarded, so no claim here rests on the text of any fetched source."
            ),
            "impact": "medium",
        },
        {
            "id": "gap-untrusted-web-text",
            "description": (
                "Vault notes are third-party web and document text fetched by an external harness. "
                "They are untrusted data and carry no instruction or authority over MOZAK."
            ),
            "impact": "medium",
        },
        {
            "id": "gap-retrieval-happened-elsewhere",
            "description": (
                "Retrieval, deduplication and any citation checking happened inside HyperResearch, "
                "outside MOZAK. This run validates the snapshot the vault returned and re-derives "
                "none of that work."
            ),
            "impact": "medium",
        },
    ]
    if truncated:
        gaps.append(
            {
                "id": "gap-truncated",
                "description": (
                    f"{total_matched} notes matched the declared selection and this run kept the "
                    f"{len(records)} most recent at the requested cap of {request['max_records']}."
                ),
                "impact": "high",
            }
        )
    if not records:
        gaps.append(
            {
                "id": "gap-empty-selection",
                "description": "No vault note matched the declared selection in this retrieval.",
                "impact": "high",
            }
        )

    status = "failed" if not records else "qualified" if truncated else "supported"
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
                "vault_root": request["vault_root"],
                "select": select,
                "max_records": request["max_records"],
                "export_sha256": export_hash,
            }
        )
    )
    run_id = f"run-{sha256_hex(f'{started_at}{pipeline_revision}{input_hash}'.encode())[:24]}"

    run = {
        "contract_version": CONTRACT_VERSION,
        "run_id": run_id,
        "created_at": started_at,
        "source_profile": {
            "version": 1,
            "id": SOURCE_PROFILE_ID,
            "allowed_schemes": ["recorded"],
            "max_records": request["max_records"],
            "max_bytes_per_record": MAX_BYTES_PER_RECORD,
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
                "max_raw_bytes": MAX_BYTES_PER_RECORD * request["max_records"],
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
            or f"Which sources did HyperResearch gather for {request['scope_id']}?",
            "included": [
                "HyperResearch vault note identity, source and provenance at the recorded time",
                f"{len(records)} notes matching {matched}",
            ],
            "excluded": [
                "note body prose and fetched source text",
                "HyperResearch reports, drafts and synthesis prose",
                "any judgement of source quality, correctness or fitness",
                "notes absent from the declared selection",
            ],
        },
        "plan": {
            "steps": [
                "Export the local HyperResearch vault once and pin the exact bytes",
                "Apply only the owner-declared selection",
                "Hash each note body and retain identity, source and provenance only",
                "Record what the external harness read, never that it is true",
            ],
            "source_profile_id": SOURCE_PROFILE_ID,
            "pipeline_id": PIPELINE_ID,
        },
        "raw_records": records,
        "evidence": evidence,
        "gaps": gaps,
        "synthesis": {
            "summary": (
                f"Recorded {len(records)} HyperResearch vault notes from {matched}. Note bodies were "
                "hashed and discarded, and no source was promoted, adopted or assessed."
            ),
            "claims": [
                {
                    "id": "claim-inventory",
                    "text": (
                        f"This run records {len(records)} sources that HyperResearch read into its "
                        "vault, as candidate evidence for owner review."
                    ),
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
                "local_vault_read",
                "external_harness_snapshot",
                "metadata_only",
            ],
            "status": {"supported": "passed", "qualified": "qualified", "failed": "failed"}[status],
        },
    }
    run["receipt"]["artifact_hash"] = sha256_hex(canonical_json_bytes(run))
    return {
        "adapter": ADAPTER_ID,
        "adapter_version": "1",
        "capability": "external_research_vault_snapshot",
        "scope_id": request["scope_id"],
        "effects": EFFECTS,
        "vault_root": request["vault_root"],
        "selected_note_ids": select["note_ids"],
        "selected_tags": select["tags"],
        "response_files": [export_hash],
        "total_matched": total_matched,
        "records_kept": len(records),
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
            select = request["select"]
            print(
                json.dumps(
                    {
                        "schema_version": 1,
                        "command": "hyperresearch plan",
                        "network_access": False,
                        "scope_id": request["scope_id"],
                        "vault_root": request["vault_root"],
                        "would_read": f"{request['vault_root']} via `hyperresearch export json`",
                        "selection": (
                            "declared note ids"
                            if select["note_ids"]
                            else ("declared tags" if select["tags"] else "whole vault")
                        ),
                        "max_records": request["max_records"],
                        "cli_available": shutil.which("hyperresearch") is not None
                        or shutil.which("hpr") is not None,
                        "effects": EFFECTS,
                        "retention": "identity, source, provenance and hashes only",
                        "authority": "proposal_only",
                        "promotion": "reading a source never accepts it; the owner does",
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
        notes, export_hash = export_vault(request, output)
        kept, total_matched = selected(notes, request)
        fixture = build_fixture(request, kept, total_matched, export_hash, started_at)
        (output / "fixture.json").write_bytes(canonical_json_bytes(fixture) + b"\n")
        print(
            json.dumps(
                {
                    "schema_version": 1,
                    "command": "hyperresearch fetch",
                    "output": str(output),
                    "notes_exported": len(notes),
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
