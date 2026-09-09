//! A recorded case reports proposals without accepting them.

use std::{
    path::{Path, PathBuf},
    process::{Command, Output},
};

fn fixture() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../mozak-core/tests/fixtures/case/example-beta-oneshot.json")
}
fn run(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_mozak"))
        .args(args)
        .output()
        .unwrap()
}

#[test]
fn case_routes_report_proposal_only_authority_and_separate_judgement_from_measurement() {
    let path = fixture();
    let validated = run(&["case", "validate", path.to_str().unwrap()]);
    assert!(
        validated.status.success(),
        "{}",
        String::from_utf8_lossy(&validated.stderr)
    );
    let value: serde_json::Value = serde_json::from_slice(&validated.stdout).unwrap();
    assert_eq!(value["authority"], "proposal_only");
    assert_eq!(value["generality"], "single_case");
    assert_eq!(value["measured_observations"], 8);
    assert_eq!(value["qualitative_observations"], 2);
    assert_eq!(value["open_findings"], 1);

    let listed = run(&["case", "list", path.to_str().unwrap()]);
    assert!(listed.status.success());
    let text = String::from_utf8_lossy(&listed.stdout);
    assert!(text.contains("(not comparable)"));
    assert!(text.contains("proposal_only"));
    assert!(text.contains("8 measured, 2 qualitative"));
    // Limitations are part of the default view, not a footnote.
    assert!(text.contains("qualitative interpretation, not a measurement"));
}

/// A valid record reads as an endorsement unless the tool says otherwise.
/// The scan tier this validation belongs to was measured against live outcome
/// at roughly zero correlation, so the boundary belongs in the receipt.
#[test]
fn every_receipt_states_what_validation_did_not_measure() {
    let path = fixture();
    let validated = run(&["case", "validate", path.to_str().unwrap()]);
    assert!(validated.status.success());
    let value: serde_json::Value = serde_json::from_slice(&validated.stdout).unwrap();
    // A fixed key, not prose inside an existing field.
    assert_eq!(
        value["validation_boundary"],
        "structure_and_internal_consistency_only: no outcome was measured and no quality is asserted"
    );
    assert_eq!(
        value["contract_version"], 1,
        "sealed v1 evidence still reads"
    );

    let listed = run(&["case", "list", path.to_str().unwrap()]);
    assert!(listed.status.success());
    assert!(
        String::from_utf8_lossy(&listed.stdout).contains("no outcome was measured"),
        "the boundary is in the human view too"
    );
}

/// The packet is what a second party would receive: the evidence, without the
/// author's conclusions, and derived rather than stored beside the case.
#[test]
fn the_reproduction_packet_carries_evidence_and_leaves_the_case_untouched() {
    let path = fixture();
    let before = std::fs::read(&path).unwrap();

    let emitted = run(&["case", "reproduce-packet", path.to_str().unwrap()]);
    assert!(
        emitted.status.success(),
        "{}",
        String::from_utf8_lossy(&emitted.stderr)
    );
    let value: serde_json::Value = serde_json::from_slice(&emitted.stdout).unwrap();
    assert_eq!(value["command"], "case reproduce-packet");
    assert_eq!(value["derived"], "on_demand_never_stored");
    assert_eq!(value["measured_observations"].as_array().unwrap().len(), 8);
    assert!(value["blinding"].as_str().unwrap().contains("not blinded"));
    assert!(
        value["authority"]
            .as_str()
            .unwrap()
            .contains("reproduction_outstanding")
    );

    // No conclusion of any kind appears in the packet.
    for withheld in ["findings", "calibration", "derived_proposals"] {
        assert!(value.get(withheld).is_none(), "packet leaked {withheld}");
    }
    assert!(
        value["withheld"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item == "derived_proposals")
    );

    // The case is the single source of truth and must not have moved.
    assert_eq!(before, std::fs::read(&path).unwrap());
}

#[test]
fn a_promotional_case_without_limitations_fails_closed_with_no_stdout() {
    let temp = std::env::temp_dir().join(format!("mozak-case-{}", std::process::id()));
    std::fs::create_dir_all(&temp).unwrap();
    let path = temp.join("promotional.json");
    let mut value: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(fixture()).unwrap()).unwrap();
    value["calibration"]["limitations"] = serde_json::json!([]);
    std::fs::write(&path, serde_json::to_vec(&value).unwrap()).unwrap();

    let rejected = run(&["case", "validate", path.to_str().unwrap()]);
    assert!(!rejected.status.success());
    assert!(rejected.stdout.is_empty());
    assert!(
        String::from_utf8_lossy(&rejected.stderr).contains("must record the limitations"),
        "{}",
        String::from_utf8_lossy(&rejected.stderr)
    );
    std::fs::remove_dir_all(&temp).unwrap();
}
