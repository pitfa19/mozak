use serde_json::{Value, json};
use std::{
    io::Write,
    process::{Command, Stdio},
};

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
            "planning_next"
        ]
    );
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
