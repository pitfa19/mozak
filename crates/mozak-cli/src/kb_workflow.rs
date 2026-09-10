use mozak_core::kb::{
    TreeFilter, ValidatedKb, assess_parity, graph_source, load_parity_observations, load_registry,
    render_list, render_tree, render_tree_with_filters,
};
use mozak_core::package_import::import_package;
use serde::Serialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    env, fs,
    io::Write,
    path::Path,
    process::{Command, ExitCode, Stdio},
};

/// Renders a rootless or explicit KB tree with optional combinable type filters.
pub fn tree(args: &[String]) -> Result<ExitCode, String> {
    let mut root = None;
    let mut filters = BTreeSet::new();
    for argument in args {
        match argument.as_str() {
            "--concept" => {
                filters.insert(TreeFilter::Concept);
            }
            "--project" => {
                filters.insert(TreeFilter::Project);
            }
            "--topic" => {
                filters.insert(TreeFilter::Topic);
            }
            value if value.starts_with('-') => {
                return Err(format!(
                    "unknown kb tree filter: {value}\n{}",
                    crate::usage()
                ));
            }
            value if root.is_none() => root = Some(value),
            _ => return Err(crate::usage()),
        }
    }
    let configured;
    let root = if let Some(root) = root {
        Path::new(root)
    } else {
        configured = crate::project_registry::configured_kb_root()?;
        &configured
    };
    let kb = load_registry(root).map_err(|error| error.to_string())?;
    print!("{}", render_tree_with_filters(&kb, &filters));
    Ok(ExitCode::SUCCESS)
}

#[derive(Serialize)]
struct Validation<'a> {
    schema_version: u64,
    command: &'static str,
    validity: &'static str,
    authority: &'static str,
    auto_discovery: bool,
    registry_root: &'a str,
    registry_sha256: &'a str,
    registration_count: usize,
    scope_count: usize,
    meta_goal_count: usize,
    input_count: usize,
    package_count: usize,
}

pub fn run(command: &str, root: &Path) -> Result<ExitCode, String> {
    let kb = load_registry(root).map_err(|error| error.to_string())?;
    match command {
        "validate" => validate(&kb),
        "list" => {
            print!("{}", render_list(&kb));
            Ok(ExitCode::SUCCESS)
        }
        "tree" => {
            print!("{}", render_tree(&kb));
            Ok(ExitCode::SUCCESS)
        }
        "graph-source" => {
            print!("{}", graph_source(&kb));
            Ok(ExitCode::SUCCESS)
        }
        "graph" => graph(&kb),
        _ => Err(crate::usage()),
    }
}

