//! `mozak feature` end to end: create-only versions, pinning, finality,
//! refusals, and tamper detection.

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
    fn new(label: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "mozak-feature-{label}-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(path.join(".mozak/evidence/voice/issues")).unwrap();
        fs::write(
            path.join(".mozak/project.yml"),
            "version: 1\nframework_contract_version: 1\nproject:\n  id: feature-test\n  name: Feature Test\nrepository:\n  revision: 0123456789abcdef0123456789abcdef01234567\nowned_paths:\n  - src\n",
        )
        .unwrap();
        fs::write(
            path.join(".mozak/idea.md"),
            "# Idea\n\n## Intent\n\nShip it.\n\n## Desired outcomes\n\n- Works.\n\n## Boundaries\n\n- Local.\n\n## Assumptions\n\n- Rust.\n\n## Open questions\n\n- None.\n",
        )
        .unwrap();
        Self(path)
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn mozak(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_mozak"))
        .args(args)
        .output()
        .unwrap()
}

fn ok(args: &[&str]) -> Value {
    let out = mozak(args);
    assert!(
        out.status.success(),
        "{args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    serde_json::from_slice(&out.stdout).unwrap()
}

fn refused(args: &[&str], needle: &str) {
    let out = mozak(args);
    assert!(!out.status.success(), "{args:?} must be refused");
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(stderr.contains(needle), "{args:?}: {stderr}");
}

fn write(root: &Path, rel: &str, body: &str) {
    fs::write(root.join(rel), body).unwrap();
}

#[test]
fn feature_lifecycle_is_create_only_pinned_and_final() {
    let temp = Temp::new("life");
    let root = temp.0.to_str().unwrap();
    let spec = "https://github.com/o/r/issues/1";
    let t2 = "https://github.com/o/r/issues/2";
    assert_eq!(
        ok(&["feature", "new", root, "voice", "Voice onboarding", spec])["version"],
        1
    );
    refused(
        &["feature", "new", root, "voice", "Again"],
        "already exists",
    );
    write(&temp.0, ".mozak/evidence/voice/issues/1.md", "spec v1\n");
    ok(&[
        "feature",
        "ticket",
        root,
        "voice",
        spec,
        ".mozak/evidence/voice/issues/1.md",
    ]);
    refused(
        &[
            "feature",
            "ticket",
            root,
            "voice",
            spec,
            ".mozak/evidence/voice/issues/1.md",
        ],
        "already has a pinned snapshot",
    );
    ok(&["feature", "ticket", root, "voice", t2]);
    refused(&["feature", "close", root, "voice", "done"], "evidence");
    write(&temp.0, ".mozak/evidence/voice/issues/2.md", "ticket 2\n");
    ok(&[
        "feature",
        "ticket",
        root,
        "voice",
        t2,
        ".mozak/evidence/voice/issues/2.md",
    ]);
    write(&temp.0, ".mozak/evidence/voice/acceptance.md", "accepted\n");
    ok(&[
        "feature",
        "evidence",
        root,
        "voice",
        ".mozak/evidence/voice/acceptance.md",
    ]);
    let closed = ok(&["feature", "close", root, "voice", "done"]);
    assert_eq!(closed["version"], 6);
    assert_eq!(closed["status"], "done");
    refused(
        &[
            "feature",
            "ticket",
            root,
            "voice",
            "https://github.com/o/r/issues/3",
        ],
        "final",
    );

    let versions: Vec<_> = fs::read_dir(temp.0.join(".mozak/features"))
        .unwrap()
        .collect();
    assert_eq!(
        versions.len(),
        6,
        "every change is its own create-only file"
    );

    let listed = ok(&["feature", "validate", root]);
    assert_eq!(listed["valid"], true);
    assert_eq!(listed["network"], false);
    assert_eq!(listed["features"][0]["tickets_pinned"], 1);

    let overview = ok(&["project", "overview", root]);
    assert_eq!(overview["features"][0]["status"], "done");
}

#[test]
fn feature_refuses_unsafe_paths_urls_and_detects_tampering() {
    let temp = Temp::new("refuse");
    let root = temp.0.to_str().unwrap();
    refused(&["feature", "new", root, "Bad_Id", "x"], "feature id");
    refused(
        &["feature", "new", root, "x", "x", "http://insecure/1"],
        "https://",
    );
    ok(&["feature", "new", root, "voice", "Voice"]);
    write(&temp.0, ".mozak/evidence/voice/a.md", "a\n");
    refused(
        &["feature", "evidence", root, "voice", "../outside.md"],
        "without ..",
    );
    refused(
        &[
            "feature",
            "evidence",
            root,
            "voice",
            ".mozak/evidence/other/a.md",
        ],
        "must live under",
    );
    ok(&[
        "feature",
        "evidence",
        root,
        "voice",
        ".mozak/evidence/voice/a.md",
    ]);
    refused(
        &[
            "feature",
            "evidence",
            root,
            "voice",
            ".mozak/evidence/voice/a.md",
        ],
        "already pinned",
    );
    let overview = ok(&["project", "overview", root]);
    assert!(
        overview["next_actions"][0]
            .as_str()
            .unwrap()
            .contains("/to-tickets")
    );

    write(&temp.0, ".mozak/evidence/voice/a.md", "edited\n");
    let out = mozak(&["feature", "validate", root]);
    assert_eq!(
        out.status.code(),
        Some(3),
        "tampered pins must fail validate"
    );
    let report: Value = serde_json::from_slice(&out.stdout).unwrap();
    assert!(report["problems"][0].as_str().unwrap().contains("drifted"));
    refused(
        &[
            "feature",
            "ticket",
            root,
            "voice",
            "https://github.com/o/r/issues/9",
        ],
        "invalid",
    );
    let overview = mozak(&["project", "overview", root]);
    let value: Value = serde_json::from_slice(&overview.stdout).unwrap();
    assert_eq!(value["state"], "invalid");

    // A hand-edited earlier version is caught: v2 pins the exact bytes of v1.
    write(&temp.0, ".mozak/evidence/voice/a.md", "a\n");
    let v1 = temp.0.join(".mozak/features/voice.v1.json");
    let original = fs::read(&v1).unwrap();
    let mut doc: Value = serde_json::from_slice(&original).unwrap();
    doc["title"] = Value::from("Renamed by hand");
    fs::write(&v1, serde_json::to_vec(&doc).unwrap()).unwrap();
    let report = ok(&["feature", "list", root]);
    assert_eq!(report["valid"], false, "editing v1 must break the chain");
    assert!(
        report["problems"]
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p.as_str().unwrap().contains("earlier version was edited")),
        "{report}"
    );
    fs::write(&v1, &original).unwrap();
    assert_eq!(
        ok(&["feature", "list", root])["valid"],
        true,
        "restoring v1 repairs it"
    );
    doc["version"] = Value::from(7);
    fs::write(&v1, serde_json::to_vec(&doc).unwrap()).unwrap();
    let report = ok(&["feature", "list", root]);
    assert_eq!(report["valid"], false, "file name and version must agree");
}
