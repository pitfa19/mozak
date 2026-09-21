#![cfg(unix)]

use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    fs,
    os::unix::fs::PermissionsExt,
    path::PathBuf,
    process::{Command, Output},
    sync::atomic::{AtomicU64, Ordering},
};

static NEXT: AtomicU64 = AtomicU64::new(0);
struct Temp(PathBuf);
impl Temp {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "mozak-adapters-{}-{}",
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

fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn run(home: &Temp, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_mozak"))
        .args(args)
        .env("XDG_CONFIG_HOME", home.0.join("config"))
        .env("HOME", &home.0)
        .output()
        .unwrap()
}

fn fixture(home: &Temp) -> PathBuf {
    let request = home.0.join("request.json");
    let request_bytes = br#"{"schema_version":1,"scope_id":"topic-test"}"#;
    fs::write(&request, request_bytes).unwrap();
    let runner = home.0.join("runner.sh");
    let marker = home.0.join("called");
    let runner_bytes = format!("#!/bin/sh\nprintf called > '{}'\n", marker.display()).into_bytes();
    fs::write(&runner, &runner_bytes).unwrap();
    fs::set_permissions(&runner, fs::Permissions::from_mode(0o755)).unwrap();
    let runs = home.0.join("runs");
    let registry = home.0.join("config/mozak/adapters.json");
    fs::create_dir_all(registry.parent().unwrap()).unwrap();
    fs::write(
        &registry,
        serde_json::to_vec_pretty(&json!({
            "schema_version": 1,
            "bindings": [{
                "id": "test-dair",
                "adapter": "dair-ai",
                "target_scope_id": "topic-test",
                "request_path": request,
                "request_sha256": hash(request_bytes),
                "runner_path": runner,
                "runner_sha256": hash(&runner_bytes),
                "runs_dir": runs
            }]
        }))
        .unwrap(),
    )
    .unwrap();
    marker
}

/// Builds a configured KB containing `topic-test`, which recheck requires
/// before restoring a binding whose output has somewhere to go.
fn kb(home: &Temp) {
    let scope_root = home.0.join("scope");
    fs::create_dir_all(&scope_root).unwrap();
    let manifest = serde_json::to_vec(&json!({
        "schema_version": 2,
        "scopes": [{
            "id": "topic-test",
            "kind": "topic",
            "title": "Topic Test",
            "intent": "Bounded test scope",
            "history": [{"id": "h-1", "at": "2026-09-06T00:00:00Z", "note": "Created"}]
        }],
        "promotions": [],
        "meta_goals": [],
        "inputs": []
    }))
    .unwrap();
    fs::write(scope_root.join("scope.json"), &manifest).unwrap();

    let kb_root = home.0.join("kb");
    fs::create_dir_all(&kb_root).unwrap();
    let kb_bytes = serde_json::to_vec(&json!({
        "schema_version": 1,
        "registrations": [{
            "id": "test",
            "path": scope_root,
            "scope_manifest_sha256": hash(&manifest)
        }]
    }))
    .unwrap();
    fs::write(kb_root.join("kb.json"), &kb_bytes).unwrap();

    let config = home.0.join("config/mozak/config.json");
    fs::create_dir_all(config.parent().unwrap()).unwrap();
    fs::write(
        &config,
        serde_json::to_vec(&json!({
            "schema_version": 1,
            "kb_root": kb_root,
            "kb_sha256": hash(&kb_bytes),
            "projects": {},
            "approval": {
                "proposal_digest": "0".repeat(64),
                "owner": "test-owner",
                "approved_at": "2026-09-06T00:00:00Z",
                "rationale": "Test fixture configured KB."
            }
        }))
        .unwrap(),
    )
    .unwrap();
}

#[test]
fn catalog_exposes_optional_adapters_without_requiring_a_registry() {
    let home = Temp::new();
    let output = run(&home, &["adapter", "catalog"]);
    assert!(output.status.success());
    let value: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(value["adapters"][0]["id"], "dair-ai");
    assert_eq!(
        value["adapters"][0]["kind"],
        "optional_external_integration"
    );
    let arxiv = value["adapters"]
        .as_array()
        .unwrap()
        .iter()
        .find(|adapter| adapter["id"] == "arxiv")
        .unwrap();
    assert_eq!(arxiv["setup_supported"], true);
}

#[test]
fn setup_registers_an_arxiv_binding_using_topic_id() {
    let home = Temp::new();
    kb(&home);
    let request = home.0.join("arxiv-request.json");
    fs::write(
        &request,
        br#"{"schema_version":1,"topic_id":"topic-test","mode":"query","categories":["cs.AI"],"terms":["test"],"days":1}"#,
    )
    .unwrap();
    let runner = home.0.join("arxiv-runner.sh");
    fs::write(&runner, b"#!/bin/sh\nexit 0\n").unwrap();
    fs::set_permissions(&runner, fs::Permissions::from_mode(0o755)).unwrap();
    let runs = home.0.join("arxiv-runs");

    let output = run(
        &home,
        &[
            "adapter",
            "setup",
            "arxiv",
            "test-arxiv",
            "topic-test",
            request.to_str().unwrap(),
            runner.to_str().unwrap(),
            runs.to_str().unwrap(),
        ],
    );
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let value: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(value["adapter"], "arxiv");
    assert_eq!(value["target_scope_id"], "topic-test");
    assert_eq!(value["automatic_promotion"], false);

    let shown = run(&home, &["adapter", "show", "test-arxiv"]);
    assert!(shown.status.success());
    let binding: Value = serde_json::from_slice(&shown.stdout).unwrap();
    assert_eq!(binding["binding"]["adapter"], "arxiv");
    assert_eq!(binding["binding"]["state"], "ready");
    assert_eq!(binding["binding"]["callable"], true);
}

#[test]
fn arxiv_setup_and_recheck_refuse_a_mismatched_topic_id() {
    let home = Temp::new();
    kb(&home);
    let request = home.0.join("arxiv-request.json");
    fs::write(
        &request,
        br#"{"schema_version":1,"topic_id":"topic-somewhere-else","mode":"query","categories":["cs.AI"],"terms":["test"],"days":1}"#,
    )
    .unwrap();
    let runner = home.0.join("arxiv-runner.sh");
    fs::write(&runner, b"#!/bin/sh\nexit 0\n").unwrap();
    fs::set_permissions(&runner, fs::Permissions::from_mode(0o755)).unwrap();
    let runs = home.0.join("arxiv-runs");

    let refused = run(
        &home,
        &[
            "adapter",
            "setup",
            "arxiv",
            "test-arxiv",
            "topic-test",
            request.to_str().unwrap(),
            runner.to_str().unwrap(),
            runs.to_str().unwrap(),
        ],
    );
    assert!(!refused.status.success());
    assert!(
        String::from_utf8_lossy(&refused.stderr)
            .contains("request topic_id does not match the target Scope")
    );

    fs::write(
        &request,
        br#"{"schema_version":1,"topic_id":"topic-test","mode":"query","categories":["cs.AI"],"terms":["test"],"days":1}"#,
    )
    .unwrap();
    assert!(
        run(
            &home,
            &[
                "adapter",
                "setup",
                "arxiv",
                "test-arxiv",
                "topic-test",
                request.to_str().unwrap(),
                runner.to_str().unwrap(),
                runs.to_str().unwrap(),
            ],
        )
        .status
        .success()
    );

    fs::write(
        &request,
        br#"{"schema_version":1,"topic_id":"topic-somewhere-else","mode":"query","categories":["cs.AI"],"terms":["changed"],"days":1}"#,
    )
    .unwrap();
    let recheck = run(&home, &["adapter", "recheck", "test-arxiv"]);
    assert!(!recheck.status.success());
    assert!(
        String::from_utf8_lossy(&recheck.stderr)
            .contains("edited request topic_id no longer matches the target Scope")
    );
    let shown: Value =
        serde_json::from_slice(&run(&home, &["adapter", "show", "test-arxiv"]).stdout).unwrap();
    assert_eq!(shown["binding"]["state"], "needs_recheck");
    assert_eq!(shown["binding"]["callable"], false);
}

#[test]
fn list_show_and_run_use_exact_pinned_binding_files() {
    let home = Temp::new();
    let marker = fixture(&home);
    let listed = run(&home, &["adapter", "list"]);
    assert!(
        listed.status.success(),
        "{}",
        String::from_utf8_lossy(&listed.stderr)
    );
    let value: Value = serde_json::from_slice(&listed.stdout).unwrap();
    assert_eq!(value["bindings"][0]["callable"], true);
    let shown = run(&home, &["adapter", "show", "test-dair"]);
    assert!(shown.status.success());
    assert_eq!(
        serde_json::from_slice::<Value>(&shown.stdout).unwrap()["binding"]["target_scope_id"],
        "topic-test"
    );
    let invoked = run(&home, &["adapter", "run", "test-dair"]);
    assert!(
        invoked.status.success(),
        "{}",
        String::from_utf8_lossy(&invoked.stderr)
    );
    assert_eq!(fs::read_to_string(marker).unwrap(), "called");
}

#[test]
fn drift_and_unknown_bindings_fail_closed() {
    let home = Temp::new();
    fixture(&home);
    fs::write(home.0.join("request.json"), "changed").unwrap();
    let listed = run(&home, &["adapter", "list"]);
    let value: Value = serde_json::from_slice(&listed.stdout).unwrap();
    assert_eq!(value["bindings"][0]["callable"], false);
    let invoked = run(&home, &["adapter", "run", "test-dair"]);
    assert!(!invoked.status.success());
    assert!(invoked.stdout.is_empty());
    let unknown = run(&home, &["adapter", "show", "absent"]);
    assert!(!unknown.status.success());
    assert!(unknown.stdout.is_empty());
}

#[test]
fn drift_names_the_changed_pin_and_recheck_restores_callability() {
    let home = Temp::new();
    fixture(&home);
    kb(&home);

    // A binding starts ready with nothing drifted.
    let before: Value =
        serde_json::from_slice(&run(&home, &["adapter", "show", "test-dair"]).stdout).unwrap();
    assert_eq!(before["binding"]["state"], "ready");
    assert_eq!(before["binding"]["callable"], true);
    assert!(before["binding"]["drifted"].as_array().unwrap().is_empty());

    // The owner edits the pinned request.
    fs::write(
        home.0.join("request.json"),
        br#"{"schema_version":1,"scope_id":"topic-test","note":"owner edit"}"#,
    )
    .unwrap();

    let drifted: Value =
        serde_json::from_slice(&run(&home, &["adapter", "show", "test-dair"]).stdout).unwrap();
    assert_eq!(drifted["binding"]["state"], "needs_recheck");
    assert_eq!(drifted["binding"]["callable"], false);
    let pins = drifted["binding"]["drifted"].as_array().unwrap();
    assert_eq!(pins.len(), 1);
    assert_eq!(pins[0]["pin"], "request");
    assert_ne!(pins[0]["pinned_sha256"], pins[0]["observed_sha256"]);

    // Running refuses and names the file rather than executing a changed request.
    let refused = run(&home, &["adapter", "run", "test-dair"]);
    assert!(!refused.status.success());
    let message = String::from_utf8_lossy(&refused.stderr);
    assert!(message.contains("request.json"), "{message}");

    // Recheck restores callability and re-states the declared effects.
    let rechecked = run(&home, &["adapter", "recheck", "test-dair"]);
    assert!(
        rechecked.status.success(),
        "{}",
        String::from_utf8_lossy(&rechecked.stderr)
    );
    let value: Value = serde_json::from_slice(&rechecked.stdout).unwrap();
    assert_eq!(value["repinned"][0], "request");
    assert_eq!(value["authority"], "observed_hashes_only");
    assert_eq!(value["content_accepted"], false);
    assert_eq!(value["automatic_promotion"], false);
    assert_eq!(value["declared_effects"]["network_access"], true);
    assert_eq!(value["declared_effects"]["requires_owner_approval"], true);

    let after: Value =
        serde_json::from_slice(&run(&home, &["adapter", "show", "test-dair"]).stdout).unwrap();
    assert_eq!(after["binding"]["state"], "ready");
    assert_eq!(after["binding"]["callable"], true);
}

#[test]
fn recheck_refuses_a_current_binding_and_an_unknown_one() {
    let home = Temp::new();
    fixture(&home);
    kb(&home);

    let current = run(&home, &["adapter", "recheck", "test-dair"]);
    assert!(!current.status.success());
    assert!(
        String::from_utf8_lossy(&current.stderr).contains("already current"),
        "{}",
        String::from_utf8_lossy(&current.stderr)
    );

    let unknown = run(&home, &["adapter", "recheck", "no-such-binding"]);
    assert!(!unknown.status.success());
    assert!(
        String::from_utf8_lossy(&unknown.stderr).contains("unknown adapter binding"),
        "{}",
        String::from_utf8_lossy(&unknown.stderr)
    );
}

#[test]
fn recheck_refuses_an_edit_that_retargets_the_scope() {
    let home = Temp::new();
    fixture(&home);
    kb(&home);

    // Editing the request to point at a different Scope is not a re-pin; it is
    // a different binding, and must not be restored silently.
    fs::write(
        home.0.join("request.json"),
        br#"{"schema_version":1,"scope_id":"topic-somewhere-else"}"#,
    )
    .unwrap();
    let output = run(&home, &["adapter", "recheck", "test-dair"]);
    assert!(!output.status.success());
    let message = String::from_utf8_lossy(&output.stderr);
    assert!(
        message.contains("no longer matches the target Scope"),
        "{message}"
    );

    // The binding stays uncallable rather than being half-repinned.
    let after: Value =
        serde_json::from_slice(&run(&home, &["adapter", "show", "test-dair"]).stdout).unwrap();
    assert_eq!(after["binding"]["state"], "needs_recheck");
}
