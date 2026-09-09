use mozak_core::project_contract::{
    validate_bootstrap_migration_json, validate_idea_markdown, validate_project_yaml,
};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn read(relative: &str) -> String {
    fs::read_to_string(root().join(relative)).expect("fixture must be readable")
}

#[test]
fn valid_project_and_idea_examples_pass_deterministically() {
    for name in ["project-minimal.yml", "project-complete.yml"] {
        let source = read(&format!(
            "spec/project-framework/fixtures/pf-0002/valid/{name}"
        ));
        let first = validate_project_yaml(&source).expect("valid project fixture");
        let second = validate_project_yaml(&source).expect("repeat validation");
        assert_eq!(first, second);
    }
    for name in ["idea-minimal.md", "idea-complete.md"] {
        let source = read(&format!(
            "spec/project-framework/fixtures/pf-0002/valid/{name}"
        ));
        let first = validate_idea_markdown(&source).expect("valid idea fixture");
        let second = validate_idea_markdown(&source).expect("repeat validation");
        assert_eq!(first, second);
    }
}

#[test]
fn adversarial_fixtures_fail_closed_with_stable_semantics() {
    let expected: BTreeMap<String, String> = serde_json::from_str(&read(
        "spec/project-framework/fixtures/pf-0002/invalid/expected-rejections.json",
    ))
    .expect("expectation map");
    for (name, expected_error) in expected {
        let source = read(&format!(
            "spec/project-framework/fixtures/pf-0002/invalid/{name}"
        ));
        let error = if Path::new(&name)
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("yml"))
        {
            validate_project_yaml(&source).expect_err("project fixture must fail")
        } else {
            validate_idea_markdown(&source).expect_err("idea fixture must fail")
        };
        assert_eq!(error.to_string(), expected_error, "fixture {name}");
    }
}

#[test]
fn bootstrap_migration_is_non_destructive_and_preserves_references() {
    let source = read("spec/project-framework/fixtures/pf-0002/bootstrap-migration.json");
    let migration = validate_bootstrap_migration_json(&source).expect("valid migration fixture");
    assert_eq!(migration.source.packet_ids, migration.migrated.packet_ids);
    assert_eq!(migration.source.goal_refs, migration.migrated.goal_refs);

    let mut changed: serde_json::Value = serde_json::from_str(&source).expect("fixture JSON");
    changed["migrated"]["packet_ids"][0] = serde_json::Value::String("PF-9999".into());
    let error =
        validate_bootstrap_migration_json(&changed.to_string()).expect_err("changed ID fails");
    assert_eq!(
        error.to_string(),
        "bootstrap migration must preserve packet IDs"
    );
}
