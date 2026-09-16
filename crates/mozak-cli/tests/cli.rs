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
    let notes_before = fs::read(root.join(".mozak/planning/notes.txt")).unwrap();
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
        notes_before,
        fs::read(restore.join(".mozak/planning/notes.txt")).unwrap()
    );
}

#[test]
fn planning_compact_apply_prunes_duplicates_and_fails_closed_on_corruption() {
    let binary = env!("CARGO_BIN_EXE_mozak");
    let root = scratch_project("compact-duplicates");
    write_project_foundation(&root);
    write_superseded_planning_fixture(&root);
    let before_files = loose_planning_file_count(&root);
    let before_bytes = planning_bytes(&root);
    let plan_path = compact_plan(binary, &root);
    let approval_path = write_approval(&root, &plan_path);
    compact_apply(binary, &root, &plan_path, &approval_path);
    assert_compacted_overview(binary, &root, before_files);
    assert_archived_predecessor_detects_successor(binary, &root);
    let restore = compact_restore(binary, &root, &approval_path);
    assert_eq!(before_bytes, planning_bytes(&restore));
    corrupt_first_archive_blob(&root);
    assert!(!project_overview(binary, &root).status.success());
    assert!(!root.join(".mozak/planning/.compact-staging").exists());
}

fn compact_plan(binary: &str, root: &Path) -> PathBuf {
    let plan_path = root.join("compact-plan.json");
    assert!(
        Command::new(binary)
            .args([
                "planning",
                "compact",
                "plan",
                root.to_str().unwrap(),
                plan_path.to_str().unwrap(),
                "2026-09-15T00:00:00Z"
            ])
            .output()
            .unwrap()
            .status
            .success()
    );
    plan_path
}

fn compact_apply(binary: &str, root: &Path, plan_path: &Path, approval_path: &Path) {
    let apply = Command::new(binary)
        .args([
            "planning",
            "compact",
            "apply",
            root.to_str().unwrap(),
            plan_path.to_str().unwrap(),
            approval_path.to_str().unwrap(),
        ])
        .output()
        .unwrap();
    assert!(
        apply.status.success(),
        "{}",
        String::from_utf8_lossy(&apply.stderr)
    );
}

fn assert_compacted_overview(binary: &str, root: &Path, before_files: usize) {
    assert!(
        loose_planning_file_count(root) < before_files,
        "loose planning files should shrink"
    );
    assert!(root.join(".mozak/planning/plans/plan-v2.json").exists());
    assert!(!root.join(".mozak/planning/plans/plan-v1.json").exists());
    let overview = project_overview(binary, root);
    assert!(
        overview.status.success(),
        "stderr:\n{}\nstdout:\n{}",
        String::from_utf8_lossy(&overview.stderr),
        String::from_utf8_lossy(&overview.stdout)
    );
    let overview_json: serde_json::Value = serde_json::from_slice(&overview.stdout).unwrap();
    assert_eq!(overview_json["state"], "valid");
    assert_eq!(overview_json["artifact_counts"]["planning"]["invalid"], 0);
    assert_eq!(overview_json["compaction"]["apply_requires_approval"], true);
    assert!(
        overview_json["compaction"]["plan_command"]
            .as_str()
            .unwrap()
            .contains("planning compact plan")
    );
}

fn assert_archived_predecessor_detects_successor(binary: &str, root: &Path) {
    let next = Command::new(binary)
        .args([
            "planning",
            "next",
            root.join(".mozak/planning/inputs/inputs-v1.json")
                .to_str()
                .unwrap(),
            root.join(".mozak/planning/plans/plan-v1.json")
                .to_str()
                .unwrap(),
        ])
        .output()
        .unwrap();
    assert!(!next.status.success());
    assert!(
        String::from_utf8_lossy(&next.stderr).contains("superseded"),
        "stderr:\n{}\nstdout:\n{}",
        String::from_utf8_lossy(&next.stderr),
        String::from_utf8_lossy(&next.stdout)
    );
}

fn compact_restore(binary: &str, root: &Path, approval_path: &Path) -> PathBuf {
    let restore = root.join("restore");
    assert!(
        Command::new(binary)
            .args([
                "planning",
                "compact",
                "restore",
                root.to_str().unwrap(),
                root.join(".mozak/planning/active-index.json")
                    .to_str()
                    .unwrap(),
                approval_path.to_str().unwrap(),
                restore.to_str().unwrap()
            ])
            .output()
            .unwrap()
            .status
            .success()
    );
    restore
}

fn corrupt_first_archive_blob(root: &Path) {
    let index: serde_json::Value =
        serde_json::from_slice(&fs::read(root.join(".mozak/planning/active-index.json")).unwrap())
            .unwrap();
    let sha256 = index["entries"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["kind"] == "plan")
        .and_then(|entry| entry["sha256"].as_str())
        .unwrap();
    let blob = root
        .join(".mozak/planning/archive/sha256")
        .join(&sha256[..2])
        .join(format!("{sha256}.json"));
    fs::write(blob, b"corrupt").unwrap();
}

