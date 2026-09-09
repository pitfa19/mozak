use mozak_core::landmark::{LandmarkIndex, validate_landmarks, validate_landmarks_json};
use mozak_core::research::{ResearchRun, validate_run_json};
use std::{fs, path::Path};

/// Uses the golden research fixture so landmarks are checked against a run
/// that the research contract itself considers valid.
fn run() -> ResearchRun {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/research/valid-run.json");
    validate_run_json(&fs::read_to_string(path).expect("fixture")).expect("valid run")
}

fn index(run: &ResearchRun) -> LandmarkIndex {
    let evidence = &run.evidence[0];
    let raw = run
        .raw_records
        .iter()
        .find(|record| record.id == evidence.raw_record_id)
        .expect("raw record");
    serde_json::from_value(serde_json::json!({
        "contract_version": 1,
        "run_id": run.run_id,
        "derived_artifact": "digest.md",
        "landmarks": [{
            "id": "landmark-000",
            "statement": "A condensed restatement.",
            "evidence_id": evidence.id,
            "raw_record_id": raw.id,
            "content_sha256": raw.content_sha256,
        }]
    }))
    .expect("index")
}

#[test]
fn a_landmark_index_drawn_from_the_run_validates() {
    let run = run();
    validate_landmarks(&index(&run), &run).expect("landmarks must validate");
}

#[test]
fn a_landmark_citing_absent_evidence_is_rejected_by_name() {
    let run = run();
    let mut value = index(&run);
    value.landmarks[0].evidence_id = "ev-does-not-exist".into();
    let error = validate_landmarks(&value, &run).unwrap_err();
    assert!(error.0.contains("landmark-000"), "{}", error.0);
    assert!(error.0.contains("ev-does-not-exist"), "{}", error.0);
}

#[test]
fn altered_evidence_bytes_invalidate_the_landmark_instead_of_repointing_it() {
    let run = run();
    let mut value = index(&run);
    // Simulate the recorded bytes changing after the landmark was written.
    value.landmarks[0].content_sha256 = "0".repeat(64);
    let error = validate_landmarks(&value, &run).unwrap_err();
    assert!(error.0.contains("pinned content"), "{}", error.0);
    assert!(error.0.contains("landmark-000"), "{}", error.0);
}

#[test]
fn a_landmark_must_name_the_raw_record_its_evidence_actually_quotes() {
    let run = run();
    let mut value = index(&run);
    let other = run
        .raw_records
        .iter()
        .find(|record| record.id != value.landmarks[0].raw_record_id);
    if let Some(other) = other {
        value.landmarks[0].raw_record_id = other.id.clone();
        value.landmarks[0].content_sha256 = other.content_sha256.clone();
        let error = validate_landmarks(&value, &run).unwrap_err();
        assert!(error.0.contains("but evidence"), "{}", error.0);
    } else {
        value.landmarks[0].raw_record_id = "raw-absent".into();
        let error = validate_landmarks(&value, &run).unwrap_err();
        assert!(error.0.contains("raw-absent"), "{}", error.0);
    }
}

#[test]
fn an_index_for_a_different_run_or_with_no_statements_is_rejected() {
    let run = run();
    let mut wrong_run = index(&run);
    wrong_run.run_id = "run-somewhere-else".into();
    assert!(
        validate_landmarks(&wrong_run, &run)
            .unwrap_err()
            .0
            .contains("different research run")
    );

    let mut empty = index(&run);
    empty.landmarks.clear();
    assert!(
        validate_landmarks(&empty, &run)
            .unwrap_err()
            .0
            .contains("at least one condensed statement")
    );

    let mut duplicate = index(&run);
    let first = duplicate.landmarks[0].clone();
    duplicate.landmarks.push(first);
    assert!(
        validate_landmarks(&duplicate, &run)
            .unwrap_err()
            .0
            .contains("duplicate landmark id")
    );
}

#[test]
fn an_unsupported_contract_version_and_malformed_json_fail_closed() {
    let run = run();
    let mut future = index(&run);
    future.contract_version = 2;
    assert!(
        validate_landmarks(&future, &run)
            .unwrap_err()
            .0
            .contains("unsupported landmark contract_version")
    );

    let error = validate_landmarks_json("{ not json", &run).unwrap_err();
    assert!(
        error.0.contains("invalid landmark index JSON"),
        "{}",
        error.0
    );
}
