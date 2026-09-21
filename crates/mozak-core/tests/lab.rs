use mozak_core::lab::{
    AdapterRunRef, CONTRACT_VERSION, Candidate, ClaimOrigin, GroupDefinition, GroupSkill,
    GroupSynthesis, GroupSynthesisEntry, ImplementationPlan, ImplementationPlans, ImproveRequest,
    LabConceptCandidate, LiteratureGroup, LiteratureRun, Mechanism, MechanismMap, Module,
    PaperReading, ReadClaim, ReadDepth, Readings, RepositoryRef, ReviewInputs, RunLedger, RunState,
    Selection, SelectionDecision, SourceClass, SourceInventory, SourceInventoryEntry, advance,
    classify_candidates, render_review, validate_group_definition, validate_group_skill,
    validate_group_synthesis, validate_literature, validate_mechanisms, validate_plans,
    validate_readings, validate_request, validate_selection, validate_source_inventory,
};
use serde_json::json;
use std::collections::BTreeMap;

fn request() -> ImproveRequest {
    ImproveRequest {
        contract_version: CONTRACT_VERSION,
        run_id: "improve-abc123".to_owned(),
        scope_id: "topic-agentic-systems".to_owned(),
        module: Module::Plans,
        question: "How should planning handle budgets?".to_owned(),
        constraints: vec!["planning only".to_owned()],
        adapter_bindings: vec!["agentic-systems-dair-ai".to_owned()],
        stop_at: RunState::OwnerReviewed,
        created_at: "2026-09-06T00:00:00Z".to_owned(),
        performed_by: None,
        evaluated_by: None,
        acceptance: None,
        scope_boundary: None,
    }
}

fn ledger() -> RunLedger {
    RunLedger {
        contract_version: CONTRACT_VERSION,
        run_id: "improve-abc123".to_owned(),
        scope_id: "topic-agentic-systems".to_owned(),
        module: Module::Plans,
        state: RunState::Requested,
        stop_at: RunState::OwnerReviewed,
        transitions: Vec::new(),
        seen_sources: BTreeMap::new(),
    }
}

fn candidate(id: &str, hash: &str) -> Candidate {
    Candidate {
        paper_id: id.to_owned(),
        title: format!("Title {id}"),
        source_uri: format!("recorded:dair-ai:rev:{id}"),
        content_sha256: hash.to_owned(),
        clusters: vec!["budgets".to_owned()],
    }
}

fn literature(candidates: Vec<Candidate>) -> LiteratureRun {
    let ids = candidates
        .iter()
        .map(|c| c.paper_id.clone())
        .collect::<Vec<_>>();
    LiteratureRun {
        contract_version: CONTRACT_VERSION,
        run_id: "improve-abc123".to_owned(),
        adapter_runs: vec![AdapterRunRef {
            binding_id: "agentic-systems-dair-ai".to_owned(),
            adapter_id: "adapter-dair-ai-v1".to_owned(),
            adapter_run_id: "run-1".to_owned(),
            artifact_hash: "hash".to_owned(),
            source_revision: "78e4809".to_owned(),
        }],
        candidates,
        new_candidates: ids,
        unchanged_candidates: Vec::new(),
    }
}

fn selection() -> Selection {
    Selection {
        contract_version: CONTRACT_VERSION,
        run_id: "improve-abc123".to_owned(),
        included: vec![SelectionDecision {
            paper_id: "paper-0000".to_owned(),
            reason: "directly addresses planning budgets".to_owned(),
        }],
        excluded: vec![SelectionDecision {
            paper_id: "paper-0001".to_owned(),
            reason: "vision model, unrelated to planning".to_owned(),
        }],
    }
}

fn readings() -> Readings {
    Readings {
        contract_version: CONTRACT_VERSION,
        run_id: "improve-abc123".to_owned(),
        readings: vec![PaperReading {
            paper_id: "paper-0000".to_owned(),
            source_class: SourceClass::Preprint,
            source_uri: "https://arxiv.org/abs/2608.20614".to_owned(),
            content_sha256: "aaa".to_owned(),
            claims: vec![
                ReadClaim {
                    id: "claim-1".to_owned(),
                    text: "Explicit budgets reduce wasted rollouts.".to_owned(),
                    origin: ClaimOrigin::SourceClaim,
                    locator: "section 4".to_owned(),
                },
                ReadClaim {
                    id: "claim-2".to_owned(),
                    text: "This likely transfers to MOZAK planning.".to_owned(),
                    origin: ClaimOrigin::LabInference,
                    locator: "lab reasoning".to_owned(),
                },
            ],
            limitations: vec!["single benchmark family".to_owned()],
            read_depth: ReadDepth::FullText,
            retained_full_text: false,
        }],
    }
}

