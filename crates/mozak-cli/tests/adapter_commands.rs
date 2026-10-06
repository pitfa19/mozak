#![cfg(unix)]
//! Adapter commands are retired: new retrieval is MCP-only. Every former
//! `mozak adapter ...` route must refuse without executing a runner, without
//! creating or mutating the adapter registry, and without writing run output.
//! Historical records stay readable through `project current/browse/why` and
//! `research validate`, which are covered by their own tests.

use serde_json::json;
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
    fn registry(&self) -> PathBuf {
        self.0.join("config/mozak/adapters.json")
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

/// Writes a historical binding whose pins match real files, so a still-live
/// route would be able to execute it. Returns the marker the runner would
/// create if it were ever called.
fn ready_binding(home: &Temp) -> PathBuf {
    let request = home.0.join("request.json");
    let request_bytes = br#"{"schema_version":1,"scope_id":"topic-test"}"#;
    fs::write(&request, request_bytes).unwrap();
    let runner = home.0.join("runner.sh");
    let marker = home.0.join("called");
    let runner_bytes = format!("#!/bin/sh\nprintf called > '{}'\n", marker.display()).into_bytes();
    fs::write(&runner, &runner_bytes).unwrap();
    fs::set_permissions(&runner, fs::Permissions::from_mode(0o755)).unwrap();
    let registry = home.registry();
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
                "runs_dir": home.0.join("runs")
            }]
        }))
        .unwrap(),
    )
    .unwrap();
    marker
}

/// Every route the retired adapter CLI used to expose, plus malformed forms.
fn former_routes(home: &Temp) -> Vec<Vec<String>> {
    let request = home.0.join("request.json").display().to_string();
    let runner = home.0.join("runner.sh").display().to_string();
    let runs = home.0.join("runs").display().to_string();
    let mut routes = vec![
        vec!["adapter".to_owned()],
        vec!["adapter".into(), "catalog".into()],
        vec!["adapter".into(), "list".into()],
        vec!["adapter".into(), "show".into(), "test-dair".into()],
        vec!["adapter".into(), "run".into(), "test-dair".into()],
        vec!["adapter".into(), "recheck".into(), "test-dair".into()],
        vec!["adapter".into(), "run".into(), "unknown-binding".into()],
    ];
    for adapter in [
        "arxiv",
        "dair-ai",
        "mcp-registry",
        "github-tooling",
        "hyperresearch",
        "monokl",
    ] {
        routes.push(vec![
            "adapter".into(),
            "setup".into(),
            adapter.into(),
            format!("new-{adapter}"),
            "topic-test".into(),
            request.clone(),
            runner.clone(),
            runs.clone(),
        ]);
    }
    routes
}

fn assert_retired(out: &Output, route: &[String]) {
    assert!(!out.status.success(), "{route:?} must fail");
    assert!(out.stdout.is_empty(), "{route:?} must print no result");
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(stderr.contains("retired"), "{route:?}: {stderr}");
    assert!(stderr.contains("MCP-only"), "{route:?}: {stderr}");
}

#[test]
fn every_former_adapter_route_is_refused_without_execution_or_registry_mutation() {
    let home = Temp::new();
    let marker = ready_binding(&home);
    let registry_before = fs::read(home.registry()).unwrap();
    for route in former_routes(&home) {
        let args = route.iter().map(String::as_str).collect::<Vec<_>>();
        assert_retired(&run(&home, &args), &route);
        assert!(!marker.exists(), "{route:?} executed the runner");
        assert!(
            !home.0.join("runs").exists(),
            "{route:?} created run output"
        );
        assert_eq!(
            fs::read(home.registry()).unwrap(),
            registry_before,
            "{route:?} mutated the adapter registry"
        );
        assert!(
            !home.registry().with_extension("json.new").exists(),
            "{route:?} staged a registry write"
        );
    }
}

#[test]
fn retired_routes_never_create_a_registry_or_config_directory() {
    let home = Temp::new();
    // Real request and runner files exist, but no registry was ever configured.
    let request = home.0.join("request.json");
    fs::write(&request, br#"{"schema_version":1,"scope_id":"topic-test"}"#).unwrap();
    let runner = home.0.join("runner.sh");
    fs::write(&runner, b"#!/bin/sh\nexit 0\n").unwrap();
    fs::set_permissions(&runner, fs::Permissions::from_mode(0o755)).unwrap();
    for route in former_routes(&home) {
        let args = route.iter().map(String::as_str).collect::<Vec<_>>();
        assert_retired(&run(&home, &args), &route);
        assert!(!home.registry().exists(), "{route:?} created a registry");
        assert!(
            !home.0.join("config").exists(),
            "{route:?} created config state"
        );
        assert!(!home.0.join("runs").exists(), "{route:?} created runs");
    }
}

#[test]
fn a_malformed_historical_registry_is_neither_read_nor_repaired_by_adapter_routes() {
    let home = Temp::new();
    let registry = home.registry();
    fs::create_dir_all(registry.parent().unwrap()).unwrap();
    fs::write(&registry, b"{not json").unwrap();
    for route in former_routes(&home) {
        let args = route.iter().map(String::as_str).collect::<Vec<_>>();
        let out = run(&home, &args);
        assert_retired(&out, &route);
        // The refusal is the retirement message, not a registry parse error.
        assert!(
            !String::from_utf8_lossy(&out.stderr).contains("invalid adapter registry"),
            "{route:?} still reads the registry"
        );
        assert_eq!(fs::read(&registry).unwrap(), b"{not json");
    }
}

#[test]
fn usage_no_longer_advertises_adapter_routes() {
    let home = Temp::new();
    let out = run(&home, &["no-such-command"]);
    assert!(!out.status.success());
    let usage = String::from_utf8_lossy(&out.stderr);
    assert!(usage.contains("usage: mozak"), "{usage}");
    for retired in [
        "mozak adapter catalog",
        "mozak adapter setup",
        "mozak adapter <list",
        "run ID",
        "recheck ID",
    ] {
        assert!(!usage.contains(retired), "usage still lists {retired}");
    }
    // Historical normalizers remain available offline.
    assert!(usage.contains("mozak research normalize"));
}
