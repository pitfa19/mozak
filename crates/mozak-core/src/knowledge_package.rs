//! Offline validation for immutable, content-addressed knowledge packages.
//!
//! Package identity is `sha256:<hex>`, where `<hex>` is SHA-256 over the UTF-8
//! canonical manifest projection: the manifest serialized as compact JSON with
//! object keys in struct order, artifact entries sorted by `(path, kind)`, the
//! `package_id` field omitted, and one trailing LF byte. Artifact hashes cover
//! every file byte. The identity therefore commits to every artifact digest and
//! all lineage metadata without a self-referential hash.

use crate::project_release::{ProjectRelease, validate_project_release};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt::{Display, Formatter};
use std::fs;
use std::path::{Component, Path, PathBuf};

pub const MANIFEST_FILE: &str = "mozak-package.json";
pub const MAX_ARTIFACTS: usize = 64;
pub const MAX_ARTIFACT_BYTES: u64 = 8 * 1024 * 1024;
pub const MAX_PACKAGE_BYTES: u64 = 32 * 1024 * 1024;
pub const MAX_MANIFEST_BYTES: u64 = 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PackageError(pub String);
impl Display for PackageError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for PackageError {}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArtifactKind {
    ProjectRelease,
    HumanOverview,
    ResearchMarkdown,
    PlanningMarkdown,
}