fn source_inventory() -> SourceInventory {
    SourceInventory {
        contract_version: CONTRACT_VERSION,
        run_id: "improve-abc123".to_owned(),
        sources: vec![SourceInventoryEntry {
            paper_id: "paper-0000".to_owned(),
            source_uri: "https://arxiv.org/abs/2608.20614".to_owned(),
            content_sha256: "aaa".to_owned(),
            repository: Some(RepositoryRef {
                url: "https://github.com/example/tool".to_owned(),
                revision: "abc123".to_owned(),
                content_sha256: "bbb".to_owned(),
            }),
        }],
    }
}

fn group_definition() -> GroupDefinition {
    GroupDefinition {
        contract_version: CONTRACT_VERSION,
        run_id: "improve-abc123".to_owned(),
        groups: vec![LiteratureGroup {
            id: "group-budgeting".to_owned(),
            title: "Budgeting approaches".to_owned(),
            purpose: "Compare bounded rollout approaches".to_owned(),
            paper_ids: vec!["paper-0000".to_owned()],
        }],
    }
}

fn group_synthesis() -> GroupSynthesis {
    GroupSynthesis {
        contract_version: CONTRACT_VERSION,
        run_id: "improve-abc123".to_owned(),
        syntheses: vec![GroupSynthesisEntry {
            group_id: "group-budgeting".to_owned(),
            compared_approaches: vec!["static budget".to_owned(), "adaptive budget".to_owned()],
            synthesis: "Static and adaptive budgets trade predictability for responsiveness."
                .to_owned(),
            cited_claim_ids: vec!["claim-1".to_owned()],
            limitations: vec!["single source".to_owned()],
        }],
    }
}

fn group_skill() -> GroupSkill {
    GroupSkill {
        contract_version: CONTRACT_VERSION,
        run_id: "improve-abc123".to_owned(),
        scope_id: "topic-agentic-systems".to_owned(),
        topic_id: "topic-agentic-systems".to_owned(),
        skill_id: "planning-budgeting".to_owned(),
        revision: "r1".to_owned(),
        summary: "Compare budgeted planning approaches with verified citations.".to_owned(),
        group_ids: vec!["group-budgeting".to_owned()],
        comparison_guidance: vec![
            "Compare static budgets".to_owned(),
            "Compare adaptive budgets".to_owned(),
        ],
        cited_claim_ids: vec!["claim-1".to_owned()],
        concept_candidates: vec![LabConceptCandidate {
            id: "concept-budgeting".to_owned(),
            group_id: "group-budgeting".to_owned(),
            title: "Budgeted planning".to_owned(),
            invariant: "A budget must bound work before execution.".to_owned(),
            applicability_limits: vec!["Planning workflows only".to_owned()],
            cited_claim_ids: vec!["claim-1".to_owned()],
            proposal_only: true,
            accepted: false,
        }],
        retains_full_text: false,
    }
}

fn mechanisms() -> MechanismMap {
    MechanismMap {
        contract_version: CONTRACT_VERSION,
        run_id: "improve-abc123".to_owned(),
        mechanisms: vec![Mechanism {
            id: "mech-1".to_owned(),
            proposed_mechanism: "Record an explicit budget on plan steps".to_owned(),
            affected_contract: "planning::Plan".to_owned(),
            expected_benefit: "Bounded execution and comparable runs".to_owned(),
            risks: vec!["budget may not reflect real cost".to_owned()],
            supporting_claim_ids: vec!["claim-1".to_owned(), "claim-2".to_owned()],
        }],
    }
}

fn plans() -> ImplementationPlans {
    ImplementationPlans {
        contract_version: CONTRACT_VERSION,
        run_id: "improve-abc123".to_owned(),
        plans: vec![ImplementationPlan {
            id: "PLAN-1".to_owned(),
            title: "Plan step budgets".to_owned(),
            mechanism_ids: vec!["mech-1".to_owned()],
            deliverables: vec!["budget field".to_owned()],
            acceptance_checks: vec![
                "a plan without a budget fails validation".to_owned(),
                "an over-budget execution is rejected".to_owned(),
            ],
            dependencies: Vec::new(),
        }],
    }
}

