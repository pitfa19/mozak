//! Mutation probes against two sealed MOZAK case fixtures.
//!
//! The ordinary contract tests build a mutant from a fixture, which proves the
//! rule fires but not that it fires on the evidence MOZAK actually keeps. These
//! probes inject one defect at a time into the committed sanitized fixtures and
//! require each v2 rule to refuse it, while the
//! unmutated records must still validate.
//!
//! The distinction matters because every v2 rule was written from a paper and
//! justified by a gap in these fixture records. If a rule cannot catch the defect
//! it was written for, in the record that motivated it, the rule is decoration.

use mozak_core::case_study::{CaseStudy, ReviewKind, validate_case, validate_case_json};
use std::path::{Path, PathBuf};

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .expect("repository root")
}

fn record(relative: &str) -> String {
    let path = repo_root().join(relative);
    let display = path.display().to_string();
    std::fs::read_to_string(&path).unwrap_or_else(|error| panic!("read {display}: {error}"))
}

fn v1() -> CaseStudy {
    validate_case_json(&record(
        "crates/mozak-core/tests/fixtures/case/mozak-self-development-v1.json",
    ))
    .expect("the sealed v1 record still validates")
}

fn v2() -> CaseStudy {
    validate_case_json(&record(
        "crates/mozak-core/tests/fixtures/case/mozak-self-development-v2.json",
    ))
    .expect("the v2 record validates")
}

/// Both sealed fixture records must be accepted, or every probe below is meaningless.
#[test]
fn the_real_records_validate_at_their_own_versions() {
    assert_eq!(v1().contract_version, 1);
    assert_eq!(v2().contract_version, 2);
    // The v1 record predates conditions, variance and named actors, and is not
    // retroactively invalid for lacking them.
    assert!(v1().subject.conditions.is_empty());
    assert!(v2().subject.conditions.len() >= 5);
}

fn refuses(mutate: impl FnOnce(&mut CaseStudy), expected: &str) {
    let mut case = v2();
    mutate(&mut case);
    let error = validate_case(&case)
        .expect_err("the mutated fixture record must be refused")
        .0;
    assert!(
        error.contains(expected),
        "expected {expected:?}, got {error:?}"
    );
}

#[test]
fn a_dropped_condition_is_refused_in_the_real_record() {
    refuses(
        |case| {
            case.subject.conditions.retain(|condition| {
                condition.kind != mozak_core::case_study::ConditionKind::Harness
            });
        },
        "does not account for condition harness",
    );
}

#[test]
fn an_asserted_condition_value_is_refused_in_the_real_record() {
    refuses(
        |case| case.subject.conditions[0].observed_how = None,
        "without saying how it was observed",
    );
}

#[test]
fn a_missing_variance_statement_is_refused_in_the_real_record() {
    refuses(
        |case| case.subject.residual_variance = None,
        "variance that survived its conditions",
    );
    refuses(
        |case| {
            let statement = case
                .subject
                .residual_variance
                .as_mut()
                .expect("the record names its variance");
            statement.sources.clear();
            statement.none_established_how = None;
        },
        "must record how that was established",
    );
}

#[test]
fn variance_pointing_at_nothing_is_refused_in_the_real_record() {
    refuses(
        |case| {
            case.subject
                .residual_variance
                .as_mut()
                .expect("variance")
                .sources[0]
                .affected_observation_ids = vec!["C-999".to_owned()];
        },
        "unknown observation",
    );
}

/// The defect this contract exists for: the case's author relabelling their own
/// assessment as independent review.
#[test]
fn the_real_self_review_cannot_be_relabelled_independent() {
    let case = v2();
    assert_eq!(case.method.review, ReviewKind::SelfReview);
    assert_eq!(case.method.performed_by, case.method.evaluated_by);
    refuses(
        |case| case.method.review = ReviewKind::Independent,
        "same actor performed and evaluated the work",
    );
}

#[test]
fn an_unnamed_performer_is_refused_in_the_real_record() {
    refuses(
        |case| case.method.performed_by = None,
        "who performed the work",
    );
}

#[test]
fn an_inconclusive_claim_without_missing_evidence_is_refused() {
    let case = v2();
    assert_eq!(
        case.calibration.inconclusive_claims.len(),
        2,
        "the real record moved two claims out of unsupported"
    );
    refuses(
        |case| case.calibration.inconclusive_claims[0].missing_evidence = String::new(),
        "missing_evidence must not be empty",
    );
}

#[test]
fn an_empty_baseline_control_is_refused_in_the_real_record() {
    use mozak_core::case_study::{CaseControl, Generality};
    refuses(
        |case| {
            case.calibration.generality = Generality::Comparative;
            case.subject.control = Some(CaseControl {
                kind: "same work without MOZAK".to_owned(),
                scope_id: None,
                comparable: true,
                reason: "a later run of comparable scope".to_owned(),
                held_fixed: vec![],
            });
        },
        "what was held fixed",
    );
}

#[test]
fn a_comparative_verdict_without_dimensions_is_refused() {
    use mozak_core::case_study::{CaseControl, Generality};
    refuses(
        |case| {
            case.calibration.generality = Generality::Comparative;
            case.subject.control = Some(CaseControl {
                kind: "same work without MOZAK".to_owned(),
                scope_id: None,
                comparable: true,
                reason: "a later run of comparable scope".to_owned(),
                held_fixed: vec!["same model, harness and repository".to_owned()],
            });
        },
        "per-dimension results",
    );
}

/// The packet is derived from the sealed fixture rather than constructed ad hoc.
#[test]
fn the_real_record_yields_a_usable_reproduction_packet() {
    let case = v2();
    let packet = mozak_core::case_study::reproduction_packet(&case).expect("packet");
    assert_eq!(packet.conditions.len(), 5);
    assert!(packet.residual_variance.is_some());
    // Every observation in this record is measured, so the packet carries all
    // of them. Assert the relationship rather than a count that moves whenever
    // the record gains an observation.
    let measured = case.observations.iter().filter(|o| o.measured).count();
    assert_eq!(packet.measured_observations.len(), measured);
    assert!(packet.measured_observations.iter().all(|o| o.measured));

    // No conclusion of the author's may appear in it.
    let rendered = serde_json::to_string(&packet).expect("serialize");
    for finding in &case.findings {
        assert!(!rendered.contains(&finding.summary), "leaked a finding");
    }
    for proposal in &case.derived_proposals {
        assert!(!rendered.contains(&proposal.text), "leaked a proposal");
    }
    for limitation in &case.calibration.limitations {
        assert!(
            !rendered.contains(limitation.as_str()),
            "leaked a calibration limitation"
        );
    }
    assert!(packet.blinding.contains("not blinded"));
    assert!(packet.authority.contains("reproduction_outstanding"));
}
