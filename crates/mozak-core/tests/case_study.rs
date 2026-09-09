//! A case record describes itself honestly or it does not validate.
//!
//! The fixture is the retrofitted first real MOZAK case study, so every
//! invariant here was derived from an actual record rather than imagined.

use mozak_core::case_study::{
    CaseCondition, CaseStudy, ConditionKind, DimensionResult, FindingState, Generality,
    InconclusiveClaim, ResidualVariance, ReviewKind, VarianceStatement, open_findings,
    proposals_by_priority, reproduction_packet, validate_case, validate_case_json,
};

const FIXTURE: &str = include_str!("fixtures/case/example-beta-oneshot.json");

fn case() -> CaseStudy {
    validate_case_json(FIXTURE).expect("the retrofitted real case is valid")
}

/// The v1 fixture raised to v2, so the new rules can be exercised against a
/// record that started life under the older contract.
///
/// The fixture declares independent review, which at v2 requires two actors.
/// That the raise cannot keep one actor and that label is the rule working.
fn case_v2() -> CaseStudy {
    let mut case = case();
    case.contract_version = 2;
    case.method.performed_by = Some("agent-a".to_owned());
    case.method.evaluated_by = Some("reviewer-b".to_owned());
    case.subject.conditions = ConditionKind::all()
        .into_iter()
        .map(|kind| CaseCondition {
            kind,
            value: Some(format!("observed {}", kind.as_str())),
            observed_how: Some("read from the session transcript".to_owned()),
            not_observed_reason: None,
        })
        .collect();
    case.subject.residual_variance = Some(VarianceStatement {
        sources: vec![ResidualVariance {
            source: "model sampling between sessions".to_owned(),
            affected_observation_ids: vec![case.observations[0].id.clone()],
        }],
        none_established_how: None,
    });
    validate_case(&case).expect("the raised fixture is valid at v2");
    case
}

/// Sealed evidence is not invalidated by a later contract asking for more.
#[test]
fn version_one_records_stay_readable() {
    let case = case();
    assert_eq!(case.contract_version, 1);
    validate_case(&case).expect("a v1 record still validates");
    // The v2 requirements do not apply to it.
    assert!(case.subject.conditions.is_empty());
    assert!(case.subject.residual_variance.is_none());
    assert!(case.method.performed_by.is_none());
}

#[test]
fn a_v2_case_must_account_for_every_condition() {
    let mut missing = case_v2();
    missing
        .subject
        .conditions
        .retain(|c| c.kind != ConditionKind::Harness);
    assert_eq!(
        validate_case(&missing).unwrap_err().0,
        "case does not account for condition harness"
    );
}

/// A value with no method would let an assertion pass as an observation.
#[test]
fn a_condition_value_must_say_how_it_was_observed() {
    let mut asserted = case_v2();
    asserted.subject.conditions[0].observed_how = None;
    assert_eq!(
        validate_case(&asserted).unwrap_err().0,
        "condition agent records a value without saying how it was observed"
    );

    // Not observing something is fine, provided the record says so.
    let mut absent = case_v2();
    absent.subject.conditions[0].value = None;
    absent.subject.conditions[0].observed_how = None;
    assert_eq!(
        validate_case(&absent).unwrap_err().0,
        "condition agent must record a value or why it was not observed"
    );
    absent.subject.conditions[0].not_observed_reason =
        Some("the session predates transcript retention".to_owned());
    validate_case(&absent).expect("an explicitly unobserved condition is valid");
}

#[test]
fn residual_variance_must_be_named_and_point_at_real_observations() {
    let mut silent = case_v2();
    silent.subject.residual_variance = None;
    assert_eq!(
        validate_case(&silent).unwrap_err().0,
        "a case must record the variance that survived its conditions"
    );

    let mut dangling = case_v2();
    dangling.subject.residual_variance = Some(VarianceStatement {
        sources: vec![ResidualVariance {
            source: "sampling".to_owned(),
            affected_observation_ids: vec!["C-999".to_owned()],
        }],
        none_established_how: None,
    });
    assert_eq!(
        validate_case(&dangling).unwrap_err().0,
        "residual variance references an unknown observation"
    );

    // Claiming none is allowed, but silence and "none" must not look alike.
    let mut claims_none = case_v2();
    claims_none.subject.residual_variance = Some(VarianceStatement {
        sources: vec![],
        none_established_how: None,
    });
    assert_eq!(
        validate_case(&claims_none).unwrap_err().0,
        "a case claiming no residual variance must record how that was established"
    );
    claims_none.subject.residual_variance = Some(VarianceStatement {
        sources: vec![],
        none_established_how: Some(
            "the pipeline is deterministic and was rerun five times".to_owned(),
        ),
    });
    validate_case(&claims_none).expect("an established absence is valid");
}

