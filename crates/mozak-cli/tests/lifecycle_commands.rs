use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Output},
    sync::atomic::{AtomicU64, Ordering},
};

static NEXT: AtomicU64 = AtomicU64::new(0);
struct Temp(PathBuf);
impl Temp {
    fn new() -> Self {
        let p = std::env::temp_dir().join(format!(
            "mozak-lifecycle-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&p).unwrap();
        Self(p)
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
fn run(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_mozak"))
        .args(args)
        .output()
        .unwrap()
}
fn json(output: &Output) -> Value {
    serde_json::from_slice(&output.stdout).unwrap()
}

#[test]
fn research_validation_matches_production_contract() {
    let valid = fixture("research/valid-run.json");
    let output = run(&["research", "validate", valid.to_str().unwrap()]);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(json(&output)["state"], "valid");
    let bad = fixture("research/adversarial-silent-pass.json");
    let rejected = run(&["research", "validate", bad.to_str().unwrap()]);
    assert!(!rejected.status.success());
    assert!(rejected.stdout.is_empty());
    assert!(String::from_utf8_lossy(&rejected.stderr).starts_with("error: "));
}

#[test]
fn dair_ai_normalization_is_create_only_and_proposal_only() {
    let temp = Temp::new();
    let input = fixture("research/provider-dair-ai.json");
    let output_path = temp.0.join("dair-run.json");
    let output = run(&[
        "research",
        "normalize",
        "dair-ai",
        input.to_str().unwrap(),
        output_path.to_str().unwrap(),
    ]);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let value = json(&output);
    assert_eq!(value["adapter"], "dair-ai");
    assert_eq!(value["authority"], "proposal_only");
    assert_eq!(value["record_count"], 20);
    assert!(output_path.is_file());

    let repeated = run(&[
        "research",
        "normalize",
        "dair-ai",
        input.to_str().unwrap(),
        output_path.to_str().unwrap(),
    ]);
    assert!(!repeated.status.success());
    assert!(repeated.stdout.is_empty());
    assert!(String::from_utf8_lossy(&repeated.stderr).contains("refusing to overwrite"));
}

#[test]
fn planning_next_validates_both_contracts_and_orders_ready_goals() {
    let inputs = fixture("planning/accepted-inputs.json");
    let plan = fixture("planning/valid-shared-dag.json");
    let output = run(&[
        "planning",
        "next",
        inputs.to_str().unwrap(),
        plan.to_str().unwrap(),
    ]);
    assert!(output.status.success());
    let value = json(&output);
    assert_eq!(
        value["ready_goals"]
            .as_array()
            .unwrap()
            .iter()
            .map(|g| g["id"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["consumer-b", "consumer-a"]
    );
    let bad = fixture("planning/adversarial-graphs.json");
    let rejected = run(&[
        "planning",
        "next",
        inputs.to_str().unwrap(),
        bad.to_str().unwrap(),
    ]);
    assert!(!rejected.status.success());
    assert!(rejected.stdout.is_empty());
}

#[test]
fn execution_validation_covers_valid_stale_and_independently_invalid_bundles() {
    let bundle = fixture("execution/fresh-agent-bundle.json");
    let revision = "0123456789abcdef0123456789abcdef01234567";
    let valid = run(&[
        "execution",
        "validate",
        bundle.to_str().unwrap(),
        revision,
        "2026-09-01T10:00:00Z",
    ]);
    assert!(
        valid.status.success(),
        "{}",
        String::from_utf8_lossy(&valid.stderr)
    );
    assert_eq!(json(&valid)["packet_id"], "fresh-task");
    let stale = run(&[
        "execution",
        "validate",
        bundle.to_str().unwrap(),
        revision,
        "2026-09-03T10:00:00Z",
    ]);
    assert!(!stale.status.success());
    assert!(stale.stdout.is_empty());
    let temp = Temp::new();
    let mut value: Value = serde_json::from_str(&fs::read_to_string(&bundle).unwrap()).unwrap();
    value["evaluation"]["evaluator"]["id"] = value["result"]["executor"]["id"].clone();
    let invalid = temp.0.join("invalid.json");
    fs::write(&invalid, serde_json::to_vec(&value).unwrap()).unwrap();
    let rejected = run(&[
        "execution",
        "validate",
        invalid.to_str().unwrap(),
        revision,
        "2026-09-01T10:00:00Z",
    ]);
    assert!(!rejected.status.success());
    assert!(rejected.stdout.is_empty());
    assert!(String::from_utf8_lossy(&rejected.stderr).contains("evaluator identity conflicts"));
}

/// Recorded lineage is unsafe if a public route does not enforce it: an agent
/// that selects a plan file directly must not be served a superseded plan.
#[test]
fn planning_next_refuses_a_superseded_plan_and_names_its_successor() {
    let temp = Temp::new();
    let history: Value = serde_json::from_str(
        &fs::read_to_string(fixture("planning/supersession-recovery.json")).unwrap(),
    )
    .unwrap();
    let versions = history["versions"].as_array().unwrap();
    let stale = &versions[0];
    let current = versions.last().unwrap();
    assert_eq!(stale["version"], 1, "fixture provides an initial plan");
    assert!(
        current["supersedes"].is_object(),
        "fixture provides a superseding plan"
    );

    let inputs = temp.0.join("inputs.json");
    fs::copy(fixture("planning/accepted-inputs.json"), &inputs).unwrap();
    // Every recorded version lives beside the others, exactly as an agent
    // globbing the plans directory would find them.
    let mut stale_path = temp.0.join("plan-v1.json");
    let mut current_path = temp.0.join("plan-v1.json");
    for plan in versions {
        let path = temp.0.join(format!("plan-v{}.json", plan["version"]));
        fs::write(&path, serde_json::to_vec(plan).unwrap()).unwrap();
        if plan["version"] == stale["version"] {
            stale_path = path.clone();
        }
        if plan["version"] == current["version"] {
            current_path = path;
        }
    }

    let refused = run(&[
        "planning",
        "next",
        inputs.to_str().unwrap(),
        stale_path.to_str().unwrap(),
    ]);
    assert!(!refused.status.success(), "a stale plan must not be served");
    assert!(
        refused.stdout.is_empty(),
        "no ready goals may be reported from a superseded plan"
    );
    let message = String::from_utf8_lossy(&refused.stderr);
    assert!(message.contains("is superseded by version"), "{message}");

    let served = run(&[
        "planning",
        "next",
        inputs.to_str().unwrap(),
        current_path.to_str().unwrap(),
    ]);
    assert!(
        served.status.success(),
        "{}",
        String::from_utf8_lossy(&served.stderr)
    );
    assert_eq!(json(&served)["superseded"], false);
}