#[test]
fn accepts_a_complete_planning_run() {
    let request = request();
    validate_request(&request).expect("request");
    let literature = literature(vec![
        candidate("paper-0000", "aaa"),
        candidate("paper-0001", "bbb"),
    ]);
    validate_literature(&literature).expect("literature");
    let selection = selection();
    validate_selection(&selection, &literature).expect("selection");
    let readings = readings();
    validate_readings(&readings, &selection).expect("readings");
    let map = mechanisms();
    validate_mechanisms(&map, &readings).expect("mechanisms");
    let plans = plans();
    validate_plans(&plans, &map).expect("plans");

    let review = render_review(&ReviewInputs {
        request: &request,
        literature: &literature,
        selection: &selection,
        readings: &readings,
        map: &map,
        plans: &plans,
        inherited: None,
        evidence: None,
    });
    assert!(review.contains("Planning only. No MOZAK code was changed."));
    assert!(review.contains("single benchmark family"));
    assert!(review.contains("PLAN-1"));
}

#[test]
fn accepts_group_synthesis_workflow_contracts() {
    let readings = readings();
    let inventory = source_inventory();
    let groups = group_definition();
    let synthesis = group_synthesis();
    let skill = group_skill();

    validate_source_inventory(&inventory, &readings).expect("source inventory");
    validate_group_definition(&groups, &inventory).expect("groups");
    validate_group_synthesis(&synthesis, &groups, &readings).expect("synthesis");
    validate_group_skill(&skill, &synthesis, &readings).expect("skill");
}

#[test]
fn rejects_group_skill_that_accepts_concept_candidate() {
    let readings = readings();
    let synthesis = group_synthesis();
    let mut skill = group_skill();
    skill.concept_candidates[0].accepted = true;

    let error = validate_group_skill(&skill, &synthesis, &readings).expect_err("must reject");
    assert!(error.0.contains("proposal_only"));
}

#[test]
fn rejects_group_synthesis_without_comparison() {
    let readings = readings();
    let groups = group_definition();
    let mut synthesis = group_synthesis();
    synthesis.syntheses[0].compared_approaches = vec!["static budget".to_owned()];

    let error = validate_group_synthesis(&synthesis, &groups, &readings).expect_err("must reject");
    assert!(error.0.contains("compare at least two approaches"));
}

#[test]
fn rejects_retained_full_text() {
    let selection = selection();
    let mut readings = readings();
    readings.readings[0].retained_full_text = true;
    let error = validate_readings(&readings, &selection).expect_err("must reject");
    assert!(error.to_string().contains("full text must not be retained"));
}

/// Reading everything and keeping nothing is the intended shape, so depth and
/// retention must not be conflated.
#[test]
fn reading_the_full_text_is_not_retaining_it() {
    let selection = selection();
    let readings = readings();
    assert_eq!(readings.readings[0].read_depth, ReadDepth::FullText);
    assert!(!readings.readings[0].retained_full_text);
    validate_readings(&readings, &selection).expect("deep reading, nothing retained");
}

/// An abstract states a conclusion without the design that produced it. It can
/// justify selecting a paper; it cannot carry a mechanism out of one.
#[test]
fn rejects_a_mechanism_resting_only_on_an_abstract() {
    let mut readings = readings();
    readings.readings[0].read_depth = ReadDepth::AbstractOnly;
    let map = mechanisms();
    let error = validate_mechanisms(&map, &readings).expect_err("must reject");
    assert!(
        error
            .to_string()
            .contains("rests only on abstract-only reading"),
        "{error}"
    );

    // Shallow reading itself stays legal; only the mechanism is refused.
    validate_readings(&readings, &selection()).expect("an abstract-only reading still validates");
}

