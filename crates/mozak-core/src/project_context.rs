//! Strict project-local context manifests with immutable provenance pointers.

use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::fmt::{Display, Formatter};
use std::path::{Component, Path};

pub const CONTRACT_VERSION: u64 = 1;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContextError(pub String);

impl Display for ContextError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for ContextError {}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProjectContextManifest {
    pub schema_version: u64,
    pub id: String,
    pub status: ContextStatus,
    pub created_at: String,
    pub source_repository: String,
    pub source_revision: String,
    pub sources: Vec<ContextSource>,
    pub research_run: String,
    pub research_run_artifact_hash: String,
    pub context_note: String,
    pub context_note_sha256: String,
    pub goal_id: String,
    pub plan_version: u64,
    pub refresh_policy: RefreshPolicy,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ContextStatus {
    Completed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ContextSource {
    pub path: String,
    pub sha256: String,
    pub role: ContextSourceRole,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ContextSourceRole {
    AuthoritativeManuscript,
    RenderedPaper,
    AcceptanceAudit,
    BenchmarkSynthesis,
    SupportingSource,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RefreshPolicy {
    CreateSuccessorVersion,
}

/// Parse and validate a closed-shape project-context manifest.
///
/// # Errors
/// Returns an error for malformed JSON, unsafe paths, incomplete provenance, or invalid hashes.
pub fn validate_context_manifest_json(input: &str) -> Result<ProjectContextManifest, ContextError> {
    let manifest: ProjectContextManifest = serde_json::from_str(input)
        .map_err(|error| ContextError(format!("invalid project context JSON: {error}")))?;
    validate_context_manifest(&manifest)?;
    Ok(manifest)
}

/// Validate immutable provenance and project-local artifact pointers.
///
/// # Errors
/// Returns the first deterministic contract violation.
pub fn validate_context_manifest(manifest: &ProjectContextManifest) -> Result<(), ContextError> {
    require(
        manifest.schema_version == CONTRACT_VERSION,
        "unsupported project context schema_version",
    )?;
    identifier(&manifest.id, "context id", "context-")?;
    timestamp(&manifest.created_at, "created_at")?;
    nonempty(&manifest.source_repository, "source_repository")?;
    git_revision(&manifest.source_revision)?;
    require(
        !manifest.sources.is_empty(),
        "context sources must not be empty",
    )?;
    let mut paths = BTreeSet::new();
    for source in &manifest.sources {
        safe_relative_path(&source.path, "context source path")?;
        require(paths.insert(&source.path), "duplicate context source path")?;
        sha256(&source.sha256, "context source sha256")?;
    }
    safe_project_path(&manifest.research_run, ".mozak/research/", "research_run")?;
    sha256(
        &manifest.research_run_artifact_hash,
        "research_run_artifact_hash",
    )?;
    safe_project_path(&manifest.context_note, ".mozak/context/", "context_note")?;
    require(
        Path::new(&manifest.context_note)
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("md")),
        "context_note must be Markdown",
    )?;
    sha256(&manifest.context_note_sha256, "context_note_sha256")?;
    identifier(&manifest.goal_id, "goal_id", "")?;
    require(manifest.plan_version > 0, "plan_version must be positive")
}

fn safe_project_path(value: &str, prefix: &str, field: &str) -> Result<(), ContextError> {
    safe_relative_path(value, field)?;
    require(
        value.starts_with(prefix),
        &format!("{field} must be inside {prefix}"),
    )
}

fn safe_relative_path(value: &str, field: &str) -> Result<(), ContextError> {
    nonempty(value, field)?;
    let path = Path::new(value);
    require(!path.is_absolute(), &format!("{field} must be relative"))?;
    require(
        path.components()
            .all(|component| matches!(component, Component::Normal(_))),
        &format!("{field} contains unsafe path components"),
    )
}

fn identifier(value: &str, field: &str, prefix: &str) -> Result<(), ContextError> {
    require(
        value.starts_with(prefix)
            && value.len() > prefix.len()
            && value
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-'),
        &format!("{field} has invalid identifier syntax"),
    )
}

fn git_revision(value: &str) -> Result<(), ContextError> {
    require(
        value.len() == 40 && value.bytes().all(|byte| byte.is_ascii_hexdigit()),
        "source_revision must be a 40-character hexadecimal Git revision",
    )
}

fn sha256(value: &str, field: &str) -> Result<(), ContextError> {
    require(
        value.len() == 64
            && value
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase()),
        &format!("{field} must be 64 lowercase hexadecimal characters"),
    )
}

fn timestamp(value: &str, field: &str) -> Result<(), ContextError> {
    let bytes = value.as_bytes();
    require(
        bytes.len() == 20
            && bytes[4] == b'-'
            && bytes[7] == b'-'
            && bytes[10] == b'T'
            && bytes[13] == b':'
            && bytes[16] == b':'
            && bytes[19] == b'Z'
            && bytes.iter().enumerate().all(|(index, byte)| {
                matches!(index, 4 | 7 | 10 | 13 | 16 | 19) || byte.is_ascii_digit()
            }),
        &format!("{field} must use canonical UTC seconds format"),
    )
}

fn nonempty(value: &str, field: &str) -> Result<(), ContextError> {
    require(
        !value.trim().is_empty(),
        &format!("{field} must not be empty"),
    )
}

fn require(condition: bool, message: &str) -> Result<(), ContextError> {
    if condition {
        Ok(())
    } else {
        Err(ContextError(message.to_owned()))
    }
}
