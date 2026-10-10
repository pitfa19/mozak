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
    // The catalog is MCP-only: no legacy adapter kind, field, or registry.
    let document = &report["document"];
    assert!(document.get("adapter_registry_path").is_none());
    let tools = document["tools"].as_array().unwrap();
    for tool in tools {
        assert_ne!(tool["kind"], "legacy_adapter", "{tool}");
        assert!(tool.get("adapter").is_none(), "{tool}");
        assert!(
            tool["detection"].get("adapter_bindings").is_none(),
            "{tool}"
        );
    }
    for use_case in document["use_cases"].as_array().unwrap() {
        for entry in use_case["tools"].as_array().unwrap() {
            assert_ne!(entry["requirement"], "legacy_alternative", "{entry}");
        }
    }
    let mut mcp: Vec<&str> = tools
        .iter()
        .filter(|t| t["kind"] == "mcp_server")
        .map(|t| t["id"].as_str().unwrap())
        .collect();
    mcp.sort_unstable();
    assert_eq!(
        mcp,
        [
            "arxiv-mcp",
            "fetch-mcp",
            "github-mcp",
            "overleaf-mcp",
            "zotero-mcp"
        ]
    );
    assert!(!String::from_utf8_lossy(&output.stdout).contains("adapters.json"));
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
    assert_eq!(literature[0], "arxiv-mcp");
    let mut sorted = literature.clone();
    sorted.sort_unstable();
    assert_eq!(sorted, ["arxiv-mcp", "fetch-mcp", "github-mcp"]);
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

/// Writes a legacy adapter binding with real pinned files and a HOME-local
/// verified KB, i.e. what was formerly a callable adapter configuration.
fn legacy_binding(home: &Path, adapter: &str) {
    home_kb(home);
    let request = home.join(format!("{adapter}-request.json"));
    let runner = home.join(format!("{adapter}-runner.sh"));
    fs::write(&request, b"{}").unwrap();
    fs::write(&runner, b"#!/bin/sh\n").unwrap();
    fs::write(
        home.join(".config/mozak/adapters.json"),
        serde_json::to_vec(&json!({"schema_version": 1, "bindings": [{
            "id": format!("{adapter}-binding"), "adapter": adapter, "target_scope_id": "topic-test",
            "request_path": request, "request_sha256": sha(b"{}"),
            "runner_path": runner, "runner_sha256": sha(b"#!/bin/sh\n"),
            "runs_dir": home.join("runs")}]}))
        .unwrap(),
    )
    .unwrap();
}

fn check_use_case(home: &Path, bin: &Path, use_case: &str, env: &[(&str, &str)]) -> Output {
    run_with(
        &["stack", "check", home.to_str().unwrap(), use_case],
        bin.to_str().unwrap(),
        env,
    )
}

/// Strips the HOME-specific prefix so reports from different HOMEs compare.
fn normalized(output: &Output, home: &Path) -> String {
    String::from_utf8_lossy(&output.stdout).replace(home.to_str().unwrap(), "HOME")
}

