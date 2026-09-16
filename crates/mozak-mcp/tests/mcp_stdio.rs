use serde_json::{Value, json};
use std::{
    fs,
    io::Write,
    os::unix::fs::PermissionsExt,
    process::{Command, Stdio},
    sync::atomic::{AtomicU64, Ordering},
};

static NEXT: AtomicU64 = AtomicU64::new(0);

fn run(lines: &[Value]) -> Vec<Value> {
    let mut child = Command::new(env!("CARGO_BIN_EXE_mozak-mcp"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    {
        let input = child.stdin.as_mut().unwrap();
        for line in lines {
            writeln!(input, "{line}").unwrap();
        }
    }
    let output = child.wait_with_output().unwrap();
    assert!(output.status.success());
    String::from_utf8(output.stdout)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect()
}

#[test]
fn initializes_lists_closed_tools_and_ignores_notifications() {
    let values = run(&[
        json!({"jsonrpc":"2.0","method":"notifications/initialized"}),
        json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}),
        json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}),
    ]);
    assert_eq!(values.len(), 2);
    assert_eq!(values[0]["result"]["serverInfo"]["name"], "mozak-mcp");
    let names = values[1]["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|tool| tool["name"].as_str().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(
        names,
        [
            "project_context",
            "project_overview",
            "project_validate",
            "kb_tree",
            "kb_concept_candidates",
            "kb_concept_translation_packet",
            "planning_next"
        ]
    );
    let kb_tree = values[1]["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .find(|tool| tool["name"] == "kb_tree")
        .unwrap();
    for name in ["concept", "project", "topic"] {
        assert_eq!(
            kb_tree["inputSchema"]["properties"][name]["type"],
            "boolean"
        );
    }
}

