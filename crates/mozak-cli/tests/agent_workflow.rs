use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Output},
    sync::atomic::{AtomicU64, Ordering},
};

static NEXT: AtomicU64 = AtomicU64::new(0);
struct Temp(PathBuf);
impl Temp {
    fn new(name: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "mozak-agent-workflow-{}-{}-{name}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}
fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../mozak-core/tests/fixtures")
        .join(name)
}
fn setup() -> Temp {
    let root = Temp::new("project");
    fs::create_dir_all(root.0.join(".mozak/planning/plans")).unwrap();
    fs::write(root.0.join(".mozak/project.yml"), "version: 1\nframework_contract_version: 1\nproject:\n  id: workflow\n  name: Workflow\nrepository:\n  revision: 0123456789abcdef0123456789abcdef01234567\nowned_paths:\n  - .mozak\n").unwrap();
    fs::write(root.0.join(".mozak/idea.md"), "# Workflow\n\n## Intent\n\nOperate a project.\n\n## Desired outcomes\n\nProduce validated work.\n\n## Boundaries\n\nRemain local.\n\n## Assumptions\n\nContracts are authoritative.\n\n## Open questions\n\nWhat is next?\n").unwrap();
    fs::copy(
        fixture("planning/accepted-inputs.json"),
        root.0.join(".mozak/planning/accepted-inputs.json"),
    )
    .unwrap();
    fs::copy(
        fixture("planning/valid-shared-dag.json"),
        root.0.join(".mozak/planning/plans/plan-v1.json"),
    )
    .unwrap();
    root
}
fn run(root: &Path) -> Output {
    run_command(root, "overview")
}
fn run_command(root: &Path, command: &str) -> Output {
    Command::new(env!("CARGO_BIN_EXE_mozak"))
        .args(["project", command])
        .arg(root)
        .output()
        .unwrap()
}

fn read_json(path: impl AsRef<Path>) -> Value {
    serde_json::from_slice(&fs::read(path).unwrap()).unwrap()
}

fn write_json(path: impl AsRef<Path>, value: &Value) {
    fs::write(path, serde_json::to_vec_pretty(value).unwrap()).unwrap();
}

#[test]
fn overview_has_closed_stable_shape_and_production_ready_order() {
    let root = setup();
    let first = run(&root.0);
    let second = run(&root.0);
    assert!(
        first.status.success(),
        "{}",
        String::from_utf8_lossy(&first.stderr)
    );
    assert_eq!(first.stdout, second.stdout);
    let value: Value = serde_json::from_slice(&first.stdout).unwrap();
    let keys = value
        .as_object()
        .unwrap()
        .keys()
        .cloned()
        .collect::<Vec<_>>();
    assert_eq!(
        keys,
        [
            "artifact_counts",
            "command",
            "compaction",
            "concepts",
            "contexts",
            "findings",
            "goals",
            "latest_valid_plan",
            "next_actions",
            "project_root",
            "ready_goals",
            "schema_version",
            "state"
        ]
    );
    assert_eq!(value["schema_version"], 1);
    assert_eq!(value["state"], "valid");
    assert_eq!(value["latest_valid_plan"]["id"], "plan-main");
    assert_eq!(
        value["ready_goals"]
            .as_array()
            .unwrap()
            .iter()
            .map(|g| g["id"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["consumer-b", "consumer-a"]
    );
    assert_eq!(value["artifact_counts"]["planning"]["recognized"], 2);
}

fn add_valid_context(root: &Path) {
    let context_dir = root.join(".mozak/context");
    let run_dir = root.join(".mozak/research/runs/paper");
    fs::create_dir_all(&context_dir).unwrap();
    fs::create_dir_all(&run_dir).unwrap();
    let note = b"# Paper context\n\nPinned project knowledge.\n";
    fs::write(context_dir.join("paper-v1.md"), note).unwrap();
    fs::copy(fixture("research/valid-run.json"), run_dir.join("run.json")).unwrap();
    let run = read_json(run_dir.join("run.json"));
    let manifest = serde_json::json!({
        "schema_version": 1,
        "id": "context-paper-v1",
        "status": "completed",
        "created_at": "2026-09-02T03:43:00Z",
        "source_repository": "/example/obsidian",
        "source_revision": "392662303f926206cfaf943ed97f84d7e61bcd7f",
        "sources": [{
            "path": "paper/manuscript.md",
            "sha256": "e96d83b7ea2e5b612f96557b5e2d2b17615374f60a05ab0a84a28bbf40858ec5",
            "role": "authoritative_manuscript"
        }],
        "research_run": ".mozak/research/runs/paper/run.json",
        "research_run_artifact_hash": run["receipt"]["artifact_hash"],
        "context_note": ".mozak/context/paper-v1.md",
        "context_note_sha256": format!("{:x}", Sha256::digest(note)),
        "goal_id": "onboard-paper-context",
        "plan_version": 1,
        "refresh_policy": "create_successor_version"
    });
    write_json(context_dir.join("paper-v1.json"), &manifest);
}

#[test]
fn overview_discovers_validated_project_context_and_lists_its_note() {
    let root = setup();
    add_valid_context(&root.0);

    let output = run(&root.0);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["artifact_counts"]["context"]["recognized"], 1);
    assert_eq!(report["artifact_counts"]["context"]["valid"], 1);
    assert_eq!(report["contexts"][0]["id"], "context-paper-v1");
    assert_eq!(
        report["contexts"][0]["context_note"],
        ".mozak/context/paper-v1.md"
    );

    let listed = run_command(&root.0, "list");
    let text = String::from_utf8(listed.stdout).unwrap();
    assert!(text.contains("[completed] context-paper-v1"));
    assert!(text.contains(".mozak/context/paper-v1.md"));
}

#[test]
fn overview_fails_closed_when_context_note_is_tampered() {
    let root = setup();
    add_valid_context(&root.0);
    fs::write(root.0.join(".mozak/context/paper-v1.md"), "tampered").unwrap();

    let output = run(&root.0);
    assert_eq!(output.status.code(), Some(3));
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["artifact_counts"]["context"]["invalid"], 1);
    assert!(
        report["findings"]
            .as_array()
            .unwrap()
            .iter()
            .any(|finding| {
                finding["path"] == ".mozak/context/paper-v1.json"
                    && finding["message"] == "context note hash mismatch"
            })
    );
}

#[test]
fn overview_discovers_two_canonical_input_sets_and_validates_each_bound_plan() {
    let root = setup();
    fs::remove_file(root.0.join(".mozak/planning/accepted-inputs.json")).unwrap();
    fs::create_dir_all(root.0.join(".mozak/planning/inputs")).unwrap();

    let primary_inputs = read_json(fixture("planning/accepted-inputs.json"));
    let mut secondary_inputs = primary_inputs.clone();
    secondary_inputs["id"] = "input-secondary".into();
    write_json(
        root.0.join(".mozak/planning/inputs/primary.json"),
        &primary_inputs,
    );
    write_json(
        root.0.join(".mozak/planning/inputs/secondary.json"),
        &secondary_inputs,
    );

    let mut secondary_plan = read_json(fixture("planning/valid-shared-dag.json"));
    secondary_plan["id"] = "plan-secondary".into();
    secondary_plan["version"] = 1.into();
    secondary_plan["input_set_id"] = "input-secondary".into();
    write_json(
        root.0.join(".mozak/planning/plans/plan-v2.json"),
        &secondary_plan,
    );

    let output = run(&root.0);
    assert!(
        output.status.success(),
        "stdout={} stderr={}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["state"], "valid");
    assert_eq!(report["latest_valid_plan"]["id"], "plan-secondary");
    assert_eq!(report["artifact_counts"]["planning"]["recognized"], 4);
    assert_eq!(report["artifact_counts"]["planning"]["valid"], 4);
}

#[test]
fn overview_fails_closed_when_a_plan_names_a_missing_input_set() {
    let root = setup();
    fs::remove_file(root.0.join(".mozak/planning/accepted-inputs.json")).unwrap();

    let output = run(&root.0);
    assert_eq!(output.status.code(), Some(3));
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["state"], "invalid");
    assert!(
        report["findings"]
            .as_array()
            .unwrap()
            .iter()
            .any(|finding| {
                finding["path"] == ".mozak/planning/plans/plan-v1.json"
                    && finding["message"]
                        .as_str()
                        .unwrap()
                        .contains("accepted planning input set is missing or invalid: inputs-001")
            })
    );
}

#[test]
fn overview_rejects_duplicate_canonical_input_set_ids_and_their_plans() {
    let root = setup();
    fs::remove_file(root.0.join(".mozak/planning/accepted-inputs.json")).unwrap();
    fs::create_dir_all(root.0.join(".mozak/planning/inputs")).unwrap();
    let inputs = read_json(fixture("planning/accepted-inputs.json"));
    write_json(root.0.join(".mozak/planning/inputs/a.json"), &inputs);
    write_json(root.0.join(".mozak/planning/inputs/b.json"), &inputs);

    let output = run(&root.0);
    assert_eq!(output.status.code(), Some(3));
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["artifact_counts"]["planning"]["invalid"], 3);
    assert_eq!(report["latest_valid_plan"], Value::Null);
    assert_eq!(
        report["findings"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|finding| finding["message"] == "duplicate planning input set id: inputs-001")
            .count(),
        2
    );
}

