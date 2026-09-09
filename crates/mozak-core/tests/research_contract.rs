use mozak_core::research::{
    PlanningAuthority, RunStatus, deterministic_run_id, export_planning_inputs, run_artifact_hash,
    validate_run, validate_run_json,
};

const VALID: &str = include_str!("fixtures/research/valid-run.json");
const AUDITED_FAILURES: &str = include_str!("fixtures/research/adversarial-audited-run.json");
const SILENT_PASS: &str = include_str!("fixtures/research/adversarial-silent-pass.json");

#[test]
fn complete_golden_run_preserves_every_artifact_and_exports_bounded_proposals() {
    let run = validate_run_json(VALID).expect("golden research run must validate");
    assert!(!run.scope.question.is_empty());
    assert!(!run.plan.steps.is_empty());
    assert!(!run.raw_records.is_empty());
    assert!(!run.evidence.is_empty());
    assert!(!run.gaps.is_empty());
    assert!(!run.synthesis.claims.is_empty());
    assert_eq!(run.audit.audited_claim_ids, vec!["claim-one"]);
    assert_eq!(run.receipt.status, RunStatus::Passed);
    assert_eq!(run_artifact_hash(&run).unwrap(), run.receipt.artifact_hash);

    let export = export_planning_inputs(&run).expect("supported findings must export");
    assert_eq!(export.authority, PlanningAuthority::ProposalOnly);
    assert_eq!(export.inputs.len(), 1);
    assert!(!export.inputs[0].accepted);
    assert_eq!(export.inputs[0].claim_id, "claim-one");
}

#[test]
fn source_instructions_remain_immutable_untrusted_data_without_control_authority() {
    let mut run = validate_run_json(VALID).unwrap();
    assert!(run.raw_records[0].content.contains("delete plans"));

    run.raw_records[0].immutable = false;
    assert_eq!(
        validate_run(&run).unwrap_err().0,
        "raw records must be immutable"
    );

    let mut run = validate_run_json(VALID).unwrap();
    run.source_profile.may_authorize_actions = true;
    assert_eq!(
        validate_run(&run).unwrap_err().0,
        "source content must not authorize actions"
    );

    let mut run = validate_run_json(VALID).unwrap();
    run.pipeline.output_authority.may_mutate_accepted_plans = true;
    assert_eq!(
        validate_run(&run).unwrap_err().0,
        "research output must not mutate accepted plans"
    );
}

#[test]
fn unsupported_and_broken_claims_are_explicitly_failed_and_lower_the_run() {
    let run = validate_run_json(AUDITED_FAILURES).expect("transparent failed run is valid");
    assert_eq!(run.audit.failures.len(), 2);
    assert_eq!(run.receipt.status, RunStatus::Failed);
    assert!(export_planning_inputs(&run).unwrap().inputs.is_empty());

    let error = validate_run_json(SILENT_PASS).unwrap_err();
    assert!(error.0.contains("overstates audit support"));
}

#[test]
fn broken_evidence_spans_and_raw_mutation_fail_closed() {
    let mut run = validate_run_json(VALID).unwrap();
    run.evidence[0].quote = "fabricated quote".into();
    assert!(validate_run(&run).unwrap_err().0.contains("quote mismatch"));

    let mut run = validate_run_json(VALID).unwrap();
    run.raw_records[0].content.push('!');
    assert_eq!(
        validate_run(&run).unwrap_err().0,
        "raw record content hash mismatch"
    );
}

#[test]
fn run_ids_and_hashes_are_deterministic() {
    let run = validate_run_json(VALID).unwrap();
    let derived = deterministic_run_id(
        &run.created_at,
        &run.pipeline.revision,
        &run.receipt.input_hash,
    )
    .unwrap();
    assert_eq!(derived, run.run_id);
    assert_eq!(
        run_artifact_hash(&run).unwrap(),
        run_artifact_hash(&run).unwrap()
    );
}
