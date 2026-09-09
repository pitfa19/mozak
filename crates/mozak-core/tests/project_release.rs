use mozak_core::project_release::{
    generate_project_release, validate_project_release, write_release_new,
};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

const ACCEPTED: &str =
    include_str!("../../../spec/project-framework/fixtures/pf-0007/accepted-state.json");
static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);

fn value() -> Value {
    serde_json::from_str(ACCEPTED).expect("fixture JSON")
}

fn generate(document: &Value) -> Result<mozak_core::project_release::GeneratedRelease, String> {
    generate_project_release(&serde_json::to_string(document).unwrap())
        .map_err(|error| error.to_string())
}

#[test]
fn complete_release_has_required_sections_provenance_scopes_and_supersession() {
    let generated = generate_project_release(ACCEPTED).expect("complete release");
    let release: Value = serde_json::from_slice(&generated.canonical_bytes).unwrap();
    for section in [
        "accepted_findings",
        "decisions",
        "reusable_patterns",
        "open_gaps",
        "implementation_state",
    ] {
        assert!(
            release[section]
                .as_array()
                .is_some_and(|items| !items.is_empty()),
            "{section}"
        );
    }
    assert_eq!(
        release["accepted_findings"][1]["supersedes"][0],
        "finding-001"
    );
    assert_eq!(
        release["reusable_patterns"][0]["truth_scope"],
        "cross_project_inference"
    );
    assert!(
        release["accepted_findings"][0]["provenance"][0]["uri"]
            .as_str()
            .unwrap()
            .starts_with("repo:")
    );
    assert!(release.get("transcript").is_none());
}

#[test]
fn missing_provenance_and_embedded_raw_or_transcript_fields_fail_closed() {
    let mut missing = value();
    missing["decisions"][0]["provenance"] = serde_json::json!([]);
    assert!(
        generate(&missing)
            .unwrap_err()
            .contains("provenance must not be empty")
    );

    for field in ["raw_content", "transcript", "raw-transcript", "content"] {
        let mut embedded = value();
        embedded["accepted_findings"][0][field] = Value::String("forbidden bytes".into());
        assert!(
            generate(&embedded)
                .unwrap_err()
                .contains("embedded raw content or transcript"),
            "{field}"
        );
    }
}

#[test]
fn invalid_supersession_fails_closed() {
    let mut unknown = value();
    unknown["accepted_findings"][0]["supersedes"] = serde_json::json!(["missing"]);
    assert!(
        generate(&unknown)
            .unwrap_err()
            .contains("supersedes unknown item")
    );

    let mut cycle = value();
    cycle["accepted_findings"][1]["supersedes"] = serde_json::json!(["finding-002"]);
    assert!(generate(&cycle).unwrap_err().contains("acyclic"));
}

#[test]
fn ordering_is_canonical_and_repeated_generation_has_identical_bytes_and_hash() {
    let first = generate_project_release(ACCEPTED).unwrap();
    let mut reordered = value();
    reordered["accepted_findings"]
        .as_array_mut()
        .unwrap()
        .reverse();
    let second = generate(&reordered).unwrap();
    let repeated = generate_project_release(ACCEPTED).unwrap();
    assert_eq!(first.canonical_bytes, second.canonical_bytes);
    assert_eq!(first.sha256, second.sha256);
    assert_eq!(first.canonical_bytes, repeated.canonical_bytes);
    assert_eq!(first.sha256, repeated.sha256);
    assert!(first.canonical_bytes.ends_with(b"\n"));
}

#[test]
fn generation_uses_the_supplied_timestamp_and_never_overwrites() {
    let generated = generate_project_release(ACCEPTED).unwrap();
    assert_eq!(generated.release.generated_at, "2026-09-01T10:00:00Z");
    let path = temp_path();
    write_release_new(&path, &generated).unwrap();
    let original = fs::read(&path).unwrap();
    let error = write_release_new(&path, &generated).unwrap_err();
    assert!(error.to_string().contains("refusing to overwrite"));
    assert_eq!(fs::read(&path).unwrap(), original);
    fs::remove_file(path).unwrap();
}

#[test]
fn deserialized_release_requires_semantic_identity_hashes_and_item_integrity() {
    let generated = generate_project_release(ACCEPTED).unwrap();

    let mut empty_identity = generated.release.clone();
    empty_identity.release_id.clear();
    assert!(
        validate_project_release(&empty_identity)
            .unwrap_err()
            .to_string()
            .contains("release_id must be non-empty")
    );

    let mut zero_version = generated.release.clone();
    zero_version.accepted_state_version = 0;
    assert!(
        validate_project_release(&zero_version)
            .unwrap_err()
            .to_string()
            .contains("accepted_state_version must be positive")
    );

    let mut bad_hash = generated.release.clone();
    bad_hash.accepted_state_sha256 = "ABC".into();
    assert!(
        validate_project_release(&bad_hash)
            .unwrap_err()
            .to_string()
            .contains("accepted_state_sha256 must be a 64-character lowercase SHA-256")
    );

    let mut duplicate = generated.release.clone();
    duplicate.decisions[0].id = duplicate.accepted_findings[0].id.clone();
    assert!(
        validate_project_release(&duplicate)
            .unwrap_err()
            .to_string()
            .contains("duplicate release item id")
    );
}

fn temp_path() -> PathBuf {
    let sequence = NEXT_TEMP.fetch_add(1, Ordering::Relaxed);
    Path::new(&std::env::temp_dir()).join(format!(
        "mozak-project-release-{}-{sequence}.json",
        std::process::id()
    ))
}
