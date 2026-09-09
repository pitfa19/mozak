//! Deterministic, provenance-backed project knowledge releases.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt::{Display, Formatter};
use std::io::Write;
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReleaseError(pub String);

impl Display for ReleaseError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for ReleaseError {}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AcceptedProjectState {
    pub schema_version: u64,
    pub project: ReleaseProject,
    pub release: ReleaseIdentity,
    pub accepted_findings: Vec<KnowledgeItem>,
    pub decisions: Vec<KnowledgeItem>,
    pub reusable_patterns: Vec<KnowledgeItem>,
    pub open_gaps: Vec<KnowledgeItem>,
    pub implementation_state: Vec<ImplementationItem>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReleaseProject {
    pub id: String,
    pub name: String,
    pub repository_revision: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReleaseIdentity {
    pub id: String,
    pub generated_at: String,
    pub accepted_state_version: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TruthScope {
    ProjectLocal,
    CrossProjectInference,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProvenanceRef {
    pub id: String,
    pub uri: String,
    pub sha256: String,
    pub locator: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KnowledgeItem {
    pub id: String,
    pub title: String,
    pub summary: String,
    pub truth_scope: TruthScope,
    pub provenance: Vec<ProvenanceRef>,
    #[serde(default)]
    pub supersedes: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImplementationItem {
    pub id: String,
    pub component: String,
    pub state: String,
    pub summary: String,
    pub truth_scope: TruthScope,
    pub provenance: Vec<ProvenanceRef>,
    #[serde(default)]
    pub supersedes: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProjectRelease {
    pub schema_version: u64,
    pub release_id: String,
    pub generated_at: String,
    pub accepted_state_version: u64,
    pub project: ReleaseProject,
    pub accepted_state_sha256: String,
    pub accepted_findings: Vec<KnowledgeItem>,
    pub decisions: Vec<KnowledgeItem>,
    pub reusable_patterns: Vec<KnowledgeItem>,
    pub open_gaps: Vec<KnowledgeItem>,
    pub implementation_state: Vec<ImplementationItem>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GeneratedRelease {
    pub release: ProjectRelease,
    pub canonical_bytes: Vec<u8>,
    pub sha256: String,
}

/// Semantically validates a deserialized canonical project release.
///
/// # Errors
/// Returns [`ReleaseError`] when identity, hashes, items, provenance, or
/// supersession relationships violate the release contract.
pub fn validate_project_release(release: &ProjectRelease) -> Result<(), ReleaseError> {
    if release.schema_version != 1 {
        return Err(ReleaseError("release schema_version must be 1".into()));
    }
    nonempty(&release.release_id, "release_id")?;
    nonempty(&release.generated_at, "generated_at")?;
    nonempty(&release.project.id, "project.id")?;
    nonempty(&release.project.name, "project.name")?;
    if release.accepted_state_version == 0 {
        return Err(ReleaseError(
            "accepted_state_version must be positive".into(),
        ));
    }
    validate_hash(
        &release.project.repository_revision,
        "project.repository_revision",
    )?;
    validate_hash(&release.accepted_state_sha256, "accepted_state_sha256")?;
    validate_release_items(
        &release.accepted_findings,
        &release.decisions,
        &release.reusable_patterns,
        &release.open_gaps,
        &release.implementation_state,
    )
}

/// Validates accepted state and emits canonical JSON. Time is read only from `release.generated_at`.
///
/// # Errors
/// Returns [`ReleaseError`] for malformed, unsafe, incomplete, or inconsistent accepted state.
pub fn generate_project_release(input: &str) -> Result<GeneratedRelease, ReleaseError> {
    let value: serde_json::Value = serde_json::from_str(input)
        .map_err(|error| ReleaseError(format!("invalid accepted state JSON: {error}")))?;
    reject_raw_fields(&value, "$")?;
    let mut state: AcceptedProjectState = serde_json::from_value(value)
        .map_err(|error| ReleaseError(format!("invalid accepted state contract: {error}")))?;
    validate_state(&state)?;
    canonicalize_state(&mut state);
    let accepted_bytes = canonical_json(&state)?;
    let accepted_state_sha256 = sha256(&accepted_bytes);
    let release = ProjectRelease {
        schema_version: 1,
        release_id: state.release.id,
        generated_at: state.release.generated_at,
        accepted_state_version: state.release.accepted_state_version,
        project: state.project,
        accepted_state_sha256,
        accepted_findings: state.accepted_findings,
        decisions: state.decisions,
        reusable_patterns: state.reusable_patterns,
        open_gaps: state.open_gaps,
        implementation_state: state.implementation_state,
    };
    let canonical_bytes = canonical_json(&release)?;
    let hash = sha256(&canonical_bytes);
    Ok(GeneratedRelease {
        release,
        canonical_bytes,
        sha256: hash,
    })
}

/// Writes canonical release bytes without replacing an existing path.
///
/// # Errors
/// Returns [`ReleaseError`] if the path exists or cannot be created and written.
pub fn write_release_new(path: &Path, generated: &GeneratedRelease) -> Result<(), ReleaseError> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    let mut file = options.open(path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::AlreadyExists {
            ReleaseError(format!(
                "refusing to overwrite existing output: {}",
                path.display()
            ))
        } else {
            ReleaseError(format!("cannot create {}: {error}", path.display()))
        }
    })?;
    file.write_all(&generated.canonical_bytes)
        .map_err(|error| ReleaseError(format!("cannot write {}: {error}", path.display())))
}

fn canonical_json<T: Serialize>(value: &T) -> Result<Vec<u8>, ReleaseError> {
    let mut bytes = serde_json::to_vec(value)
        .map_err(|error| ReleaseError(format!("cannot serialize canonical release: {error}")))?;
    bytes.push(b'\n');
    Ok(bytes)
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn reject_raw_fields(value: &serde_json::Value, path: &str) -> Result<(), ReleaseError> {
    match value {
        serde_json::Value::Object(map) => {
            for (key, child) in map {
                let normalized = key.to_ascii_lowercase().replace('-', "_");
                if normalized.contains("transcript")
                    || normalized == "raw_content"
                    || normalized == "raw_text"
                    || normalized == "raw_record"
                    || normalized == "content"
                {
                    return Err(ReleaseError(format!(
                        "embedded raw content or transcript field is forbidden at {path}.{key}"
                    )));
                }
                reject_raw_fields(child, &format!("{path}.{key}"))?;
            }
        }
        serde_json::Value::Array(items) => {
            for (index, child) in items.iter().enumerate() {
                reject_raw_fields(child, &format!("{path}[{index}]"))?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn validate_state(state: &AcceptedProjectState) -> Result<(), ReleaseError> {
    if state.schema_version != 1 {
        return Err(ReleaseError("schema_version must be 1".into()));
    }
    nonempty(&state.project.id, "project.id")?;
    nonempty(&state.project.name, "project.name")?;
    nonempty(&state.release.id, "release.id")?;
    nonempty(&state.release.generated_at, "release.generated_at")?;
    if state.release.accepted_state_version == 0 {
        return Err(ReleaseError(
            "release.accepted_state_version must be positive".into(),
        ));
    }
    validate_hash(
        &state.project.repository_revision,
        "project.repository_revision",
    )?;

    validate_release_items(
        &state.accepted_findings,
        &state.decisions,
        &state.reusable_patterns,
        &state.open_gaps,
        &state.implementation_state,
    )
}

fn validate_release_items(
    accepted_findings: &[KnowledgeItem],
    decisions: &[KnowledgeItem],
    reusable_patterns: &[KnowledgeItem],
    open_gaps: &[KnowledgeItem],
    implementation_state: &[ImplementationItem],
) -> Result<(), ReleaseError> {
    let mut all_ids = BTreeSet::new();
    let mut supersession = BTreeMap::<String, Vec<String>>::new();
    for (section, items) in [
        ("accepted_findings", accepted_findings),
        ("decisions", decisions),
        ("reusable_patterns", reusable_patterns),
        ("open_gaps", open_gaps),
    ] {
        for (index, item) in items.iter().enumerate() {
            let location = format!("{section}[{index}]");
            validate_item(item, &location)?;
            if !all_ids.insert(item.id.clone()) {
                return Err(ReleaseError(format!(
                    "duplicate release item id: {}",
                    item.id
                )));
            }
            supersession.insert(item.id.clone(), item.supersedes.clone());
        }
    }
    for (index, item) in implementation_state.iter().enumerate() {
        let location = format!("implementation_state[{index}]");
        nonempty(&item.id, &format!("{location}.id"))?;
        nonempty(&item.component, &format!("{location}.component"))?;
        nonempty(&item.state, &format!("{location}.state"))?;
        nonempty(&item.summary, &format!("{location}.summary"))?;
        validate_provenance(&item.provenance, &location)?;
        unique_strings(&item.supersedes, &format!("{location}.supersedes"))?;
        if !all_ids.insert(item.id.clone()) {
            return Err(ReleaseError(format!(
                "duplicate release item id: {}",
                item.id
            )));
        }
        supersession.insert(item.id.clone(), item.supersedes.clone());
    }
    validate_supersession(&all_ids, &supersession)
}

fn validate_item(item: &KnowledgeItem, location: &str) -> Result<(), ReleaseError> {
    nonempty(&item.id, &format!("{location}.id"))?;
    nonempty(&item.title, &format!("{location}.title"))?;
    nonempty(&item.summary, &format!("{location}.summary"))?;
    validate_provenance(&item.provenance, location)?;
    unique_strings(&item.supersedes, &format!("{location}.supersedes"))
}

fn validate_provenance(refs: &[ProvenanceRef], location: &str) -> Result<(), ReleaseError> {
    if refs.is_empty() {
        return Err(ReleaseError(format!(
            "{location}.provenance must not be empty"
        )));
    }
    let mut ids = BTreeSet::new();
    for (index, reference) in refs.iter().enumerate() {
        let item = format!("{location}.provenance[{index}]");
        nonempty(&reference.id, &format!("{item}.id"))?;
        nonempty(&reference.uri, &format!("{item}.uri"))?;
        if !reference.uri.contains(':') && !reference.uri.starts_with('/') {
            return Err(ReleaseError(format!("{item}.uri must be addressable")));
        }
        validate_hash(&reference.sha256, &format!("{item}.sha256"))?;
        nonempty(&reference.locator, &format!("{item}.locator"))?;
        if !ids.insert(reference.id.as_str()) {
            return Err(ReleaseError(format!(
                "duplicate provenance id: {}",
                reference.id
            )));
        }
    }
    Ok(())
}

fn validate_supersession(
    ids: &BTreeSet<String>,
    graph: &BTreeMap<String, Vec<String>>,
) -> Result<(), ReleaseError> {
    let mut superseded_by = BTreeMap::<String, String>::new();
    for (successor, predecessors) in graph {
        for predecessor in predecessors {
            if predecessor == successor {
                return Err(ReleaseError(format!(
                    "item {successor} cannot supersede itself"
                )));
            }
            if !ids.contains(predecessor) {
                return Err(ReleaseError(format!(
                    "item {successor} supersedes unknown item {predecessor}"
                )));
            }
            if let Some(other) = superseded_by.insert(predecessor.clone(), successor.clone()) {
                return Err(ReleaseError(format!(
                    "item {predecessor} is superseded by both {other} and {successor}"
                )));
            }
        }
    }
    for start in ids {
        let mut seen = BTreeSet::new();
        let mut current = start.as_str();
        while let Some(next) = superseded_by.get(current) {
            if !seen.insert(current) {
                return Err(ReleaseError("supersession graph must be acyclic".into()));
            }
            current = next;
        }
    }
    Ok(())
}

fn canonicalize_state(state: &mut AcceptedProjectState) {
    for items in [
        &mut state.accepted_findings,
        &mut state.decisions,
        &mut state.reusable_patterns,
        &mut state.open_gaps,
    ] {
        for item in &mut *items {
            item.provenance
                .sort_by(|a, b| a.id.cmp(&b.id).then(a.uri.cmp(&b.uri)));
            item.supersedes.sort();
        }
        items.sort_by(|a, b| a.id.cmp(&b.id));
    }
    for item in &mut state.implementation_state {
        item.provenance
            .sort_by(|a, b| a.id.cmp(&b.id).then(a.uri.cmp(&b.uri)));
        item.supersedes.sort();
    }
    state.implementation_state.sort_by(|a, b| a.id.cmp(&b.id));
}

fn nonempty(value: &str, location: &str) -> Result<(), ReleaseError> {
    if value.trim().is_empty() {
        Err(ReleaseError(format!("{location} must be non-empty")))
    } else {
        Ok(())
    }
}

fn validate_hash(value: &str, location: &str) -> Result<(), ReleaseError> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        Err(ReleaseError(format!(
            "{location} must be a 64-character lowercase SHA-256"
        )))
    } else {
        Ok(())
    }
}

fn unique_strings(values: &[String], location: &str) -> Result<(), ReleaseError> {
    let mut seen = BTreeSet::new();
    for value in values {
        nonempty(value, location)?;
        if !seen.insert(value) {
            return Err(ReleaseError(format!(
                "{location} must not contain duplicates"
            )));
        }
    }
    Ok(())
}