/// Registers an existing Scope root in the KB registry.
///
/// The route is additive and create-only. It records where a Scope lives and
/// pins the exact manifest hash observed at registration. Registration is a
/// local index entry: it never grants trust, authority, or truth to the Scope.
///
/// # Errors
/// Returns an error when the Scope is invalid, when the id or root is already
/// registered, or when the registry cannot be read or written.
pub fn register(registry_root: &Path, id: &str, scope_root: &Path) -> Result<ExitCode, String> {
    let scope_root = scope_root
        .canonicalize()
        .map_err(|error| format!("cannot resolve Scope root: {error}"))?;

    // The Scope must already be valid on its own before it can be indexed.
    let manifest_path = scope_root.join("scope.json");
    let manifest_bytes = fs::read(&manifest_path)
        .map_err(|error| format!("cannot read {}: {error}", manifest_path.display()))?;
    mozak_core::scope::load_scopes(&scope_root)
        .map_err(|error| format!("refusing to register an invalid Scope: {error}"))?;

    let registry_path = registry_root.join("kb.json");
    let mut registry: serde_json::Value = if registry_path.exists() {
        serde_json::from_slice(
            &fs::read(&registry_path)
                .map_err(|error| format!("cannot read {}: {error}", registry_path.display()))?,
        )
        .map_err(|error| format!("invalid {}: {error}", registry_path.display()))?
    } else {
        json!({ "schema_version": 1, "registrations": [] })
    };

    let entries = registry["registrations"]
        .as_array_mut()
        .ok_or_else(|| "invalid KB registry: registrations must be an array".to_owned())?;
    let root_text = scope_root.display().to_string();
    for entry in entries.iter() {
        if entry["id"] == id {
            return Err(format!(
                "refusing to replace an existing registration: {id}"
            ));
        }
        if entry["path"] == root_text.as_str() {
            return Err(format!(
                "Scope root is already registered as {}",
                entry["id"].as_str().unwrap_or("?")
            ));
        }
    }
    let observed = format!("{:x}", Sha256::digest(&manifest_bytes));
    entries.push(json!({
        "id": id,
        "path": root_text,
        "scope_manifest_sha256": observed,
    }));
    entries.sort_by(|a, b| {
        a["id"]
            .as_str()
            .unwrap_or("")
            .cmp(b["id"].as_str().unwrap_or(""))
    });

    fs::create_dir_all(registry_root)
        .map_err(|error| format!("cannot create {}: {error}", registry_root.display()))?;
    let serialized = serde_json::to_string_pretty(&registry).map_err(|e| e.to_string())?;
    fs::write(&registry_path, serialized + "\n")
        .map_err(|error| format!("cannot write {}: {error}", registry_path.display()))?;

    // Validate the registry that was just written, so register never leaves it broken.
    let kb = load_registry(registry_root).map_err(|error| error.to_string())?;
    println!(
        "{}",
        serde_json::to_string(&json!({
            "schema_version": 1,
            "command": "kb register",
            "registry_root": registry_root.display().to_string(),
            "registration_id": id,
            "scope_root": root_text,
            "scope_manifest_sha256": observed,
            "registration_count": kb.registry.registrations.len(),
            "state": "valid",
            "authority": "registration records a location only; it transfers no trust or truth",
        }))
        .map_err(|e| e.to_string())?
    );
    Ok(ExitCode::SUCCESS)
}

/// Re-pins a registration to the Scope manifest as it exists now.
///
/// Editing a registered Scope is legitimate, so the registry needs a way to
/// record the new hash. This is an update route, not a discovery route: the
/// registration and the Scope root must already match, only the pin moves, and
/// the Scope must be valid before its hash is accepted.
///
/// # Errors
/// Returns an error when the registration is unknown, when the recorded root
/// does not match the Scope root given, when the Scope is invalid, or when the
/// registry cannot be read or written.
pub fn repin(registry_root: &Path, id: &str, scope_root: &Path) -> Result<ExitCode, String> {
    let scope_root = scope_root
        .canonicalize()
        .map_err(|error| format!("cannot resolve Scope root: {error}"))?;
    let manifest_path = scope_root.join("scope.json");
    let manifest_bytes = fs::read(&manifest_path)
        .map_err(|error| format!("cannot read {}: {error}", manifest_path.display()))?;
    mozak_core::scope::load_scopes(&scope_root)
        .map_err(|error| format!("refusing to pin an invalid Scope: {error}"))?;

    let registry_path = registry_root.join("kb.json");
    let mut registry: serde_json::Value = serde_json::from_slice(
        &fs::read(&registry_path)
            .map_err(|error| format!("cannot read {}: {error}", registry_path.display()))?,
    )
    .map_err(|error| format!("invalid {}: {error}", registry_path.display()))?;

    let root_text = scope_root.display().to_string();
    let observed = format!("{:x}", Sha256::digest(&manifest_bytes));
    let entries = registry["registrations"]
        .as_array_mut()
        .ok_or_else(|| "invalid KB registry: registrations must be an array".to_owned())?;
    let entry = entries
        .iter_mut()
        .find(|entry| entry["id"] == id)
        .ok_or_else(|| format!("unknown registration: {id}"))?;
    // Re-pinning must never silently move a registration to a different Scope.
    if entry["path"] != root_text.as_str() {
        return Err(format!(
            "registration {id} records a different Scope root: {}",
            entry["path"].as_str().unwrap_or("?")
        ));
    }
    let previous = entry["scope_manifest_sha256"]
        .as_str()
        .unwrap_or_default()
        .to_owned();
    if previous == observed {
        return Err(format!("registration {id} is already current"));
    }
    entry["scope_manifest_sha256"] = serde_json::Value::String(observed.clone());

    let serialized = serde_json::to_string_pretty(&registry).map_err(|e| e.to_string())?;
    fs::write(&registry_path, serialized + "\n")
        .map_err(|error| format!("cannot write {}: {error}", registry_path.display()))?;

    let kb = load_registry(registry_root).map_err(|error| error.to_string())?;
    println!(
        "{}",
        serde_json::to_string(&json!({
            "schema_version": 1,
            "command": "kb repin",
            "registry_root": registry_root.display().to_string(),
            "registration_id": id,
            "scope_root": root_text,
            "previous_sha256": previous,
            "scope_manifest_sha256": observed,
            "registration_count": kb.registry.registrations.len(),
            "state": "valid",
            "authority": "re-pinning records an observed hash only; it accepts no content and transfers no trust",
        }))
        .map_err(|e| e.to_string())?
    );
    Ok(ExitCode::SUCCESS)
}

