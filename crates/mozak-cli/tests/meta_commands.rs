use std::{
    fs,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::{AtomicU64, Ordering},
};
static NEXT: AtomicU64 = AtomicU64::new(0);
struct Temp(PathBuf);
impl Temp {
    fn new() -> Self {
        let p = std::env::temp_dir().join(format!(
            "mozak-meta-cli-{}-{}",
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
fn fixture() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../mozak-core/tests/fixtures/meta-kb")
}
fn run(command: &str, root: &Path) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_mozak"))
        .args(["meta", command])
        .arg(root)
        .output()
        .unwrap()
}
#[test]
fn meta_outputs_are_stable_and_graph_uses_exact_source() {
    let root = fixture();
    let validate = run("validate", &root);
    assert!(validate.status.success());
    let value: serde_json::Value = serde_json::from_slice(&validate.stdout).unwrap();
    assert_eq!(value["command"], "meta validate");
    assert_eq!(value["projects"][0]["project_id"], "alpha");
    let list = run("list", &root);
    assert_eq!(
        String::from_utf8(list.stdout).unwrap(),
        "Projects:\n  alpha @ alpha-r1 (releases/alpha-r1.json)\n  beta @ beta-r1 (releases/beta-r1.json)\nRelationships:\n  alpha -[informs]-> beta\n"
    );
    let source = run("graph-source", &root);
    assert!(source.status.success());
    let expected=b"flowchart LR\n  p0[\"alpha\\nalpha-r1\"]\n  p1[\"beta\\nbeta-r1\"]\n  p0 -->|informs| p1\n";
    assert_eq!(source.stdout, expected);
    let tools = Temp::new();
    let fake = tools.0.join("termaid");
    let capture = tools.0.join("capture");
    fs::write(
        &fake,
        "#!/bin/sh\ncat > \"$MOZAK_CAPTURE\"\nprintf 'rendered\\n'\n",
    )
    .unwrap();
    fs::set_permissions(&fake, fs::Permissions::from_mode(0o755)).unwrap();
    let graph = Command::new(env!("CARGO_BIN_EXE_mozak"))
        .args(["meta", "graph"])
        .arg(&root)
        .env("MOZAK_TERMAID", &fake)
        .env("MOZAK_CAPTURE", &capture)
        .output()
        .unwrap();
    assert!(graph.status.success());
    assert_eq!(graph.stdout, b"rendered\n");
    assert_eq!(fs::read(capture).unwrap(), expected);
    let missing = Command::new(env!("CARGO_BIN_EXE_mozak"))
        .args(["meta", "graph"])
        .arg(&root)
        .env("MOZAK_TERMAID", tools.0.join("missing"))
        .output()
        .unwrap();
    assert!(!missing.status.success());
    assert!(missing.stdout.is_empty());
    assert!(String::from_utf8_lossy(&missing.stderr).contains("cannot run Termaid executable"));
}
#[test]
fn contract_errors_are_nonzero_and_have_no_stdout() {
    let t = Temp::new();
    copy_tree(&fixture(), &t.0);
    fs::write(t.0.join("releases/alpha-r1.json"), b"tampered").unwrap();
    let out = run("validate", &t.0);
    assert!(!out.status.success());
    assert!(out.stdout.is_empty());
    assert!(String::from_utf8_lossy(&out.stderr).contains("SHA-256 mismatch"));
    let t = Temp::new();
    copy_tree(&fixture(), &t.0);
    let path = t.0.join("meta-kb.json");
    let mut m: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    m["projects"][0]["release_path"] = serde_json::json!("../escape.json");
    fs::write(path, serde_json::to_vec(&m).unwrap()).unwrap();
    let out = run("list", &t.0);
    assert!(!out.status.success());
    assert!(out.stdout.is_empty());

    let cases = [
        ("validate", "relationship", serde_json::json!("unknown")),
        ("list", "relationship", serde_json::json!(" informs")),
        (
            "graph-source",
            "project_id",
            serde_json::json!("alpha\nforged"),
        ),
        (
            "validate",
            "release_id",
            serde_json::json!("alpha-r1\u{1b}[31m"),
        ),
    ];
    for (command, field, injected) in cases {
        let t = Temp::new();
        copy_tree(&fixture(), &t.0);
        let path = t.0.join("meta-kb.json");
        let mut manifest: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        if field == "relationship" {
            manifest["relationships"][0][field] = injected;
        } else {
            manifest["projects"][0][field] = injected;
        }
        fs::write(path, serde_json::to_vec(&manifest).unwrap()).unwrap();
        let out = run(command, &t.0);
        assert!(!out.status.success(), "{command} accepted {field}");
        assert!(out.stdout.is_empty(), "{command} wrote stdout for {field}");
        assert!(
            !out.stderr.is_empty(),
            "{command} omitted stderr for {field}"
        );
    }
}
fn copy_tree(from: &Path, to: &Path) {
    for entry in fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let dest = to.join(entry.file_name());
        if entry.path().is_dir() {
            fs::create_dir_all(&dest).unwrap();
            copy_tree(&entry.path(), &dest);
        } else {
            fs::copy(entry.path(), dest).unwrap();
        }
    }
}
