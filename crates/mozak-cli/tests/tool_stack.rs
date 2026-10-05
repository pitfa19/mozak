//! Public CLI tests for the explicit tool stack: `stack catalog`,
//! `stack recommend USE_CASE`, and `stack check HOME [USE_CASE]`.
//!
//! Every test runs against a disposable HOME and a controlled PATH. No test
//! installs, launches, or contacts anything.

use serde_json::{Value, json};
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Output},
};

fn scratch(name: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!(
        "mozak-stack-{name}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir(&path).unwrap();
    path
}

/// Runs mozak with a fixed PATH and every credential-like variable removed so
/// the host environment cannot leak into results.
fn run_with(args: &[&str], path: &str, env: &[(&str, &str)]) -> Output {
    let mut command = Command::new(env!("CARGO_BIN_EXE_mozak"));
    command.args(args).env("PATH", path);
    for key in [
        "ZOTERO_DB_PATH",
        "ZOTERO_API_KEY",
        "ZOTERO_LIBRARY_ID",
        "ZOTERO_LOCAL_API_KEY",
        "OVERLEAF_SESSION",
        "OVERLEAF_GIT_TOKEN",
        "GITHUB_TOKEN",
    ] {
        command.env_remove(key);
    }
    for (key, value) in env {
        command.env(key, value);
    }
    command.output().unwrap()
}

fn json_of(output: &Output) -> Value {
    serde_json::from_slice(&output.stdout).unwrap_or_else(|error| {
        panic!(
            "stdout is not JSON ({error}): {}\nstderr: {}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        )
    })
}

#[cfg(unix)]
fn fake_executable(dir: &Path, name: &str) {
    use std::os::unix::fs::PermissionsExt;
    fs::create_dir_all(dir).unwrap();
    let path = dir.join(name);
    // A sentinel: if MOZAK ever executed a probed executable this would write
    // a marker file, and the test asserts that never happens.
    let marker = dir.join(format!("{name}.executed"));
    fs::write(&path, format!("#!/bin/sh\ntouch '{}'\n", marker.display())).unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
}

fn tool<'a>(report: &'a Value, use_case: &str, id: &str) -> &'a Value {
    report["use_cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|u| u["id"] == use_case)
        .unwrap_or_else(|| panic!("use case {use_case} missing"))["tools"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["id"] == id)
        .unwrap_or_else(|| panic!("tool {id} missing"))
}

fn install_baseline(home: &Path) {
    for root in [".agents", ".jcode", ".claude", ".codex"] {
        for skill in [
            "i-have-adhd",
            "note",
            "note-healthcheck",
            "note-voice-census",
        ] {
            fs::create_dir_all(home.join(root).join("skills").join(skill)).unwrap();
        }
    }
}

#[test]
fn catalog_lists_every_named_use_case_and_declares_no_effects() {
    let output = run_with(&["stack", "catalog"], "", &[]);
    assert!(output.status.success());
    let report = json_of(&output);
    assert_eq!(report["command"], "stack catalog");
    assert_eq!(report["catalog"]["id"], "mozak-tool-stack");
    assert_eq!(report["catalog"]["file"], "tool-stack.json");
    let ids: Vec<&str> = report["use_cases"]
        .as_array()
        .unwrap()
        .iter()
        .map(|u| u["id"].as_str().unwrap())
        .collect();
    assert_eq!(
        ids,
        [
            "baseline",
            "literature",
            "references",
            "manuscript",
            "tooling-watch",
            "deep-research"
        ]
    );
    assert_eq!(report["effects"]["network"], false);
    assert_eq!(report["effects"]["installs"], false);
    assert_eq!(report["effects"]["executes_external_programs"], false);
    // Every existing adapter capability is named somewhere in the catalog.
    let tools = report["document"]["tools"].as_array().unwrap();
    for adapter in [
        "arxiv",
        "dair-ai",
        "mcp-registry",
        "github-tooling",
        "hyperresearch",
        "monokl",
    ] {
        assert!(
            tools.iter().any(|t| t["adapter"] == adapter),
            "adapter {adapter} has no catalog guidance"
        );
    }
}

#[test]
fn recommend_returns_only_applicable_tools_plus_baseline() {
    let output = run_with(&["stack", "recommend", "literature"], "", &[]);
    assert!(output.status.success());
    let report = json_of(&output);
    let use_cases: Vec<&str> = report["use_cases"]
        .as_array()
        .unwrap()
        .iter()
        .map(|u| u["id"].as_str().unwrap())
        .collect();
    assert_eq!(use_cases, ["baseline", "literature"]);
    let literature: Vec<&str> = report["use_cases"][1]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["id"].as_str().unwrap())
        .collect();
    assert_eq!(
        literature,
        ["arxiv-mcp", "adapter-arxiv", "adapter-dair-ai"]
    );
    let arxiv = &report["use_cases"][1]["tools"][0];
    assert_eq!(
        arxiv["upstream"]["repository"],
        "https://github.com/blazickjp/arxiv-mcp-server"
    );
    assert_eq!(arxiv["upstream"]["pinned_version"], "0.8.1");
    assert_eq!(arxiv["shipped_by_mozak"], false);
    assert_eq!(
        arxiv["registration"]["claude-code"]["command"],
        "claude mcp add --transport stdio --scope user arxiv -- uvx arxiv-mcp-server@0.8.1"
    );
    let text = String::from_utf8_lossy(&output.stdout);
    assert!(
        !text.contains("zotero-mcp\""),
        "references tools leaked into literature"
    );
    assert!(
        !text.contains("overleaf-mcp\""),
        "manuscript tools leaked into literature"
    );

    let references = json_of(&run_with(&["stack", "recommend", "references"], "", &[]));
    let zotero = &references["use_cases"][1]["tools"][0];
    assert_eq!(zotero["id"], "zotero-mcp");
    assert_eq!(
        zotero["upstream"]["repository"],
        "https://github.com/54yyyu/zotero-mcp"
    );
    let manuscript = json_of(&run_with(&["stack", "recommend", "manuscript"], "", &[]));
    let overleaf = &manuscript["use_cases"][1]["tools"][0];
    assert_eq!(
        overleaf["upstream"]["repository"],
        "https://github.com/rangehow/overleaf-mcp"
    );
    assert_eq!(overleaf["upstream"]["package"], "overleaf-mcp-plus");
    assert_eq!(
        overleaf["credentials"]["required_env"],
        json!(["OVERLEAF_SESSION"])
    );
}

