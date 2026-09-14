use mozak_core::lab::{
    AdapterRunRef, CONTRACT_VERSION, Candidate, ClaimOrigin, ImplementationPlan,
    ImplementationPlans, ImproveRequest, LiteratureRun, Mechanism, MechanismMap, Module,
    PaperReading, ReadClaim, ReadDepth, Readings, RunLedger, RunState, Selection,
    SelectionDecision, SourceClass, advance, classify_candidates, render_review,
    validate_literature, validate_mechanisms, validate_plans, validate_readings, validate_request,
    validate_selection,
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

    let review = render_review(
        &request,
        &literature,
        &selection,
        &readings,
        &map,
        &plans,
        None,
    );
    assert!(review.contains("Planning only. No MOZAK code was changed."));
    assert!(review.contains("single benchmark family"));
    assert!(review.contains("PLAN-1"));
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
        render_review(
            &request,
            &literature(vec![
                candidate("paper-0000", "aaa"),
                candidate("paper-0001", "bbb"),
            ]),
            &selection(),
            &readings(),
            &mechanisms(),
            &plans(),
            None,
        )
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