pub fn run_current(command: &str) -> Result<ExitCode, String> {
    if !matches!(
        command,
        "validate" | "list" | "tree" | "graph-source" | "graph"
    ) {
        return Err(crate::usage());
    }
    let root = crate::project_registry::configured_kb_root()?;
    run(command, &root)
}

pub fn parity(root: &Path, observations: &Path) -> Result<ExitCode, String> {
    let kb = load_registry(root).map_err(|error| error.to_string())?;
    let observations =
        load_parity_observations(observations, &kb).map_err(|error| error.to_string())?;
    let assessment = assess_parity(&kb, &observations);
    println!(
        "{}",
        serde_json::to_string(&assessment).map_err(|error| error.to_string())?
    );
    if assessment.parity {
        Ok(ExitCode::SUCCESS)
    } else {
        Ok(ExitCode::from(2))
    }
}

fn validate(kb: &ValidatedKb) -> Result<ExitCode, String> {
    let root = kb.registry_root.to_string_lossy();
    let scope_count = kb
        .entries
        .iter()
        .map(|entry| entry.scopes.manifest.scopes.len())
        .sum();
    let meta_goal_count = kb
        .entries
        .iter()
        .map(|entry| entry.scopes.manifest.meta_goals.len())
        .sum();
    let input_count = kb
        .entries
        .iter()
        .map(|entry| entry.scopes.manifest.inputs.len())
        .sum();
    println!(
        "{}",
        serde_json::to_string(&Validation {
            schema_version: 1,
            command: "kb validate",
            validity: "registry_valid",
            authority: "registered_sources_remain_authoritative",
            auto_discovery: false,
            registry_root: &root,
            registry_sha256: &kb.registry_sha256,
            registration_count: kb.entries.len(),
            scope_count,
            meta_goal_count,
            input_count,
            package_count: kb.packages.len(),
        })
        .map_err(|error| error.to_string())?
    );
    Ok(ExitCode::SUCCESS)
}

pub fn import(
    source_package: &Path,
    input_registry: &Path,
    approval: &Path,
    output: &Path,
) -> Result<ExitCode, String> {
    let receipt = import_package(source_package, input_registry, approval, output)?;
    println!(
        "{}",
        serde_json::to_string(&receipt).map_err(|e| e.to_string())?
    );
    Ok(ExitCode::SUCCESS)
}

fn graph(kb: &ValidatedKb) -> Result<ExitCode, String> {
    let source = graph_source(kb);
    let executable = env::var("MOZAK_TERMAID").unwrap_or_else(|_| "termaid".into());
    let mut child = Command::new(&executable)
        .stdin(Stdio::piped())
        .stdout(Stdio::inherit())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("cannot run Termaid executable {executable:?}: {error}"))?;
    // A Termaid that fails immediately can close stdin before the source is
    // written. Reporting that broken pipe would hide the child's real error,
    // so the write failure is held and only surfaces if the child succeeded
    // anyway, which would mean the source never arrived.
    let write_failed = child
        .stdin
        .take()
        .ok_or_else(|| "cannot open Termaid stdin".to_owned())?
        .write_all(source.as_bytes())
        .err();
    let output = child
        .wait_with_output()
        .map_err(|error| format!("cannot wait for Termaid: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "Termaid failed with {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    if let Some(error) = write_failed {
        return Err(format!("cannot write Termaid stdin: {error}"));
    }
    Ok(ExitCode::SUCCESS)
}
