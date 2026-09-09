//! Checks that the Lab's planning-only boundary is justified by named evidence.
//!
//! Card `plan-record-why-the-lab-stops` requires the justification to name its
//! source and specific claims rather than appeal generally to caution, and to
//! record that the evidence concerns memory-based self-improving agents rather
//! than a planning-only lab. Documentation drifts silently, so the requirement
//! is asserted rather than trusted.

use std::{fs, path::Path};

fn lab_source() -> String {
    fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("src/lab.rs")).expect("lab.rs")
}

/// Flattens doc-comment wrapping so a phrase can be asserted regardless of
/// where the line breaks fall.
fn prose() -> String {
    lab_source()
        .lines()
        .map(|line| line.trim_start().trim_start_matches("//!").trim())
        .collect::<Vec<_>>()
        .join(" ")
}

#[test]
fn the_planning_only_boundary_names_its_source_and_claims() {
    let source = lab_source();
    // A specific citation, not a general appeal to caution.
    assert!(
        source.contains("arXiv:2608.18066"),
        "missing source identifier"
    );
    assert!(
        source.contains("On the Fragility") && source.contains("Ye et al."),
        "missing named source"
    );
    for claim in [
        "claim-self-improvement-noise",
        "claim-task-order-dependence",
        "claim-underspecification-oversight",
    ] {
        assert!(source.contains(claim), "missing recorded claim {claim}");
    }
    // Traceable to the run that read it.
    assert!(
        source.contains("improve-b1805c3b0f1488a48af592cc"),
        "missing the Lab run the evidence was read in"
    );
}

#[test]
fn the_justification_records_its_own_limitations() {
    let source = prose();
    assert!(
        source.contains("read from the paper's abstract"),
        "must admit the read depth"
    );
    // The scope mismatch is the limitation most likely to be glossed over.
    assert!(
        source.contains("rewrite their own textual memory") && source.contains("planning-only lab"),
        "must record that the evidence concerns memory-based self-improving agents"
    );
    assert!(
        source.contains("does not establish that a stop is sufficient"),
        "must not overclaim what the evidence shows"
    );
}
