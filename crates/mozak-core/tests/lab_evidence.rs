//! Contract tests for Scope evidence carried between Lab runs.
//!
//! Every test here exists because of a way carried knowledge can lie: by
//! forgetting a disagreement, by letting the newest run rewrite history, by
//! promoting one run's reasoning into the Scope's permanent record, or by
//! becoming an accepted input without anyone approving it.

use mozak_core::lab_evidence::{
    CONTRACT_VERSION, ClaimStanding, EvidenceEntry, ScopeEvidence, validate, validate_json,
};

fn entry(claim_id: &str, standing: ClaimStanding, run: &str) -> EvidenceEntry {
    EvidenceEntry {
        claim_id: claim_id.to_owned(),
        text: format!("claim {claim_id} says something checkable"),
        standing,
        locator: "section 3".to_owned(),
        recorded_by_run: run.to_owned(),
        recorded_at: "2026-09-14T00:00:00Z".to_owned(),
        source_sha256: "a".repeat(64),
    }
}

fn evidence_with(entries: Vec<EvidenceEntry>) -> ScopeEvidence {
    let mut evidence = ScopeEvidence::new("topic-agentic-systems");
    evidence
        .record("topic-agentic-systems", entries)
        .expect("entries are well formed");
    evidence
}

/// D1 check 1: a later run must inherit rather than start empty.
#[test]
fn a_later_run_reads_what_an_earlier_run_established() {
    let evidence = evidence_with(vec![
        entry("paper-0000::c1", ClaimStanding::Held, "improve-first"),
        entry(
            "paper-0000::c2",
            ClaimStanding::OpenFailure,
            "improve-first",
        ),
    ]);

    assert_eq!(evidence.entries.len(), 2);
    assert_eq!(evidence.current().len(), 2);
    assert_eq!(
        evidence.preservation_requirements().len(),
        1,
        "only a held claim binds later work"
    );
    assert_eq!(evidence.open_failures().len(), 1);
}

/// D1 check 2: a verified claim becomes a requirement, an unsupported one does not.
#[test]
fn only_held_claims_become_preservation_requirements() {
    let evidence = evidence_with(vec![
        entry("held", ClaimStanding::Held, "improve-a"),
        entry("unsupported", ClaimStanding::Unsupported, "improve-a"),
        entry("open", ClaimStanding::OpenFailure, "improve-a"),
    ]);

    let ids = evidence
        .preservation_requirements()
        .iter()
        .map(|e| e.claim_id.as_str())
        .collect::<Vec<_>>();
    assert_eq!(ids, vec!["held"]);
    assert!(ClaimStanding::Held.is_preservation_requirement());
    assert!(!ClaimStanding::Unsupported.is_preservation_requirement());
    assert!(!ClaimStanding::OpenFailure.is_preservation_requirement());
}

/// D1 check 3: carrying evidence must not become a route around the owner gate.
#[test]
fn carried_evidence_states_that_it_authorizes_nothing() {
    let authority = mozak_core::lab_evidence::authority();
    assert!(authority.starts_with("proposal_only"), "{authority}");
    assert!(
        authority.contains("owner approval"),
        "the boundary must name what is still required"
    );
}

/// D1 check 4: disagreement is surfaced, never silently overwritten.
#[test]
fn a_contradicting_later_claim_is_recorded_not_overwritten() {
    let mut evidence = evidence_with(vec![entry("c1", ClaimStanding::Held, "improve-first")]);
    let found = evidence
        .record(
            "topic-agentic-systems",
            vec![entry("c1", ClaimStanding::Unsupported, "improve-second")],
        )
        .expect("recording is valid");

    assert_eq!(found.len(), 1, "the disagreement must be reported");
    assert_eq!(found[0].earlier_standing, ClaimStanding::Held);
    assert_eq!(found[0].later_standing, ClaimStanding::Unsupported);
    assert_eq!(found[0].earlier_run, "improve-first");
    assert_eq!(found[0].later_run, "improve-second");

    assert_eq!(
        evidence.entries.len(),
        2,
        "the earlier entry survives; history is append-only"
    );
    assert!(
        evidence.preservation_requirements().is_empty(),
        "a contradicted claim no longer binds later work"
    );
    validate(&evidence).expect("a state with a recorded contradiction is valid");
}

