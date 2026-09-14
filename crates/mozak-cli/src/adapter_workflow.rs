use mozak_core::kb::load_registry;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    env, fs,
    path::{Path, PathBuf},
    process::{Command, ExitCode},
};

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct AdapterRegistry {
    schema_version: u32,
    bindings: Vec<AdapterBinding>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct AdapterBinding {
    id: String,
    adapter: String,
    target_scope_id: String,
    request_path: String,
    request_sha256: String,
    runner_path: String,
    runner_sha256: String,
    runs_dir: String,
}

pub fn run(args: &[String]) -> Result<ExitCode, String> {
    match args
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>()
        .as_slice()
    {
        ["catalog"] => catalog(),
        ["list"] => list(&registry_path()?),
        ["show", id] => show(&registry_path()?, id),
        ["run", id] => invoke(&registry_path()?, id),
        ["recheck", id] => recheck(&registry_path()?, id),
        ["setup", adapter, id, scope_id, request, runner, runs_dir] => setup(
            &registry_path()?,
            adapter,
            id,
            scope_id,
            Path::new(request),
            Path::new(runner),
            Path::new(runs_dir),
        ),
        _ => Err(crate::usage()),
    }
}

fn catalog() -> Result<ExitCode, String> {
    print_json(&json!({
        "schema_version": 1,
        "command": "adapter catalog",
        "adapters": [
            {
                "id": "dair-ai",
                "kind": "optional_external_integration",
                "capability": "curated_paper_metadata",
                "setup_supported": true,
                "normalizer": "research normalize dair-ai"
            },
            {
                "id": "mcp-registry",
                "kind": "optional_external_integration",
                "capability": "tool_release_metadata",
                "setup_supported": true,
                "normalizer": "research normalize mcp-registry"
            },
            {
                "id": "github-tooling",
                "kind": "optional_external_integration",
                "capability": "repository_release_metadata",
                "setup_supported": true,
                "modes": ["discover", "watch"],
                "normalizer": "research normalize github-tooling"
            },
            {
                "id": "hyperresearch",
                "kind": "optional_external_integration",
                "capability": "external_research_vault_snapshot",
                "setup_supported": true,
                "normalizer": "research normalize hyperresearch"
            },
            {
                "id": "arxiv",
                "kind": "optional_external_integration",
                "capability": "broad_paper_metadata_search",
                "setup_supported": false,
                "normalizer": "research normalize arxiv"
            }
        ]
    }))?;
    Ok(ExitCode::SUCCESS)
}

fn setup(
    path: &Path,
    adapter: &str,
    id: &str,
    scope_id: &str,
    request: &Path,
    runner: &Path,
    runs_dir: &Path,
) -> Result<ExitCode, String> {
    if !matches!(
        adapter,
        "dair-ai" | "mcp-registry" | "github-tooling" | "hyperresearch"
    ) {
        return Err(
            "adapter setup currently supports dair-ai, mcp-registry, github-tooling and hyperresearch only"
                .into(),
        );
    }
    validate_id(id, "binding id")?;
    validate_id(scope_id, "target scope id")?;
    validate_registered_scope(scope_id)?;
    let request = canonical_file(request, "request")?;
    let runner = canonical_file(runner, "runner")?;
    let request_bytes = fs::read(&request).map_err(|error| error.to_string())?;
    let request_json: serde_json::Value = serde_json::from_slice(&request_bytes)
        .map_err(|error| format!("invalid adapter request: {error}"))?;
    if request_json
        .get("scope_id")
        .and_then(|value| value.as_str())
        != Some(scope_id)
    {
        return Err("adapter request scope_id does not match the target Scope".into());
    }
    let runner_bytes = fs::read(&runner).map_err(|error| error.to_string())?;
    let runs_dir = absolute(runs_dir)?;
    let mut registry = if path.exists() {
        load(path)?
    } else {
        AdapterRegistry {
            schema_version: 1,
            bindings: Vec::new(),
        }
    };
    if registry.bindings.iter().any(|binding| binding.id == id) {
        return Err(format!("adapter binding already exists: {id}"));
    }
    registry.bindings.push(AdapterBinding {
        id: id.into(),
        adapter: adapter.into(),
        target_scope_id: scope_id.into(),
        request_path: display(&request)?,
        request_sha256: hash(&request_bytes),
        runner_path: display(&runner)?,
        runner_sha256: hash(&runner_bytes),
        runs_dir: display(&runs_dir)?,
    });
    registry
        .bindings
        .sort_by(|left, right| left.id.cmp(&right.id));
    write_atomic(path, &registry)?;
    print_json(&json!({
        "schema_version": 1,
        "command": "adapter setup",
        "binding_id": id,
        "adapter": adapter,
        "target_scope_id": scope_id,
        "registry": display(path)?,
        "authority": "owner_configured_callable",
        "automatic_promotion": false
    }))?;
    Ok(ExitCode::SUCCESS)
}

fn list(path: &Path) -> Result<ExitCode, String> {
    let registry = if path.exists() {
        load(path)?
    } else {
        AdapterRegistry {
            schema_version: 1,
            bindings: Vec::new(),
        }
    };
    let bindings = registry
        .bindings
        .iter()
        .map(binding_view)
        .collect::<Vec<_>>();
    print_json(&json!({
        "schema_version": 1,
        "command": "adapter list",
        "registry": display(path)?,
        "bindings": bindings
    }))?;
    Ok(ExitCode::SUCCESS)
}

fn show(path: &Path, id: &str) -> Result<ExitCode, String> {
    let registry = load(path)?;
    let binding = find(&registry, id)?;
    print_json(&json!({
        "schema_version": 1,
        "command": "adapter show",
        "registry": display(path)?,
        "binding": binding_view(binding)
    }))?;
    Ok(ExitCode::SUCCESS)
}

fn invoke(path: &Path, id: &str) -> Result<ExitCode, String> {
    let registry = load(path)?;
    let binding = find(&registry, id)?;
    verify_pin(&binding.request_path, &binding.request_sha256, "request")?;
    verify_pin(&binding.runner_path, &binding.runner_sha256, "runner")?;
    let current = env::current_exe().map_err(|error| error.to_string())?;
    let status = Command::new(&binding.runner_path)
        .arg(&binding.request_path)
        .arg(&binding.runs_dir)
        .env("MOZAK", current)
        .status()
        .map_err(|error| format!("cannot run adapter {}: {error}", binding.id))?;
    if !status.success() {
        return Err(format!("adapter {} failed with {status}", binding.id));
    }
    Ok(ExitCode::SUCCESS)
}

fn registry_path() -> Result<PathBuf, String> {
    let base = env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")))
        .ok_or("HOME or XDG_CONFIG_HOME is required")?;
    Ok(base.join("mozak/adapters.json"))
}

fn load(path: &Path) -> Result<AdapterRegistry, String> {
    let input = fs::read_to_string(path)
        .map_err(|error| format!("cannot read adapter registry {}: {error}", path.display()))?;
    let registry: AdapterRegistry = serde_json::from_str(&input)
        .map_err(|error| format!("invalid adapter registry: {error}"))?;
    if registry.schema_version != 1 {
        return Err("adapter registry schema_version must be 1".into());
    }
    let mut ids = std::collections::BTreeSet::new();
    for binding in &registry.bindings {
        validate_id(&binding.id, "binding id")?;
        validate_id(&binding.target_scope_id, "target scope id")?;
        if !matches!(
            binding.adapter.as_str(),
            "dair-ai" | "mcp-registry" | "github-tooling" | "hyperresearch"
        ) {
            return Err(format!(
                "unsupported configured adapter: {}",
                binding.adapter
            ));
        }
        for (value, label) in [
            (&binding.request_sha256, "request hash"),
            (&binding.runner_sha256, "runner hash"),
        ] {
            if value.len() != 64
                || !value
                    .bytes()
                    .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
            {
                return Err(format!(
                    "{label} must be 64 lowercase hexadecimal characters"
                ));
            }
        }
        if !Path::new(&binding.request_path).is_absolute()
            || !Path::new(&binding.runner_path).is_absolute()
            || !Path::new(&binding.runs_dir).is_absolute()
        {
            return Err("adapter binding paths must be absolute".into());
        }
        if !ids.insert(binding.id.as_str()) {
            return Err(format!("duplicate adapter binding: {}", binding.id));
        }
    }
    Ok(registry)
}

fn find<'a>(registry: &'a AdapterRegistry, id: &str) -> Result<&'a AdapterBinding, String> {
    registry
        .bindings
        .iter()
        .find(|binding| binding.id == id)
        .ok_or_else(|| format!("unknown adapter binding: {id}"))
}