/// Depth is judged per cited claim, so one properly read source is enough to
/// carry a mechanism that also cites lighter reading.
#[test]
fn one_full_text_source_claim_carries_the_mechanism() {
    let mut readings = readings();
    readings.readings.push(PaperReading {
        paper_id: "paper-0001".to_owned(),
        source_class: SourceClass::Preprint,
        source_uri: "https://arxiv.org/abs/2608.30730".to_owned(),
        content_sha256: "bbb".to_owned(),
        claims: vec![ReadClaim {
            id: "claim-3".to_owned(),
            text: "A skimmed corroborating result.".to_owned(),
            origin: ClaimOrigin::SourceClaim,
            locator: "abstract".to_owned(),
        }],
        limitations: vec!["abstract only".to_owned()],
        read_depth: ReadDepth::AbstractOnly,
        retained_full_text: false,
    });
    let mut map = mechanisms();
    map.mechanisms[0]
        .supporting_claim_ids
        .push("claim-3".to_owned());
    validate_mechanisms(&map, &readings).expect("one deep source claim is enough");
}

/// A reading recorded before depth was contracted is read as what it was,
/// rather than being assumed adequate.
#[test]
fn a_legacy_reading_without_depth_is_abstract_only() {
    let json = r#"{"contract_version":1,"run_id":"improve-abc123","readings":[{"paper_id":"paper-0000","source_class":"preprint","source_uri":"https://example.org/a","content_sha256":"aaa","claims":[{"id":"claim-1","text":"t","origin":"source_claim","locator":"abstract"}],"limitations":["abstract only"],"retained_full_text":false}]}"#;
    let parsed: Readings = serde_json::from_str(json).expect("legacy readings still parse");
    assert_eq!(parsed.readings[0].read_depth, ReadDepth::AbstractOnly);
    assert!(!parsed.readings[0].read_depth.supports_mechanism());
}

#[test]
fn rejects_unselected_paper_reading() {
    let selection = selection();
    let mut readings = readings();
    readings.readings[0].paper_id = "paper-0002".to_owned();
    let error = validate_readings(&readings, &selection).expect_err("must reject");
    assert!(error.to_string().contains("unselected paper"));
}

#[test]
fn rejects_selection_without_reasons_for_every_candidate() {
    let literature = literature(vec![
        candidate("paper-0000", "aaa"),
        candidate("paper-0001", "bbb"),
        candidate("paper-0002", "ccc"),
    ]);
    let selection = selection();
    let error = validate_selection(&selection, &literature).expect_err("must reject");
    assert!(error.to_string().contains("inclusion or exclusion reason"));
}

#[test]
fn rejects_mechanism_resting_only_on_lab_inference() {
    let readings = readings();
    let mut map = mechanisms();
    map.mechanisms[0].supporting_claim_ids = vec!["claim-2".to_owned()];
    let error = validate_mechanisms(&map, &readings).expect_err("must reject");
    assert!(error.to_string().contains("only on Lab inference"));
}

#[test]
fn rejects_mechanism_citing_unknown_claim() {
    let readings = readings();
    let mut map = mechanisms();
    map.mechanisms[0].supporting_claim_ids = vec!["claim-9".to_owned()];
    let error = validate_mechanisms(&map, &readings).expect_err("must reject");
    assert!(error.to_string().contains("unknown claim"));
}

#[test]
fn rejects_plan_with_too_few_acceptance_checks() {
    let map = mechanisms();
    let mut plans = plans();
    plans.plans[0].acceptance_checks.pop();
    let error = validate_plans(&plans, &map).expect_err("must reject");
    assert!(error.to_string().contains("at least two acceptance checks"));
}

#[test]
fn rejects_plan_referencing_unknown_mechanism() {
    let map = mechanisms();
    let mut plans = plans();
    plans.plans[0].mechanism_ids = vec!["mech-9".to_owned()];
    let error = validate_plans(&plans, &map).expect_err("must reject");
    assert!(error.to_string().contains("unknown mechanism"));
}

#[test]
fn state_machine_rejects_skipped_steps() {
    let mut ledger = ledger();
    let error = advance(
        &mut ledger,
        RunState::PapersRead,
        "tester",
        "2026-09-06T00:00:00Z",
        &json!({}),
    )
    .expect_err("must reject");
    assert!(error.to_string().contains("cannot move to papers_read"));
}

