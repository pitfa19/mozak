//! `mozak research record-tool` and `mozak research verify-tool`.
//!
//! Records one read-only MCP, CLI, skill, or API tool call as a proposal-only
//! research run through the source-neutral `mozak.tool-evidence.v1` contract.
//! MOZAK performs no networking here: the tool already ran, and this route
//! validates the recorded fixture against the exact response bytes it names.
//! Output is create-only, and symlinked inputs, outputs, or ancestors are
//! refused so a recording cannot be redirected or silently replace another.

use mozak_core::research::{OverallClaim, validate_run_json};
use mozak_core::tool_evidence::{
    TOOL_EVIDENCE_ADAPTER_ID, TOOL_EVIDENCE_SCHEMA, parse_fixture, record_tool_evidence,
    verify_tool_evidence,
};
use serde_json::json;
use std::{
    env,
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
};

const MAX_INPUT_BYTES: u64 = 16 * 1024 * 1024;

/// Records a tool-evidence fixture plus its exact response bytes as a new run.
///
/// # Errors
/// Fails closed on symlinked or oversized inputs, an existing or symlinked
/// output, any contract violation, or a write failure.
pub fn record_tool(fixture: &Path, response: &Path, output: &Path) -> Result<(), String> {
    ensure_safe_output(output)?;
    let fixture_text = read_text(fixture, "fixture")?;
    let response_bytes = read_bytes(response, "response")?;
    let run = record_tool_evidence(&fixture_text, &response_bytes).map_err(|e| e.to_string())?;
    let parsed = parse_fixture(&fixture_text).map_err(|e| e.to_string())?;
    let serialized = serde_json::to_string_pretty(&run).map_err(|e| e.to_string())? + "\n";
    // Re-validate the exact bytes about to be written, so what lands on disk
    // is what `research validate` will accept.
    validate_run_json(&serialized).map_err(|e| e.to_string())?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(output)
        .map_err(|error| format!("refusing to write {}: {error}", output.display()))?;
    if let Err(error) = file
        .write_all(serialized.as_bytes())
        .and_then(|()| file.sync_all())
    {
        drop(file);
        let _ = fs::remove_file(output);
        return Err(format!("cannot write {}: {error}", output.display()));
    }
    print_json(&json!({
        "schema_version": 1,
        "command": "research record-tool",
        "schema": TOOL_EVIDENCE_SCHEMA,
        "fixture": fixture.display().to_string(),
        "response": response.display().to_string(),
        "run": output.display().to_string(),
        "state": "recorded",
        "run_id": run.run_id,
        "adapter_id": TOOL_EVIDENCE_ADAPTER_ID,
        "tool_id": parsed.tool.tool_id,
        "tool_version": parsed.tool.version,
        "operation": parsed.tool.operation,
        "response_sha256": parsed.response.sha256,
        "input_hash": run.receipt.input_hash,
        "artifact_hash": run.receipt.artifact_hash,
        "record_count": run.raw_records.len(),
        "evidence_count": run.evidence.len(),
        "gap_count": run.gaps.len(),
        "overall_claim": overall(run.synthesis.overall_claim),
        "accepted": false,
        "authority": "proposal_only",
        "networking": "none"
    }))
}

/// Re-derives a stored run from its fixture and exact response bytes and
/// requires an exact match.
///
/// # Errors
/// Fails closed on symlinked inputs, an invalid stored run, fixture or response
/// drift, or any difference between the stored and re-derived run.
pub fn verify_tool(fixture: &Path, response: &Path, run: &Path) -> Result<(), String> {
    let fixture_text = read_text(fixture, "fixture")?;
    let response_bytes = read_bytes(response, "response")?;
    let stored = validate_run_json(&read_text(run, "run")?).map_err(|e| e.to_string())?;
    verify_tool_evidence(&fixture_text, &response_bytes, &stored).map_err(|e| e.to_string())?;
    print_json(&json!({
        "schema_version": 1,
        "command": "research verify-tool",
        "schema": TOOL_EVIDENCE_SCHEMA,
        "fixture": fixture.display().to_string(),
        "response": response.display().to_string(),
        "run": run.display().to_string(),
        "state": "verified",
        "run_id": stored.run_id,
        "artifact_hash": stored.receipt.artifact_hash,
        "accepted": false,
        "authority": "proposal_only",
        "mutation": "none"
    }))
}

const fn overall(claim: OverallClaim) -> &'static str {
    match claim {
        OverallClaim::Supported => "supported",
        OverallClaim::Qualified => "qualified",
        OverallClaim::Failed => "failed",
    }
}

fn read_bytes(path: &Path, label: &str) -> Result<Vec<u8>, String> {
    reject_symlink_chain(path, label)?;
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("cannot read {label} {}: {error}", path.display()))?;
    if !metadata.file_type().is_file() {
        return Err(format!(
            "{label} must be a regular file: {}",
            path.display()
        ));
    }
    if metadata.len() > MAX_INPUT_BYTES {
        return Err(format!(
            "{label} exceeds the 16 MiB input bound: {}",
            path.display()
        ));
    }
    // The metadata check is advisory; the bound is enforced on the bytes
    // actually read, so a file growing after the check is still refused.
    let mut bytes = Vec::new();
    fs::File::open(path)
        .and_then(|file| file.take(MAX_INPUT_BYTES + 1).read_to_end(&mut bytes))
        .map_err(|error| format!("cannot read {label} {}: {error}", path.display()))?;
    if bytes.len() as u64 > MAX_INPUT_BYTES {
        return Err(format!(
            "{label} exceeds the 16 MiB input bound: {}",
            path.display()
        ));
    }
    Ok(bytes)
}

fn read_text(path: &Path, label: &str) -> Result<String, String> {
    String::from_utf8(read_bytes(path, label)?)
        .map_err(|_| format!("{label} is not UTF-8: {}", path.display()))
}

fn absolute(path: &Path) -> Result<PathBuf, String> {
    if path.is_absolute() {
        Ok(path.to_path_buf())
    } else {
        Ok(env::current_dir()
            .map_err(|error| format!("cannot read current directory: {error}"))?
            .join(path))
    }
}

/// Refuses a path whose final component or any existing ancestor is a symlink.
fn reject_symlink_chain(path: &Path, label: &str) -> Result<(), String> {
    if path.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err(format!(
            "{label} path must not contain '..': {}",
            path.display()
        ));
    }
    let full = absolute(path)?;
    let mut current = PathBuf::new();
    for component in full.components() {
        current.push(component);
        if let Component::Normal(_) = component {
            match fs::symlink_metadata(&current) {
                Ok(metadata) if metadata.file_type().is_symlink() => {
                    return Err(format!(
                        "{label} path must not traverse a symlink: {}",
                        current.display()
                    ));
                }
                Ok(_) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => break,
                Err(error) => {
                    return Err(format!("cannot inspect {}: {error}", current.display()));
                }
            }
        }
    }
    Ok(())
}

fn ensure_safe_output(path: &Path) -> Result<(), String> {
    if fs::symlink_metadata(path).is_ok() {
        return Err(format!(
            "refusing to overwrite existing output: {}",
            path.display()
        ));
    }
    reject_symlink_chain(path, "output")?;
    let parent = absolute(path)?
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| format!("output has no parent directory: {}", path.display()))?;
    if !parent.is_dir() {
        return Err(format!(
            "output parent directory does not exist: {}",
            parent.display()
        ));
    }
    Ok(())
}

fn print_json(value: &serde_json::Value) -> Result<(), String> {
    println!(
        "{}",
        serde_json::to_string(value).map_err(|error| error.to_string())?
    );
    Ok(())
}
