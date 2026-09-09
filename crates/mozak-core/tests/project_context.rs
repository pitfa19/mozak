use mozak_core::project_context::validate_context_manifest_json;
use serde_json::{Value, json};

fn valid() -> Value {
    json!({
        "schema_version": 1,
        "id": "context-paper-v1",
        "status": "completed",
        "created_at": "2026-09-02T03:43:00Z",
        "source_repository": "/example/obsidian",
        "source_revision": "392662303f926206cfaf943ed97f84d7e61bcd7f",
        "sources": [{
            "path": "paper/manuscript.md",
            "sha256": "e96d83b7ea2e5b612f96557b5e2d2b17615374f60a05ab0a84a28bbf40858ec5",
            "role": "authoritative_manuscript"
        }],
        "research_run": ".mozak/research/runs/paper/run.json",
        "research_run_artifact_hash": "0a7f2c4e83d74afe66dd9602bad5bf52dfea289ccae109691e9342a05a0af67e",
        "context_note": ".mozak/context/paper-v1.md",
        "context_note_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "goal_id": "onboard-paper-context",
        "plan_version": 8,
        "refresh_policy": "create_successor_version"
    })
}

#[test]
fn accepts_strict_context_manifest() {
    validate_context_manifest_json(&valid().to_string()).unwrap();
}

#[test]
fn rejects_unknown_fields() {
    let mut value = valid();
    value["extra"] = json!(true);
    assert!(validate_context_manifest_json(&value.to_string()).is_err());
}

#[test]
fn rejects_path_traversal() {
    let mut value = valid();
    value["context_note"] = json!(".mozak/context/../idea.md");
    let error = validate_context_manifest_json(&value.to_string()).unwrap_err();
    assert!(error.to_string().contains("unsafe path"));
}

#[test]
fn rejects_duplicate_sources() {
    let mut value = valid();
    let duplicate = value["sources"][0].clone();
    value["sources"].as_array_mut().unwrap().push(duplicate);
    let error = validate_context_manifest_json(&value.to_string()).unwrap_err();
    assert!(error.to_string().contains("duplicate context source path"));
}

#[test]
fn rejects_invalid_hashes_and_revisions() {
    let mut value = valid();
    value["source_revision"] = json!("HEAD");
    assert!(validate_context_manifest_json(&value.to_string()).is_err());

    let mut value = valid();
    value["context_note_sha256"] = json!("ABC");
    assert!(validate_context_manifest_json(&value.to_string()).is_err());
}
