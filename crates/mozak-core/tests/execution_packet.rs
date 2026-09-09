use mozak_core::execution::{
    EvaluationClaim, ExecutionBundle, ExecutionFailure, ExecutionHistory, ExecutionStatus,
    GateEvaluation, MAX_CONTEXT_BYTES, PacketRef, RetryState, packet_content_hash,
    result_content_hash, validate_bundle, validate_bundle_json, validate_evaluation,
    validate_history, validate_packet, validate_result,
};

const FIXTURE: &str = include_str!("fixtures/execution/fresh-agent-bundle.json");
const REVISION: &str = "0123456789abcdef0123456789abcdef01234567";
const OBSERVED_AT: &str = "2026-09-01T10:04:00Z";

fn bundle() -> ExecutionBundle {
    serde_json::from_str(FIXTURE).expect("recorded fixture parses")
}

fn rehash_packet(bundle: &mut ExecutionBundle) {
    bundle.packet.packet_hash = packet_content_hash(&bundle.packet).unwrap();
    bundle.result.packet.packet_hash = bundle.packet.packet_hash.clone();
    bundle.result.receipt.input_packet_hash = bundle.packet.packet_hash.clone();
    rehash_result(bundle);
}

fn rehash_result(bundle: &mut ExecutionBundle) {
    bundle.result.receipt.result_sha256 = result_content_hash(&bundle.result).unwrap();
}

#[test]
fn recorded_fresh_agent_bundle_is_sufficient_without_project_history() {
    let validated = validate_bundle_json(FIXTURE, REVISION, OBSERVED_AT)
        .expect("one packet plus result and evaluation artifacts is sufficient");
    assert_eq!(validated.packet.context.len(), 1);
    assert_eq!(validated.result.artifacts.len(), 1);
    assert_eq!(validated.evaluation.condition_evaluations.len(), 2);
    assert_eq!(validated.evaluation.claim, EvaluationClaim::Passed);
}

#[test]
fn contracts_are_closed_shape_and_stale_packets_are_rejected() {
    let unknown = FIXTURE.replacen("\"packet\": {", "\"packet\": {\"surprise\": true,", 1);
    assert!(validate_bundle_json(&unknown, REVISION, OBSERVED_AT).is_err());

    let fixture = bundle();
    assert_eq!(
        validate_packet(&fixture.packet, "different-revision", OBSERVED_AT)
            .unwrap_err()
            .0,
        "stale packet project revision"
    );
    assert_eq!(
        validate_packet(&fixture.packet, REVISION, "2026-09-03T00:00:00Z")
            .unwrap_err()
            .0,
        "stale packet expired"
    );
}

#[test]
fn oversized_context_is_rejected_even_when_hashes_are_valid() {
    let mut fixture = bundle();
    fixture.packet.context[0].content = "x".repeat(MAX_CONTEXT_BYTES + 1);
    fixture.packet.context[0].content_sha256 = {
        use sha2::{Digest, Sha256};
        format!(
            "{:x}",
            Sha256::digest(fixture.packet.context[0].content.as_bytes())
        )
    };
    rehash_packet(&mut fixture);
    assert_eq!(
        validate_packet(&fixture.packet, REVISION, OBSERVED_AT)
            .unwrap_err()
            .0,
        "packet context byte budget exceeded"
    );
}

#[test]
fn failed_execution_remains_explicit_and_cannot_claim_pass() {
    let mut fixture = bundle();
    fixture.result.status = ExecutionStatus::Failed;
    fixture.result.gates[0].passed = false;
    fixture.result.gates[0].failure = Some("test failed".into());
    fixture.result.validation_evidence[0].passed = false;
    fixture.result.failures.push(ExecutionFailure {
        code: "test_failure".into(),
        detail: "recorded test did not pass".into(),
        evidence_ids: vec!["evidence-content".into()],
    });
    fixture.evaluation.condition_evaluations[0].passed = false;
    fixture.evaluation.gate_evaluations[0].passed = false;
    fixture.evaluation.claim = EvaluationClaim::Qualified;
    rehash_result(&mut fixture);
    validate_bundle(&fixture, REVISION, OBSERVED_AT)
        .expect("failed execution is valid when the claim is transparently lowered");

    fixture.evaluation.claim = EvaluationClaim::Passed;
    assert_eq!(
        validate_evaluation(&fixture.evaluation, &fixture.packet, &fixture.result)
            .unwrap_err()
            .0,
        "claimed pass for failed execution"
    );
}