fn project_overview(binary: &str, root: &Path) -> std::process::Output {
    Command::new(binary)
        .args(["project", "overview", root.to_str().unwrap()])
        .output()
        .unwrap()
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

fn write_project_foundation(root: &Path) {
    fs::write(
        root.join(".mozak/idea.md"),
        "# Test\n\n## Intent\nTest compaction.\n\n## Desired outcomes\nValid overview.\n\n## Boundaries\nNo canonical mutation.\n\n## Assumptions\nLocal fixtures are enough.\n\n## Open questions\nNone.\n",
    )
    .unwrap();
    fs::write(
        root.join(".mozak/project.yml"),
        "version: 1\nframework_contract_version: 1\nproject:\n  id: compact-test\n  name: Compact Test\nrepository:\n  revision: 4368c6a0553b7f81016d3f7850c4442f0febb508\nowned_paths:\n  - crates\n",
    )
    .unwrap();
}

fn write_superseded_planning_fixture(root: &Path) {
    fs::write(root.join(".mozak/planning/notes.txt"), b"cold support").unwrap();
    fs::write(root.join(".mozak/planning/inputs/inputs-v1.json"), br#"{"contract_version":2,"id":"inputs-v1","accepted_at":"2026-09-15T00:00:00Z","inputs":[{"id":"i1","text":"old","retention":"constraint","provenance":{"kind":"human_decision","decision_id":"d1","actor":"owner"}}]}"#).unwrap();
    fs::write(root.join(".mozak/planning/inputs/inputs-v2.json"), br#"{"contract_version":2,"id":"inputs-v2","accepted_at":"2026-09-15T00:00:01Z","inputs":[{"id":"i1","text":"old","retention":"constraint","provenance":{"kind":"human_decision","decision_id":"d1","actor":"owner"}},{"id":"i2","text":"new","retention":"constraint","provenance":{"kind":"human_decision","decision_id":"d2","actor":"owner"}}]}"#).unwrap();
    fs::write(root.join(".mozak/planning/plans/plan-v1.json"), br#"{"contract_version":1,"id":"plan","version":1,"input_set_id":"inputs-v1","goals":[{"id":"g1","version":1,"title":"Do old","status":"ready","priority":1,"input_ids":["i1"],"recovery_attempts":0}],"dependencies":[],"recovery":{"max_attempts_per_goal":1,"allowed_failed_transition":"blocked"}}"#).unwrap();
    fs::write(root.join(".mozak/planning/plans/plan-v2.json"), br#"{"contract_version":1,"id":"plan","version":2,"input_set_id":"inputs-v2","supersedes":{"id":"plan","version":1},"goals":[{"id":"g1","version":2,"title":"Do new","status":"ready","priority":1,"input_ids":["i1","i2"],"supersedes_version":1,"recovery_attempts":0}],"dependencies":[],"recovery":{"max_attempts_per_goal":1,"allowed_failed_transition":"blocked"}}"#).unwrap();
}

fn write_approval(root: &Path, plan_path: &Path) -> PathBuf {
    let plan_sha256 = format!("{:x}", Sha256::digest(fs::read(plan_path).unwrap()));
    let approval_path = root.join("approval.json");
    fs::write(
        &approval_path,
        serde_json::to_string_pretty(&serde_json::json!({
            "schema_version": 1,
            "decision": true,
            "owner": "pitfa",
            "approved_at": "2026-09-15T00:00:01Z",
            "plan_sha256": plan_sha256,
            "project_root": root.canonicalize().unwrap().to_string_lossy(),
            "rationale": "cli test approval"
        }))
        .unwrap()
            + "\n",
    )
    .unwrap();
    approval_path
}

fn loose_planning_file_count(root: &Path) -> usize {
    files_under(&root.join(".mozak/planning"))
        .into_iter()
        .filter(|path| !path.to_string_lossy().contains("/archive/"))
        .count()
}

fn planning_bytes(root: &Path) -> Vec<(String, Vec<u8>)> {
    let mut bytes = files_under(&root.join(".mozak/planning"))
        .into_iter()
        .filter(|path| !path.to_string_lossy().contains("/archive/"))
        .map(|path| {
            let rel = path
                .strip_prefix(root)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            (rel, fs::read(path).unwrap())
        })
        .collect::<Vec<_>>();
    bytes.sort_by(|a, b| a.0.cmp(&b.0));
    bytes
}

fn files_under(dir: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                files.extend(files_under(&path));
            } else if path.is_file() {
                files.push(path);
            }
        }
    }
    files
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