#[test]
fn unknown_use_case_is_invalid_and_lists_valid_ids() {
    for args in [
        vec!["stack", "recommend", "astrology"],
        vec!["stack", "check", "/", "astrology"],
    ] {
        let output = run_with(&args, "", &[]);
        assert_eq!(output.status.code(), Some(3));
        let report = json_of(&output);
        assert_eq!(report["state"], "invalid");
        assert_eq!(report["message"], "unknown use case: astrology");
        assert!(
            report["valid_use_cases"]
                .as_array()
                .unwrap()
                .contains(&json!("references"))
        );
    }
}

#[test]
fn check_rejects_unsafe_home() {
    for home in ["relative/home", "/does/not/exist/for/mozak", "/tmp/../tmp"] {
        let output = run_with(&["stack", "check", home], "", &[]);
        assert_eq!(output.status.code(), Some(3), "{home}");
        assert_eq!(json_of(&output)["state"], "invalid");
    }
    let output = run_with(&["stack", "bogus"], "", &[]);
    assert!(!output.status.success());
}

#[cfg(unix)]
#[test]
fn fresh_home_reports_missing_dependencies_with_install_steps_and_installs_nothing() {
    let home = scratch("fresh");
    let before: Vec<_> = fs::read_dir(&home).unwrap().collect();
    let output = run_with(
        &["stack", "check", home.to_str().unwrap(), "literature"],
        "",
        &[],
    );
    assert_eq!(output.status.code(), Some(2));
    let report = json_of(&output);
    assert_eq!(report["state"], "incomplete");
    assert_eq!(
        report["gating_use_cases"],
        json!(["baseline", "literature"])
    );
    let arxiv = tool(&report, "literature", "arxiv-mcp");
    assert_eq!(arxiv["state"], "missing");
    assert_eq!(arxiv["handshake"], "not_observed");
    assert_eq!(arxiv["usable"], "unknown");
    assert_eq!(arxiv["write_grant"], "not_observed");
    assert!(
        arxiv["next_step"]
            .as_str()
            .unwrap()
            .contains("uv tool install arxiv-mcp-server==0.8.1")
    );
    assert!(
        report["next_steps"]
            .as_array()
            .unwrap()
            .iter()
            .any(|s| s["tool_id"] == "termaid")
    );
    assert_eq!(
        report["observation_boundary"]["not_observed"],
        json!([
            "mcp_handshake",
            "service_usability",
            "write_grants",
            "network"
        ])
    );
    // Nothing was created under HOME.
    let after: Vec<_> = fs::read_dir(&home).unwrap().collect();
    assert_eq!(before.len(), after.len());
    fs::remove_dir_all(home).unwrap();
}