#[test]
fn overview_reports_a_malformed_canonical_input_set_as_invalid() {
    let root = setup();
    fs::remove_file(root.0.join(".mozak/planning/accepted-inputs.json")).unwrap();
    fs::create_dir_all(root.0.join(".mozak/planning/inputs")).unwrap();
    fs::write(
        root.0.join(".mozak/planning/inputs/broken.json"),
        "{not json",
    )
    .unwrap();

    let output = run(&root.0);
    assert_eq!(output.status.code(), Some(3));
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert!(
        report["findings"]
            .as_array()
            .unwrap()
            .iter()
            .any(|finding| {
                finding["path"] == ".mozak/planning/inputs/broken.json"
                    && finding["message"]
                        .as_str()
                        .unwrap()
                        .contains("invalid planning input set JSON")
            })
    );
}

#[test]
fn overview_preserves_legacy_accepted_inputs_project_compatibility() {
    let root = setup();
    assert!(!root.0.join(".mozak/planning/inputs").exists());

    let output = run(&root.0);
    assert!(output.status.success());
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["state"], "valid");
    assert_eq!(report["artifact_counts"]["planning"]["recognized"], 2);
    assert_eq!(report["artifact_counts"]["planning"]["valid"], 2);
}

#[test]
fn malformed_recognized_artifacts_are_explicit_and_non_success() {
    let root = setup();
    fs::create_dir_all(root.0.join(".mozak/research/bad")).unwrap();
    fs::write(root.0.join(".mozak/research/bad/run.json"), "{not json").unwrap();
    let output = run(&root.0);
    assert_eq!(output.status.code(), Some(3));
    let value: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(value["state"], "invalid");
    assert_eq!(value["artifact_counts"]["research"]["invalid"], 1);
    assert!(
        value["findings"]
            .as_array()
            .unwrap()
            .iter()
            .any(|finding| finding["path"] == ".mozak/research/bad/run.json"
                && finding["status"] == "invalid")
    );
}