/// The strongest limitation of the first real MOZAK case was that its author
/// evaluated it. That must be visible in the record rather than confessed.
#[test]
fn an_author_cannot_call_their_own_review_independent() {
    let mut overclaimed = case_v2();
    overclaimed.method.review = ReviewKind::Independent;
    overclaimed.method.evaluated_by = overclaimed.method.performed_by.clone();
    assert_eq!(
        validate_case(&overclaimed).unwrap_err().0,
        "review cannot be independent when the same actor performed and evaluated the work"
    );

    // Two actors make the claim expressible again.
    overclaimed.method.evaluated_by = Some("reviewer-b".to_owned());
    validate_case(&overclaimed).expect("a genuinely separate evaluator may claim independence");

    // Honest self-review with one actor stays fully valid.
    let mut honest = case_v2();
    honest.method.review = ReviewKind::SelfReview;
    honest.method.evaluated_by = honest.method.performed_by.clone();
    validate_case(&honest).expect("self review with one actor is valid");
}

#[test]
fn a_v2_case_must_name_both_actors() {
    let mut anonymous = case_v2();
    anonymous.method.performed_by = None;
    assert_eq!(
        validate_case(&anonymous).unwrap_err().0,
        "a case must record who performed the work"
    );
}

/// Absence of evidence must not be filed as evidence either way.
#[test]
fn an_inconclusive_claim_must_say_what_was_missing() {
    let mut vague = case_v2();
    vague.calibration.inconclusive_claims = vec![InconclusiveClaim {
        claim: "the contracts would catch this defect in another project".to_owned(),
        what_was_checked: "ran the suite against one external repository".to_owned(),
        missing_evidence: String::new(),
    }];
    assert_eq!(
        validate_case(&vague).unwrap_err().0,
        "inconclusive claim missing_evidence must not be empty"
    );

    vague.calibration.inconclusive_claims[0].missing_evidence =
        "no defect of that class occurred during the window".to_owned();
    validate_case(&vague).expect("a fully stated inconclusive claim is valid");
}

/// A single verdict can hide the dimension where the subject did worse.
#[test]
fn a_comparative_case_must_report_dimensions_and_a_real_control() {
    use mozak_core::case_study::CaseControl;
    let mut comparative = case_v2();
    comparative.calibration.generality = Generality::Comparative;
    comparative.subject.control = Some(CaseControl {
        kind: "same work without MOZAK".to_owned(),
        scope_id: None,
        comparable: true,
        reason: "a second run of comparable scope".to_owned(),
        held_fixed: vec![],
    });
    // An empty baseline is not a control.
    assert_eq!(
        validate_case(&comparative).unwrap_err().0,
        "a comparable control must record what was held fixed in the comparison condition"
    );

    comparative.subject.control.as_mut().unwrap().held_fixed =
        vec!["same model, harness and repository".to_owned()];
    assert_eq!(
        validate_case(&comparative).unwrap_err().0,
        "a comparative claim must report per-dimension results, not a single verdict"
    );

    // An unfavourable dimension must stay expressible.
    comparative.calibration.dimension_results = vec![
        DimensionResult {
            dimension: "defects caught".to_owned(),
            result: "higher with MOZAK".to_owned(),
        },
        DimensionResult {
            dimension: "elapsed time".to_owned(),
            result: "worse with MOZAK".to_owned(),
        },
    ];
    validate_case(&comparative).expect("a per-dimension comparative result is valid");
}

#[test]
fn the_reproduction_packet_withholds_every_conclusion() {
    let case = case_v2();
    let packet = reproduction_packet(&case).expect("the case has measured observations");

    // Evidence is carried.
    assert_eq!(packet.evaluated_revision, case.subject.final_revision);
    assert_eq!(packet.conditions.len(), ConditionKind::all().len());
    assert!(packet.residual_variance.is_some());
    assert!(!packet.measured_observations.is_empty());

    // Interpretation is not: the fixture's two qualitative observations are gone.
    assert!(packet.measured_observations.iter().all(|o| o.measured));
    assert_eq!(
        packet.measured_observations.len(),
        case.observations.iter().filter(|o| o.measured).count()
    );

    // Nothing in the serialized packet leaks a finding or a proposal.
    let rendered = serde_json::to_string(&packet).expect("packet serializes");
    for finding in &case.findings {
        assert!(!rendered.contains(&finding.summary), "leaked a finding");
    }
    for proposal in &case.derived_proposals {
        assert!(!rendered.contains(&proposal.text), "leaked a proposal");
    }
    for limitation in &case.calibration.limitations {
        assert!(
            !rendered.contains(limitation.as_str()),
            "leaked calibration"
        );
    }

    // The packet says what it is not.
    assert!(packet.blinding.contains("not blinded"));
    assert!(packet.authority.contains("reproduction_outstanding"));
}