#[cfg(unix)]
#[test]
fn configured_arxiv_is_ready_at_configured_and_probed_executables_are_never_run() {
    let home = scratch("arxiv");
    install_baseline(&home);
    let bin = home.join("bin");
    fake_executable(&bin, "termaid");
    fake_executable(&bin, "uvx");
    fs::create_dir_all(home.join(".jcode")).unwrap();
    fs::write(
        home.join(".jcode/mcp.json"),
        r#"{"servers":{"papers":{"command":"uvx","args":["arxiv-mcp-server@0.8.1"]}}}"#,
    )
    .unwrap();
    let output = run_with(
        &["stack", "check", home.to_str().unwrap(), "literature"],
        bin.to_str().unwrap(),
        &[],
    );
    let report = json_of(&output);
    assert_eq!(output.status.code(), Some(0), "{report}");
    assert_eq!(report["state"], "ready");
    let arxiv = tool(&report, "literature", "arxiv-mcp");
    assert_eq!(arxiv["state"], "configured");
    assert_eq!(arxiv["configured"]["hosts"][0]["server_name"], "papers");
    assert_eq!(arxiv["handshake"], "not_observed");
    assert!(!bin.join("uvx.executed").exists());
    assert!(!bin.join("termaid.executed").exists());
    fs::remove_dir_all(home).unwrap();
}

#[cfg(unix)]
#[test]
fn configured_zotero_without_database_is_prerequisite_missing_not_ready() {
    let home = scratch("zotero");
    install_baseline(&home);
    let bin = home.join("bin");
    fake_executable(&bin, "termaid");
    fake_executable(&bin, "zotero-mcp");
    fs::create_dir_all(home.join(".jcode")).unwrap();
    fs::write(
        home.join(".jcode/mcp.json"),
        r#"{"servers":{"zotero":{"command":"zotero-mcp","args":["serve"],"env":{"ZOTERO_LOCAL":"true"}}}}"#,
    )
    .unwrap();
    let home_arg = home.to_str().unwrap();
    let output = run_with(
        &["stack", "check", home_arg, "references"],
        bin.to_str().unwrap(),
        &[],
    );
    assert_eq!(output.status.code(), Some(2));
    let report = json_of(&output);
    let zotero = tool(&report, "references", "zotero-mcp");
    assert_eq!(zotero["state"], "prerequisite_missing");
    assert_eq!(zotero["ready"], false);
    assert_eq!(zotero["usable"], "unknown");
    assert_eq!(zotero["prerequisites"][0]["status"], "missing");
    assert_eq!(zotero["prerequisites"][0]["alternative"]["present"], false);

    // A real database file at the default path satisfies the prerequisite.
    fs::create_dir_all(home.join("Zotero")).unwrap();
    fs::write(home.join("Zotero/zotero.sqlite"), b"").unwrap();
    let ready = json_of(&run_with(
        &["stack", "check", home_arg, "references"],
        bin.to_str().unwrap(),
        &[],
    ));
    let zotero = tool(&ready, "references", "zotero-mcp");
    assert_eq!(zotero["state"], "configured");
    assert_eq!(zotero["prerequisites"][0]["satisfied_by"], "file");
    assert_eq!(ready["state"], "ready");
    fs::remove_dir_all(home).unwrap();
}