#[test]
fn framework_pf0008_layout_selects_root_v5_and_validates_accepted_state_and_export() {
    let root = setup();
    fs::remove_dir_all(root.0.join(".mozak/planning/plans")).unwrap();

    let mut plan: Value = serde_json::from_str(
        &fs::read_to_string(fixture("planning/valid-shared-dag.json")).unwrap(),
    )
    .unwrap();
    plan["version"] = 5.into();
    plan["supersedes"] = serde_json::json!({"id": "plan-main", "version": 4});
    fs::write(
        root.0.join(".mozak/planning/goal-dag-v5.json"),
        serde_json::to_vec_pretty(&plan).unwrap(),
    )
    .unwrap();

    fs::create_dir_all(root.0.join(".mozak/releases")).unwrap();
    fs::create_dir_all(root.0.join(".mozak/exports")).unwrap();
    fs::copy(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../spec/project-framework/fixtures/pf-0007/accepted-state.json"),
        root.0
            .join(".mozak/releases/workflow-accepted-state-v1.json"),
    )
    .unwrap();
    fs::copy(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../spec/project-framework/fixtures/pf-0007/canonical-release.json"),
        root.0.join(".mozak/exports/canonical-knowledge.json"),
    )
    .unwrap();
    fs::write(
        root.0.join(".mozak/releases/provider-support.json"),
        r#"{"provider":"example","notes":"non-authoritative"}"#,
    )
    .unwrap();

    let overview = run(&root.0);
    assert!(
        overview.status.success(),
        "stdout={} stderr={}",
        String::from_utf8_lossy(&overview.stdout),
        String::from_utf8_lossy(&overview.stderr)
    );
    let value: Value = serde_json::from_slice(&overview.stdout).unwrap();
    assert_eq!(value["state"], "valid");
    assert_eq!(value["latest_valid_plan"]["version"], 5);
    assert_eq!(
        value["latest_valid_plan"]["path"],
        ".mozak/planning/goal-dag-v5.json"
    );
    assert!(
        value["goals"]
            .as_array()
            .unwrap()
            .iter()
            .any(|goal| { goal["id"] == "foundation" && goal["status"] == "completed" })
    );
    assert_eq!(value["artifact_counts"]["planning"]["recognized"], 2);
    assert_eq!(value["artifact_counts"]["release"]["recognized"], 2);
    assert_eq!(value["artifact_counts"]["release"]["valid"], 2);
    assert_eq!(value["artifact_counts"]["release"]["invalid"], 0);
    assert_eq!(value["artifact_counts"]["release"]["unknown"], 1);
    assert!(value["findings"].as_array().unwrap().iter().any(|finding| {
        finding["path"] == ".mozak/releases/provider-support.json" && finding["status"] == "unknown"
    }));

    let list = run_command(&root.0, "list");
    assert!(list.status.success());
    assert!(String::from_utf8_lossy(&list.stdout).contains("[completed] foundation"));
    let graph = run_command(&root.0, "graph-source");
    assert!(graph.status.success());
    assert!(String::from_utf8_lossy(&graph.stdout).contains("foundation"));
}