#[cfg(unix)]
#[test]
fn existing_adapter_bindings_never_satisfy_mcp_readiness_and_are_never_read() {
    let home = scratch("legacy-bindings");
    install_baseline(&home);
    let bin = home.join("bin");
    fake_executable(&bin, "termaid");
    fake_executable(&bin, "python3");
    fake_executable(&bin, "npx");

    let fresh = check_use_case(&home, &bin, "tooling-watch", &[]);
    assert_eq!(fresh.status.code(), Some(2));
    let fresh_text = normalized(&fresh, &home);

    // A formerly callable binding for every retired adapter changes nothing.
    for adapter in ["github-tooling", "mcp-registry", "hyperresearch", "monokl"] {
        legacy_binding(&home, adapter);
        for use_case in ["tooling-watch", "deep-research"] {
            let output = check_use_case(&home, &bin, use_case, &[]);
            let expected_code = if use_case == "deep-research" { 0 } else { 2 };
            let expected_state = if use_case == "deep-research" {
                "ready"
            } else {
                "incomplete"
            };
            assert_eq!(
                output.status.code(),
                Some(expected_code),
                "{adapter} {use_case}"
            );
            let report = json_of(&output);
            assert_eq!(report["state"], expected_state);
            assert!(report.get("adapter_registry").is_none());
            let text = String::from_utf8_lossy(&output.stdout);
            assert!(!text.contains("adapters.json"), "{text}");
            assert!(!text.contains("adapter_binding"), "{text}");
            assert!(
                !report["observation_boundary"]["observed"]
                    .as_array()
                    .unwrap()
                    .contains(&json!("mozak_adapter_registry"))
            );
            for tool in report["use_cases"][1]["tools"].as_array().unwrap() {
                assert_eq!(tool["kind"], "mcp_server", "{tool}");
                assert_ne!(tool["state"], "configured", "{tool}");
                assert!(tool["configured"].get("adapter_binding").is_none());
            }
        }
    }
    let bound = check_use_case(&home, &bin, "tooling-watch", &[]);
    // The report never depends on the registry: only HOME-local MOZAK config
    // files were added, which stack check does not read either.
    assert_eq!(normalized(&bound, &home), fresh_text);

    // Malformed registry: identical report, no "invalid registry" status.
    fs::write(home.join(".config/mozak/adapters.json"), b"{not json").unwrap();
    assert_eq!(
        normalized(&check_use_case(&home, &bin, "tooling-watch", &[]), &home),
        fresh_text
    );
    // Symlinked registry pointing outside HOME: identical report.
    let outside = scratch("legacy-bindings-outside");
    fs::write(outside.join("adapters.json"), b"{}").unwrap();
    fs::remove_file(home.join(".config/mozak/adapters.json")).unwrap();
    std::os::unix::fs::symlink(
        outside.join("adapters.json"),
        home.join(".config/mozak/adapters.json"),
    )
    .unwrap();
    assert_eq!(
        normalized(&check_use_case(&home, &bin, "tooling-watch", &[]), &home),
        fresh_text
    );
    // A registry that would block a reader (FIFO) never hangs the check.
    fs::remove_file(home.join(".config/mozak/adapters.json")).unwrap();
    assert!(
        Command::new("mkfifo")
            .arg(home.join(".config/mozak/adapters.json"))
            .status()
            .unwrap()
            .success()
    );
    assert_eq!(
        normalized(&check_use_case(&home, &bin, "tooling-watch", &[]), &home),
        fresh_text
    );
    assert!(!bin.join("python3.executed").exists());
    fs::remove_dir_all(home).unwrap();
    fs::remove_dir_all(outside).unwrap();
}

#[cfg(unix)]
#[test]
fn tooling_watch_is_ready_through_a_configured_mcp_server_only() {
    let home = scratch("tooling-watch");
    install_baseline(&home);
    let bin = home.join("bin");
    fake_executable(&bin, "termaid");
    fake_executable(&bin, "uvx");
    fake_executable(&bin, "docker");
    fs::create_dir_all(home.join(".jcode")).unwrap();

    // Optional GitHub MCP configured without its token stays
    // prerequisite_missing, and cannot stand in for required fetch.
    fs::write(
        home.join(".jcode/mcp.json"),
        r#"{"servers":{"github":{"command":"docker","args":["run","-i","--rm","ghcr.io/github/github-mcp-server"]}}}"#,
    )
    .unwrap();
    let output = check_use_case(&home, &bin, "tooling-watch", &[]);
    assert_eq!(output.status.code(), Some(2));
    let report = json_of(&output);
    let github = tool(&report, "tooling-watch", "github-mcp");
    assert_eq!(github["state"], "prerequisite_missing");
    assert_eq!(github["requirement"], "optional");
    assert_eq!(
        tool(&report, "tooling-watch", "fetch-mcp")["requirement"],
        "required"
    );

    // The token name completes GitHub without leaking a value, but the use
    // case stays incomplete while required fetch is unconfigured.
    fs::write(
        home.join(".jcode/mcp.json"),
        r#"{"servers":{"github":{"command":"docker","args":["run","ghcr.io/github/github-mcp-server"],"env":{"GITHUB_PERSONAL_ACCESS_TOKEN":"sekret-token"}}}}"#,
    )
    .unwrap();
    let output = check_use_case(&home, &bin, "tooling-watch", &[]);
    assert!(!String::from_utf8_lossy(&output.stdout).contains("sekret"));
    assert_eq!(output.status.code(), Some(2), "{}", json_of(&output));
    let report = json_of(&output);
    assert_eq!(report["state"], "incomplete");
    assert_eq!(
        tool(&report, "tooling-watch", "github-mcp")["state"],
        "configured"
    );
    assert!(
        report["next_steps"]
            .as_array()
            .unwrap()
            .iter()
            .any(|s| s["tool_id"] == "fetch-mcp")
    );

    // Fetch MCP alone makes it ready; it needs no credential.
    fs::write(
        home.join(".jcode/mcp.json"),
        r#"{"servers":{"fetch":{"command":"uvx","args":["mcp-server-fetch"]}}}"#,
    )
    .unwrap();
    let output = check_use_case(&home, &bin, "tooling-watch", &[]);
    let report = json_of(&output);
    assert_eq!(output.status.code(), Some(0), "{report}");
    assert_eq!(
        tool(&report, "tooling-watch", "fetch-mcp")["state"],
        "configured"
    );
    assert_ne!(
        tool(&report, "tooling-watch", "github-mcp")["state"],
        "configured"
    );
    assert!(!bin.join("uvx.executed").exists());
    assert!(!bin.join("docker.executed").exists());
    fs::remove_dir_all(home).unwrap();
}