#[cfg(unix)]
#[test]
fn zotero_web_mode_counts_declared_names_and_never_reports_values() {
    let home = scratch("zotero-web");
    install_baseline(&home);
    let bin = home.join("bin");
    fake_executable(&bin, "termaid");
    fs::create_dir_all(home.join(".codex")).unwrap();
    fs::write(
        home.join(".codex/config.toml"),
        "[mcp_servers.zotero]\ncommand = \"zotero-mcp\" # local\n\n[mcp_servers.zotero.env]\nZOTERO_API_KEY = \"sekret-api-value\"\nZOTERO_LIBRARY_ID = \"sekret-library\"\n",
    )
    .unwrap();
    let output = run_with(
        &["stack", "check", home.to_str().unwrap(), "references"],
        bin.to_str().unwrap(),
        &[("OVERLEAF_SESSION", "sekret-cookie")],
    );
    let text = String::from_utf8_lossy(&output.stdout).into_owned();
    assert!(
        !text.contains("sekret"),
        "a credential value leaked: {text}"
    );
    let report = json_of(&output);
    let zotero = tool(&report, "references", "zotero-mcp");
    assert_eq!(zotero["state"], "configured");
    assert_eq!(zotero["prerequisites"][0]["satisfied_by"], "alternative");
    assert_eq!(zotero["credentials"]["values_reported"], false);
    assert_eq!(
        zotero["credentials"]["present_in_host_config"],
        json!(["ZOTERO_API_KEY", "ZOTERO_LIBRARY_ID"])
    );
    fs::remove_dir_all(home).unwrap();
}

#[cfg(unix)]
#[test]
fn overleaf_without_session_name_is_prerequisite_missing_and_value_never_leaks() {
    let home = scratch("overleaf");
    install_baseline(&home);
    let bin = home.join("bin");
    fake_executable(&bin, "termaid");
    fake_executable(&bin, "overleaf-mcp");
    let home_arg = home.to_str().unwrap();
    let installed = json_of(&run_with(
        &["stack", "check", home_arg, "manuscript"],
        bin.to_str().unwrap(),
        &[],
    ));
    let overleaf = tool(&installed, "manuscript", "overleaf-mcp");
    assert_eq!(overleaf["state"], "prerequisite_missing");
    assert_eq!(overleaf["installed"]["status"], "present");

    fs::write(
        home.join(".claude.json"),
        r#"{"mcpServers":{"overleaf":{"command":"overleaf-mcp","env":{"OVERLEAF_SESSION":"s%3Asekret"}}}}"#,
    )
    .unwrap();
    let output = run_with(
        &["stack", "check", home_arg, "manuscript"],
        bin.to_str().unwrap(),
        &[],
    );
    assert!(!String::from_utf8_lossy(&output.stdout).contains("sekret"));
    let report = json_of(&output);
    let overleaf = tool(&report, "manuscript", "overleaf-mcp");
    assert_eq!(overleaf["state"], "configured");
    assert_eq!(overleaf["prerequisites"][0]["present_in_host_config"], true);
    assert_eq!(overleaf["prerequisites"][0]["value_reported"], false);
    assert_eq!(overleaf["write_grant"], "not_observed");
    fs::remove_dir_all(home).unwrap();
}

