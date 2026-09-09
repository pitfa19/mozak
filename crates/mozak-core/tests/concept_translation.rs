//! Porting a concept means re-deriving its assumptions, not transplanting its
//! constants.
//!
//! The fixtures are the real transfer measured in the first production case
//! study: a publish-as-commit mechanism that moved between two independently
//! owned projects and carried three target-invalid assumptions.

use mozak_core::concept::{
    Adoption, AssumptionOutcome, Concept, Translation, concept_hash, validate_concept_json,
    validate_translation, validate_translation_json,
};

const CONCEPT: &str = include_str!("fixtures/concept/publish-as-commit.json");
const TRANSLATION: &str = include_str!("fixtures/concept/example-beta-translation.json");

fn concept() -> Concept {
    validate_concept_json(CONCEPT).expect("recorded concept is valid")
}

fn translation() -> Translation {
    let concept = concept();
    validate_translation_json(TRANSLATION, &concept).expect("recorded translation is valid")
}

#[test]
fn the_recorded_real_transfer_validates_as_qualified_adoption() {
    let translation = translation();
    // Three of five assumptions did not survive the crossing, which is the
    // measured outcome, not a hypothetical.
    assert_eq!(translation.adoption, Adoption::Qualified);
    assert_eq!(translation.assumption_checks.len(), 5);
    let replaced = translation
        .assumption_checks
        .iter()
        .filter(|check| matches!(check.outcome, AssumptionOutcome::Replaced { .. }))
        .count();
    let rejected = translation
        .assumption_checks
        .iter()
        .filter(|check| matches!(check.outcome, AssumptionOutcome::Rejected { .. }))
        .count();
    assert_eq!(replaced, 2, "handler model and commit author identity");
    assert_eq!(rejected, 2, "kv throttle and central middleware");
}

#[test]
fn a_concept_must_carry_evidence_and_state_its_assumptions() {
    let mut bare = concept();
    bare.evidence.clear();
    assert_eq!(
        mozak_core::concept::validate_concept(&bare).unwrap_err().0,
        "concept must carry supporting evidence"
    );

    let mut universal = concept();
    universal.assumptions.clear();
    assert_eq!(
        mozak_core::concept::validate_concept(&universal)
            .unwrap_err()
            .0,
        "concept must state at least one assumption"
    );
}

#[test]
fn a_translation_must_re_derive_every_source_assumption() {
    let concept = concept();
    let mut partial = translation();
    partial.assumption_checks.retain(|check| {
        // Drop exactly the assumption whose silent transfer broke production.
        check.assumption_id != "A-02"
    });
    assert_eq!(
        validate_translation(&partial, &concept).unwrap_err().0,
        "translation must re-derive every concept assumption"
    );
}

#[test]
fn a_translation_cannot_claim_adoption_while_weakening_the_mechanism() {
    let concept = concept();
    let mut overclaimed = translation();
    overclaimed.adoption = Adoption::Adopted;
    assert_eq!(
        validate_translation(&overclaimed, &concept).unwrap_err().0,
        "a translation that replaced or rejected an assumption is qualified, not adopted"
    );
}

#[test]
fn an_unchecked_assumption_is_neither_holding_nor_failing() {
    let concept = concept();
    let mut unproven = translation();
    for check in &mut unproven.assumption_checks {
        if check.assumption_id == "A-03" {
            check.outcome = AssumptionOutcome::CouldNotCheck {
                reason: "the target deployment could not be exercised without credentials".into(),
            };
        }
    }
    // A non-load-bearing assumption that could not be checked is a disclosed
    // limitation, exactly as could_not_check is elsewhere in the contract.
    validate_translation(&unproven, &concept).expect("qualified adoption discloses the limitation");

    unproven.adoption = Adoption::Adopted;
    assert_eq!(
        validate_translation(&unproven, &concept).unwrap_err().0,
        "an adopted translation must not rest on an unchecked assumption"
    );
}

#[test]
fn a_rejected_load_bearing_assumption_cannot_be_qualified_adoption() {
    let concept = concept();
    let mut broken = translation();
    for check in &mut broken.assumption_checks {
        if check.assumption_id == "A-01" {
            // A-01 is load bearing: without it the invariant cannot hold.
            check.outcome = AssumptionOutcome::Rejected {
                rationale: "the target host does not build from repository commits".into(),
            };
        }
    }
    assert_eq!(
        validate_translation(&broken, &concept).unwrap_err().0,
        "a load-bearing assumption that was rejected or unchecked cannot be qualified adoption"
    );
}

#[test]
fn a_translation_is_pinned_to_the_exact_concept_it_re_derived() {
    let mut drifted = concept();
    drifted.assumptions[3].load_bearing = true;
    assert_ne!(
        concept_hash(&drifted).unwrap(),
        concept_hash(&concept()).unwrap()
    );
    assert_eq!(
        validate_translation(&translation(), &drifted)
            .unwrap_err()
            .0,
        "translation concept hash mismatch"
    );
}

#[test]
fn a_concept_never_translates_into_its_own_origin() {
    let concept = concept();
    let mut circular = translation();
    circular.target_scope_id = concept.origin.scope_id.clone();
    assert_eq!(
        validate_translation(&circular, &concept).unwrap_err().0,
        "translation target must differ from the concept origin scope"
    );
}

#[test]
fn a_holding_assumption_requires_evidence_observed_in_the_target() {
    let concept = concept();
    let mut unsupported = translation();
    for check in &mut unsupported.assumption_checks {
        if check.assumption_id == "A-01" {
            check.outcome = AssumptionOutcome::Holds {
                target_evidence_id: "E-023".into(),
            };
        }
    }
    // E-023 is source evidence. A target claim cannot rest on it.
    assert_eq!(
        validate_translation(&unsupported, &concept).unwrap_err().0,
        "a holding assumption requires evidence observed in the target"
    );
}

#[test]
fn contracts_are_closed_shape() {
    let extra = CONCEPT.replacen('{', "{\"surprise\": true,", 1);
    assert!(validate_concept_json(&extra).is_err());
}
