//! Strict, local, provider-neutral Meta KB manifests.

use crate::project_release::{ProjectRelease, validate_project_release};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    fmt::{Display, Formatter},
    fs,
    path::{Component, Path, PathBuf},
};

pub const MANIFEST_FILE: &str = "meta-kb.json";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MetaKbError(pub String);
impl Display for MetaKbError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for MetaKbError {}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MetaKbManifest {
    pub schema_version: u64,
    pub projects: Vec<MetaProject>,
    pub relationships: Vec<MetaRelationship>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MetaProject {
    pub project_id: String,
    pub release_id: String,
    pub release_path: String,
    pub release_sha256: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub human_overview: Option<HumanOverview>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HumanOverview {
    pub path: String,
    pub sha256: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
/// Closed vocabulary for project knowledge-transfer relationships.
pub enum MetaRelationshipKind {
    /// One project provides knowledge relevant to another.
    Informs,
    /// One project requires another project or its knowledge.
    DependsOn,
    /// One project's knowledge was produced from another's.
    DerivedFrom,
    /// The projects have a meaningful, otherwise-unspecified connection.
    RelatedTo,
    /// One project checks or supports the correctness of another.
    Validates,
    /// One project is checked or supported by another.
    ValidatedBy,
    /// One project applies another project or its knowledge.
    Uses,
    /// One project replaces another as the current source of knowledge.
    Supersedes,
}

impl MetaRelationshipKind {
    /// Returns the canonical `snake_case` label used by JSON and public output.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Informs => "informs",
            Self::DependsOn => "depends_on",
            Self::DerivedFrom => "derived_from",
            Self::RelatedTo => "related_to",
            Self::Validates => "validates",
            Self::ValidatedBy => "validated_by",
            Self::Uses => "uses",
            Self::Supersedes => "supersedes",
        }
    }
}

impl Display for MetaRelationshipKind {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MetaRelationship {
    pub from_project_id: String,
    pub to_project_id: String,
    pub relationship: MetaRelationshipKind,
}

#[derive(Debug, Clone)]
pub struct ValidatedMetaKb {
    pub manifest: MetaKbManifest,
    pub releases: Vec<ProjectRelease>,
}

/// Loads and fully validates `<root>/meta-kb.json` and every referenced local artifact.
///
/// # Errors
/// Returns [`MetaKbError`] for I/O, JSON, identity, path, hash, release, or graph contract errors.
pub fn load_meta_kb(root: &Path) -> Result<ValidatedMetaKb, MetaKbError> {
    if !root.is_dir() {
        return Err(MetaKbError(format!(
            "Meta KB root is not a directory: {}",
            root.display()
        )));
    }
    let root = root.canonicalize().map_err(|e| {
        MetaKbError(format!(
            "cannot resolve Meta KB root {}: {e}",
            root.display()
        ))
    })?;
    let path = root.join(MANIFEST_FILE);
    let text = fs::read_to_string(&path)
        .map_err(|e| MetaKbError(format!("cannot read {}: {e}", path.display())))?;
    let manifest: MetaKbManifest = serde_json::from_str(&text)
        .map_err(|e| MetaKbError(format!("invalid Meta KB manifest contract: {e}")))?;
    validate_manifest_shape(&manifest)?;
    let mut releases = Vec::with_capacity(manifest.projects.len());
    for project in &manifest.projects {
        let release_path = resolve_safe(&root, &project.release_path, "release_path")?;
        let bytes = fs::read(&release_path)
            .map_err(|e| MetaKbError(format!("cannot read {}: {e}", release_path.display())))?;
        require_hash(&bytes, &project.release_sha256, "release")?;
        let release: ProjectRelease = serde_json::from_slice(&bytes).map_err(|e| {
            MetaKbError(format!(
                "invalid project release contract at {}: {e}",
                project.release_path
            ))
        })?;
        validate_project_release(&release).map_err(|e| {
            MetaKbError(format!(
                "invalid project release at {}: {e}",
                project.release_path
            ))
        })?;
        validate_meta_identifier(&release.project.id, "release project.id")?;
        validate_meta_identifier(&release.release_id, "release release_id")?;
        if release.project.id != project.project_id {
            return Err(MetaKbError(format!(
                "project_id does not match release at {}",
                project.release_path
            )));
        }
        if release.release_id != project.release_id {
            return Err(MetaKbError(format!(
                "release_id does not match release at {}",
                project.release_path
            )));
        }
        if let Some(overview) = &project.human_overview {
            let overview_path = resolve_safe(&root, &overview.path, "human_overview.path")?;
            let overview_bytes = fs::read(&overview_path).map_err(|e| {
                MetaKbError(format!("cannot read {}: {e}", overview_path.display()))
            })?;
            require_hash(&overview_bytes, &overview.sha256, "human overview")?;
        }
        releases.push(release);
    }
    Ok(ValidatedMetaKb { manifest, releases })
}

fn validate_manifest_shape(manifest: &MetaKbManifest) -> Result<(), MetaKbError> {
    if manifest.schema_version != 1 {
        return Err(MetaKbError("Meta KB schema_version must be 1".into()));
    }
    let mut projects = BTreeSet::new();
    let mut identities = BTreeSet::new();
    for p in &manifest.projects {
        validate_meta_identifier(&p.project_id, "project_id")?;
        validate_meta_identifier(&p.release_id, "release_id")?;
        validate_relative(&p.release_path, "release_path")?;
        validate_hash(&p.release_sha256, "release_sha256")?;
        if !projects.insert(p.project_id.clone()) {
            return Err(MetaKbError(format!(
                "duplicate project_id: {}",
                p.project_id
            )));
        }
        if !identities.insert(p.release_id.clone()) {
            return Err(MetaKbError(format!(
                "duplicate release identity: {}",
                p.release_id
            )));
        }
        if let Some(o) = &p.human_overview {
            validate_relative(&o.path, "human_overview.path")?;
            validate_hash(&o.sha256, "human_overview.sha256")?;
        }
    }
    let mut relations = BTreeSet::new();
    for r in &manifest.relationships {
        if r.from_project_id == r.to_project_id {
            return Err(MetaKbError("self-relations are not allowed".into()));
        }
        if !projects.contains(&r.from_project_id) {
            return Err(MetaKbError(format!(
                "unknown relationship endpoint: {}",
                r.from_project_id
            )));
        }
        if !projects.contains(&r.to_project_id) {
            return Err(MetaKbError(format!(
                "unknown relationship endpoint: {}",
                r.to_project_id
            )));
        }
        if !relations.insert(r.clone()) {
            return Err(MetaKbError("duplicate relationship".into()));
        }
    }
    Ok(())
}

/// Validates an identifier safe for terminal display and graph source output.
///
/// Valid identifiers contain 1 to 128 ASCII characters, begin with an ASCII
/// alphanumeric character, and otherwise contain only ASCII alphanumerics,
/// `.`, `_`, or `-`.
///
/// # Errors
/// Returns [`MetaKbError`] when `value` does not satisfy the identifier format.
pub fn validate_meta_identifier(value: &str, name: &str) -> Result<(), MetaKbError> {
    let bytes = value.as_bytes();
    if (1..=128).contains(&bytes.len())
        && bytes[0].is_ascii_alphanumeric()
        && bytes[1..]
            .iter()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
    {
        Ok(())
    } else {
        Err(MetaKbError(format!(
            "{name} must be 1..=128 ASCII characters, start with an alphanumeric character, and contain only alphanumerics, '.', '_', or '-'"
        )))
    }
}
fn validate_hash(value: &str, name: &str) -> Result<(), MetaKbError> {
    if value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        Ok(())
    } else {
        Err(MetaKbError(format!(
            "{name} must be 64 lowercase hexadecimal characters"
        )))
    }
}
fn validate_relative(value: &str, name: &str) -> Result<(), MetaKbError> {
    if value.is_empty() {
        return Err(MetaKbError(format!("{name} must not be empty")));
    }
    let path = Path::new(value);
    if path.is_absolute()
        || path
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err(MetaKbError(format!("unsafe {name}: {value}")));
    }
    Ok(())
}
fn resolve_safe(root: &Path, value: &str, name: &str) -> Result<PathBuf, MetaKbError> {
    validate_relative(value, name)?;
    let joined = root.join(value);
    let resolved = joined
        .canonicalize()
        .map_err(|e| MetaKbError(format!("cannot resolve {}: {e}", joined.display())))?;
    if !resolved.starts_with(root) {
        return Err(MetaKbError(format!("unsafe {name}: {value}")));
    }
    Ok(resolved)
}
fn require_hash(bytes: &[u8], expected: &str, label: &str) -> Result<(), MetaKbError> {
    let actual = format!("{:x}", Sha256::digest(bytes));
    if actual == expected {
        Ok(())
    } else {
        Err(MetaKbError(format!(
            "{label} SHA-256 mismatch: expected {expected}, got {actual}"
        )))
    }
}