#[test]
fn state_machine_stops_after_owner_review() {
    let mut ledger = ledger();
    for state in [
        RunState::LiteratureRefreshed,
        RunState::PapersSelected,
        RunState::PapersRead,
        RunState::MechanismsExtracted,
        RunState::ImplementationPlansProposed,
        RunState::OwnerReviewed,
    ] {
        advance(
            &mut ledger,
            state,
            "tester",
            "2026-09-06T00:00:00Z",
            &json!({}),
        )
        .expect("legal transition");
    }
    assert!(ledger.state.is_terminal());
    assert_eq!(ledger.transitions.len(), 6);
    let error = advance(
        &mut ledger,
        RunState::OwnerReviewed,
        "tester",
        "2026-09-06T00:00:00Z",
        &json!({}),
    )
    .expect_err("must stop");
    assert!(error.to_string().contains("separately authorized phase"));
}

#[test]
fn transitions_record_actor_and_input_hash() {
    let mut ledger = ledger();
    advance(
        &mut ledger,
        RunState::LiteratureRefreshed,
        "pitfa",
        "2026-09-06T00:00:00Z",
        &json!({"candidates": 20}),
    )
    .expect("legal transition");
    let recorded = &ledger.transitions[0];
    assert_eq!(recorded.actor, "pitfa");
    assert_eq!(recorded.input_hash.len(), 64);
}

#[test]
fn dedup_marks_repeat_sources_unchanged() {
    let mut ledger = ledger();
    let first = vec![
        candidate("paper-0000", "aaa"),
        candidate("paper-0001", "bbb"),
    ];
    let (fresh, unchanged) = classify_candidates(&mut ledger, &first);
    assert_eq!(fresh.len(), 2);
    assert!(unchanged.is_empty());

    let second = vec![
        candidate("paper-0000", "aaa"),
        candidate("paper-0001", "changed"),
        candidate("paper-0002", "ccc"),
    ];
    let (fresh, unchanged) = classify_candidates(&mut ledger, &second);
    assert_eq!(unchanged, vec!["paper-0000".to_owned()]);
    assert_eq!(
        fresh,
        vec!["paper-0001".to_owned(), "paper-0002".to_owned()]
    );
}

#[test]
fn rejects_unbalanced_dedup_accounting() {
    let mut literature = literature(vec![candidate("paper-0000", "aaa")]);
    literature.new_candidates.clear();
    let error = validate_literature(&literature).expect_err("must reject");
    assert!(error.to_string().contains("classified as new or unchanged"));
}

#[test]
fn rejects_request_that_plans_to_run_past_review() {
    let mut request = request();
    request.stop_at = RunState::PapersRead;
    let error = validate_request(&request).expect_err("must reject");
    assert!(error.to_string().contains("stop at owner_reviewed"));
}

#[test]
fn module_identifiers_round_trip() {
    for module in Module::all() {
        assert_eq!(Module::parse(module.as_str()).expect("known"), module);
        assert!(!module.source_areas().is_empty());
    }
    assert!(Module::parse("nonexistent").is_err());
}

/// D2: a Lab run must not read as though someone else checked it.
///
/// The case-record contract already refuses to call review independent when one
/// actor both performed and evaluated the work. A Lab run could not express the
/// distinction at all, so a self-accepted run was indistinguishable from a
/// reviewed one. These tests pin the rule at the same strength, in the same
/// vocabulary.
mod acceptance {
    use super::*;
    use mozak_core::lab::AcceptanceKind;

    fn with_actors(performed: &str, evaluated: &str) -> ImproveRequest {
        ImproveRequest {
            performed_by: Some(performed.to_owned()),
            evaluated_by: Some(evaluated.to_owned()),
            acceptance: None,
            ..request()
        }
    }

    #[test]
    fn one_actor_is_self_review_and_two_are_independent() {
        assert_eq!(
            with_actors("pitfa", "pitfa").derived_acceptance(),
            Some(AcceptanceKind::SelfReview)
        );
        assert_eq!(
            with_actors("pitfa", "a reviewer").derived_acceptance(),
            Some(AcceptanceKind::Independent)
        );
    }

    /// Whitespace must not manufacture a second actor.
    #[test]
    fn surrounding_whitespace_does_not_create_independence() {
        assert_eq!(
            with_actors("pitfa", "  pitfa  ").derived_acceptance(),
            Some(AcceptanceKind::SelfReview)
        );
    }

    #[test]
    fn a_run_cannot_claim_independence_it_does_not_have() {
        let mut overclaiming = with_actors("pitfa", "pitfa");
        overclaiming.acceptance = Some(AcceptanceKind::Independent);
        let error = validate_request(&overclaiming)
            .expect_err("must be refused")
            .0;
        assert!(
            error.contains("same actor performed and evaluated"),
            "{error}"
        );
    }

