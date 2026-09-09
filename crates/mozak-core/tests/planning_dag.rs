use mozak_core::planning::{
    Plan, PlanHistory, accept_research_proposals, next_ready_goals, validate_input_set_json,
    validate_plan, validate_plan_history, validate_plan_history_with_input_sets,
    validate_plan_json,
};
use mozak_core::research::{export_planning_inputs, validate_run_json};
use serde::Deserialize;
use std::collections::BTreeMap;

const INPUTS: &str = include_str!("fixtures/planning/accepted-inputs.json");
const SHARED_DAG: &str = include_str!("fixtures/planning/valid-shared-dag.json");
const ADVERSARIAL: &str = include_str!("fixtures/planning/adversarial-graphs.json");
const HISTORY: &str = include_str!("fixtures/planning/supersession-recovery.json");
const RESEARCH_RUN: &str = include_str!("fixtures/research/valid-run.json");

#[derive(Deserialize)]
struct AdversarialGraphs {
    cycle: Plan,
    missing_dependency: Plan,
    duplicate_edge: Plan,
    inferred_as_fact: Plan,
}

#[test]
fn valid_shared_dag_preserves_one_dependency_and_selects_ready_goals_deterministically() {
    let inputs = validate_input_set_json(INPUTS).expect("accepted inputs validate");
    let plan = validate_plan_json(SHARED_DAG, &inputs).expect("shared DAG validates");

    assert_eq!(
        plan.dependencies
            .iter()
            .filter(|edge| edge.depends_on_goal_id == "foundation")
            .count(),
        2
    );
    assert_eq!(
        next_ready_goals(&plan, &inputs).unwrap(),
        vec!["consumer-b", "consumer-a"]
    );
}

#[test]
fn cycles_missing_dependencies_duplicates_and_inferred_fact_fail_closed() {
    let inputs = validate_input_set_json(INPUTS).unwrap();
    let fixtures: AdversarialGraphs = serde_json::from_str(ADVERSARIAL).unwrap();

    assert_eq!(
        validate_plan(&fixtures.cycle, &inputs).unwrap_err().0,
        "dependency cycle detected"
    );
    assert_eq!(
        validate_plan(&fixtures.missing_dependency, &inputs)
            .unwrap_err()
            .0,
        "dependency references missing dependency"
    );
    assert_eq!(
        validate_plan(&fixtures.duplicate_edge, &inputs)
            .unwrap_err()
            .0,
        "duplicate dependency edge"
    );
    assert_eq!(
        validate_plan(&fixtures.inferred_as_fact, &inputs)
            .unwrap_err()
            .0,
        "inferred dependency must not be silently treated as fact"
    );
}

#[test]
fn missing_or_invalid_edge_provenance_and_duplicate_goals_fail_closed() {
    let inputs = validate_input_set_json(INPUTS).unwrap();
    let mut value: serde_json::Value = serde_json::from_str(SHARED_DAG).unwrap();
    value["dependencies"][0]
        .as_object_mut()
        .unwrap()
        .remove("provenance");
    assert!(validate_plan_json(&value.to_string(), &inputs).is_err());

    let mut plan = validate_plan_json(SHARED_DAG, &inputs).unwrap();
    plan.goals.push(plan.goals[0].clone());
    assert_eq!(
        validate_plan(&plan, &inputs).unwrap_err().0,
        "duplicate goal id"
    );

    let mut plan = validate_plan_json(SHARED_DAG, &inputs).unwrap();
    if let mozak_core::planning::DependencyProvenance::Declared { input_ids } =
        &mut plan.dependencies[0].provenance
    {
        input_ids.clear();
    }
    assert_eq!(
        validate_plan(&plan, &inputs).unwrap_err().0,
        "declared dependency lacks provenance"
    );
}

