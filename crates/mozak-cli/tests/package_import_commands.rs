#![allow(clippy::many_single_char_names)]

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
    fn new() -> Self {
        let p = std::env::temp_dir().join(format!(
            "mozak-cli-import-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&p).unwrap();
        Self(p)
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn sha(b: &[u8]) -> String {
    format!("{:x}", Sha256::digest(b))
}
fn package() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../spec/project-framework/fixtures/pf-0015/canonical")
}
fn setup(t: &Temp) -> (PathBuf, PathBuf, PathBuf) {
    let scope = t.0.join("scope");
    fs::create_dir(&scope).unwrap();
    let sb=serde_json::to_vec_pretty(&serde_json::json!({"schema_version":2,"scopes":[{"id":"root","kind":"topic","title":"Root","intent":"Test","history":[{"id":"h","at":"2026-09-03T00:00:00Z","note":"Created"}]}],"promotions":[],"meta_goals":[],"inputs":[]})).unwrap();
    fs::write(scope.join("scope.json"), &sb).unwrap();
    let registry = t.0.join("registry");
    fs::create_dir(&registry).unwrap();
    let rb=serde_json::to_vec_pretty(&serde_json::json!({"schema_version":1,"registrations":[{"id":"root","path":scope.canonicalize().unwrap(),"scope_manifest_sha256":sha(&sb)}]})).unwrap();
    fs::write(registry.join("kb.json"), &rb).unwrap();
    let m: serde_json::Value =
        serde_json::from_slice(&fs::read(package().join("mozak-package.json")).unwrap()).unwrap();
    let approval = t.0.join("approval.json");
    fs::write(&approval,serde_json::to_vec_pretty(&serde_json::json!({"schema_version":1,"decision":true,"owner":"test-owner","approved_at":"2026-09-03T05:00:00Z","rationale":"Exact CLI import test","output_root":t.0.join("output"),"package_id":m["package_id"],"project_id":m["project_id"],"release_id":m["release_id"],"target_registry_sha256":sha(&rb)})).unwrap()).unwrap();
    (registry, approval, t.0.join("output"))
}
fn run(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_mozak"))
        .args(args)
        .output()
        .unwrap()
}
#[test]
fn public_import_emits_exact_receipt_and_views_include_package() {
    let t = Temp::new();
    let (r, a, o) = setup(&t);
    let out = run(&[
        "kb",
        "import-package",
        package().to_str().unwrap(),
        r.to_str().unwrap(),
        a.to_str().unwrap(),
        o.to_str().unwrap(),
    ]);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(v["command"], "kb import-package");
    assert_eq!(v["authority"], "owner_approved_local_copy");
    assert_eq!(v["network_used"], false);
    for command in ["list", "tree", "graph-source"] {
        let view = run(&["kb", command, o.to_str().unwrap()]);
        assert!(view.status.success());
        let expected = match command {
            "list" => "Owned packages:",
            "tree" => "Package:",
            _ => "owns package bytes",
        };
        assert!(String::from_utf8(view.stdout).unwrap().contains(expected));
    }
}
#[test]
fn stale_approval_exits_nonzero_without_output() {
    let t = Temp::new();
    let (r, a, o) = setup(&t);
    let mut v: serde_json::Value = serde_json::from_slice(&fs::read(&a).unwrap()).unwrap();
    v["target_registry_sha256"] = "0".repeat(64).into();
    fs::write(&a, serde_json::to_vec(&v).unwrap()).unwrap();
    let out = run(&[
        "kb",
        "import-package",
        package().to_str().unwrap(),
        r.to_str().unwrap(),
        a.to_str().unwrap(),
        o.to_str().unwrap(),
    ]);
    assert!(!out.status.success());
    assert!(out.stdout.is_empty());
    assert!(!o.exists());
}

#[test]
fn malformed_approval_timestamp_exits_nonzero_without_output() {
    let t = Temp::new();
    let (r, a, o) = setup(&t);
    let mut v: serde_json::Value = serde_json::from_slice(&fs::read(&a).unwrap()).unwrap();
    v["approved_at"] = "garbageTZ".into();
    fs::write(&a, serde_json::to_vec(&v).unwrap()).unwrap();
    let out = run(&[
        "kb",
        "import-package",
        package().to_str().unwrap(),
        r.to_str().unwrap(),
        a.to_str().unwrap(),
        o.to_str().unwrap(),
    ]);
    assert!(!out.status.success());
    assert!(out.stdout.is_empty());
    assert!(!o.exists());
}