#[test]
fn forged_release_identity_version_and_hash_make_overview_invalid() {
    let canonical: Value = serde_json::from_str(
        &fs::read_to_string(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../spec/project-framework/fixtures/pf-0007/canonical-release.json"),
        )
        .unwrap(),
    )
    .unwrap();

    for (name, mutate) in [
        (
            "empty-release-id",
            ("release_id", Value::String(String::new())),
        ),
        (
            "zero-state-version",
            ("accepted_state_version", Value::from(0)),
        ),
        (
            "bad-state-hash",
            ("accepted_state_sha256", Value::String("ABC".into())),
        ),
    ] {
        let root = setup();
        fs::create_dir_all(root.0.join(".mozak/exports")).unwrap();
        let mut forged = canonical.clone();
        forged[mutate.0] = mutate.1;
        let path = root.0.join(format!(".mozak/exports/{name}-release.json"));
        fs::write(&path, serde_json::to_vec(&forged).unwrap()).unwrap();

        let output = run(&root.0);
        assert_eq!(output.status.code(), Some(3), "{name}");
        let report: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(report["state"], "invalid", "{name}");
        assert_eq!(report["artifact_counts"]["release"]["invalid"], 1, "{name}");
        assert!(
            report["findings"]
                .as_array()
                .unwrap()
                .iter()
                .any(|finding| {
                    finding["path"] == format!(".mozak/exports/{name}-release.json")
                        && finding["status"] == "invalid"
                })
        );
    }
}

#[test]
fn mermaid_uses_distinct_nodes_for_textually_colliding_goal_ids() {
    let root = setup();
    let plan_path = root.0.join(".mozak/planning/plans/plan-v1.json");
    let mut plan: Value = serde_json::from_str(&fs::read_to_string(&plan_path).unwrap()).unwrap();
    plan["goals"][0]["id"] = "a-b".into();
    plan["goals"][1]["id"] = "a_b".into();
    plan["dependencies"][0]["goal_id"] = "a_b".into();
    plan["dependencies"][0]["depends_on_goal_id"] = "a-b".into();
    for edge in plan["dependencies"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .skip(1)
    {
        if edge["depends_on_goal_id"] == "foundation" {
            edge["depends_on_goal_id"] = "a-b".into();
        }
        if edge["depends_on_goal_id"] == "consumer-a" {
            edge["depends_on_goal_id"] = "a_b".into();
        }
    }
    fs::write(&plan_path, serde_json::to_vec_pretty(&plan).unwrap()).unwrap();

    let output = run_command(&root.0, "graph-source");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let graph = String::from_utf8(output.stdout).unwrap();
    assert!(graph.contains("  g_0[\"a-b: Build shared foundation [completed]\"]"));
    assert!(graph.contains("  g_1[\"a_b: Build consumer A [ready]\"]"));
    assert!(graph.contains("  g_0 --> g_1\n"));
    assert_eq!(graph.matches("[\"a-b:").count(), 1);
    assert_eq!(graph.matches("[\"a_b:").count(), 1);
}
