//! Contract tests for the `MONOKL` vault adapter.
//!
//! The fixture is a real snapshot of a local vault. Each test alters one thing
//! and asserts the normalizer fails closed, because an adapter that accepted a
//! dishonest snapshot would quietly turn an external agent's reading list into
//! MOZAK evidence, or turn a provenance record into a copy of someone else's
//! text.

use mozak_core::research::normalize_provider_monokl as normalize;
use serde_json::{Value, json};
use std::{fs, path::Path};

fn fixture() -> Value {
    let path =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/research/provider-monokl.json");
    serde_json::from_str(&fs::read_to_string(path).expect("fixture")).expect("json")
}

fn normalized(value: &Value) -> Result<(), String> {
    normalize(&value.to_string())
        .map(|_| ())
        .map_err(|error| error.0)
}

fn without_gap(id: &str) -> Value {
    let mut value = fixture();
    let gaps = value["run"]["gaps"]
        .as_array()
        .expect("gaps")
        .iter()
        .filter(|gap| gap["id"] != id)
        .cloned()
        .collect::<Vec<_>>();
    value["run"]["gaps"] = Value::Array(gaps);
    value
}

#[test]
fn a_real_vault_snapshot_normalizes_into_a_valid_run() {
    let value = fixture();
    let run = normalize(&value.to_string()).expect("must normalize");
    assert_eq!(run.receipt.adapter_id, "adapter-monokl-v1");
    assert!(!run.raw_records.is_empty());
    for record in &run.raw_records {
        assert!(
            record.source_uri.starts_with("recorded:monokl:"),
            "{}",
            record.source_uri
        );
        assert!(record.immutable);
    }
}

/// The whole point of this adapter is that MOZAK does not keep the harness's
/// copy of the web. A record carrying note prose would defeat it.
#[test]
fn a_record_retaining_note_prose_is_rejected() {
    let mut value = fixture();
    let record = &mut value["run"]["raw_records"][0];
    let content = record["content"].as_str().expect("content").to_owned();
    record["content"] = json!(format!("{content}\nbody: the full fetched article text"));
    let error = normalized(&value).unwrap_err();
    assert!(
        error.contains("retained metadata lines") || error.contains("out of contract order"),
        "{error}"
    );
}

#[test]
fn a_record_without_its_declared_retention_line_is_rejected() {
    let mut value = fixture();
    let record = &mut value["run"]["raw_records"][0];
    let content = record["content"].as_str().expect("content").to_owned();
    let rewritten = content.replace(
        "retention: identity, source, provenance and hashes only; note body prose not retained",
        "retention: everything",
    );
    record["content"] = json!(rewritten);
    assert!(
        normalized(&value)
            .unwrap_err()
            .contains("declare that note prose was not retained")
    );
}

/// A discarded body is only honest if it stays re-checkable.
#[test]
fn a_record_without_a_valid_body_hash_is_rejected() {
    let mut value = fixture();
    let record = &mut value["run"]["raw_records"][0];
    let content = record["content"].as_str().expect("content").to_owned();
    let mut lines = content.lines().map(str::to_owned).collect::<Vec<_>>();
    lines[3] = "body_sha256: not-a-hash".to_owned();
    record["content"] = json!(lines.join("\n"));
    assert!(
        normalized(&value)
            .unwrap_err()
            .contains("MONOKL note body hash")
    );
}

#[test]
fn record_fields_out_of_contract_order_are_rejected() {
    let mut value = fixture();
    let record = &mut value["run"]["raw_records"][0];
    let content = record["content"].as_str().expect("content").to_owned();
    let mut lines = content.lines().map(str::to_owned).collect::<Vec<_>>();
    lines.swap(1, 2);
    record["content"] = json!(lines.join("\n"));
    assert!(
        normalized(&value)
            .unwrap_err()
            .contains("out of contract order")
    );
}

/// Retrieval happened in the harness, before MOZAK saw anything. A fixture
/// claiming this adapter fetched from the network misreports where the work
/// occurred and what the recorded bytes actually witness.
#[test]
fn claiming_the_vault_read_used_the_network_is_rejected() {
    let mut value = fixture();
    value["effects"]["network_used"] = json!(true);
    assert!(
        normalized(&value)
            .unwrap_err()
            .contains("performs no networking")
    );
}

#[test]
fn an_adapter_declaring_writes_or_mutations_is_rejected() {
    let mut writes = fixture();
    writes["effects"]["external_writes"] = json!(["/etc/passwd"]);
    assert!(normalized(&writes).unwrap_err().contains("external writes"));

    let mut mutations = fixture();
    mutations["effects"]["mutations_performed"] = json!("vault rewritten");
    assert!(normalized(&mutations).unwrap_err().contains("mutations"));
}

#[test]
fn dishonest_counts_are_rejected() {
    let mut miscounted = fixture();
    miscounted["records_kept"] = json!(99);
    assert!(
        normalized(&miscounted)
            .unwrap_err()
            .contains("records_kept disagrees")
    );

    let mut inflated = fixture();
    inflated["total_matched"] = json!(0);
    assert!(normalized(&inflated).is_err());
}

#[test]
fn a_capped_retrieval_cannot_hide_its_truncation() {
    let mut value = fixture();
    value["truncated"] = json!(true);
    let error = normalized(&value).unwrap_err();
    assert!(error.contains("high-impact gap"), "{error}");
}

/// Presence in the vault records what an agent chose to read. Without that
/// disclosure a snapshot reads like a survey of a field.
#[test]
fn omitting_the_agent_selected_corpus_disclosure_is_rejected() {
    let value = without_gap("gap-agent-selected-corpus");
    assert!(
        normalized(&value)
            .unwrap_err()
            .contains("an external agent chose the corpus")
    );
}

#[test]
fn omitting_the_retention_or_untrusted_disclosure_is_rejected() {
    let retention = without_gap("gap-body-not-retained");
    assert!(
        normalized(&retention)
            .unwrap_err()
            .contains("note bodies are not retained")
    );

    let untrusted = without_gap("gap-untrusted-web-text");
    assert!(
        normalized(&untrusted)
            .unwrap_err()
            .contains("untrusted web text")
    );
}

#[test]
fn an_unpinned_or_mismatched_snapshot_is_rejected() {
    let mut unpinned = fixture();
    unpinned["response_files"] = json!([]);
    assert!(
        normalized(&unpinned)
            .unwrap_err()
            .contains("must pin the exact vault export")
    );

    let mut wrong_adapter = fixture();
    wrong_adapter["adapter"] = json!("adapter-arxiv-v1");
    assert!(normalized(&wrong_adapter).unwrap_err().contains("mismatch"));

    let mut relative = fixture();
    relative["vault_root"] = json!("relative/vault");
    assert!(
        normalized(&relative)
            .unwrap_err()
            .contains("vault_root must be an absolute path")
    );
}

/// Output authority is the boundary the Lab and planning both rely on.
#[test]
fn the_run_remains_proposal_only() {
    let run = normalize(&fixture().to_string()).expect("must normalize");
    assert!(run.pipeline.output_authority.planning_inputs_are_proposals);
    assert!(!run.pipeline.output_authority.may_mutate_accepted_plans);
    assert!(!run.source_profile.may_authorize_actions);
    assert!(run.source_profile.content_is_untrusted);
}
