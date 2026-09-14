//! Contract tests for paired observation and versioned gate criteria.
//!
//! Each test exists because of a way a measurement can overstate itself: by
//! attributing a difference to a mechanism while something else also moved, by
//! generalizing one bounded task, by presenting a difference as a verdict, or
//! by letting a gate's description drift from what it actually checks.

use mozak_core::lab_evaluation::{
    CONTRACT_VERSION, FixedCondition, GateDeclaration, MechanismEvidence, PairedObservation,
    PairedSide, UnpairedReason, authority, detect_drift, unaccounted, validate_evidence,
    validate_evidence_json, validate_gate, validate_pair,
};
use std::collections::BTreeMap;

fn condition(kind: &str, value: &str) -> FixedCondition {
    FixedCondition {
        kind: kind.to_owned(),
        baseline: value.to_owned(),
        treatment: value.to_owned(),
    }
}

fn pair() -> PairedObservation {
    PairedObservation {
        contract_version: CONTRACT_VERSION,
        mechanism_id: "m-evidence-state-carry".to_owned(),
        task: "open a second Lab run on a Scope with prior evidence".to_owned(),
        baseline: PairedSide {
            observed: "the run started empty and re-read three sources".to_owned(),
            locator: "run-one/review.md".to_owned(),
        },
        treatment: PairedSide {
            observed: "the run inherited one preservation requirement".to_owned(),
            locator: "run-two/review.md".to_owned(),
        },
        fixed_conditions: vec![
            condition("agent", "claude via jcode"),
            condition("harness", "mozak 0.3.1"),
            condition("grader", "mozak lab validation"),
        ],
        difference: "one claim carried instead of none".to_owned(),
        limitations: vec!["one task, one Scope, one run pair".to_owned()],
    }
}

fn evidence() -> MechanismEvidence {
    MechanismEvidence {
        contract_version: CONTRACT_VERSION,
        run_id: "improve-abc123".to_owned(),
        paired: vec![pair()],
        unpaired: Vec::new(),
    }
}

/// D4 check 1: an uncontrolled difference is not a result.
#[test]
fn a_condition_that_did_not_stay_fixed_is_rejected() {
    let mut drifted = pair();
    drifted.fixed_conditions.push(FixedCondition {
        kind: "agent".to_owned(),
        baseline: "claude".to_owned(),
        treatment: "a different model".to_owned(),
    });
    let error = validate_pair(&drifted).expect_err("must be refused").0;
    assert!(error.contains("was not held fixed"), "{error}");
    assert!(
        error.contains("agent"),
        "the error must name which condition moved"
    );
}

/// Whitespace must not be mistaken for a real difference.
#[test]
fn surrounding_whitespace_does_not_break_a_held_condition() {
    let mut spaced = pair();
    spaced.fixed_conditions[0].treatment = "  claude via jcode  ".to_owned();
    validate_pair(&spaced).expect("whitespace is not a condition change");
}

#[test]
fn a_pair_declaring_no_fixed_conditions_is_rejected() {
    let mut uncontrolled = pair();
    uncontrolled.fixed_conditions.clear();
    let error = validate_pair(&uncontrolled).expect_err("must be refused").0;
    assert!(error.contains("conditions it held fixed"), "{error}");
}

/// One bounded task is one bounded task. Saying nothing about that is how a
/// single trial becomes a general claim.
#[test]
fn a_pair_must_record_what_it_cannot_establish() {
    let mut unlimited = pair();
    unlimited.limitations.clear();
    let error = validate_pair(&unlimited).expect_err("must be refused").0;
    assert!(error.contains("cannot establish"), "{error}");
}

/// D4 check 4: a pair reports a difference, never a verdict.
#[test]
fn the_contract_records_a_difference_under_conditions_not_a_quality_claim() {
    let valid = pair();
    validate_pair(&valid).expect("a controlled pair is valid");

    let boundary = authority();
    assert!(
        boundary.starts_with("difference_under_stated_conditions"),
        "{boundary}"
    );
    assert!(boundary.contains("not a quality claim"));
    assert!(boundary.contains("does not generalize"));
    assert!(boundary.contains("promotes nothing"));

    // Serialized shape carries no verdict field for a caller to populate.
    let json = serde_json::to_string(&valid).expect("serialize");
    for forbidden in ["better", "worse", "score", "verdict", "quality"] {
        assert!(
            !json.contains(&format!("\"{forbidden}\"")),
            "the contract must offer no field named {forbidden}"
        );
    }
}

