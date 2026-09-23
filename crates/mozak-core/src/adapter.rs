//! Closed adapter-registry contract shared by the CLI and current-state projection.

use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::fmt::{Display, Formatter};
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdapterError(pub String);

impl Display for AdapterError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for AdapterError {}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct AdapterRegistry {
    pub schema_version: u32,
    pub bindings: Vec<AdapterBinding>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct AdapterBinding {
    pub id: String,
    pub adapter: String,
    pub target_scope_id: String,
    pub request_path: String,
    pub request_sha256: String,
    pub runner_path: String,
    pub runner_sha256: String,
    pub runs_dir: String,
}

/// Parse and validate an adapter registry without invoking any adapter.
///
/// # Errors
/// Returns an error for malformed JSON, unsupported adapters, unsafe paths,
/// invalid hashes, or duplicate bindings.
pub fn validate_adapter_registry_json(input: &str) -> Result<AdapterRegistry, AdapterError> {
    let registry: AdapterRegistry = serde_json::from_str(input)
        .map_err(|error| AdapterError(format!("invalid adapter registry: {error}")))?;
    validate_adapter_registry(&registry)?;
    Ok(registry)
}

/// Validate the closed adapter-registry shape.
///
/// # Errors
/// Returns the first deterministic contract violation.
pub fn validate_adapter_registry(registry: &AdapterRegistry) -> Result<(), AdapterError> {
    require(
        registry.schema_version == 1,
        "adapter registry schema_version must be 1",
    )?;
    let mut ids = BTreeSet::new();
    for binding in &registry.bindings {
        identifier(&binding.id, "binding id")?;
        identifier(&binding.target_scope_id, "target scope id")?;
        require(
            matches!(
                binding.adapter.as_str(),
                "arxiv"
                    | "dair-ai"
                    | "mcp-registry"
                    | "github-tooling"
                    | "hyperresearch"
                    | "monokl"
            ),
            &format!("unsupported configured adapter: {}", binding.adapter),
        )?;
        sha256(&binding.request_sha256, "request hash")?;
        sha256(&binding.runner_sha256, "runner hash")?;
        require(
            Path::new(&binding.request_path).is_absolute()
                && Path::new(&binding.runner_path).is_absolute()
                && Path::new(&binding.runs_dir).is_absolute(),
            "adapter binding paths must be absolute",
        )?;
        require(
            ids.insert(binding.id.as_str()),
            &format!("duplicate adapter binding: {}", binding.id),
        )?;
    }
    Ok(())
}

fn identifier(value: &str, field: &str) -> Result<(), AdapterError> {
    require(
        !value.is_empty()
            && value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.')),
        &format!("{field} has invalid syntax"),
    )
}

fn sha256(value: &str, field: &str) -> Result<(), AdapterError> {
    require(
        value.len() == 64
            && value
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase()),
        &format!("{field} must be 64 lowercase hexadecimal characters"),
    )
}

fn require(condition: bool, message: &str) -> Result<(), AdapterError> {
    if condition {
        Ok(())
    } else {
        Err(AdapterError(message.to_owned()))
    }
}
