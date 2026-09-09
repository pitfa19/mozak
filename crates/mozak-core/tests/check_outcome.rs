//! A check that cannot observe its subject is neither a pass nor a failure.
//!
//! Derived from the domain-neutral lesson of the first real production case
//! study: repository-local checks reported green while the owner-facing
//! outcome was dead, and several checks reported on their own instrument
//! rather than on the subject they claimed to verify.

use mozak_core::execution::{
    EvaluationClaim, ExecutionBundle, packet_content_hash, result_content_hash, validate_bundle,
};

const FIXTURE: &str = include_str!("fixtures/execution/fresh-agent-bundle.json");
const REVISION: &str = "0123456789abcdef0123456789abcdef01234567";
const OBSERVED_AT: &str = "2026-09-01T10:04:00Z";

fn bundle() -> ExecutionBundle {
    serde_json::from_str(FIXTURE).expect("recorded fixture parses")
}

fn rehash(bundle: &mut ExecutionBundle) {
    bundle.packet.packet_hash = packet_content_hash(&bundle.packet).unwrap();
    bundle.result.packet.packet_hash = bundle.packet.packet_hash.clone();
    bundle.result.receipt.input_packet_hash = bundle.packet.packet_hash.clone();
    bundle.result.receipt.result_sha256 = result_content_hash(&bundle.result).unwrap();
}

#[test]
fn recorded_bundle_has_no_unproven_checks_and_still_validates() {
    let fixture = bundle();
    assert!(
        fixture
            .result
            .validation_evidence
            .iter()
            .all(|item| item.could_not_check.is_none()),
        "the recorded fixture proves the new field defaults absent"
    );
    validate_bundle(&fixture, REVISION, OBSERVED_AT).expect("existing artifacts remain loadable");
}

#[test]
fn could_not_check_requires_a_non_empty_reason() {
    let mut fixture = bundle();
    fixture.result.validation_evidence[0].passed = false;
    fixture.result.validation_evidence[0].could_not_check = Some("   ".into());
    rehash(&mut fixture);
    assert_eq!(
        validate_bundle(&fixture, REVISION, OBSERVED_AT)
            .unwrap_err()
            .0,
        "could_not_check requires a non-empty reason"
    );
}

#[test]
fn a_check_that_could_not_observe_its_subject_cannot_be_recorded_as_passed() {
    let mut fixture = bundle();
    fixture.result.validation_evidence[0].could_not_check =
        Some("the deployment origin did not resolve, so nothing was observed".into());
    rehash(&mut fixture);
    assert_eq!(
        validate_bundle(&fixture, REVISION, OBSERVED_AT)
            .unwrap_err()
            .0,
        "a check that could not observe its subject must not be recorded as passed"
    );
}

#[test]
fn an_unexercised_acceptance_condition_cannot_be_recorded_as_passed() {
    let mut fixture = bundle();
    fixture.evaluation.condition_evaluations[0].could_not_check =
        Some("no credentials, so the owner workflow was never exercised".into());
    rehash(&mut fixture);
    assert_eq!(
        validate_bundle(&fixture, REVISION, OBSERVED_AT)
            .unwrap_err()
            .0,
        "an acceptance condition that could not be exercised must not be recorded as passed"
    );
}

#[test]
fn an_unproven_check_cannot_support_a_clean_pass_claim() {
    let mut fixture = bundle();
    fixture.result.validation_evidence[0].passed = false;
    fixture.result.validation_evidence[0].could_not_check =
        Some("bot protection answered a challenge, so the subject was never reached".into());
    // A condition resting on an unobserved check is itself unproven.
    fixture.evaluation.condition_evaluations[0].passed = false;
    fixture.evaluation.condition_evaluations[0].could_not_check =
        Some("its only evidence never reached the subject".into());
    rehash(&mut fixture);
    assert_eq!(fixture.evaluation.claim, EvaluationClaim::Passed);
    assert_eq!(
        validate_bundle(&fixture, REVISION, OBSERVED_AT)
            .unwrap_err()
            .0,
        "claimed pass while a check could not observe its subject"
    );
}

#[test]
fn an_unproven_check_is_a_disclosed_limitation_for_a_qualified_claim() {
    let mut fixture = bundle();
    fixture.result.validation_evidence[0].passed = false;
    fixture.result.validation_evidence[0].could_not_check =
        Some("bot protection answered a challenge, so the subject was never reached".into());
    fixture.evaluation.condition_evaluations[0].passed = false;
    fixture.evaluation.condition_evaluations[0].could_not_check =
        Some("its only evidence never reached the subject".into());
    fixture.evaluation.claim = EvaluationClaim::Qualified;
    rehash(&mut fixture);
    validate_bundle(&fixture, REVISION, OBSERVED_AT)
        .expect("could_not_check alone discloses a limitation");
}

#[test]
fn unproven_is_counted_separately_from_passed_and_failed() {
    let mut fixture = bundle();
    fixture.result.validation_evidence[0].passed = false;
    fixture.result.validation_evidence[0].could_not_check =
        Some("the subject was never reached".into());

    let unproven = fixture
        .result
        .validation_evidence
        .iter()
        .filter(|item| item.could_not_check.is_some())
        .count();
    let passed = fixture
        .result
        .validation_evidence
        .iter()
        .filter(|item| item.passed)
        .count();
    let failed = fixture
        .result
        .validation_evidence
        .iter()
        .filter(|item| !item.passed && item.could_not_check.is_none())
        .count();

    assert_eq!(unproven, 1);
    assert_eq!(failed, 0, "an unreached subject is not a failing subject");
    assert_eq!(
        passed + failed + unproven,
        fixture.result.validation_evidence.len(),
        "the three outcomes partition every check"
    );
}