/// Agreement is not a contradiction. Re-confirming a claim must stay quiet.
#[test]
fn re_recording_the_same_standing_is_not_a_contradiction() {
    let mut evidence = evidence_with(vec![entry("c1", ClaimStanding::Held, "improve-first")]);
    let found = evidence
        .record(
            "topic-agentic-systems",
            vec![entry("c1", ClaimStanding::Held, "improve-second")],
        )
        .expect("valid");
    assert!(found.is_empty());
    assert_eq!(evidence.preservation_requirements().len(), 1);
}

/// A state that dropped a disagreement would look consistent while hiding the
/// one thing a reader most needs to see.
#[test]
fn a_standing_change_without_a_recorded_contradiction_is_refused() {
    let mut evidence = evidence_with(vec![entry("c1", ClaimStanding::Held, "improve-first")]);
    evidence
        .entries
        .push(entry("c1", ClaimStanding::Unsupported, "improve-second"));
    let error = validate(&evidence).expect_err("must be refused").0;
    assert!(
        error.contains("without a recorded contradiction"),
        "{error}"
    );
}

#[test]
fn a_manufactured_contradiction_is_refused() {
    let mut evidence = evidence_with(vec![entry("c1", ClaimStanding::Held, "improve-first")]);
    evidence
        .contradictions
        .push(mozak_core::lab_evidence::EvidenceContradiction {
            claim_id: "never-recorded".to_owned(),
            earlier_standing: ClaimStanding::Held,
            earlier_run: "improve-first".to_owned(),
            later_standing: ClaimStanding::Unsupported,
            later_run: "improve-second".to_owned(),
        });
    let error = validate(&evidence).expect_err("must be refused").0;
    assert!(error.contains("no recorded entry"), "{error}");
}

#[test]
fn a_contradiction_between_two_identical_standings_is_refused() {
    let mut evidence = evidence_with(vec![entry("c1", ClaimStanding::Held, "improve-first")]);
    evidence
        .contradictions
        .push(mozak_core::lab_evidence::EvidenceContradiction {
            claim_id: "c1".to_owned(),
            earlier_standing: ClaimStanding::Held,
            earlier_run: "improve-first".to_owned(),
            later_standing: ClaimStanding::Held,
            later_run: "improve-second".to_owned(),
        });
    assert!(validate(&evidence).is_err());
}

/// Evidence belongs to one Scope. Accepting another's would let knowledge
/// migrate between projects without anyone deciding it should.
#[test]
fn evidence_from_another_scope_is_refused() {
    let mut evidence = ScopeEvidence::new("topic-agentic-systems");
    let error = evidence
        .record("genome-mcp", vec![entry("c1", ClaimStanding::Held, "run")])
        .expect_err("must be refused")
        .0;
    assert!(error.contains("different Scope"), "{error}");
}

#[test]
fn a_malformed_entry_is_refused() {
    let mut evidence = ScopeEvidence::new("topic-agentic-systems");
    let mut bad = entry("c1", ClaimStanding::Held, "run");
    bad.source_sha256 = String::new();
    assert!(evidence.record("topic-agentic-systems", vec![bad]).is_err());

    let mut empty_id = entry("", ClaimStanding::Held, "run");
    empty_id.claim_id = String::new();
    assert!(
        evidence
            .record("topic-agentic-systems", vec![empty_id])
            .is_err()
    );
}

#[test]
fn an_empty_scope_starts_with_nothing_and_is_valid() {
    let evidence = ScopeEvidence::new("topic-agentic-systems");
    validate(&evidence).expect("an empty state is valid");
    assert!(evidence.preservation_requirements().is_empty());
    assert!(evidence.open_failures().is_empty());
    assert_eq!(evidence.contract_version, CONTRACT_VERSION);
}

#[test]
fn the_state_round_trips_and_hashes_deterministically() {
    let evidence = evidence_with(vec![
        entry("c1", ClaimStanding::Held, "improve-first"),
        entry("c2", ClaimStanding::OpenFailure, "improve-first"),
    ]);
    let json = serde_json::to_string(&evidence).expect("serialize");
    let parsed = validate_json(&json).expect("round trip");
    assert_eq!(parsed, evidence);
    assert_eq!(parsed.hash().expect("hash"), evidence.hash().expect("hash"));
}

#[test]
fn unknown_fields_are_refused() {
    let json = r#"{"contract_version":1,"scope_id":"s","entries":[],"surprise":true}"#;
    assert!(validate_json(json).is_err());
}