    /// The inverse also fails: understating is still a claim that disagrees
    /// with the actors, and the actors are the fact.
    #[test]
    fn a_run_cannot_understate_a_real_independent_review() {
        let mut understating = with_actors("pitfa", "a reviewer");
        understating.acceptance = Some(AcceptanceKind::SelfReview);
        assert!(validate_request(&understating).is_err());
    }

    #[test]
    fn an_honest_claim_is_accepted() {
        let mut honest = with_actors("pitfa", "pitfa");
        honest.acceptance = Some(AcceptanceKind::SelfReview);
        validate_request(&honest).expect("self_review with one actor is honest");

        let mut independent = with_actors("pitfa", "a reviewer");
        independent.acceptance = Some(AcceptanceKind::Independent);
        validate_request(&independent).expect("independent with two actors is honest");
    }

    /// A half-recorded pair cannot be checked against anything, so it would let
    /// an unverifiable claim sit in the record looking verified.
    #[test]
    fn recording_one_actor_without_the_other_is_refused() {
        let mut half = request();
        half.performed_by = Some("pitfa".to_owned());
        let error = validate_request(&half).expect_err("must be refused").0;
        assert!(error.contains("or neither"), "{error}");

        let mut other_half = request();
        other_half.evaluated_by = Some("pitfa".to_owned());
        assert!(validate_request(&other_half).is_err());
    }

    #[test]
    fn acceptance_cannot_be_claimed_without_actors() {
        let mut claimed = request();
        claimed.acceptance = Some(AcceptanceKind::Independent);
        let error = validate_request(&claimed).expect_err("must be refused").0;
        assert!(error.contains("without recording"), "{error}");
    }

    /// A run recorded before acceptance existed reports nothing rather than a
    /// default, because silence and self-review are different states.
    #[test]
    fn a_legacy_run_without_actors_reports_no_acceptance() {
        assert_eq!(request().derived_acceptance(), None);
        validate_request(&request()).expect("a run predating acceptance stays valid");
    }
}

/// D2: the packet must say who checked the run, and what validity means.
mod packet_disclosure {
    use super::*;
    use mozak_core::lab::{AcceptanceKind, render_review};

    fn packet(performed: Option<&str>, evaluated: Option<&str>) -> String {
        let request = ImproveRequest {
            performed_by: performed.map(str::to_owned),
            evaluated_by: evaluated.map(str::to_owned),
            acceptance: match (performed, evaluated) {
                (Some(p), Some(e)) => Some(AcceptanceKind::derive(p, e)),
                _ => None,
            },
            ..request()
        };
        render_review(&ReviewInputs {
            request: &request,
            literature: &literature(vec![
                candidate("paper-0000", "aaa"),
                candidate("paper-0001", "bbb"),
            ]),
            selection: &selection(),
            readings: &readings(),
            map: &mechanisms(),
            plans: &plans(),
            inherited: None,
            evidence: None,
        })
    }

    #[test]
    fn a_self_reviewed_run_says_so_prominently() {
        let rendered = packet(Some("pitfa"), Some("pitfa"));
        assert!(rendered.contains("self-review"), "{rendered}");
        assert!(
            rendered.contains("both performed and accepted"),
            "the label must say what it means, not only name itself"
        );
    }

    #[test]
    fn an_independent_run_names_both_actors() {
        let rendered = packet(Some("pitfa"), Some("a reviewer"));
        assert!(rendered.contains("independent"));
        assert!(rendered.contains("a reviewer"));
    }

    #[test]
    fn an_unrecorded_acceptance_is_not_silently_a_self_review() {
        let rendered = packet(None, None);
        assert!(rendered.contains("not recorded"), "{rendered}");
        assert!(!rendered.contains("self-review"));
    }

    /// Acceptance qualifies the findings, so it must arrive before them.
    #[test]
    fn acceptance_appears_before_the_mechanisms_it_qualifies() {
        let rendered = packet(Some("pitfa"), Some("pitfa"));
        let acceptance = rendered.find("Acceptance:").expect("acceptance line");
        let mechanisms = rendered
            .find("## Proposed mechanisms")
            .expect("mechanisms section");
        assert!(acceptance < mechanisms);
    }