/// Re-pins a drifted binding after the owner changed a pinned file.
///
/// Editing a pinned request or runner invalidates its recorded hash, and the
/// binding stops being callable with no supported way back. This mirrors the
/// dead end `kb repin` already resolved for a registered Scope: the route
/// records an observed hash only. It accepts no content, transfers no trust,
/// and re-states the adapter's declared effects so a recheck is never mistaken
/// for fresh approval of what the adapter does.
fn recheck(path: &Path, id: &str) -> Result<ExitCode, String> {
    let mut registry = load(path)?;
    let (request_sha256, runner_sha256, adapter, scope_id, changed) = {
        let binding = find(&registry, id)?;
        if drifted_pins(binding).is_empty() {
            return Err(format!("adapter binding {id} is already current"));
        }
        // The target Scope must still exist, or re-pinning would restore a
        // binding that cannot deliver its output anywhere.
        validate_registered_scope(&binding.target_scope_id)?;
        let request_bytes = read_pinned(&binding.request_path, "request")?;
        let runner_bytes = read_pinned(&binding.runner_path, "runner")?;
        let request_json: serde_json::Value = serde_json::from_slice(&request_bytes)
            .map_err(|error| format!("invalid adapter request: {error}"))?;
        if request_json
            .get("scope_id")
            .and_then(serde_json::Value::as_str)
            != Some(binding.target_scope_id.as_str())
        {
            return Err("edited request scope_id no longer matches the target Scope".into());
        }
        let changed = drifted_pins(binding)
            .iter()
            .filter_map(|entry| entry["pin"].as_str().map(str::to_owned))
            .collect::<Vec<_>>();
        (
            hash(&request_bytes),
            hash(&runner_bytes),
            binding.adapter.clone(),
            binding.target_scope_id.clone(),
            changed,
        )
    };
    let binding = registry
        .bindings
        .iter_mut()
        .find(|binding| binding.id == id)
        .ok_or_else(|| format!("unknown adapter binding: {id}"))?;
    binding.request_sha256 = request_sha256;
    binding.runner_sha256 = runner_sha256;
    write_atomic(path, &registry)?;
    print_json(&json!({
        "schema_version": 1,
        "command": "adapter recheck",
        "binding_id": id,
        "adapter": adapter,
        "target_scope_id": scope_id,
        "repinned": changed,
        "registry": display(path)?,
        "declared_effects": declared_effects(&adapter),
        "authority": "observed_hashes_only",
        "content_accepted": false,
        "automatic_promotion": false,
        "note": "re-pinning records what the files now are; it does not approve what the adapter does, and no prior run becomes accepted"
    }))?;
    Ok(ExitCode::SUCCESS)
}