/// D4 check 2: promotion without a pair is allowed, but never silently.
#[test]
fn a_mechanism_without_a_pair_must_carry_a_recorded_reason() {
    let mut excused = evidence();
    excused.unpaired.push(UnpairedReason {
        mechanism_id: "m-fixed-meta-operation".to_owned(),
        reason:
            "this mechanism defends an existing invariant, so there is no variant to pair against"
                .to_owned(),
    });
    validate_evidence(&excused).expect("a stated reason is valid");

    let mut empty_reason = evidence();
    empty_reason.unpaired.push(UnpairedReason {
        mechanism_id: "m-x".to_owned(),
        reason: String::new(),
    });
    assert!(validate_evidence(&empty_reason).is_err());
}

/// Both would let a reader wonder which the promotion actually rested on.
#[test]
fn a_mechanism_cannot_be_both_measured_and_excused() {
    let mut both = evidence();
    both.unpaired.push(UnpairedReason {
        mechanism_id: "m-evidence-state-carry".to_owned(),
        reason: "hard to measure".to_owned(),
    });
    let error = validate_evidence(&both).expect_err("must be refused").0;
    assert!(error.contains("both a paired observation"), "{error}");
}

/// Silence about evidence reads as evidence, so silence is named.
#[test]
fn mechanisms_with_neither_a_pair_nor_a_reason_are_reported() {
    let evidence = evidence();
    let missing = unaccounted(
        &evidence,
        &["m-evidence-state-carry", "m-gate-lifecycle", "m-bounded"],
    );
    assert_eq!(missing, vec!["m-gate-lifecycle", "m-bounded"]);

    let none_missing = unaccounted(&evidence, &["m-evidence-state-carry"]);
    assert!(none_missing.is_empty());
}

/// D4 check 3: a gate whose description stopped matching is reported.
#[test]
fn a_gate_whose_implementation_moved_is_reported_as_drift() {
    let gate = GateDeclaration {
        gate_id: "lab-abstract-only".to_owned(),
        criteria: vec!["a mechanism may not rest only on an abstract-only reading".to_owned()],
        criteria_revised_at: "2026-09-14T00:00:00Z".to_owned(),
        reconciled_implementation_sha256: "a".repeat(64),
    };
    validate_gate(&gate).expect("a declared gate is valid");

    let mut observed = BTreeMap::new();
    observed.insert("lab-abstract-only".to_owned(), "b".repeat(64));
    let drift = detect_drift(std::slice::from_ref(&gate), &observed);
    assert_eq!(drift.len(), 1);
    assert_eq!(drift[0].gate_id, "lab-abstract-only");
    assert_eq!(drift[0].observed_sha256, "b".repeat(64));

    let mut unchanged = BTreeMap::new();
    unchanged.insert("lab-abstract-only".to_owned(), "a".repeat(64));
    assert!(detect_drift(std::slice::from_ref(&gate), &unchanged).is_empty());
}

/// An uninspected gate is a quieter problem than a mismatched one, and
/// conflating them would make every unchecked gate look broken.
#[test]
fn an_uninspected_gate_is_not_reported_as_drift() {
    let gate = GateDeclaration {
        gate_id: "never-inspected".to_owned(),
        criteria: vec!["something".to_owned()],
        criteria_revised_at: "2026-09-14T00:00:00Z".to_owned(),
        reconciled_implementation_sha256: "a".repeat(64),
    };
    assert!(detect_drift(&[gate], &BTreeMap::new()).is_empty());
}

#[test]
fn a_gate_declaring_no_criteria_is_rejected() {
    let gate = GateDeclaration {
        gate_id: "empty".to_owned(),
        criteria: Vec::new(),
        criteria_revised_at: "2026-09-14T00:00:00Z".to_owned(),
        reconciled_implementation_sha256: "a".repeat(64),
    };
    let error = validate_gate(&gate).expect_err("must be refused").0;
    assert!(error.contains("declare what it checks"), "{error}");
}

#[test]
fn evidence_round_trips_and_refuses_unknown_fields() {
    let original = evidence();
    let json = serde_json::to_string(&original).expect("serialize");
    let parsed = validate_evidence_json(&json).expect("round trip");
    assert_eq!(parsed, original);

    let surprising = r#"{"contract_version":1,"run_id":"improve-a","surprise":true}"#;
    assert!(validate_evidence_json(surprising).is_err());
}
