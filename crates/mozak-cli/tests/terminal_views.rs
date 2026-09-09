use std::{
    fs,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    process::{Command, Output},
    sync::atomic::{AtomicU64, Ordering},
};

static NEXT: AtomicU64 = AtomicU64::new(0);
struct Temp(PathBuf);
impl Temp {
    fn new(name: &str) -> Self {
        let p = std::env::temp_dir().join(format!(
            "mozak-terminal-{}-{}-{name}",
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
fn setup(complete: bool) -> Temp {
    let r = Temp::new("project");
    fs::create_dir_all(r.0.join(".mozak/planning/plans")).unwrap();
    fs::write(r.0.join(".mozak/project.yml"),"version: 1\nframework_contract_version: 1\nproject:\n  id: terminal\n  name: Terminal\nrepository:\n  revision: 0123456789abcdef0123456789abcdef01234567\nowned_paths:\n  - .mozak\n").unwrap();
    fs::write(r.0.join(".mozak/idea.md"),"# Terminal\n\n## Intent\n\nShow state.\n\n## Desired outcomes\n\nStable views.\n\n## Boundaries\n\nLocal only.\n\n## Assumptions\n\nFiles are authoritative.\n\n## Open questions\n\nWhat next?\n").unwrap();
    if complete {
        fs::copy(
            fixture("planning/accepted-inputs.json"),
            r.0.join(".mozak/planning/accepted-inputs.json"),
        )
        .unwrap();
        fs::copy(
            fixture("planning/valid-shared-dag.json"),
            r.0.join(".mozak/planning/plans/plan.json"),
        )
        .unwrap();
    }
    r
}
fn run(args: &[&str], root: &Path) -> Output {
    Command::new(env!("CARGO_BIN_EXE_mozak"))
        .args(args)
        .arg(root)
        .output()
        .unwrap()
}

#[test]
fn list_output_is_stable_for_complete_and_incomplete_projects() {
    let complete = setup(true);
    let text = String::from_utf8(run(&["project", "list"], &complete.0).stdout).unwrap();
    assert!(text.contains("State: valid\nArtifacts:\n  concept: 0 recognized"));
    assert!(text.contains("\n  context: 0 recognized"));
    assert!(text.contains("Contexts:\n  (none)\nConcepts:\n  (none)\nGoals:\n"));
    assert!(text.contains("[ready] consumer-b (priority 10) Build consumer B"));
    let incomplete = setup(false);
    let output = run(&["project", "list"], &incomplete.0);
    assert_eq!(output.status.code(), Some(2));
    assert!(
        String::from_utf8(output.stdout)
            .unwrap()
            .contains("State: incomplete\n")
    );
}

#[test]
fn graph_source_is_exact_termaid_stdin_and_missing_or_failed_tools_are_errors() {
    let root = setup(true);
    let source = run(&["project", "graph-source"], &root.0);
    assert!(source.status.success());
    let expected = source.stdout;
    let tools = Temp::new("tools");
    let capture = tools.0.join("captured");
    let fake = tools.0.join("termaid");
    fs::write(
        &fake,
        "#!/bin/sh\ncat > \"$MOZAK_CAPTURE\"\nprintf 'rendered\\n'\n",
    )
    .unwrap();
    fs::set_permissions(&fake, fs::Permissions::from_mode(0o755)).unwrap();
    let rendered = Command::new(env!("CARGO_BIN_EXE_mozak"))
        .args(["project", "graph"])
        .arg(&root.0)
        .env("MOZAK_TERMAID", &fake)
        .env("MOZAK_CAPTURE", &capture)
        .output()
        .unwrap();
    assert!(rendered.status.success());
    assert_eq!(rendered.stdout, b"rendered\n");
    assert_eq!(fs::read(capture).unwrap(), expected);
    let missing = Command::new(env!("CARGO_BIN_EXE_mozak"))
        .args(["project", "graph"])
        .arg(&root.0)
        .env("MOZAK_TERMAID", tools.0.join("absent"))
        .output()
        .unwrap();
    assert!(!missing.status.success());
    assert!(String::from_utf8_lossy(&missing.stderr).contains("cannot run Termaid executable"));
    fs::write(&fake, "#!/bin/sh\necho broken >&2\nexit 7\n").unwrap();
    let failed = Command::new(env!("CARGO_BIN_EXE_mozak"))
        .args(["project", "graph"])
        .arg(&root.0)
        .env("MOZAK_TERMAID", &fake)
        .output()
        .unwrap();
    assert!(!failed.status.success());
    // Print what was actually produced. A bare assert here previously failed
    // on CI without recording MOZAK's stderr, which left the cause unknown.
    let failure = String::from_utf8_lossy(&failed.stderr);
    assert!(
        failure.contains("Termaid failed"),
        "expected the child's own failure, got: {failure:?}"
    );
}
