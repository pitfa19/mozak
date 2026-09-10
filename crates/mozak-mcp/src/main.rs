use serde_json::{Value, json};
use std::{
    env,
    io::{self, BufRead, Write},
    path::PathBuf,
    process::Command,
};

const PROTOCOL_VERSION: &str = "2025-06-18";

fn tool(name: &str, description: &str, properties: &Value, required: &[&str]) -> Value {
    json!({
        "name": name,
        "description": description,
        "inputSchema": {
            "type": "object",
            "properties": properties,
            "required": required,
            "additionalProperties": false
        }
    })
}

fn tools() -> Vec<Value> {
    vec![
        tool(
            "project_context",
            "Resolve one exact registered project ID to validated bounded context.",
            &json!({"project_id":{"type":"string","minLength":1}}),
            &["project_id"],
        ),
        tool(
            "project_overview",
            "Inspect the validated workflow overview for one explicit project root.",
            &json!({"project_root":{"type":"string","minLength":1}}),
            &["project_root"],
        ),
        tool(
            "project_validate",
            "Validate one explicit MOZAK project root.",
            &json!({"project_root":{"type":"string","minLength":1}}),
            &["project_root"],
        ),
        tool(
            "kb_tree",
            "Render the configured or explicit KB tree, optionally filtered to any combination of Concepts, Projects, and Topics.",
            &json!({
                "registry_root":{"type":"string","minLength":1},
                "concept":{"type":"boolean"},
                "project":{"type":"boolean"},
                "topic":{"type":"boolean"}
            }),
            &[],
        ),
        tool(
            "planning_next",
            "Recommend the next goal from explicit accepted-input and plan files without accepting it.",
            &json!({"accepted_inputs":{"type":"string","minLength":1},"plan":{"type":"string","minLength":1}}),
            &["accepted_inputs", "plan"],
        ),
    ]
}

fn mozak_binary() -> PathBuf {
    if let Ok(path) = env::var("MOZAK_CLI") {
        return PathBuf::from(path);
    }
    if let Ok(current) = env::current_exe()
        && let Some(parent) = current.parent()
    {
        let sibling = parent.join("mozak");
        if sibling.is_file() {
            return sibling;
        }
    }
    PathBuf::from("mozak")
}

fn string_arg<'a>(arguments: &'a Value, key: &str) -> Result<&'a str, String> {
    arguments
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("{key} must be a non-empty string"))
}

fn optional_bool(arguments: &Value, key: &str) -> Result<bool, String> {
    match arguments.get(key) {
        None | Some(Value::Null | Value::Bool(false)) => Ok(false),
        Some(Value::Bool(true)) => Ok(true),
        Some(_) => Err(format!("{key} must be a boolean when supplied")),
    }
}

fn argv(name: &str, arguments: &Value) -> Result<Vec<String>, String> {
    let value = match name {
        "project_context" => vec![
            "project".into(),
            "context".into(),
            string_arg(arguments, "project_id")?.into(),
        ],
        "project_overview" => vec![
            "project".into(),
            "overview".into(),
            string_arg(arguments, "project_root")?.into(),
        ],
        "project_validate" => vec![
            "project".into(),
            "validate".into(),
            string_arg(arguments, "project_root")?.into(),
        ],
        "kb_tree" => {
            let mut args = vec!["kb".into(), "tree".into()];
            match arguments.get("registry_root") {
                None | Some(Value::Null) => {}
                Some(Value::String(root)) if !root.is_empty() => args.push(root.clone()),
                _ => return Err("registry_root must be a non-empty string when supplied".into()),
            }
            for (key, flag) in [
                ("concept", "--concept"),
                ("project", "--project"),
                ("topic", "--topic"),
            ] {
                if optional_bool(arguments, key)? {
                    args.push(flag.into());
                }
            }
            args
        }
        "planning_next" => vec![
            "planning".into(),
            "next".into(),
            string_arg(arguments, "accepted_inputs")?.into(),
            string_arg(arguments, "plan")?.into(),
        ],
        _ => return Err(format!("unknown tool: {name}")),
    };
    Ok(value)
}

fn call_tool(params: &Value) -> Result<Value, String> {
    let name = params
        .get("name")
        .and_then(Value::as_str)
        .ok_or("tool name must be a string")?;
    let arguments = params
        .get("arguments")
        .cloned()
        .unwrap_or_else(|| json!({}));
    if !arguments.is_object() {
        return Err("tool arguments must be an object".into());
    }
    let args = argv(name, &arguments)?;
    let output = Command::new(mozak_binary())
        .args(&args)
        .output()
        .map_err(|error| format!("cannot run mozak CLI: {error}"))?;
    let stdout = String::from_utf8(output.stdout).map_err(|_| "mozak emitted non-UTF-8 stdout")?;
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
    if !output.status.success() {
        return Ok(
            json!({"content":[{"type":"text","text":if stderr.is_empty(){stdout.trim()}else{&stderr}}],"isError":true}),
        );
    }
    let text = stdout.trim_end();
    Ok(
        json!({"content":[{"type":"text","text":text}],"structuredContent":{"output":text},"isError":false}),
    )
}

fn response(request: &Value) -> Option<Value> {
    let id = request.get("id")?.clone();
    if request.get("jsonrpc") != Some(&Value::String("2.0".into())) {
        return Some(
            json!({"jsonrpc":"2.0","id":id,"error":{"code":-32600,"message":"invalid JSON-RPC request"}}),
        );
    }
    let method = request.get("method").and_then(Value::as_str);
    let result = match method {
        Some("initialize") => Ok(
            json!({"protocolVersion":PROTOCOL_VERSION,"capabilities":{"tools":{"listChanged":false}},"serverInfo":{"name":"mozak-mcp","version":env!("CARGO_PKG_VERSION")}}),
        ),
        Some("ping") => Ok(json!({})),
        Some("tools/list") => Ok(json!({"tools":tools()})),
        Some("tools/call") => call_tool(request.get("params").unwrap_or(&Value::Null)),
        Some(_) => {
            return Some(
                json!({"jsonrpc":"2.0","id":id,"error":{"code":-32601,"message":"method not found"}}),
            );
        }
        None => {
            return Some(
                json!({"jsonrpc":"2.0","id":id,"error":{"code":-32600,"message":"method must be a string"}}),
            );
        }
    };
    Some(match result {
        Ok(value) => json!({"jsonrpc":"2.0","id":id,"result":value}),
        Err(message) => json!({"jsonrpc":"2.0","id":id,"error":{"code":-32602,"message":message}}),
    })
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let stdin = io::stdin();
    let mut stdout = io::stdout().lock();
    for line in stdin.lock().lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let parsed: Value = if let Ok(value) = serde_json::from_str(&line) {
            value
        } else {
            serde_json::to_writer(
                &mut stdout,
                &json!({"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"parse error"}}),
            )?;
            writeln!(stdout)?;
            stdout.flush()?;
            continue;
        };
        if parsed.get("id").is_none() {
            continue;
        }
        if let Some(value) = response(&parsed) {
            serde_json::to_writer(&mut stdout, &value)?;
            writeln!(stdout)?;
            stdout.flush()?;
        }
    }
    Ok(())
}
