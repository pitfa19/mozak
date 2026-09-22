//! Deterministic, read-only projection of already validated MOZAK state.
//!
//! This module deliberately does not discover files or decide which artifacts
//! are authoritative. Callers validate the source artifacts first, then pass
//! their pinned and observed hashes here. The projection fails closed on drift,
//! preserves each item's authority, and provides no mutation or promotion path.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::fmt::{Display, Formatter};
use std::path::{Component, Path};

pub const CONTRACT_VERSION: u64 = 1;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CurrentStateError(pub String);

impl Display for CurrentStateError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for CurrentStateError {}

/// The authority carried by one validated artifact or derived relationship.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum Authority {
    Authoritative,
    Accepted,
    AdvisoryOnly,
    ProposalOnly,
}

/// Freshness is observation metadata, not an authority claim.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum Freshness {
    Current,
    Stale,
    NotChecked,
}

/// Closed set of validated artifact families that may feed the projection.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum SourceKind {
    ProjectManifest,
    ProjectOverview,
    AdapterRegistry,
    KnowledgeBase,
    ResearchRun,
    PlanningArtifact,
}

/// Closed set of item families represented in current state.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum NodeKind {
    Project,
    Goal,
    Plan,
    AdapterBinding,
    ResearchRun,
    KnowledgeBase,
    Finding,
    Scope,
    Concept,
    Translation,
    Package,
}

/// Closed set of relationships. Adding a new semantic edge changes the
/// contract instead of allowing an unreviewed string to acquire meaning.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum RelationshipKind {
    Observes,
    Uses,
    Supersedes,
    Supports,
    DependsOn,
    RegisteredIn,
    DerivedFrom,
}

/// A validated artifact used to derive the projection.
#[derive(Debug, Clone, Serialize, PartialEq, Eq, PartialOrd, Ord)]
pub struct ProjectionSource {
    id: String,
    kind: SourceKind,
    path: String,
    pinned_sha256: String,
    observed_sha256: String,
    authority: Authority,
    freshness: Freshness,
}

impl ProjectionSource {
    /// Observe one already validated artifact and pin the exact bytes used by
    /// the projection. The observed digest is computed here, never reported by
    /// the caller.
    ///
    /// # Errors
    /// Returns an error when the source identity, path, or pin is invalid, or
    /// when the supplied bytes do not match the pin.
    pub fn observe(
        id: impl Into<String>,
        kind: SourceKind,
        path: impl Into<String>,
        pinned_sha256: impl Into<String>,
        content: &[u8],
        authority: Authority,
        freshness: Freshness,
    ) -> Result<Self, CurrentStateError> {
        let value = Self {
            id: id.into(),
            kind,
            path: path.into(),
            pinned_sha256: pinned_sha256.into(),
            observed_sha256: format!("{:x}", Sha256::digest(content)),
            authority,
            freshness,
        };
        validate_source(&value)?;
        Ok(value)
    }

    #[must_use]
    pub fn id(&self) -> &str {
        &self.id
    }

    #[must_use]
    pub const fn authority(&self) -> Authority {
        self.authority
    }
}

/// One typed item displayed by the projection.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(deny_unknown_fields)]
pub struct StateNode {
    pub id: String,
    pub kind: NodeKind,
    pub label: String,
    pub status: String,
    pub source_id: String,
    pub authority: Authority,
}

/// One provenance-pinned relationship between displayed items.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(deny_unknown_fields)]
pub struct StateRelationship {
    pub from: String,
    pub relation: RelationshipKind,
    pub to: String,
    pub source_id: String,
    pub authority: Authority,
}

/// Explicit inputs supplied only after their artifacts have been validated.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct CurrentStateInput {
    pub contract_version: u64,
    pub project_id: String,
    pub sources: Vec<ProjectionSource>,
    pub nodes: Vec<StateNode>,
    pub relationships: Vec<StateRelationship>,
}

/// Canonical projection. It is a view only and carries explicit negative
/// capability flags so consumers cannot mistake it for an execution artifact.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct CurrentStateProjection {
    pub schema_version: u64,
    pub project_id: String,
    pub mutation: bool,
    pub automatic_promotion: bool,
    pub sources: Vec<ProjectionSource>,
    pub nodes: Vec<StateNode>,
    pub relationships: Vec<StateRelationship>,
}