/// Re-states what an adapter declares it will do, so recheck is never silent.
fn declared_effects(adapter: &str) -> serde_json::Value {
    match adapter {
        // These adapters read a public HTTP source and write nothing outside
        // their own run directory.
        "dair-ai" | "mcp-registry" | "github-tooling" => json!({
            "network_access": true,
            "external_writes": false,
            "mutations": false,
            "irreversible_effects": false,
            "dry_run_available": true,
            "requires_owner_approval": true
        }),
        // The HyperResearch harness already did its fetching, outside MOZAK.
        // This adapter reads the local vault it left behind, so declaring
        // network access here would misreport where retrieval happened.
        "hyperresearch" => json!({
            "network_access": false,
            "external_writes": false,
            "mutations": false,
            "irreversible_effects": false,
            "dry_run_available": true,
            "requires_owner_approval": true
        }),
        _ => json!({"declared": false}),
    }
}

/// Reads a pinned file, refusing a path that vanished rather than re-pinning nothing.
fn read_pinned(path: &str, label: &str) -> Result<Vec<u8>, String> {
    fs::read(path).map_err(|error| format!("cannot read adapter {label} {path}: {error}"))
}

fn binding_view(binding: &AdapterBinding) -> serde_json::Value {
    let request_status = pin_status(&binding.request_path, &binding.request_sha256);
    let runner_status = pin_status(&binding.runner_path, &binding.runner_sha256);
    let callable = request_status == "ready" && runner_status == "ready";
    json!({
        "id": binding.id,
        "adapter": binding.adapter,
        "target_scope_id": binding.target_scope_id,
        "request_path": binding.request_path,
        "runner_path": binding.runner_path,
        "runs_dir": binding.runs_dir,
        "request_status": request_status,
        "runner_status": runner_status,
        "state": if callable { "ready" } else { "needs_recheck" },
        "callable": callable,
        "drifted": drifted_pins(binding),
        "automatic_promotion": false
    })
}