#[test]
fn a_case_with_no_measurement_yields_a_refusal_not_an_empty_packet() {
    let mut interpretive = case_v2();
    for observation in &mut interpretive.observations {
        observation.measured = false;
    }
    assert_eq!(
        reproduction_packet(&interpretive).unwrap_err().0,
        "case records no measured observation, so there is nothing to reproduce"
    );
}

#[test]
fn the_retrofitted_first_real_case_validates() {
    let case = case();
    assert_eq!(case.observations.len(), 10);
    assert_eq!(case.findings.len(), 8);
    assert_eq!(case.derived_proposals.len(), 6);
    assert_eq!(case.calibration.generality, Generality::SingleCase);
    // Two of ten observations are the reviewer's judgement, not measurements.
    let qualitative = case
        .observations
        .iter()
        .filter(|observation| !observation.measured)
        .count();
    assert_eq!(qualitative, 2);
}

#[test]
fn a_case_must_record_its_own_limitations() {
    let mut promotional = case();
    promotional.calibration.limitations.clear();
    assert_eq!(
        validate_case(&promotional).unwrap_err().0,
        "calibration must record the limitations of this case"
    );
}

#[test]
fn one_case_cannot_report_a_comparative_result() {
    let mut overclaimed = case();
    overclaimed.calibration.generality = Generality::Comparative;
    assert_eq!(
        validate_case(&overclaimed).unwrap_err().0,
        "a comparative claim requires a control declared comparable"
    );

    // The recorded control exists but declares itself not comparable, which is
    // exactly why the claim must stay a single case.
    let control = overclaimed.subject.control.as_ref().unwrap();
    assert!(!control.comparable);
    assert!(control.reason.contains("isolates no variable"));
}

#[test]
fn a_qualitative_case_cannot_stand_on_judgement_alone() {
    let mut unmeasured = case();
    for observation in &mut unmeasured.observations {
        observation.measured = false;
    }
    assert_eq!(
        validate_case(&unmeasured).unwrap_err().0,
        "a case that states supported claims must record at least one measured observation"
    );
}

#[test]
fn a_resolved_finding_must_record_how_it_was_resolved() {
    let mut silent = case();
    silent.findings[0].resolution = None;
    assert_eq!(
        validate_case(&silent).unwrap_err().0,
        "a resolved finding must record how"
    );

    // An open finding legitimately has no resolution.
    let mut reopened = case();
    reopened.findings[0].state = FindingState::Open;
    reopened.findings[0].resolution = None;
    validate_case(&reopened).expect("an open finding needs no resolution");
}

#[test]
fn a_derived_proposal_must_cite_the_observations_that_motivate_it() {
    let mut untraceable = case();
    untraceable.derived_proposals[0].observation_ids.clear();
    assert_eq!(
        validate_case(&untraceable).unwrap_err().0,
        "a derived proposal must cite the observations that motivate it"
    );

    let mut dangling = case();
    dangling.derived_proposals[0].observation_ids = vec!["C-999".into()];
    assert_eq!(
        validate_case(&dangling).unwrap_err().0,
        "derived proposal references an unknown observation"
    );
}

#[test]
fn mutation_counts_must_be_internally_consistent() {
    let mut impossible = case();
    impossible.method.mutations_caught = Some(99);
    assert_eq!(
        validate_case(&impossible).unwrap_err().0,
        "mutations caught cannot exceed mutations injected"
    );

    let mut unreported = case();
    unreported.method.mutation_count = None;
    unreported.method.mutations_caught = None;
    assert!(
        unreported
            .method
            .rigor
            .contains(&mozak_core::case_study::MethodRigor::MutationTested)
    );
    assert_eq!(
        validate_case(&unreported).unwrap_err().0,
        "a mutation-tested case must record how many mutations were injected"
    );
}

#[test]
fn the_recorded_proposals_match_the_work_they_later_drove() {
    let case = case();
    let ordered = proposals_by_priority(&case);
    // The first two proposals became the previous MOZAK commit, and the third
    // became the commit after it. The record is what drove the work.
    assert_eq!(ordered[0].id, "P-01");
    assert!(ordered[0].text.contains("furthest observable interface"));
    assert_eq!(ordered[1].id, "P-02");
    assert!(ordered[1].text.contains("supersession-aware"));
    assert_eq!(ordered[2].id, "P-03");
    assert!(ordered[2].text.contains("Concept Translation"));
    // Recording them never accepted them.
    assert_eq!(
        serde_json::to_value(case.authority).unwrap(),
        serde_json::json!("proposal_only")
    );
}

#[test]
fn open_findings_stay_visible() {
    let case = case();
    let open = open_findings(&case);
    assert_eq!(open.len(), 1, "one informational finding remains open");
    assert_eq!(open[0].id, "F-7");
}

#[test]
fn contracts_are_closed_shape() {
    let extra = FIXTURE.replacen('{', "{\"surprise\": true,", 1);
    assert!(validate_case_json(&extra).is_err());
}