#[test]
fn retry_attempts_increment_once_and_address_a_failed_gate() {
    let mut first = bundle();
    first.result.status = ExecutionStatus::Failed;
    first.result.gates[0].passed = false;
    first.result.gates[0].failure = Some("test failed".into());
    first.result.validation_evidence[0].passed = false;
    first.result.failures.push(ExecutionFailure {
        code: "test_failure".into(),
        detail: "first attempt failed".into(),
        evidence_ids: vec!["evidence-content".into()],
    });
    rehash_result(&mut first);
    validate_result(&first.result, &first.packet, None).unwrap();

    let mut second = bundle();
    second.result.id = "result-2".into();
    second.result.attempt = 2;
    second.result.retry = Some(RetryState {
        previous_result_id: first.result.id.clone(),
        previous_attempt: 1,
        addressed_failed_gate_ids: vec!["gate-tests".into()],
        improvement: "Corrected output and reran the failed exact-content gate.".into(),
    });
    rehash_result(&mut second);
    validate_result(&second.result, &second.packet, Some(&first.result))
        .expect("the next attempt explicitly improves the failed gate");

    second.result.attempt = 3;
    rehash_result(&mut second);
    assert_eq!(
        validate_result(&second.result, &second.packet, Some(&first.result))
            .unwrap_err()
            .0,
        "retry must increment attempt exactly once"
    );
}

#[test]
fn released_versions_are_immutable_and_supersession_links_are_exact() {
    let first = bundle().packet;
    let mut second = first.clone();
    second.version = 2;
    second.objective = "Produce and verify a greeting artifact from bounded input.".into();
    second.supersedes = Some(PacketRef {
        id: first.id.clone(),
        version: first.version,
        packet_hash: first.packet_hash.clone(),
    });
    second.packet_hash = packet_content_hash(&second).unwrap();
    let history = ExecutionHistory {
        packets: vec![first.clone(), second.clone()],
        results: vec![],
        evaluations: vec![],
    };
    validate_history(&history, REVISION, OBSERVED_AT).expect("linked immutable releases validate");

    second.supersedes.as_mut().unwrap().packet_hash = "tampered".into();
    second.packet_hash = packet_content_hash(&second).unwrap();
    let invalid = ExecutionHistory {
        packets: vec![first, second],
        results: vec![],
        evaluations: vec![],
    };
    assert_eq!(
        validate_history(&invalid, REVISION, OBSERVED_AT)
            .unwrap_err()
            .0,
        "packet supersession link mismatch"
    );
}

#[test]
fn evaluator_must_be_independent_and_trace_every_condition() {
    let mut fixture = bundle();
    fixture.evaluation.evaluator = fixture.result.executor.clone();
    assert_eq!(
        validate_evaluation(&fixture.evaluation, &fixture.packet, &fixture.result)
            .unwrap_err()
            .0,
        "evaluator identity conflicts with executor"
    );

    let mut fixture = bundle();
    fixture.evaluation.condition_evaluations.pop();
    assert_eq!(
        validate_evaluation(&fixture.evaluation, &fixture.packet, &fixture.result)
            .unwrap_err()
            .0,
        "incomplete acceptance condition traceability"
    );
}

#[test]
fn claimed_pass_with_failed_gate_is_rejected_but_qualified_claim_is_allowed() {
    let mut fixture = bundle();
    fixture.result.gates[0].passed = false;
    fixture.result.gates[0].failure = Some("lint gate failed".into());
    fixture.evaluation.gate_evaluations = vec![GateEvaluation {
        gate_id: "gate-tests".into(),
        evidence_ids: vec!["evidence-content".into()],
        passed: false,
    }];
    rehash_result(&mut fixture);
    assert_eq!(
        validate_evaluation(&fixture.evaluation, &fixture.packet, &fixture.result)
            .unwrap_err()
            .0,
        "claimed pass with failed gate"
    );
    fixture.evaluation.claim = EvaluationClaim::Qualified;
    validate_evaluation(&fixture.evaluation, &fixture.packet, &fixture.result)
        .expect("failed gate remains explicit and lowers the claim");
}

#[test]
fn executor_without_any_independent_evaluation_is_rejected_in_history() {
    let fixture = bundle();
    let history = ExecutionHistory {
        packets: vec![fixture.packet],
        results: vec![fixture.result],
        evaluations: vec![],
    };
    assert_eq!(
        validate_history(&history, REVISION, OBSERVED_AT)
            .unwrap_err()
            .0,
        "executor cannot be its only evaluator"
    );
}
