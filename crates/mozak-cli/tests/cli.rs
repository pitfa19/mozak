use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

const FIXTURE_PATH: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../spec/m0/fixtures/canonical-state.json"
);

#[test]
fn validate_and_replay_commands_work_end_to_end() {
    let binary = env!("CARGO_BIN_EXE_mozak");
    let validate = Command::new(binary)
        .args(["validate", FIXTURE_PATH])
        .output()
        .unwrap();
    assert!(
        validate.status.success(),
        "{}",
        String::from_utf8_lossy(&validate.stderr)
    );
    assert_eq!(
        String::from_utf8(validate.stdout).unwrap(),
        "validated 12 fixtures\n"
    );

    let replay = Command::new(binary)
        .args(["replay", FIXTURE_PATH])
        .output()
        .unwrap();
    assert!(
        replay.status.success(),
        "{}",
        String::from_utf8_lossy(&replay.stderr)
    );
    let output: serde_json::Value = serde_json::from_slice(&replay.stdout).unwrap();
    assert_eq!(output.as_array().unwrap().len(), 12);
    assert_eq!(
        output[0]["canonical_hash"],
        "d6c62e3365cc27225ad3c49744a4bc43f2db9f1d9ae1aa3eb6e34c580679b93a"
    );
}

#[test]
fn invalid_usage_and_invalid_json_fail() {
    let binary = env!("CARGO_BIN_EXE_mozak");
    assert!(!Command::new(binary).output().unwrap().status.success());
    assert!(
        !Command::new(binary)
            .args(["validate", "does-not-exist.json"])
            .output()
            .unwrap()
            .status
            .success()
    );
}

#[test]
fn planning_compact_cli_roundtrips_dynamic_scratch_fixture() {
    let binary = env!("CARGO_BIN_EXE_mozak");
    let root = scratch_project("compact-cli");
    copy_current_planning_fixture(&root);
    let plan_path = root.join("compact-plan.json");
    let output = Command::new(binary)
        .args([
            "planning",
            "compact",
            "plan",
            root.to_str().expect("root"),
            plan_path.to_str().expect("plan"),
            "2026-09-15T00:00:00Z",
        ])
        .output()
        .expect("plan command");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let planned: serde_json::Value = serde_json::from_slice(&output.stdout).expect("plan stdout");
    let entry_count = planned["entry_count"].as_u64().expect("entry count");
    assert!(
        entry_count >= 3,
        "dynamic scratch fixture should archive every planning file"
    );
    let plan_bytes = fs::read(&plan_path).expect("plan bytes");
    let plan_sha256 = format!("{:x}", Sha256::digest(&plan_bytes));
    let approval = serde_json::json!({
        "schema_version": 1,
        "decision": true,
        "owner": "pitfa",
        "approved_at": "2026-09-15T00:00:01Z",
        "plan_sha256": plan_sha256,
        "project_root": root.canonicalize().expect("canonical").to_string_lossy(),
        "rationale": "cli test approval"
    });
    let approval_path = root.join("approval.json");
    fs::write(
        &approval_path,
        serde_json::to_string_pretty(&approval).unwrap() + "\n",
    )
    .unwrap();
    let apply = Command::new(binary)
        .args([
            "planning",
            "compact",
            "apply",
            root.to_str().expect("root"),
            plan_path.to_str().expect("plan"),
            approval_path.to_str().expect("approval"),
        ])
        .output()
        .expect("apply command");
    assert!(
        apply.status.success(),
        "{}",
        String::from_utf8_lossy(&apply.stderr)
    );
    let restore = root.join("restore");
    let restore_output = Command::new(binary)
        .args([
            "planning",
            "compact",
            "restore",
            root.to_str().expect("root"),
            root.join(".mozak/planning/active-index.json")
                .to_str()
                .expect("index"),
            approval_path.to_str().expect("approval"),
            restore.to_str().expect("restore"),
        ])
        .output()
        .expect("restore command");
    assert!(
        restore_output.status.success(),
        "{}",
        String::from_utf8_lossy(&restore_output.stderr)
    );
    assert_eq!(
        fs::read(root.join(".mozak/planning/notes.txt")).unwrap(),
        fs::read(restore.join(".mozak/planning/notes.txt")).unwrap()
    );
}

fn scratch_project(name: &str) -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let root = std::env::temp_dir().join(format!("mozak-cli-{name}-{stamp}"));
    fs::create_dir_all(root.join(".mozak/planning/inputs")).unwrap();
    fs::create_dir_all(root.join(".mozak/planning/plans")).unwrap();
    root
}

fn write_planning_fixture(root: &Path) {
    fs::write(
        root.join(".mozak/planning/inputs/accepted.json"),
        br#"{"contract_version":2,"id":"inputs","accepted_at":"2026-09-15T00:00:00Z","inputs":[{"id":"i1","text":"keep exact","retention":"constraint","provenance":{"kind":"human_decision","decision_id":"d1","actor":"owner"}}]}"#,
    )
    .unwrap();
    fs::write(
        root.join(".mozak/planning/plans/plan.json"),
        br#"{"contract_version":1,"id":"plan","version":1,"input_set_id":"inputs","goals":[{"id":"g1","version":1,"title":"Do it","status":"ready","priority":1,"input_ids":["i1"],"recovery_attempts":0}],"dependencies":[],"recovery":{"max_attempts_per_goal":1,"allowed_failed_transition":"blocked"}}"#,
    )
    .unwrap();
    fs::write(
        root.join(".mozak/planning/notes.txt"),
        b"dynamic scratch note" as &[u8],
    )
    .unwrap();
}

fn copy_current_planning_fixture(root: &Path) {
    let repo = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("crates")
        .parent()
        .expect("repo");
    let current = repo.join(".mozak/planning");
    if current.is_dir() && copy_dir(&current, &root.join(".mozak/planning")).is_ok() {
        fs::write(
            root.join(".mozak/planning/notes.txt"),
            b"dynamic scratch note" as &[u8],
        )
        .unwrap();
    } else {
        write_planning_fixture(root);
    }
}

fn copy_dir(source: &Path, target: &Path) -> std::io::Result<()> {
    fs::create_dir_all(target)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            if entry.file_name().to_string_lossy().starts_with('.')
                || entry.file_name().to_string_lossy() == "archive"
            {
                continue;
            }
            copy_dir(&source_path, &target_path)?;
        } else {
            fs::copy(source_path, target_path)?;
        }
    }
    Ok(())
}