    #[test]
    fn the_packet_states_that_validity_is_structural_only() {
        let rendered = packet(Some("pitfa"), Some("pitfa"));
        assert!(rendered.contains("structural conformance"), "{rendered}");
        assert!(
            rendered.contains("not evidence that they are"),
            "a valid run must not read as a verdict on the work"
        );
    }
}

/// D2 check 4: the Lab and case records must name acceptance the same way.
///
/// Two vocabularies for one idea would let a reader think a self-reviewed Lab
/// run and a self-reviewed case were different kinds of claim.
#[test]
fn lab_and_case_records_use_one_acceptance_vocabulary() {
    use mozak_core::case_study::ReviewKind;
    use mozak_core::lab::AcceptanceKind;

    let lab_self = serde_json::to_string(&AcceptanceKind::SelfReview).expect("json");
    let case_self = serde_json::to_string(&ReviewKind::SelfReview).expect("json");
    assert_eq!(
        lab_self, case_self,
        "self-review must serialize identically"
    );

    let lab_independent = serde_json::to_string(&AcceptanceKind::Independent).expect("json");
    let case_independent = serde_json::to_string(&ReviewKind::Independent).expect("json");
    assert_eq!(lab_independent, case_independent);

    assert_eq!(AcceptanceKind::SelfReview.as_str(), "self_review");
    assert_eq!(AcceptanceKind::Independent.as_str(), "independent");
}

/// D3: a run must say what it is bounded to, in terms that can be checked.
mod objective {
    use super::*;
    use mozak_core::lab::RunObjective;

    fn bounded(conditions: &[&str], excludes: &[&str]) -> ImproveRequest {
        ImproveRequest {
            scope_boundary: Some(RunObjective {
                objective: "decide how planning should represent budgets".to_owned(),
                completion_conditions: conditions.iter().map(|c| (*c).to_owned()).collect(),
                excludes: excludes.iter().map(|e| (*e).to_owned()).collect(),
            }),
            ..request()
        }
    }

    /// Without an observable condition, "done" is whatever the run later says.
    #[test]
    fn an_objective_without_completion_conditions_is_rejected() {
        let error = validate_request(&bounded(&[], &[]))
            .expect_err("must be refused")
            .0;
        assert!(error.contains("completion condition"), "{error}");
    }

    #[test]
    fn an_objective_with_an_empty_condition_is_rejected() {
        assert!(validate_request(&bounded(&["  "], &[])).is_err());
    }

    #[test]
    fn an_objective_with_an_observable_condition_is_accepted() {
        validate_request(&bounded(
            &["a plan card exists naming the budget field"],
            &["runtime budget enforcement"],
        ))
        .expect("a bounded objective is valid");
    }

    /// Runs recorded before objectives existed must stay valid.
    #[test]
    fn a_run_without_an_objective_remains_valid() {
        assert!(request().scope_boundary.is_none());
        validate_request(&request()).expect("legacy runs stay valid");
    }

    /// D3 check 2: the packet shows the objective beside what was excluded.
    #[test]
    fn the_packet_shows_the_objective_and_its_exclusions() {
        let request = bounded(
            &["a plan card exists naming the budget field"],
            &["runtime budget enforcement"],
        );
        let rendered = render_review(&ReviewInputs {
            request: &request,
            literature: &literature(vec![
                candidate("paper-0000", "aaa"),
                candidate("paper-0001", "bbb"),
            ]),
            selection: &selection(),
            readings: &readings(),
            map: &mechanisms(),
            plans: &plans(),
            inherited: None,
            evidence: None,
        });
        assert!(rendered.contains("## Objective"), "{rendered}");
        assert!(rendered.contains("Complete when:"));
        assert!(rendered.contains("a plan card exists naming the budget field"));
        assert!(rendered.contains("Deliberately excluded:"));
        assert!(rendered.contains("runtime budget enforcement"));

        let objective = rendered.find("## Objective").expect("objective");
        let mechanisms = rendered.find("## Proposed mechanisms").expect("mechanisms");
        assert!(
            objective < mechanisms,
            "the boundary must precede the findings it bounds"
        );
    }
}