/// Names the pinned files whose bytes no longer match the recorded hash.
///
/// A drifted binding is not a defect in the adapter; it means the owner changed
/// a pinned file. Naming the exact file is what makes `adapter recheck`
/// actionable rather than a blind retry.
fn drifted_pins(binding: &AdapterBinding) -> Vec<serde_json::Value> {
    [
        ("request", &binding.request_path, &binding.request_sha256),
        ("runner", &binding.runner_path, &binding.runner_sha256),
    ]
    .into_iter()
    .filter(|(_, path, expected)| pin_status(path, expected) != "ready")
    .map(|(label, path, expected)| {
        json!({
            "pin": label,
            "path": path,
            "pinned_sha256": expected,
            "observed_sha256": fs::read(path).ok().map(|bytes| hash(&bytes)),
        })
    })
    .collect()
}

fn validate_registered_scope(scope_id: &str) -> Result<(), String> {
    let root = crate::project_registry::configured_kb_root()?;
    let kb = load_registry(&root).map_err(|error| error.to_string())?;
    let found = kb.entries.iter().any(|entry| {
        entry
            .scopes
            .manifest
            .scopes
            .iter()
            .any(|scope| scope.id == scope_id)
    });
    if found {
        Ok(())
    } else {
        Err(format!(
            "target Scope is not registered in the current KB: {scope_id}"
        ))
    }
}

fn validate_id(value: &str, label: &str) -> Result<(), String> {
    let valid = !value.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-');
    if valid {
        Ok(())
    } else {
        Err(format!("{label} must be lowercase-hyphenated"))
    }
}

fn canonical_file(path: &Path, label: &str) -> Result<PathBuf, String> {
    let original = fs::symlink_metadata(path)
        .map_err(|error| format!("cannot inspect {label} {}: {error}", path.display()))?;
    if original.file_type().is_symlink() {
        return Err(format!("{label} must not be a symlink: {}", path.display()));
    }
    let path = fs::canonicalize(path)
        .map_err(|error| format!("cannot resolve {label} {}: {error}", path.display()))?;
    let metadata = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
    if !metadata.file_type().is_file() {
        return Err(format!("{label} is not a regular file: {}", path.display()));
    }
    Ok(path)
}

fn absolute(path: &Path) -> Result<PathBuf, String> {
    if path.is_absolute() {
        Ok(path.to_owned())
    } else {
        Ok(env::current_dir()
            .map_err(|error| error.to_string())?
            .join(path))
    }
}

fn verify_pin(path: &str, expected: &str, label: &str) -> Result<(), String> {
    if pin_status(path, expected) == "ready" {
        Ok(())
    } else {
        Err(format!("adapter {label} drifted or is unavailable: {path}"))
    }
}

fn pin_status(path: &str, expected: &str) -> &'static str {
    fs::read(path)
        .ok()
        .filter(|bytes| hash(bytes) == expected)
        .map_or("drifted", |_| "ready")
}

fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn write_atomic(path: &Path, registry: &AdapterRegistry) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or("adapter registry needs a parent directory")?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let temporary = path.with_extension("json.new");
    if temporary.exists() {
        return Err(format!(
            "refusing existing staging file: {}",
            temporary.display()
        ));
    }
    let bytes = serde_json::to_vec_pretty(registry).map_err(|error| error.to_string())?;
    fs::write(&temporary, [bytes, b"\n".to_vec()].concat()).map_err(|error| error.to_string())?;
    fs::rename(&temporary, path).map_err(|error| error.to_string())
}

fn display(path: &Path) -> Result<String, String> {
    path.to_str()
        .map(str::to_owned)
        .ok_or_else(|| format!("path is not UTF-8: {}", path.display()))
}

fn print_json(value: &serde_json::Value) -> Result<(), String> {
    println!(
        "{}",
        serde_json::to_string(value).map_err(|error| error.to_string())?
    );
    Ok(())
}