/// Validate explicit source pins and produce a deterministically ordered,
/// read-only current-state projection.
///
/// # Errors
/// Returns the first deterministic contract violation, including any observed
/// source hash that differs from its pinned hash.
pub fn project_current_state(
    mut input: CurrentStateInput,
) -> Result<CurrentStateProjection, CurrentStateError> {
    require(
        input.contract_version == CONTRACT_VERSION,
        "unsupported current-state contract_version",
    )?;
    identifier(&input.project_id, "project_id")?;
    require(!input.sources.is_empty(), "sources must not be empty")?;
    require(!input.nodes.is_empty(), "nodes must not be empty")?;

    input.sources.sort();
    input.nodes.sort();
    input.relationships.sort();

    let mut source_ids = BTreeSet::new();
    for source in &input.sources {
        validate_source(source)?;
        require(source_ids.insert(&source.id), "duplicate source id")?;
    }

    let mut node_ids = BTreeSet::new();
    for node in &input.nodes {
        identifier(&node.id, "node id")?;
        nonempty(&node.label, "node label")?;
        token(&node.status, "node status")?;
        require(
            source_ids.contains(&node.source_id),
            "node source is unknown",
        )?;
        let source = source(&input.sources, &node.source_id);
        require(
            node.authority == source.authority,
            "node authority differs from its source",
        )?;
        require(node_ids.insert(&node.id), "duplicate node id")?;
    }

    let mut relationships = BTreeSet::new();
    for relationship in &input.relationships {
        require(
            node_ids.contains(&relationship.from),
            "relationship source node is unknown",
        )?;
        require(
            node_ids.contains(&relationship.to),
            "relationship target node is unknown",
        )?;
        require(
            source_ids.contains(&relationship.source_id),
            "relationship provenance source is unknown",
        )?;
        let source = source(&input.sources, &relationship.source_id);
        require(
            relationship.authority == source.authority,
            "relationship authority differs from its source",
        )?;
        require(relationships.insert(relationship), "duplicate relationship")?;
    }

    Ok(CurrentStateProjection {
        schema_version: CONTRACT_VERSION,
        project_id: input.project_id,
        mutation: false,
        automatic_promotion: false,
        sources: input.sources,
        nodes: input.nodes,
        relationships: input.relationships,
    })
}

fn validate_source(source: &ProjectionSource) -> Result<(), CurrentStateError> {
    identifier(&source.id, "source id")?;
    safe_path(&source.path)?;
    sha256(&source.pinned_sha256, "pinned_sha256")?;
    sha256(&source.observed_sha256, "observed_sha256")?;
    require(
        source.pinned_sha256 == source.observed_sha256,
        &format!("source {} hash drifted", source.id),
    )
}

fn source<'a>(sources: &'a [ProjectionSource], id: &str) -> &'a ProjectionSource {
    sources
        .iter()
        .find(|source| source.id == id)
        .expect("source existence checked before lookup")
}

fn identifier(value: &str, field: &str) -> Result<(), CurrentStateError> {
    require(
        !value.is_empty()
            && value.bytes().all(|byte| {
                byte.is_ascii_lowercase()
                    || byte.is_ascii_digit()
                    || matches!(byte, b'-' | b'_' | b'.' | b':')
            }),
        &format!("{field} has invalid identifier syntax"),
    )
}

fn token(value: &str, field: &str) -> Result<(), CurrentStateError> {
    require(
        !value.is_empty()
            && value
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_'),
        &format!("{field} must be lowercase snake_case"),
    )
}

fn safe_path(value: &str) -> Result<(), CurrentStateError> {
    nonempty(value, "source path")?;
    require(
        !value.bytes().any(|byte| byte.is_ascii_control()),
        "source path contains control characters",
    )?;
    let path = Path::new(value);
    let safe = path.components().all(|component| {
        matches!(
            component,
            Component::Prefix(_) | Component::RootDir | Component::Normal(_)
        )
    });
    require(safe, "source path contains unsafe components")
}

fn sha256(value: &str, field: &str) -> Result<(), CurrentStateError> {
    require(
        value.len() == 64
            && value
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase()),
        &format!("{field} must be 64 lowercase hexadecimal characters"),
    )
}

fn nonempty(value: &str, field: &str) -> Result<(), CurrentStateError> {
    require(
        !value.trim().is_empty(),
        &format!("{field} must not be empty"),
    )
}

fn require(condition: bool, message: &str) -> Result<(), CurrentStateError> {
    if condition {
        Ok(())
    } else {
        Err(CurrentStateError(message.to_owned()))
    }
}