/// D3 check 3: a run proposing a Lab change still stops, and says why.
#[test]
fn the_meta_boundary_is_terminal_and_its_rationale_is_recorded() {
    assert!(RunState::OwnerReviewed.is_terminal());
    for state in [
        RunState::Requested,
        RunState::LiteratureRefreshed,
        RunState::PapersSelected,
        RunState::PapersRead,
        RunState::MechanismsExtracted,
        RunState::ImplementationPlansProposed,
    ] {
        assert!(!state.is_terminal(), "{state:?} must not end the lifecycle");
    }

    // The rationale lives on the invariant itself, where an editor removing the
    // stop would have to read past it first.
    let source = include_str!("../src/lab.rs");
    let doc_start = source
        .find("/// Whether the planning-only lifecycle ends here.")
        .expect("is_terminal doc");
    let doc = &source[doc_start..doc_start + 1600];
    assert!(doc.contains("Metan"), "the rationale must cite its source");
    assert!(doc.contains("stable"));
    assert!(
        doc.contains("separately authorized phase"),
        "it must say what does happen instead"
    );
}

// --- Retired module identifiers -------------------------------------------
//
// The public release replaced a five-module split with the current six and
// removed the old identifiers outright. Five real runs recorded 2026-09-06 to
// 2026-09-08 became unreadable: `Module` had no variant for their id, so the
// whole ledger failed to deserialize and every route that reads one was closed
// to them. These tests exist because nothing previously asserted that an
// artifact written by an older MOZAK still parses.

#[test]
fn a_retired_module_id_still_deserializes() {
    // The exact ids found in the orphaned runs.
    for id in [
        "research-and-adapters",
        "scope-and-knowledge-state",
        "evaluation-and-cases",
        "concepts-and-translations",
        "planning-and-execution",
    ] {
        let module: Module = serde_json::from_value(json!(id))
            .unwrap_or_else(|error| panic!("retired id {id} must still parse: {error}"));
        assert_eq!(
            module.as_str(),
            id,
            "a retired id must round-trip as itself"
        );
        assert!(module.is_retired(), "{id} must report itself as retired");
    }
}

#[test]
fn a_retired_id_is_not_silently_mapped_onto_a_current_module() {
    // The tempting fix is a serde alias onto the nearest current variant. That
    // would make an old run claim it studied a module that did not exist when
    // it ran. A retired id must deserialize to itself and to nothing else.
    let module: Module = serde_json::from_value(json!("evaluation-and-cases")).expect("parses");
    for current in Module::all() {
        assert_ne!(
            module,
            current,
            "a retired id must not resolve to the current module {}",
            current.as_str()
        );
    }
}

#[test]
fn a_whole_ledger_written_under_a_retired_id_still_loads() {
    // The actual failure: not the enum in isolation, but the ledger around it.
    let mut ledger = ledger();
    ledger.module = Module::EvaluationAndCases;
    let raw = serde_json::to_string(&ledger).expect("serializes");
    let loaded: RunLedger = serde_json::from_str(&raw).expect("a retired ledger must still load");
    assert_eq!(loaded.module, Module::EvaluationAndCases);
    assert!(loaded.module.is_retired());
}

#[test]
fn a_retired_module_is_not_addressable_by_a_new_run() {
    // Readable is not the same as choosable. `parse` backs the command line.
    assert!(
        Module::parse("evaluation-and-cases").is_err(),
        "a retired id must not be selectable on the command line"
    );
    assert!(
        !Module::all().iter().any(|module| module.is_retired()),
        "`lab modules` must offer only current modules"
    );
    assert_eq!(Module::all().len(), 6);
}

#[test]
fn authoring_a_request_under_a_retired_module_is_refused() {
    // The contract-level guard, independent of the CLI's `parse`.
    let mut request = request();
    request.module = Module::ConceptsAndTranslations;
    let error =
        validate_request(&request).expect_err("authoring under a retired module is refused");
    assert!(
        error.to_string().contains("retired"),
        "the refusal must say why: {error}"
    );
}

#[test]
fn a_retired_module_describes_itself_as_retired_rather_than_as_a_current_boundary() {
    // Its summary must not describe a module MOZAK draws today, and it must
    // claim no source files, since those were redistributed.
    let module = Module::ResearchAndAdapters;
    assert!(module.summary().contains("retired"));
    assert!(
        module.source_areas().is_empty(),
        "a retired boundary must claim no current source files"
    );
    for current in Module::all() {
        assert_ne!(module.summary(), current.summary());
    }
}