#[cfg(unix)]
#[test]
fn disabled_null_and_malformed_host_entries_never_count_as_configured() {
    let home = scratch("disabled");
    install_baseline(&home);
    fs::create_dir_all(home.join(".jcode")).unwrap();
    fs::create_dir_all(home.join(".codex")).unwrap();
    fs::write(
        home.join(".jcode/mcp.json"),
        r#"{"servers":{"arxiv":null,"zotero":{"command":"zotero-mcp","disabled":true}}}"#,
    )
    .unwrap();
    fs::write(
        home.join(".claude.json"),
        r#"{"mcpServers":{"arxiv":{"args":["arxiv-mcp-server"]}}}"#,
    )
    .unwrap();
    fs::write(
        home.join(".codex/config.toml"),
        "[mcp_servers.arxiv\ncommand = \"uvx\"\n",
    )
    .unwrap();
    let report = json_of(&run_with(
        &["stack", "check", home.to_str().unwrap()],
        "",
        &[],
    ));
    assert_eq!(report["gating_use_cases"], json!(["baseline"]));
    assert_eq!(report["use_cases"].as_array().unwrap().len(), 6);
    assert_eq!(tool(&report, "literature", "arxiv-mcp")["state"], "missing");
    assert_eq!(
        tool(&report, "references", "zotero-mcp")["state"],
        "missing"
    );
    let codex = report["host_configs"]
        .as_array()
        .unwrap()
        .iter()
        .find(|h| h["host"] == "codex")
        .unwrap();
    assert!(codex["status"].as_str().unwrap().starts_with("unreadable"));

    fs::write(
        home.join(".codex/config.toml"),
        "[mcp_servers.arxiv]\ncommand = \"uvx\"\nenabled = false # paused\n",
    )
    .unwrap();
    let report = json_of(&run_with(
        &["stack", "check", home.to_str().unwrap()],
        "",
        &[],
    ));
    assert_eq!(tool(&report, "literature", "arxiv-mcp")["state"], "missing");
    fs::remove_dir_all(home).unwrap();
}

#[cfg(unix)]
#[test]
fn symlinked_host_configs_and_ancestors_are_refused_not_followed() {
    let home = scratch("symlink");
    let outside = scratch("symlink-outside");
    fs::write(
        outside.join("mcp.json"),
        r#"{"servers":{"arxiv":{"command":"uvx","args":["arxiv-mcp-server"]}}}"#,
    )
    .unwrap();
    fs::create_dir_all(outside.join("jcode")).unwrap();
    fs::copy(outside.join("mcp.json"), outside.join("jcode/mcp.json")).unwrap();
    // File symlink.
    fs::write(home.join("placeholder"), b"").unwrap();
    std::os::unix::fs::symlink(outside.join("mcp.json"), home.join(".claude.json")).unwrap();
    // Ancestor symlink.
    std::os::unix::fs::symlink(outside.join("jcode"), home.join(".jcode")).unwrap();
    let report = json_of(&run_with(
        &["stack", "check", home.to_str().unwrap(), "literature"],
        "",
        &[],
    ));
    assert_eq!(tool(&report, "literature", "arxiv-mcp")["state"], "missing");
    for host in ["jcode", "claude-code"] {
        let status = report["host_configs"]
            .as_array()
            .unwrap()
            .iter()
            .find(|h| h["host"] == host)
            .unwrap()["status"]
            .as_str()
            .unwrap()
            .to_owned();
        assert_eq!(status, "unreadable: symlink refused", "{host}");
    }
    fs::remove_dir_all(home).unwrap();
    fs::remove_dir_all(outside).unwrap();
}

fn sha(bytes: &[u8]) -> String {
    use sha2::Digest;
    format!("{:x}", sha2::Sha256::digest(bytes))
}

/// HOME-local MOZAK config pointing at a real KB that registers `topic-test`.
fn home_kb(home: &Path) {
    let scope_root = home.join("scope");
    fs::create_dir_all(&scope_root).unwrap();
    let manifest = serde_json::to_vec(&json!({
        "schema_version": 2,
        "scopes": [{"id": "topic-test", "kind": "topic", "title": "Topic Test",
            "intent": "Bounded test scope",
            "history": [{"id": "h-1", "at": "2026-09-06T00:00:00Z", "note": "Created"}]}],
        "promotions": [], "meta_goals": [], "inputs": []
    }))
    .unwrap();
    fs::write(scope_root.join("scope.json"), &manifest).unwrap();
    let kb_root = home.join("kb");
    fs::create_dir_all(&kb_root).unwrap();
    let kb_bytes = serde_json::to_vec(&json!({
        "schema_version": 1,
        "registrations": [{"id": "test", "path": scope_root, "scope_manifest_sha256": sha(&manifest)}]
    }))
    .unwrap();
    fs::write(kb_root.join("kb.json"), &kb_bytes).unwrap();
    fs::create_dir_all(home.join(".config/mozak")).unwrap();
    fs::write(
        home.join(".config/mozak/config.json"),
        serde_json::to_vec(
            &json!({"schema_version": 1, "kb_root": kb_root, "kb_sha256": sha(&kb_bytes)}),
        )
        .unwrap(),
    )
    .unwrap();
}