impl ArtifactKind {
    fn expected_media_type(&self) -> &'static str {
        match self {
            Self::ProjectRelease => "application/vnd.mozak.project-release+json",
            Self::HumanOverview | Self::ResearchMarkdown | Self::PlanningMarkdown => {
                "text/markdown; charset=utf-8"
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PackageArtifact {
    pub kind: ArtifactKind,
    pub path: String,
    pub media_type: String,
    pub sha256: String,
    pub bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PackageReference {
    pub project_id: String,
    pub release_id: String,
    pub package_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KnowledgePackageManifest {
    pub schema_version: u64,
    pub package_id: String,
    pub project_id: String,
    pub release_id: String,
    pub predecessor: Option<PackageReference>,
    pub restores: Option<PackageReference>,
    pub artifacts: Vec<PackageArtifact>,
}

#[derive(Serialize)]
struct IdentityProjection<'a> {
    schema_version: u64,
    project_id: &'a str,
    release_id: &'a str,
    predecessor: &'a Option<PackageReference>,
    restores: &'a Option<PackageReference>,
    artifacts: &'a [PackageArtifact],
}

#[derive(Debug, Clone)]
pub struct ValidatedKnowledgePackage {
    pub root: PathBuf,
    pub manifest: KnowledgePackageManifest,
    pub release: ProjectRelease,
    pub canonical_manifest_bytes: Vec<u8>,
}

/// Returns deterministic canonical manifest bytes, including a trailing LF.
///
/// # Errors
/// Returns [`PackageError`] if the manifest cannot be serialized.
pub fn canonical_manifest_bytes(
    manifest: &KnowledgePackageManifest,
) -> Result<Vec<u8>, PackageError> {
    let mut normalized = manifest.clone();
    normalized
        .artifacts
        .sort_by(|a, b| a.path.cmp(&b.path).then(a.kind.cmp(&b.kind)));
    let mut bytes = serde_json::to_vec(&normalized)
        .map_err(|e| PackageError(format!("cannot serialize package manifest: {e}")))?;
    bytes.push(b'\n');
    Ok(bytes)
}

/// Computes the content-digest identity from the documented projection.
///
/// # Errors
/// Returns [`PackageError`] if the identity projection cannot be serialized.
pub fn package_identity(manifest: &KnowledgePackageManifest) -> Result<String, PackageError> {
    let mut artifacts = manifest.artifacts.clone();
    artifacts.sort_by(|a, b| a.path.cmp(&b.path).then(a.kind.cmp(&b.kind)));
    let projection = IdentityProjection {
        schema_version: manifest.schema_version,
        project_id: &manifest.project_id,
        release_id: &manifest.release_id,
        predecessor: &manifest.predecessor,
        restores: &manifest.restores,
        artifacts: &artifacts,
    };
    let mut bytes = serde_json::to_vec(&projection)
        .map_err(|e| PackageError(format!("cannot serialize package identity projection: {e}")))?;
    bytes.push(b'\n');
    Ok(format!("sha256:{:x}", Sha256::digest(bytes)))
}

/// Loads and fully validates one package directory without modifying it.
///
/// # Errors
/// Returns [`PackageError`] for malformed manifests, unsafe filesystem entries,
/// invalid artifacts, digest mismatches, bounds violations, or identity errors.
#[allow(clippy::too_many_lines)]
pub fn load_knowledge_package(root: &Path) -> Result<ValidatedKnowledgePackage, PackageError> {
    reject_symlink(root, "package root")?;
    if !root.is_dir() {
        return Err(PackageError(format!(
            "package root is not a directory: {}",
            root.display()
        )));
    }
    let manifest_path = root.join(MANIFEST_FILE);
    let metadata = fs::symlink_metadata(&manifest_path)
        .map_err(|e| PackageError(format!("cannot inspect {}: {e}", manifest_path.display())))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(PackageError(
            "package manifest must be a regular non-symlink file".into(),
        ));
    }
    if metadata.len() > MAX_MANIFEST_BYTES {
        return Err(PackageError("package manifest exceeds size limit".into()));
    }
    let raw = fs::read(&manifest_path)
        .map_err(|e| PackageError(format!("cannot read {}: {e}", manifest_path.display())))?;
    let mut manifest: KnowledgePackageManifest = serde_json::from_slice(&raw)
        .map_err(|e| PackageError(format!("invalid package manifest: {e}")))?;
    validate_manifest_shape(&manifest)?;
    let expected_id = package_identity(&manifest)?;
    if manifest.package_id != expected_id {
        return Err(PackageError(format!(
            "package_id mismatch: expected {expected_id}"
        )));
    }
    manifest
        .artifacts
        .sort_by(|a, b| a.path.cmp(&b.path).then(a.kind.cmp(&b.kind)));
    let canonical = canonical_manifest_bytes(&manifest)?;
    if raw != canonical {
        return Err(PackageError(
            "package manifest bytes are not canonical".into(),
        ));
    }

    validate_closed_directory(root, &manifest, metadata.len())?;

    let mut release = None;
    let mut total = metadata.len();
    for artifact in &manifest.artifacts {
        let path = resolve_regular_file(root, &artifact.path)?;
        let metadata = fs::metadata(&path)
            .map_err(|e| PackageError(format!("cannot inspect {}: {e}", path.display())))?;
        if metadata.len() != artifact.bytes {
            return Err(PackageError(format!(
                "artifact byte count mismatch: {}",
                artifact.path
            )));
        }
        if metadata.len() > MAX_ARTIFACT_BYTES {
            return Err(PackageError(format!(
                "artifact exceeds size limit: {}",
                artifact.path
            )));
        }
        total = total
            .checked_add(metadata.len())
            .ok_or_else(|| PackageError("package byte count overflow".into()))?;
        if total > MAX_PACKAGE_BYTES {
            return Err(PackageError("package exceeds total size limit".into()));
        }
        let bytes = fs::read(&path)
            .map_err(|e| PackageError(format!("cannot read {}: {e}", path.display())))?;
        let digest = format!("{:x}", Sha256::digest(&bytes));
        if digest != artifact.sha256 {
            return Err(PackageError(format!(
                "artifact SHA-256 mismatch: {}",
                artifact.path
            )));
        }
        if matches!(
            artifact.kind,
            ArtifactKind::HumanOverview
                | ArtifactKind::ResearchMarkdown
                | ArtifactKind::PlanningMarkdown
        ) {
            std::str::from_utf8(&bytes).map_err(|_| {
                PackageError(format!("Markdown artifact is not UTF-8: {}", artifact.path))
            })?;
        }
        if artifact.kind == ArtifactKind::ProjectRelease {
            let parsed: ProjectRelease = serde_json::from_slice(&bytes).map_err(|e| {
                PackageError(format!("invalid ProjectRelease {}: {e}", artifact.path))
            })?;
            validate_project_release(&parsed).map_err(|e| {
                PackageError(format!("invalid ProjectRelease {}: {e}", artifact.path))
            })?;
            if parsed.project.id != manifest.project_id || parsed.release_id != manifest.release_id
            {
                return Err(PackageError(
                    "ProjectRelease identity does not match package identity".into(),
                ));
            }
            release = Some(parsed);
        }
    }
    let release = release
        .ok_or_else(|| PackageError("exactly one ProjectRelease artifact is required".into()))?;
    let canonical_manifest_bytes = canonical;
    Ok(ValidatedKnowledgePackage {
        root: root.to_path_buf(),
        manifest,
        release,
        canonical_manifest_bytes,
    })
}

fn validate_manifest_shape(manifest: &KnowledgePackageManifest) -> Result<(), PackageError> {
    if manifest.schema_version != 1 {
        return Err(PackageError("package schema_version must be 1".into()));
    }
    nonempty(&manifest.project_id, "project_id")?;
    nonempty(&manifest.release_id, "release_id")?;
    validate_package_id(&manifest.package_id, "package_id")?;
    if manifest.artifacts.len() > MAX_ARTIFACTS {
        return Err(PackageError("package artifact count exceeds limit".into()));
    }
    let mut paths = BTreeSet::new();
    let mut folded = BTreeSet::new();
    let mut kinds = BTreeMap::<ArtifactKind, usize>::new();
    for artifact in &manifest.artifacts {
        validate_safe_path(&artifact.path)?;
        validate_hash(&artifact.sha256, "artifact.sha256")?;
        if artifact.bytes > MAX_ARTIFACT_BYTES {
            return Err(PackageError(format!(
                "artifact exceeds size limit: {}",
                artifact.path
            )));
        }
        if artifact.media_type != artifact.kind.expected_media_type() {
            return Err(PackageError(format!(
                "invalid media type for {}",
                artifact.path
            )));
        }
        if !paths.insert(artifact.path.clone()) {
            return Err(PackageError(format!(
                "duplicate artifact path: {}",
                artifact.path
            )));
        }
        if !folded.insert(artifact.path.to_ascii_lowercase()) {
            return Err(PackageError(format!(
                "case-folding artifact path collision: {}",
                artifact.path
            )));
        }
        *kinds.entry(artifact.kind.clone()).or_default() += 1;
    }
    if kinds.get(&ArtifactKind::ProjectRelease) != Some(&1) {
        return Err(PackageError(
            "exactly one ProjectRelease artifact is required".into(),
        ));
    }
    if kinds.get(&ArtifactKind::HumanOverview) != Some(&1) {
        return Err(PackageError(
            "exactly one human overview artifact is required".into(),
        ));
    }
    for reference in [&manifest.predecessor, &manifest.restores]
        .into_iter()
        .flatten()
    {
        nonempty(&reference.project_id, "reference.project_id")?;
        nonempty(&reference.release_id, "reference.release_id")?;
        validate_package_id(&reference.package_id, "reference.package_id")?;
        if reference.project_id != manifest.project_id {
            return Err(PackageError(
                "lineage reference must name the same project".into(),
            ));
        }
        if reference.package_id == manifest.package_id {
            return Err(PackageError("package cannot reference itself".into()));
        }
    }
    if manifest.restores.is_some() && manifest.predecessor.is_none() {
        return Err(PackageError(
            "a restore publication must have a predecessor".into(),
        ));
    }
    Ok(())
}

fn validate_closed_directory(
    root: &Path,
    manifest: &KnowledgePackageManifest,
    manifest_bytes: u64,
) -> Result<(), PackageError> {
    let declared = manifest
        .artifacts
        .iter()
        .map(|artifact| artifact.path.as_str())
        .collect::<BTreeSet<_>>();
    let declared_directories = declared
        .iter()
        .flat_map(|path| {
            let mut ancestors = Vec::new();
            let mut current = Path::new(path).parent();
            while let Some(parent) = current {
                if parent.as_os_str().is_empty() {
                    break;
                }
                ancestors.push(path_text(parent));
                current = parent.parent();
            }
            ancestors
        })
        .collect::<BTreeSet<_>>();
    let mut folded_entries = BTreeSet::new();
    let mut found_artifacts = BTreeSet::new();
    let mut package_bytes = manifest_bytes;
    inspect_directory(
        root,
        root,
        &declared,
        &declared_directories,
        &mut folded_entries,
        &mut found_artifacts,
        &mut package_bytes,
    )?;
    if found_artifacts.len() != declared.len() {
        return Err(PackageError(
            "package directory does not contain exactly the declared artifacts".into(),
        ));
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn inspect_directory(
    root: &Path,
    directory: &Path,
    declared: &BTreeSet<&str>,
    declared_directories: &BTreeSet<String>,
    folded_entries: &mut BTreeSet<String>,
    found_artifacts: &mut BTreeSet<String>,
    package_bytes: &mut u64,
) -> Result<(), PackageError> {
    let mut entries = fs::read_dir(directory)
        .map_err(|e| PackageError(format!("cannot inspect {}: {e}", directory.display())))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| PackageError(format!("cannot inspect {}: {e}", directory.display())))?;
    entries.sort_by_key(std::fs::DirEntry::file_name);
    for entry in entries {
        let path = entry.path();
        let relative = path
            .strip_prefix(root)
            .map_err(|_| PackageError(format!("package entry escapes root: {}", path.display())))?;
        let relative = path_text(relative);
        if !folded_entries.insert(relative.to_ascii_lowercase()) {
            return Err(PackageError(format!(
                "case-folding package path collision: {relative}"
            )));
        }
        let metadata = fs::symlink_metadata(&path)
            .map_err(|e| PackageError(format!("cannot inspect {}: {e}", path.display())))?;
        let file_type = metadata.file_type();
        if file_type.is_symlink() {
            return Err(PackageError(format!(
                "package entries must not be symlinks: {relative}"
            )));
        }
        if file_type.is_dir() {
            if !declared_directories.contains(&relative) {
                return Err(PackageError(format!(
                    "package directory has no declared artifact descendants: {relative}"
                )));
            }
            inspect_directory(
                root,
                &path,
                declared,
                declared_directories,
                folded_entries,
                found_artifacts,
                package_bytes,
            )?;
        } else if file_type.is_file() {
            if relative == MANIFEST_FILE {
                continue;
            }
            if !declared.contains(relative.as_str()) {
                return Err(PackageError(format!("undeclared package file: {relative}")));
            }
            if !found_artifacts.insert(relative.clone()) {
                return Err(PackageError(format!("duplicate package file: {relative}")));
            }
            *package_bytes = package_bytes
                .checked_add(metadata.len())
                .ok_or_else(|| PackageError("package byte count overflow".into()))?;
            if *package_bytes > MAX_PACKAGE_BYTES {
                return Err(PackageError("package exceeds total size limit".into()));
            }
        } else {
            return Err(PackageError(format!(
                "package entry must be a regular file or required directory: {relative}"
            )));
        }
    }
    Ok(())
}

fn path_text(path: &Path) -> String {
    path.components()
        .filter_map(|component| match component {
            Component::Normal(value) => Some(value.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

/// Validates a caller-supplied, branch-capable package DAG. Input order has no meaning.
///
/// # Errors
/// Returns [`PackageError`] for unresolved or inconsistent references, duplicate
/// identities, cross-project history, cycles, version gaps, or invalid restores.
pub fn validate_package_history(
    packages: &[ValidatedKnowledgePackage],
) -> Result<(), PackageError> {
    if packages.is_empty() {
        return Err(PackageError("package history must not be empty".into()));
    }
    let project = &packages[0].manifest.project_id;
    let mut by_digest = BTreeMap::new();
    let mut identities = BTreeSet::new();
    for package in packages {
        let m = &package.manifest;
        if &m.project_id != project {
            return Err(PackageError(
                "package history must contain one project".into(),
            ));
        }
        if !identities.insert((m.project_id.clone(), m.release_id.clone())) {
            return Err(PackageError(
                "duplicate (project_id, release_id) in package history".into(),
            ));
        }
        if by_digest.insert(m.package_id.clone(), package).is_some() {
            return Err(PackageError("duplicate package digest in history".into()));
        }
    }
    for package in packages {
        let m = &package.manifest;
        let predecessor = match &m.predecessor {
            Some(reference) => Some(resolve_reference(reference, &by_digest)?),
            None => None,
        };
        if let Some(previous) = predecessor {
            if m.release_id == previous.manifest.release_id {
                return Err(PackageError("successor release_id must be unique".into()));
            }
            let expected = previous
                .release
                .accepted_state_version
                .checked_add(1)
                .ok_or_else(|| PackageError("accepted-state version overflow".into()))?;
            if package.release.accepted_state_version != expected {
                return Err(PackageError(
                    "accepted-state versions must progress exactly gaplessly".into(),
                ));
            }
        } else if package.release.accepted_state_version != 1 {
            return Err(PackageError(
                "a history root must have accepted-state version 1".into(),
            ));
        }
        if let Some(restores) = &m.restores {
            let restored = resolve_reference(restores, &by_digest)?;
            let previous = predecessor
                .ok_or_else(|| PackageError("restore publication is missing predecessor".into()))?;
            if restored.manifest.package_id == previous.manifest.package_id
                || restored.release.accepted_state_version
                    >= previous.release.accepted_state_version
            {
                return Err(PackageError(
                    "restore target must be an ancestor of the predecessor".into(),
                ));
            }
            if !is_ancestor(
                &restored.manifest.package_id,
                &previous.manifest.package_id,
                &by_digest,
            )? {
                return Err(PackageError(
                    "restore target must be an ancestor of the predecessor".into(),
                ));
            }
            if package.release.accepted_state_sha256 != restored.release.accepted_state_sha256 {
                return Err(PackageError(
                    "rollback successor must restore the ancestor accepted state".into(),
                ));
            }
        }
    }
    for digest in by_digest.keys() {
        let mut seen = BTreeSet::new();
        let mut current = digest.as_str();
        while let Some(reference) = by_digest[current].manifest.predecessor.as_ref() {
            if !seen.insert(current.to_owned()) {
                return Err(PackageError("package history must be acyclic".into()));
            }
            current = &resolve_reference(reference, &by_digest)?
                .manifest
                .package_id;
        }
    }
    Ok(())
}

fn resolve_reference<'a>(
    reference: &PackageReference,
    packages: &'a BTreeMap<String, &ValidatedKnowledgePackage>,
) -> Result<&'a ValidatedKnowledgePackage, PackageError> {
    let package = packages
        .get(&reference.package_id)
        .copied()
        .ok_or_else(|| {
            PackageError(format!(
                "missing referenced package: {}",
                reference.package_id
            ))
        })?;
    if package.manifest.project_id != reference.project_id
        || package.manifest.release_id != reference.release_id
    {
        return Err(PackageError("lineage reference identity mismatch".into()));
    }
    Ok(package)
}

fn is_ancestor(
    target: &str,
    start: &str,
    packages: &BTreeMap<String, &ValidatedKnowledgePackage>,
) -> Result<bool, PackageError> {
    let mut current = start;
    let mut seen = BTreeSet::new();
    loop {
        if current == target {
            return Ok(true);
        }
        if !seen.insert(current.to_owned()) {
            return Err(PackageError("package history must be acyclic".into()));
        }
        match &packages[current].manifest.predecessor {
            Some(reference) => {
                current = &resolve_reference(reference, packages)?.manifest.package_id;
            }
            None => return Ok(false),
        }
    }
}

fn resolve_regular_file(root: &Path, relative: &str) -> Result<PathBuf, PackageError> {
    let mut current = root.to_path_buf();
    for component in Path::new(relative).components() {
        let Component::Normal(part) = component else {
            return Err(PackageError(format!("unsafe artifact path: {relative}")));
        };
        current.push(part);
        let metadata = fs::symlink_metadata(&current)
            .map_err(|e| PackageError(format!("cannot inspect {}: {e}", current.display())))?;
        if metadata.file_type().is_symlink() {
            return Err(PackageError(format!(
                "symlink is forbidden in artifact path: {relative}"
            )));
        }
    }
    if !current.is_file() {
        return Err(PackageError(format!(
            "artifact is not a regular file: {relative}"
        )));
    }
    Ok(current)
}

fn reject_symlink(path: &Path, label: &str) -> Result<(), PackageError> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|e| PackageError(format!("cannot inspect {label} {}: {e}", path.display())))?;
    if metadata.file_type().is_symlink() {
        Err(PackageError(format!("{label} must not be a symlink")))
    } else {
        Ok(())
    }
}

fn validate_safe_path(value: &str) -> Result<(), PackageError> {
    if value.is_empty()
        || !value.is_ascii()
        || value.contains('\\')
        || value.starts_with('/')
        || value.ends_with('/')
        || value.contains("//")
        || value.bytes().any(|b| b.is_ascii_control())
        || value.bytes().any(|byte| {
            !(byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-' | b'/'))
        })
        || value.split('/').any(|part| part == "." || part == "..")
    {
        return Err(PackageError(format!(
            "artifact path must be safe ASCII relative path: {value}"
        )));
    }
    let path = Path::new(value);
    if path.is_absolute()
        || path
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err(PackageError(format!(
            "artifact path must be safe ASCII relative path: {value}"
        )));
    }
    Ok(())
}
fn nonempty(value: &str, field: &str) -> Result<(), PackageError> {
    if value.trim().is_empty() {
        Err(PackageError(format!("{field} must be non-empty")))
    } else {
        Ok(())
    }
}
fn validate_hash(value: &str, field: &str) -> Result<(), PackageError> {
    if value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        Ok(())
    } else {
        Err(PackageError(format!("{field} must be a lowercase SHA-256")))
    }
}
fn validate_package_id(value: &str, field: &str) -> Result<(), PackageError> {
    match value.strip_prefix("sha256:") {
        Some(hash) => validate_hash(hash, field),
        None => Err(PackageError(format!(
            "{field} must use sha256:<lowercase-hex>"
        ))),
    }
}