#[cfg(unix)]
#[test]
fn deep_research_has_optional_fetch_not_a_search_readiness_claim() {
    let home = scratch("deep-research");
    install_baseline(&home);
    let bin = home.join("bin");
    fake_executable(&bin, "termaid");
    fake_executable(&bin, "uvx");

    // No MCP search tool or credentials are required. This checks baseline only.
    let output = check_use_case(&home, &bin, "deep-research", &[]);
    assert_eq!(output.status.code(), Some(0));
    let report = json_of(&output);
    assert_eq!(
        tool(&report, "deep-research", "fetch-mcp")["requirement"],
        "optional"
    );
    assert_ne!(
        tool(&report, "deep-research", "fetch-mcp")["state"],
        "configured"
    );
    assert!(
        !String::from_utf8_lossy(&output.stdout)
            .to_lowercase()
            .contains("firecrawl")
    );

    fs::create_dir_all(home.join(".jcode")).unwrap();
    fs::write(
        home.join(".jcode/mcp.json"),
        r#"{"servers":{"fetch":{"command":"uvx","args":["mcp-server-fetch"]}}}"#,
    )
    .unwrap();
    let output = check_use_case(&home, &bin, "deep-research", &[]);
    assert_eq!(output.status.code(), Some(0));
    let report = json_of(&output);
    assert_eq!(
        tool(&report, "deep-research", "fetch-mcp")["state"],
        "configured"
    );
    assert!(!bin.join("uvx.executed").exists());

    let recommendation = run_with(&["stack", "recommend", "deep-research"], "", &[]);
    let text = String::from_utf8_lossy(&recommendation.stdout);
    assert!(!text.to_lowercase().contains("firecrawl"));
    assert!(text.contains("outside this MCP catalog"));
    assert!(text.contains("cannot establish their availability or usability"));
    assert!(text.contains("not search"));
    fs::remove_dir_all(home).unwrap();
}

#[test]
fn explicit_baseline_check_gates_baseline_once() {
    let home = scratch("baseline-once");
    let output = run_with(
        &["stack", "check", home.to_str().unwrap(), "baseline"],
        "",
        &[],
    );
    let report = json_of(&output);
    assert_eq!(report["gating_use_cases"], json!(["baseline"]));
    let ids: Vec<&str> = report["use_cases"]
        .as_array()
        .unwrap()
        .iter()
        .map(|u| u["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, ["baseline"]);
    let steps = report["next_steps"].as_array().unwrap();
    let termaid = steps.iter().filter(|s| s["tool_id"] == "termaid").count();
    assert_eq!(termaid, 1, "{steps:?}");
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