/// Writes one adapter binding with real pinned files. Returns the request path.
fn bind(home: &Path, adapter: &str, scope: &str) -> PathBuf {
    let request = home.join(format!("{adapter}-request.json"));
    let runner = home.join(format!("{adapter}-runner.sh"));
    fs::write(&request, b"{}").unwrap();
    fs::write(&runner, b"#!/bin/sh\n").unwrap();
    fs::create_dir_all(home.join(".config/mozak")).unwrap();
    fs::write(
        home.join(".config/mozak/adapters.json"),
        serde_json::to_vec(&json!({"schema_version": 1, "bindings": [{
            "id": format!("{adapter}-binding"), "adapter": adapter, "target_scope_id": scope,
            "request_path": request, "request_sha256": sha(b"{}"),
            "runner_path": runner, "runner_sha256": sha(b"#!/bin/sh\n"),
            "runs_dir": home.join("runs")}]}))
        .unwrap(),
    )
    .unwrap();
    request
}

fn binding_state(home: &Path, bin: &Path) -> (Option<i32>, Value) {
    let output = run_with(
        &["stack", "check", home.to_str().unwrap(), "tooling-watch"],
        bin.to_str().unwrap(),
        &[],
    );
    (output.status.code(), json_of(&output))
}

#[cfg(unix)]
#[test]
fn only_callable_adapter_bindings_with_registered_scope_count_as_configured() {
    let home = scratch("adapters");
    install_baseline(&home);
    let bin = home.join("bin");
    fake_executable(&bin, "termaid");
    fake_executable(&bin, "python3");

    let (code, before) = binding_state(&home, &bin);
    assert_eq!(code, Some(2));
    assert_eq!(
        tool(&before, "tooling-watch", "adapter-github-tooling")["state"],
        "installed"
    );

    // Valid pins but no verifiable KB under HOME: not callable.
    bind(&home, "github-tooling", "topic-test");
    let (code, unverified) = binding_state(&home, &bin);
    assert_eq!(code, Some(2));
    assert_eq!(
        tool(&unverified, "tooling-watch", "adapter-github-tooling")["state"],
        "installed"
    );
    assert_eq!(
        unverified["adapter_registry"]["bindings"][0]["reasons"],
        json!(["target_scope_unverified"])
    );

    // Verified KB but the target Scope is not registered: not callable.
    home_kb(&home);
    bind(&home, "github-tooling", "topic-missing");
    let (code, missing_scope) = binding_state(&home, &bin);
    assert_eq!(code, Some(2));
    assert_eq!(
        missing_scope["adapter_registry"]["bindings"][0]["reasons"],
        json!(["target_scope_not_registered"])
    );

    // Registered Scope and current pins: callable and configured.
    let request = bind(&home, "github-tooling", "topic-test");
    let (code, ready) = binding_state(&home, &bin);
    assert_eq!(code, Some(0), "{ready}");
    assert_eq!(
        tool(&ready, "tooling-watch", "adapter-github-tooling")["state"],
        "configured"
    );
    assert_eq!(ready["adapter_registry"]["bindings"][0]["state"], "ready");

    // A drifted pin needs recheck and stops counting.
    fs::write(&request, b"{\"edited\":true}").unwrap();
    let (code, drifted) = binding_state(&home, &bin);
    assert_eq!(code, Some(2));
    assert_eq!(
        drifted["adapter_registry"]["bindings"][0]["state"],
        "needs_recheck"
    );
    assert_eq!(
        drifted["adapter_registry"]["bindings"][0]["reasons"],
        json!(["request_pin_drifted"])
    );

    // A registry the strict validator rejects never counts.
    fs::write(
        home.join(".config/mozak/adapters.json"),
        r#"{"schema_version":1,"bindings":[{"id":"b","adapter":"github-tooling","target_scope_id":"s","request_path":"/r","request_sha256":"0","runner_path":"/x","runner_sha256":"0","runs_dir":"/d"}]}"#,
    )
    .unwrap();
    let (code, invalid) = binding_state(&home, &bin);
    assert_eq!(code, Some(2));
    assert_eq!(
        invalid["adapter_registry"]["status"],
        "unreadable: invalid adapter registry"
    );
    assert!(!bin.join("python3.executed").exists());
    fs::remove_dir_all(home).unwrap();
}

