//! Public Concept and Translation routes stay proposal-only and fail closed.

use std::{
    path::{Path, PathBuf},
    process::{Command, Output},
};

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../mozak-core/tests/fixtures/concept")
        .join(name)
}
fn run(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_mozak"))
        .args(args)
        .output()
        .unwrap()
}

#[test]
fn concept_and_translation_routes_report_advisory_authority_only() {
    let concept = fixture("publish-as-commit.json");
    let translation = fixture("example-beta-translation.json");

    let validated = run(&["concept", "validate", concept.to_str().unwrap()]);
    assert!(
        validated.status.success(),
        "{}",
        String::from_utf8_lossy(&validated.stderr)
    );
    let value: serde_json::Value = serde_json::from_slice(&validated.stdout).unwrap();
    assert_eq!(value["authority"], "advisory_only");
    assert_eq!(value["assumption_count"], 5);
    assert_eq!(
        value["load_bearing_assumptions"],
        serde_json::json!(["A-01", "A-02"])
    );

    let checked = run(&[
        "concept",
        "translation",
        "validate",
        concept.to_str().unwrap(),
        translation.to_str().unwrap(),
    ]);
    assert!(
        checked.status.success(),
        "{}",
        String::from_utf8_lossy(&checked.stderr)
    );
    let value: serde_json::Value = serde_json::from_slice(&checked.stdout).unwrap();
    assert_eq!(value["authority"], "advisory_only");
    assert_eq!(value["adoption"], "qualified");
    assert_eq!(value["assumptions_re_derived"], 5);
    assert_eq!(value["outcomes"]["replaced"], 2);
    assert_eq!(value["outcomes"]["rejected"], 2);

    // The terminal view shows every assumption and what the target did with it.
    let listed = run(&[
        "concept",
        "list",
        concept.to_str().unwrap(),
        translation.to_str().unwrap(),
    ]);
    assert!(listed.status.success());
    let text = String::from_utf8_lossy(&listed.stdout);
    assert!(text.contains("[load-bearing] The commit author identity"));
    assert!(text.contains("-> replaced:"));
    assert!(text.contains("-> rejected:"));
    assert!(text.contains("[qualified]"));
}

#[test]
fn a_translation_whose_concept_drifted_fails_closed_with_no_stdout() {
    let concept = fixture("publish-as-commit.json");
    let translation = fixture("example-beta-translation.json");
    let temp = std::env::temp_dir().join(format!("mozak-concept-{}", std::process::id()));
    std::fs::create_dir_all(&temp).unwrap();
    let drifted = temp.join("drifted-concept.json");
    let mut value: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&concept).unwrap()).unwrap();
    value["assumptions"][3]["load_bearing"] = serde_json::json!(true);
    std::fs::write(&drifted, serde_json::to_vec(&value).unwrap()).unwrap();

    let rejected = run(&[
        "concept",
        "translation",
        "validate",
        drifted.to_str().unwrap(),
        translation.to_str().unwrap(),
    ]);
    assert!(!rejected.status.success());
    assert!(
        rejected.stdout.is_empty(),
        "a drifted concept must produce no output"
    );
    assert!(
        String::from_utf8_lossy(&rejected.stderr).contains("concept hash mismatch"),
        "{}",
        String::from_utf8_lossy(&rejected.stderr)
    );
    std::fs::remove_dir_all(&temp).unwrap();
}

/// A Concept is owned by its author, so discovery must handle both the local
/// case and the ordinary cross-owner case without lying about either.
#[test]
fn project_overview_discovers_owned_concepts_and_reports_external_pins_honestly() {
    let temp = std::env::temp_dir().join(format!("mozak-concept-proj-{}", std::process::id()));
    let project = temp.join("project");
    std::fs::create_dir_all(project.join(".mozak/concepts")).unwrap();
    std::fs::create_dir_all(project.join(".mozak/translations")).unwrap();
    std::fs::write(
        project.join(".mozak/project.yml"),
        "version: 1\nframework_contract_version: 1\nproject:\n  id: adopter\n  name: Adopter\nrepository:\n  revision: 0123456789abcdef0123456789abcdef01234567\nowned_paths:\n  - src\n",
    )
    .unwrap();
    std::fs::write(
        project.join(".mozak/idea.md"),
        "# Adopter\n\n## Intent\n\nAdopt one bounded concept.\n\n## Desired outcomes\n\n- Works.\n\n## Boundaries\n\n- Local only.\n\n## Assumptions\n\n- Rust.\n\n## Open questions\n\n- None.\n",
    )
    .unwrap();

    // A translation whose source concept is authored elsewhere is reported as
    // an external pin, not as a project defect and not as fully verified.
    std::fs::copy(
        fixture("example-beta-translation.json"),
        project.join(".mozak/translations/external.json"),
    )
    .unwrap();
    let external = run(&["project", "overview", project.to_str().unwrap()]);
    let value: serde_json::Value = serde_json::from_slice(&external.stdout).unwrap();
    assert_eq!(
        value["concepts"][0]["role"],
        "translation_of_external_concept"
    );
    assert_eq!(value["concepts"][0]["adoption"], "qualified");
    assert_eq!(value["artifact_counts"]["concept"]["invalid"], 0);

    // With the source concept authored locally, the full contract is checked.
    std::fs::copy(
        fixture("publish-as-commit.json"),
        project.join(".mozak/concepts/publish-as-commit.json"),
    )
    .unwrap();
    let local = run(&["project", "overview", project.to_str().unwrap()]);
    let value: serde_json::Value = serde_json::from_slice(&local.stdout).unwrap();
    let roles: Vec<_> = value["concepts"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["role"].as_str().unwrap())
        .collect();
    assert!(roles.contains(&"authored"));
    assert!(roles.contains(&"translation"));
    assert_eq!(value["artifact_counts"]["concept"]["valid"], 2);

    // A translation that contradicts its locally authored source fails closed.
    let mut broken: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(project.join(".mozak/translations/external.json")).unwrap(),
    )
    .unwrap();
    broken["adoption"] = serde_json::json!("adopted");
    std::fs::write(
        project.join(".mozak/translations/external.json"),
        serde_json::to_vec(&broken).unwrap(),
    )
    .unwrap();
    let rejected = run(&["project", "overview", project.to_str().unwrap()]);
    let value: serde_json::Value = serde_json::from_slice(&rejected.stdout).unwrap();
    assert_eq!(value["state"], "invalid");
    assert_eq!(value["artifact_counts"]["concept"]["invalid"], 1);

    std::fs::remove_dir_all(&temp).unwrap();
}
