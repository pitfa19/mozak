use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Output},
    sync::atomic::{AtomicU64, Ordering},
};

const REVISION: &str = "0123456789abcdef0123456789abcdef01234567";
static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);

struct TempDir(PathBuf);

impl TempDir {
    fn new(name: &str) -> Self {
        let sequence = NEXT_TEMP.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "mozak-project-commands-{}-{sequence}-{name}",
            std::process::id()
        ));
        fs::create_dir(&path).unwrap();
        Self(path)
    }

    fn path(&self) -> &Path {
        &self.0
    }

    fn make_git_like(&self) {
        fs::create_dir(self.0.join(".git")).unwrap();
        fs::write(self.0.join(".git/HEAD"), format!("{REVISION}\n")).unwrap();
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

fn run(args: &[&str], cwd: &Path) -> Output {
    Command::new(env!("CARGO_BIN_EXE_mozak"))
        .args(args)
        .current_dir(cwd)
        .output()
        .unwrap()
}

fn json(output: &Output) -> Value {
    serde_json::from_slice(&output.stdout).unwrap_or_else(|error| {
        panic!(
            "invalid JSON ({error}): stdout={} stderr={}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        )
    })
}

fn init(root: &TempDir) -> Value {
    let output = run(&["project", "init"], root.path());
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    json(&output)
}

#[test]
fn clean_init_creates_only_the_golden_layout() {
    let root = TempDir::new("golden");
    root.make_git_like();

    let result = init(&root);
    assert_eq!(result["state"], "valid");
    assert_eq!(
        result["created"],
        serde_json::json!([".mozak/project.yml", ".mozak/idea.md"])
    );
    let mut entries = fs::read_dir(root.path().join(".mozak"))
        .unwrap()
        .map(|entry| entry.unwrap().file_name().into_string().unwrap())
        .collect::<Vec<_>>();
    entries.sort();
    assert_eq!(entries, ["idea.md", "project.yml"]);

    let manifest = fs::read_to_string(root.path().join(".mozak/project.yml")).unwrap();
    assert!(manifest.contains(&format!("revision: {REVISION}")));
    assert!(manifest.contains("-golden\n"));
}

#[test]
fn repeated_init_preserves_edits_and_fills_a_partial_layout() {
    let root = TempDir::new("idempotent");
    root.make_git_like();
    init(&root);
    let edited = "# User edit\n\nThis must never be overwritten.\n";
    fs::write(root.path().join(".mozak/idea.md"), edited).unwrap();

    let repeated = run(&["project", "init"], root.path());
    assert_eq!(repeated.status.code(), Some(3));
    assert_eq!(json(&repeated)["created"], serde_json::json!([]));
    assert_eq!(
        fs::read_to_string(root.path().join(".mozak/idea.md")).unwrap(),
        edited
    );

    let partial = TempDir::new("partial");
    partial.make_git_like();
    fs::create_dir(partial.path().join(".mozak")).unwrap();
    fs::write(partial.path().join(".mozak/idea.md"), edited).unwrap();
    let output = run(&["project", "init"], partial.path());
    assert_eq!(output.status.code(), Some(3));
    assert_eq!(
        json(&output)["created"],
        serde_json::json!([".mozak/project.yml"])
    );
    assert_eq!(
        fs::read_to_string(partial.path().join(".mozak/idea.md")).unwrap(),
        edited
    );
}

#[test]
fn status_and_validate_report_valid_incomplete_and_invalid() {
    let valid = TempDir::new("valid");
    valid.make_git_like();
    init(&valid);
    for command in ["status", "validate"] {
        let output = run(&["project", command], valid.path());
        assert!(output.status.success());
        let report = json(&output);
        assert_eq!(report["schema_version"], 1);
        assert_eq!(report["state"], "valid");
        assert_eq!(report["checks"].as_array().unwrap().len(), 2);
    }

    let incomplete = TempDir::new("incomplete");
    let status = run(&["project", "status"], incomplete.path());
    assert!(status.status.success());
    assert_eq!(json(&status)["state"], "incomplete");
    let validate = run(&["project", "validate"], incomplete.path());
    assert_eq!(validate.status.code(), Some(2));
    assert_eq!(json(&validate)["state"], "incomplete");

    let invalid = TempDir::new("invalid");
    fs::create_dir(invalid.path().join(".mozak")).unwrap();
    fs::write(invalid.path().join(".mozak/project.yml"), "version: 99\n").unwrap();
    fs::write(invalid.path().join(".mozak/idea.md"), "not a contract\n").unwrap();
    for command in ["status", "validate"] {
        let output = run(&["project", command], invalid.path());
        assert_eq!(output.status.code(), Some(3));
        let report = json(&output);
        assert_eq!(report["state"], "invalid");
        assert!(
            report["checks"]
                .as_array()
                .unwrap()
                .iter()
                .all(|check| check["status"] == "invalid")
        );
    }
}

#[test]
fn explicit_and_current_directory_paths_are_supported() {
    let parent = TempDir::new("paths");
    let nested = parent.path().join("Nested Project");
    fs::create_dir(&nested).unwrap();
    fs::create_dir(nested.join(".git")).unwrap();
    fs::write(nested.join(".git/HEAD"), "ref: refs/heads/main\n").unwrap();
    fs::create_dir_all(nested.join(".git/refs/heads")).unwrap();
    fs::write(nested.join(".git/refs/heads/main"), format!("{REVISION}\n")).unwrap();

    let output = run(
        &["project", "init", nested.to_str().unwrap()],
        parent.path(),
    );
    assert!(output.status.success());
    let report = json(&output);
    assert_eq!(
        report["project_root"],
        nested.canonicalize().unwrap().to_string_lossy().as_ref()
    );
    let manifest = fs::read_to_string(nested.join(".mozak/project.yml")).unwrap();
    assert!(manifest.contains("id: nested-project"));

    let missing = run(&["project", "status", "missing"], parent.path());
    assert!(!missing.status.success());
    assert!(String::from_utf8_lossy(&missing.stderr).contains("project path is not a directory"));
}

#[test]
fn legacy_validate_replay_and_usage_behavior_remain_available() {
    const FIXTURE_PATH: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../spec/m0/fixtures/canonical-state.json"
    );
    let cwd = Path::new(env!("CARGO_MANIFEST_DIR"));
    let validate = run(&["validate", FIXTURE_PATH], cwd);
    assert!(validate.status.success());
    assert_eq!(
        String::from_utf8(validate.stdout).unwrap(),
        "validated 12 fixtures\n"
    );

    let replay = run(&["replay", FIXTURE_PATH], cwd);
    assert!(replay.status.success());
    assert_eq!(json(&replay).as_array().unwrap().len(), 12);

    assert!(!run(&[], cwd).status.success());
    assert!(!run(&["project", "unknown"], cwd).status.success());
}
