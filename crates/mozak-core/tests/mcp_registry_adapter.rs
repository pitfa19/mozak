//! Contract tests for the MCP registry tooling adapter.
//!
//! The fixture is a real retrieval from the official registry, trimmed to three
//! records. Each test alters one thing and asserts the normalizer fails closed,
//! because an adapter that accepted a dishonest snapshot would quietly turn
//! marketing copy and stale counts into MOZAK evidence.

use mozak_core::research::normalize_provider_mcp_registry as normalize;
use serde_json::Value;
use std::{fs, path::Path};

fn fixture() -> Value {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/research/provider-mcp-registry.json");
    serde_json::from_str(&fs::read_to_string(path).expect("fixture")).expect("json")
}

fn normalized(value: &Value) -> Result<(), String> {
    normalize(&value.to_string())
        .map(|_| ())
        .map_err(|error| error.0)
}

#[test]
fn a_real_registry_retrieval_normalizes_into_a_valid_run() {
    let value = fixture();
    let run = normalize(&value.to_string()).expect("must normalize");
    assert_eq!(run.receipt.adapter_id, "adapter-mcp-registry-v1");
    assert!(!run.raw_records.is_empty());
    // Every record must be addressable back to the registry it came from.
    for record in &run.raw_records {
        assert!(
            record.source_uri.starts_with("recorded:mcp-registry:"),
            "{}",
            record.source_uri
        );
        assert!(record.immutable);
    }
}

#[test]
fn dishonest_counts_are_rejected() {
    let mut value = fixture();
    value["records_kept"] = serde_json::json!(1);
    assert!(
        normalized(&value)
            .unwrap_err()
            .contains("records_kept disagrees")
    );

    let mut inflated = fixture();
    inflated["total_matched"] = serde_json::json!(1);
    assert!(normalized(&inflated).is_err());
}

#[test]
fn a_capped_retrieval_cannot_hide_its_truncation_or_claim_full_support() {
    let mut hidden = fixture();
    hidden["truncated"] = serde_json::json!(false);
    assert!(
        normalized(&hidden)
            .unwrap_err()
            .contains("must keep everything it matched")
    );

    let mut overclaim = fixture();
    overclaim["run"]["synthesis"]["overall_claim"] = serde_json::json!("supported");
    assert!(
        normalized(&overclaim)
            .unwrap_err()
            .contains("must not claim full support")
    );
}

#[test]
fn the_retrieval_must_disclose_what_the_registry_cannot_see() {
    // The registry lists MCP servers only, so silence here would overstate
    // coverage of agentic tooling generally.
    for (gap, expected) in [
        ("gap-mcp-servers-only", "non-MCP tooling is outside it"),
        ("gap-self-published", "self-published"),
    ] {
        let mut value = fixture();
        let gaps = value["run"]["gaps"]
            .as_array()
            .expect("gaps")
            .iter()
            .filter(|entry| entry["id"] != gap)
            .cloned()
            .collect::<Vec<_>>();
        value["run"]["gaps"] = Value::Array(gaps);
        assert!(
            normalized(&value).unwrap_err().contains(expected),
            "removing {gap} must be refused"
        );
    }
}

#[test]
fn publisher_prose_must_not_be_retained() {
    let mut value = fixture();
    let content = value["run"]["raw_records"][0]["content"]
        .as_str()
        .expect("content")
        .replace(
            "retention: identity",
            "description: the best tool ever\nretention: identity",
        );
    value["run"]["raw_records"][0]["content"] = Value::String(content);
    let error = normalized(&value).unwrap_err();
    assert!(
        error.contains("retained metadata lines") || error.contains("publisher description"),
        "{error}"
    );
}

#[test]
fn unsafe_effects_and_a_foreign_registry_fail_closed() {
    let mut mutating = fixture();
    mutating["effects"]["mutations_performed"] = serde_json::json!("accepted_state");
    assert!(normalized(&mutating).unwrap_err().contains("mutations"));

    let mut elsewhere = fixture();
    elsewhere["registry"] = serde_json::json!("https://example.invalid");
    assert!(
        normalized(&elsewhere)
            .unwrap_err()
            .contains("registry identity mismatch")
    );

    let mut wrong_adapter = fixture();
    wrong_adapter["adapter"] = serde_json::json!("adapter-something-else-v1");
    assert!(normalized(&wrong_adapter).unwrap_err().contains("mismatch"));
}

#[test]
fn an_empty_interest_cluster_must_record_a_gap() {
    let mut value = fixture();
    value["interests"] = serde_json::json!([
        {"name": "nothing-matched", "terms": ["zzz-no-such-term"], "records_matched": 0}
    ]);
    assert!(
        normalized(&value)
            .unwrap_err()
            .contains("empty interest cluster must record a gap")
    );
}

#[test]
fn every_response_body_must_be_pinned_by_hash() {
    let mut value = fixture();
    value["response_files"] = serde_json::json!([]);
    assert!(
        normalized(&value)
            .unwrap_err()
            .contains("must pin at least one response body")
    );

    let mut bad = fixture();
    bad["response_files"] = serde_json::json!(["not-a-hash"]);
    assert!(normalized(&bad).is_err());
}