#[test]
fn recorded_supersession_and_bounded_recovery_are_valid_and_tampering_is_rejected() {
    let inputs = validate_input_set_json(INPUTS).unwrap();
    let history: PlanHistory = serde_json::from_str(HISTORY).unwrap();
    validate_plan_history(&history, &inputs).expect("recorded recovery history validates");

    let mut invalid_transition = history.clone();
    invalid_transition.versions[2].goals[1].status = mozak_core::planning::GoalStatus::Completed;
    assert_eq!(
        validate_plan_history(&invalid_transition, &inputs)
            .unwrap_err()
            .0,
        "invalid goal status transition"
    );

    let mut skipped_attempt = history.clone();
    skipped_attempt.versions[2].goals[1].recovery_attempts = 2;
    assert_eq!(
        validate_plan_history(&skipped_attempt, &inputs)
            .unwrap_err()
            .0,
        "recovery must increment attempts exactly once"
    );

    let mut broken_link = history;
    broken_link.versions[2].supersedes.as_mut().unwrap().version = 1;
    assert_eq!(
        validate_plan_history(&broken_link, &inputs).unwrap_err().0,
        "plan versions must be consecutive"
    );
}

#[test]
fn plan_history_supports_explicit_immutable_input_set_changes() {
    let first = validate_input_set_json(INPUTS).unwrap();
    let mut second = first.clone();
    second.id = "inputs-002".into();
    let mut history: PlanHistory = serde_json::from_str(HISTORY).unwrap();
    history.versions[2].input_set_id.clone_from(&second.id);

    validate_plan_history_with_input_sets(&history, &[first.clone(), second.clone()])
        .expect("successor plan may bind a new immutable input set");

    let missing =
        validate_plan_history_with_input_sets(&history, std::slice::from_ref(&first)).unwrap_err();
    assert_eq!(
        missing.0,
        "plan references missing planning input set: inputs-002"
    );

    let duplicate = validate_plan_history_with_input_sets(
        &history,
        &[first.clone(), first.clone(), second.clone()],
    )
    .unwrap_err();
    assert_eq!(duplicate.0, "duplicate planning input set id");

    let mut invalid_transition = history;
    invalid_transition.versions[2].goals[1].status = mozak_core::planning::GoalStatus::Completed;
    assert_eq!(
        validate_plan_history_with_input_sets(&invalid_transition, &[first, second])
            .unwrap_err()
            .0,
        "invalid goal status transition"
    );
}

#[test]
fn pf0004_proposals_require_explicit_acceptance_and_retain_provenance() {
    let run = validate_run_json(RESEARCH_RUN).unwrap();
    let export = export_planning_inputs(&run).unwrap();
    assert!(!export.inputs[0].accepted);

    let set = accept_research_proposals(
        "accepted-research-001".into(),
        "2026-09-01T10:00:00Z".into(),
        &export,
        &[export.inputs[0].id.clone()],
    )
    .expect("proposal crosses explicit acceptance boundary");

    assert_eq!(set.inputs.len(), 1);
    assert!(matches!(
        set.inputs[0].provenance,
        mozak_core::planning::PlanningInputProvenance::ResearchProposal { .. }
    ));
    assert!(
        accept_research_proposals(
            "duplicate-selection".into(),
            "2026-09-01T10:00:00Z".into(),
            &export,
            &[export.inputs[0].id.clone(), export.inputs[0].id.clone()],
        )
        .is_err()
    );
}

#[test]
fn input_sets_and_plan_json_are_closed_shape_contracts() {
    let unknown_input_field =
        INPUTS.replacen("\"accepted_at\"", "\"surprise\": true, \"accepted_at\"", 1);
    assert!(validate_input_set_json(&unknown_input_field).is_err());

    let inputs = validate_input_set_json(INPUTS).unwrap();
    let unknown_plan_field = SHARED_DAG.replacen(
        "\"input_set_id\"",
        "\"surprise\": true, \"input_set_id\"",
        1,
    );
    assert!(validate_plan_json(&unknown_plan_field, &inputs).is_err());
}

#[test]
fn fixture_names_are_stable_for_recorded_adversarial_cases() {
    let value: BTreeMap<String, serde_json::Value> = serde_json::from_str(ADVERSARIAL).unwrap();
    assert_eq!(
        value.keys().cloned().collect::<Vec<_>>(),
        vec![
            "cycle",
            "duplicate_edge",
            "inferred_as_fact",
            "missing_dependency"
        ]
    );
}
