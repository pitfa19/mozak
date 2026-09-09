//! Tests for the in-toto Statement projection of a sealed package.
//!
//! The fixture is the real canonical package used by the package tests, so
//! these check the projection against bytes MOZAK already treats as sealed.

use mozak_core::attestation::{PREDICATE_TYPE, STATEMENT_TYPE, project_statement, statement_json};
use mozak_core::knowledge_package::load_knowledge_package;
use sha2::{Digest, Sha256};
use std::{fs, path::PathBuf};

fn package_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../spec/project-framework/fixtures/pf-0015/canonical")
}

#[test]
fn a_sealed_package_projects_a_spec_shaped_statement() {
    let package = load_knowledge_package(&package_root()).expect("package");
    let statement = project_statement(&package).expect("statement");

    assert_eq!(statement.statement_type, STATEMENT_TYPE);
    assert_eq!(statement.predicate_type, PREDICATE_TYPE);
    assert!(!statement.subject.is_empty());

    // in-toto requires every subject element to carry a digest.
    for subject in &statement.subject {
        assert!(
            subject.digest.contains_key("sha256"),
            "{} carries no sha256 digest",
            subject.name
        );
        assert_eq!(subject.digest["sha256"].len(), 64);
    }
}

#[test]
fn every_subject_digest_matches_the_real_artifact_bytes() {
    // This is the property that makes the statement useful to someone outside
    // MOZAK: they can recompute it without trusting MOZAK at all.
    let root = package_root();
    let package = load_knowledge_package(&root).expect("package");
    let statement = project_statement(&package).expect("statement");

    for subject in &statement.subject {
        let bytes = fs::read(root.join(&subject.name)).expect("artifact");
        let actual = format!("{:x}", Sha256::digest(&bytes));
        assert_eq!(
            actual, subject.digest["sha256"],
            "{} digest does not match its bytes",
            subject.name
        );
    }
}

#[test]
fn the_statement_carries_release_identity_and_refuses_to_claim_more() {
    let package = load_knowledge_package(&package_root()).expect("package");
    let statement = project_statement(&package).expect("statement");
    let predicate = &statement.predicate;

    assert_eq!(predicate.package_id, package.manifest.package_id);
    assert_eq!(predicate.project_id, package.manifest.project_id);
    assert_eq!(predicate.release_id, package.manifest.release_id);
    assert!(predicate.package_identity.starts_with("sha256:"));

    // An attestation about knowledge is easy to over-read as an endorsement of
    // that knowledge, so the boundary is stated in the predicate itself.
    assert!(
        predicate
            .claim_boundary
            .contains("asserts nothing about the correctness"),
        "{}",
        predicate.claim_boundary
    );
    assert!(
        predicate.verification.contains("recompute"),
        "{}",
        predicate.verification
    );
}

#[test]
fn projection_is_deterministic_and_subject_order_is_stable() {
    let package = load_knowledge_package(&package_root()).expect("package");
    let first = statement_json(&project_statement(&package).expect("a")).expect("json");
    let second = statement_json(&project_statement(&package).expect("b")).expect("json");
    assert_eq!(first, second);

    let statement = project_statement(&package).expect("statement");
    let mut names = statement
        .subject
        .iter()
        .map(|subject| subject.name.clone())
        .collect::<Vec<_>>();
    let observed = names.clone();
    names.sort();
    assert_eq!(observed, names, "subjects must be emitted in stable order");
}

#[test]
fn a_package_with_no_artifacts_has_nothing_to_attest() {
    let mut package = load_knowledge_package(&package_root()).expect("package");
    package.manifest.artifacts.clear();
    let error = project_statement(&package).expect_err("must refuse");
    assert!(error.0.contains("no subject to attest"), "{}", error.0);
}

#[test]
fn a_malformed_digest_produces_no_statement_rather_than_a_wrong_one() {
    // A subject with a bad digest would look verifiable and match nothing,
    // which is worse than emitting no statement at all.
    for bad in ["not-a-digest", "ABCDEF", ""] {
        let mut package = load_knowledge_package(&package_root()).expect("package");
        package.manifest.artifacts[0].sha256 = bad.to_owned();
        let error = project_statement(&package).expect_err("must refuse");
        assert!(
            error.0.contains("SHA-256 digest"),
            "digest {bad:?} was accepted: {}",
            error.0
        );
    }

    // Uppercase hex is valid hex but not the canonical form the manifest uses.
    let mut package = load_knowledge_package(&package_root()).expect("package");
    package.manifest.artifacts[0].sha256 = "A".repeat(64);
    assert!(project_statement(&package).is_err());
}

#[test]
fn the_serialized_statement_is_valid_json_with_the_spec_field_names() {
    let package = load_knowledge_package(&package_root()).expect("package");
    let text = statement_json(&project_statement(&package).expect("statement")).expect("json");
    assert!(text.ends_with('\n'));

    let value: serde_json::Value = serde_json::from_str(&text).expect("valid json");
    // The spec names these fields exactly; Rust naming would silently break
    // any external verifier.
    assert_eq!(value["_type"], STATEMENT_TYPE);
    assert_eq!(value["predicateType"], PREDICATE_TYPE);
    assert!(value["subject"].is_array());
    assert!(value["predicate"].is_object());
}