#[test]
fn malformed_and_unknown_requests_fail_without_stopping_server() {
    let mut child = Command::new(env!("CARGO_BIN_EXE_mozak-mcp"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    {
        let input = child.stdin.as_mut().unwrap();
        writeln!(input, "not-json").unwrap();
        writeln!(input, "{}", json!({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"missing","arguments":{}}})).unwrap();
        writeln!(input, "{}", json!({"jsonrpc":"2.0","id":3,"method":"ping"})).unwrap();
        writeln!(input, "{}", json!({"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"kb_tree","arguments":{"concept":"yes"}}})).unwrap();
        writeln!(input, "{}", json!({"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"kb_concept_candidates","arguments":{"target_scope_id":"target","research_runs":"not-an-array"}}})).unwrap();
    }
    let output = child.wait_with_output().unwrap();
    let values: Vec<Value> = String::from_utf8(output.stdout)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(values[0]["error"]["code"], -32700);
    assert_eq!(values[1]["error"]["code"], -32602);
    assert_eq!(values[2]["result"], json!({}));
    assert_eq!(values[3]["error"]["code"], -32602);
    assert_eq!(
        values[3]["error"]["message"],
        "concept must be a boolean when supplied"
    );
    assert_eq!(values[4]["error"]["code"], -32602);
    assert_eq!(
        values[4]["error"]["message"],
        "research_runs must be an array when supplied"
    );
}

#[test]
fn project_validate_matches_cli_output() {
    let root = env!("CARGO_MANIFEST_DIR")
        .strip_suffix("/crates/mozak-mcp")
        .unwrap();
    let cli_path = std::path::Path::new(root).join("target/debug/mozak");
    if !cli_path.is_file() {
        let status = Command::new("cargo")
            .args(["build", "-p", "mozak-cli"])
            .current_dir(root)
            .status()
            .unwrap();
        assert!(status.success());
    }
    let cli = Command::new(&cli_path)
        .args(["project", "validate", root])
        .output()
        .unwrap();
    assert!(cli.status.success());
    let cli_text = String::from_utf8(cli.stdout).unwrap().trim_end().to_owned();
    let mut child = Command::new(env!("CARGO_BIN_EXE_mozak-mcp"))
        .env("MOZAK_CLI", &cli_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    writeln!(
        child.stdin.as_mut().unwrap(),
        "{}",
        json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"project_validate","arguments":{"project_root":root}}})
    )
    .unwrap();
    drop(child.stdin.take());
    let output = child.wait_with_output().unwrap();
    let result: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(result["result"]["structuredContent"]["output"], cli_text);
}

#[test]
fn project_context_uses_the_exact_cli_behavior() {
    let temp = std::env::temp_dir().join(format!(
        "mozak-mcp-context-parity-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir_all(&temp).unwrap();
    let cli = temp.join("mozak");
    let argv = temp.join("argv");
    fs::write(
        &cli,
        format!(
            "#!/bin/sh\nprintf '%s\\n' \"$*\" > '{}'\nprintf '%s\\n' '{{\"reconciliation\":{{\"performed\":true}},\"config\":{{\"sha256\":\"new\"}}}}'\n",
            argv.display()
        ),
    )
    .unwrap();
    let mut permissions = fs::metadata(&cli).unwrap().permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&cli, permissions).unwrap();

    let mut child = Command::new(env!("CARGO_BIN_EXE_mozak-mcp"))
        .env("MOZAK_CLI", &cli)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    writeln!(
        child.stdin.as_mut().unwrap(),
        "{}",
        json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"project_context","arguments":{"project_id":"exact-id"}}})
    )
    .unwrap();
    drop(child.stdin.take());
    let output = child.wait_with_output().unwrap();
    assert!(output.status.success());
    let result: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(
        fs::read_to_string(&argv).unwrap(),
        "project context exact-id\n"
    );
    assert_eq!(
        result["result"]["structuredContent"]["output"],
        "{\"reconciliation\":{\"performed\":true},\"config\":{\"sha256\":\"new\"}}"
    );
    fs::remove_dir_all(temp).unwrap();
}

#[test]
fn meta_transfer_tools_delegate_exact_read_only_cli_arguments() {
    let temp = std::env::temp_dir().join(format!(
        "mozak-mcp-meta-transfer-parity-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir_all(&temp).unwrap();
    let cli = temp.join("mozak");
    let argv = temp.join("argv");
    fs::write(
        &cli,
        format!(
            "#!/bin/sh\nprintf '%s\\n' \"$*\" >> '{}'\nprintf '%s\\n' '{{\"mutation\":false}}'\n",
            argv.display()
        ),
    )
    .unwrap();
    let mut permissions = fs::metadata(&cli).unwrap().permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&cli, permissions).unwrap();

    let hash = "a".repeat(64);
    let mut child = Command::new(env!("CARGO_BIN_EXE_mozak-mcp"))
        .env("MOZAK_CLI", &cli)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    writeln!(
        child.stdin.as_mut().unwrap(),
        "{}",
        json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"kb_concept_candidates","arguments":{"target_scope_id":"genome-mcp","research_runs":["/runs/one.json","/runs/two.json"]}}})
    )
    .unwrap();
    writeln!(
        child.stdin.as_mut().unwrap(),
        "{}",
        json!({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"kb_concept_translation_packet","arguments":{"target_scope_id":"genome-mcp","concept_id":"concept-one","concept_sha256":hash}}})
    )
    .unwrap();
    drop(child.stdin.take());
    let output = child.wait_with_output().unwrap();
    assert!(output.status.success());
    assert_eq!(
        fs::read_to_string(&argv).unwrap(),
        format!(
            "kb concept candidates genome-mcp /runs/one.json /runs/two.json\nkb concept translation-packet genome-mcp concept-one {hash}\n"
        )
    );
    let results = String::from_utf8(output.stdout)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str::<Value>(line).unwrap())
        .collect::<Vec<_>>();
    assert_eq!(results.len(), 2);
    assert_eq!(results[0]["result"]["isError"], false);
    assert_eq!(results[1]["result"]["isError"], false);
    fs::remove_dir_all(temp).unwrap();
}