#[cfg(unix)]
#[test]
fn zotero_alternative_names_are_never_unioned_across_sources() {
    let home = scratch("zotero-union");
    install_baseline(&home);
    let bin = home.join("bin");
    fake_executable(&bin, "termaid");
    fs::create_dir_all(home.join(".jcode")).unwrap();
    // Two servers each declare half of the pair; the process env declares neither.
    fs::write(
        home.join(".jcode/mcp.json"),
        r#"{"servers":{"zotero":{"command":"zotero-mcp","env":{"ZOTERO_API_KEY":"x"}},"zotero-web":{"command":"zotero-mcp","env":{"ZOTERO_LIBRARY_ID":"y"}}}}"#,
    )
    .unwrap();
    let home_arg = home.to_str().unwrap();
    let split = json_of(&run_with(
        &["stack", "check", home_arg, "references"],
        bin.to_str().unwrap(),
        &[],
    ));
    let zotero = tool(&split, "references", "zotero-mcp");
    assert_eq!(zotero["state"], "prerequisite_missing");
    assert_eq!(zotero["prerequisites"][0]["alternative"]["present"], false);

    // One server key plus the other key in the process env is still a union.
    let mixed = json_of(&run_with(
        &["stack", "check", home_arg, "references"],
        bin.to_str().unwrap(),
        &[("ZOTERO_LIBRARY_ID", "z")],
    ));
    assert_eq!(
        tool(&mixed, "references", "zotero-mcp")["state"],
        "prerequisite_missing"
    );

    // Both keys in the process env is one source.
    let process = json_of(&run_with(
        &["stack", "check", home_arg, "references"],
        bin.to_str().unwrap(),
        &[("ZOTERO_API_KEY", "a"), ("ZOTERO_LIBRARY_ID", "b")],
    ));
    let zotero = tool(&process, "references", "zotero-mcp");
    assert_eq!(zotero["state"], "configured");
    assert_eq!(
        zotero["prerequisites"][0]["alternative"]["source"]["kind"],
        "process_env"
    );
    fs::remove_dir_all(home).unwrap();
}

#[cfg(unix)]
#[test]
fn symlinked_zotero_database_does_not_satisfy_the_prerequisite() {
    let home = scratch("zotero-link");
    let outside = scratch("zotero-link-outside");
    install_baseline(&home);
    let bin = home.join("bin");
    fake_executable(&bin, "termaid");
    fs::write(outside.join("zotero.sqlite"), b"").unwrap();
    fs::create_dir_all(home.join(".jcode")).unwrap();
    fs::write(
        home.join(".jcode/mcp.json"),
        r#"{"servers":{"zotero":{"command":"zotero-mcp"}}}"#,
    )
    .unwrap();
    fs::create_dir_all(home.join("Zotero")).unwrap();
    std::os::unix::fs::symlink(
        outside.join("zotero.sqlite"),
        home.join("Zotero/zotero.sqlite"),
    )
    .unwrap();
    let home_arg = home.to_str().unwrap();
    let file_link = json_of(&run_with(
        &["stack", "check", home_arg, "references"],
        bin.to_str().unwrap(),
        &[],
    ));
    assert_eq!(
        tool(&file_link, "references", "zotero-mcp")["state"],
        "prerequisite_missing"
    );
    // An ancestor symlink in ZOTERO_DB_PATH is refused too.
    std::os::unix::fs::symlink(&outside, home.join("linked-dir")).unwrap();
    let db = home.join("linked-dir/zotero.sqlite");
    let ancestor = json_of(&run_with(
        &["stack", "check", home_arg, "references"],
        bin.to_str().unwrap(),
        &[("ZOTERO_DB_PATH", db.to_str().unwrap())],
    ));
    assert_eq!(
        tool(&ancestor, "references", "zotero-mcp")["state"],
        "prerequisite_missing"
    );
    fs::remove_dir_all(home).unwrap();
    fs::remove_dir_all(outside).unwrap();
}
