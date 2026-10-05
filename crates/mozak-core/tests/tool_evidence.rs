//! Contract tests for source-neutral tool evidence recording.

use mozak_core::research::{
    OverallClaim, ResearchRun, run_artifact_hash, validate_run, validate_run_json,
};
use mozak_core::tool_evidence::{record_tool_evidence, verify_tool_evidence};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{fs, path::Path};

const RESPONSE: &[u8] =
    b"{\"papers\":[{\"id\":\"2501.00001\",\"title\":\"Example paper title\"}]}\n";

fn sha(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn fixture() -> Value {
    json!({
        "schema": "mozak.tool-evidence.v1",
        "scope_id": "topic-agentic-systems",
        "question": "Which recent papers discuss agent memory?",
        "tool": {"tool_id": "arxiv-mcp-server", "kind": "mcp", "version": "0.8.1",
                 "operation": "search_papers", "server": "arxiv"},
        "call": {"arguments": {"query": "agent memory", "max_results": 1},
                 "started_at": "2026-10-05T18:00:00Z", "finished_at": "2026-10-05T18:00:02Z"},
        "effects": {"network_used": true, "external_writes": [], "mutations_performed": "none",
                    "irreversible_effects": [], "dry_run_available": false,
                    "owner_approval_required": false},
        "response": {"sha256": sha(RESPONSE), "byte_length": RESPONSE.len(),
                     "media_type": "application/json"},
        "selections": [{"id": "sel-0001", "locator": "arxiv:2501.00001",
                        "response_byte_start": 39, "response_byte_end": 58,
                        "excerpt": "Example paper title"}],
        "total_results": 1,
        "truncated": false,
        "gaps": [],
        "accepted": false,
        "authority": "proposal_only"
    })
}

fn record(value: &Value) -> Result<ResearchRun, String> {
    record_tool_evidence(&value.to_string(), RESPONSE).map_err(|error| error.0)
}

fn refused(value: &Value, needle: &str) {
    let error = record(value).expect_err("fixture must be refused");
    assert!(error.contains(needle), "expected {needle:?} in {error:?}");
}

fn mutate(edit: impl FnOnce(&mut Value)) -> Value {
    let mut value = fixture();
    edit(&mut value);
    value
}

#[test]
fn a_recorded_call_validates_as_a_qualified_proposal_only_run() {
    let run = record(&fixture()).expect("recording");
    validate_run(&run).expect("derived run validates");
    let text = serde_json::to_string_pretty(&run).unwrap();
    let reparsed = validate_run_json(&text).expect("research validate accepts it");
    assert_eq!(reparsed, run);
    assert_eq!(run.synthesis.overall_claim, OverallClaim::Qualified);
    assert_eq!(run.receipt.adapter_id, "adapter-tool-evidence-v1");
    let provenance = &run.raw_records[0].content;
    for needle in [
        "tool_id: arxiv-mcp-server",
        "tool_version: 0.8.1",
        "tool_server: arxiv",
        "operation: search_papers",
        &format!("response_sha256: {}", sha(RESPONSE)),
        "call_started_at: 2026-10-05T18:00:00Z",
        "accepted: false",
        "authority: proposal_only",
    ] {
        assert!(provenance.contains(needle), "provenance lacks {needle}");
    }
    // The full response is never persisted, only its selected excerpt.
    assert!(!text.contains("2501.00001\\\",\\\"title"));
    assert!(
        run.gaps
            .iter()
            .any(|gap| gap.id == "gap-selected-excerpts-only")
    );
}

#[test]
fn recording_is_deterministic_and_independent_of_fixture_formatting() {
    let compact = record(&fixture()).unwrap();
    let pretty =
        record_tool_evidence(&serde_json::to_string_pretty(&fixture()).unwrap(), RESPONSE).unwrap();
    assert_eq!(compact, pretty);
}

#[test]
fn verification_detects_response_and_run_drift() {
    let run = record(&fixture()).unwrap();
    verify_tool_evidence(&fixture().to_string(), RESPONSE, &run).expect("verifies");
    let mut drifted = RESPONSE.to_vec();
    drifted[45] = b'X';
    let error = verify_tool_evidence(&fixture().to_string(), &drifted, &run).unwrap_err();
    assert!(error.0.contains("response bytes do not match"), "{error}");
    let error = verify_tool_evidence(&fixture().to_string(), &RESPONSE[1..], &run).unwrap_err();
    assert!(error.0.contains("byte length"), "{error}");
}

#[test]
fn a_tampered_run_fails_standalone_validation_even_with_a_fresh_artifact_hash() {
    let run = record(&fixture()).unwrap();
    // Editing the excerpt and its quote while recomputing every hash would pass
    // generic validation; re-derivation from the embedded fixture refuses it.
    let mut forged = run.clone();
    forged.raw_records[1].content = "Forged paper title!".into();
    forged.raw_records[1].content_sha256 = sha(b"Forged paper title!");
    forged.evidence[0].quote = "Forged paper title!".into();
    forged.receipt.artifact_hash = run_artifact_hash(&forged).unwrap();
    let error = validate_run(&forged).unwrap_err();
    assert!(error.0.contains("re-derived"), "{error}");

    let mut supported = run.clone();
    supported.synthesis.claims[0].status = mozak_core::research::ClaimStatus::Supported;
    supported.synthesis.overall_claim = OverallClaim::Supported;
    supported.receipt.status = mozak_core::research::RunStatus::Passed;
    supported.receipt.artifact_hash = run_artifact_hash(&supported).unwrap();
    assert!(validate_run(&supported).is_err());

    let mut stripped = run;
    stripped.raw_records[0].content = "schema: mozak.tool-evidence.v1".into();
    stripped.raw_records[0].content_sha256 = sha(b"schema: mozak.tool-evidence.v1");
    stripped.receipt.artifact_hash = run_artifact_hash(&stripped).unwrap();
    assert!(validate_run(&stripped).is_err());
}

#[test]
fn bad_schemas_and_unknown_fields_are_refused() {
    refused(
        &mutate(|v| v["schema"] = json!("mozak.tool-evidence.v2")),
        "schema",
    );
    refused(&mutate(|v| v["safe"] = json!(true)), "unknown field");
    refused(
        &mutate(|v| v["effects"]["trusted"] = json!(true)),
        "unknown field",
    );
    refused(
        &mutate(|v| v["tool"]["kind"] = json!("browser")),
        "unknown variant",
    );
    refused(
        &mutate(|v| v["call"]["arguments"] = json!(["x"])),
        "JSON object",
    );
    refused(&mutate(|v| v["selections"] = json!([])), "between 1 and 32");
}

#[test]
fn false_acceptance_claims_are_refused() {
    refused(
        &mutate(|v| v["accepted"] = json!(true)),
        "must not claim acceptance",
    );
    refused(
        &mutate(|v| v["authority"] = json!("accepted")),
        "proposal_only",
    );
}

#[test]
fn declared_writes_mutations_and_irreversible_effects_are_refused() {
    refused(
        &mutate(|v| v["effects"]["external_writes"] = json!(["zotero:item"])),
        "external writes",
    );
    refused(
        &mutate(|v| v["effects"]["mutations_performed"] = json!("tagged item")),
        "mutations",
    );
    refused(
        &mutate(|v| v["effects"]["irreversible_effects"] = json!(["sent email"])),
        "irreversible",
    );
    refused(
        &mutate(|v| v["effects"]["owner_approval_required"] = json!(true)),
        "owner approval",
    );
}

#[test]
fn malformed_timestamps_are_refused() {
    for bad in [
        "2026-10-05 18:00:00Z",
        "2026-10-05T18:00:00+02:00",
        "2026-13-05T18:00:00Z",
        "2026-02-30T18:00:00Z",
        "2026-10-05T24:00:00Z",
    ] {
        refused(
            &mutate(|v| v["call"]["started_at"] = json!(bad)),
            "started_at",
        );
    }
    refused(
        &mutate(|v| v["call"]["started_at"] = json!("2026-10-05T18:00:03Z")),
        "must not follow",
    );
}

#[test]
fn tool_identity_and_version_must_be_exact() {
    for bad in ["latest", "", "unknown", "v*", "main"] {
        refused(
            &mutate(|v| v["tool"]["version"] = json!(bad)),
            "tool.version",
        );
    }
    refused(
        &mutate(|v| v["tool"]["tool_id"] = json!("Arxiv MCP")),
        "tool.tool_id",
    );
    refused(
        &mutate(|v| {
            v["tool"].as_object_mut().unwrap().remove("server").unwrap();
        }),
        "must name its server",
    );
    refused(
        &mutate(|v| v["tool"]["kind"] = json!("cli")),
        "only valid for an mcp",
    );
}

#[test]
fn credentials_in_call_arguments_are_refused() {
    refused(
        &mutate(|v| v["call"]["arguments"]["api_key"] = json!("x")),
        "credential-like key",
    );
    refused(
        &mutate(|v| v["call"]["arguments"]["headers"] = json!({"Authorization": "x"})),
        "credential-like key",
    );
    refused(
        &mutate(|v| v["call"]["arguments"]["query"] = json!("Bearer abc")),
        "authorization value",
    );
}

#[test]
fn excerpts_must_match_their_exact_response_range_and_stay_bounded() {
    refused(
        &mutate(|v| v["selections"][0]["excerpt"] = json!("Example paper titlX")),
        "does not equal its response byte range",
    );
    refused(
        &mutate(|v| v["selections"][0]["response_byte_end"] = json!(57)),
        "length disagrees",
    );
    refused(
        &mutate(|v| v["selections"][0]["response_byte_end"] = json!(9_999)),
        "invalid response byte range",
    );
    refused(
        &mutate(|v| v["selections"][0]["locator"] = json!("no locator")),
        "locator",
    );
    refused(
        &mutate(|v| v["response"]["sha256"] = json!("ABC")),
        "response.sha256",
    );
    refused(&mutate(|v| v["total_results"] = json!(0)), "total_results");

    let big = vec![b'a'; 2_100];
    let big_text = String::from_utf8(big.clone()).unwrap();
    let value = mutate(|v| {
        v["response"] =
            json!({"sha256": sha(&big), "byte_length": big.len(), "media_type": "text/plain"});
        v["selections"][0]["response_byte_start"] = json!(0);
        v["selections"][0]["response_byte_end"] = json!(2_100);
        v["selections"][0]["excerpt"] = json!(big_text);
    });
    let error = record_tool_evidence(&value.to_string(), &big).unwrap_err();
    assert!(error.0.contains("exceeds 2000 bytes"), "{error}");
}

#[test]
fn reserved_gaps_and_truncation_are_disclosed_by_mozak() {
    refused(
        &mutate(|v| {
            v["gaps"] = json!([{"id": "gap-truncated", "description": "x", "impact": "low"}]);
        }),
        "reserved",
    );
    let run = record(&mutate(|v| v["truncated"] = json!(true))).unwrap();
    assert!(run.gaps.iter().any(
        |gap| gap.id == "gap-truncated" && gap.impact == mozak_core::research::GapImpact::High
    ));
    assert_ne!(run.synthesis.overall_claim, OverallClaim::Supported);
}

#[test]
fn existing_historical_runs_remain_valid() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/research");
    let run = fs::read_to_string(dir.join("valid-run.json")).unwrap();
    validate_run_json(&run).expect("legacy run stays valid");
}
