//! Deterministic, read-only projection of validated MOZAK domain artifacts.
//!
//! Sources can only be constructed by the real project, adapter, KB, and
//! research validators. Nodes derive authority from those sealed sources, and
//! relationships use a closed semantic matrix. The projection performs no
//! discovery, mutation, acceptance, recommendation, execution, or promotion.

use crate::{
    adapter::{AdapterBinding, AdapterRegistry, validate_adapter_registry_json},
    kb::ValidatedKb,
    kb::load_registry,
    project_contract::{ProjectManifest, validate_project_yaml},
    research::{ResearchRun, validate_run_json},
};
use serde::Serialize;
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

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum Authority {
    Authoritative,
    AdvisoryOnly,
    ProposalOnly,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum Freshness {
    Current,
    Stale,
    NotChecked,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum SourceKind {
    ProjectManifest,
    AdapterRegistry,
    KnowledgeBase,
    ResearchRun,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum NodeKind {
    Project,
    AdapterBinding,
    KnowledgeBase,
    Scope,
    ResearchRun,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum RelationshipKind {
    Observes,
    RegisteredIn,
    Targets,
}

/// A sealed reference to bytes or state accepted by a real MOZAK validator.
#[derive(Debug, Clone, Serialize, PartialEq, Eq, PartialOrd, Ord)]
pub struct ProjectionSource {
    id: String,
    kind: SourceKind,
    path: String,
    sha256: String,
    authority: Authority,
    freshness: Freshness,
    #[serde(skip)]
    facts: SourceFacts,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum SourceFacts {
    ProjectManifest {
        project_id: String,
        project_name: String,
    },
    AdapterRegistry {
        bindings: Vec<BindingFact>,
    },
    KnowledgeBase {
        scopes: Vec<ScopeFact>,
    },
    ResearchRun {
        run_id: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct BindingFact {
    id: String,
    target_scope_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct ScopeFact {
    id: String,
    title: String,
}

impl ProjectionSource {
    /// Validate project manifest bytes and construct their authoritative source.
    ///
    /// # Errors
    /// Returns an error when the path is unsafe or the real project validator rejects the bytes.
    pub fn project_manifest(
        path: impl Into<String>,
        bytes: &[u8],
        freshness: Freshness,
    ) -> Result<(Self, ProjectManifest), CurrentStateError> {
        let text = std::str::from_utf8(bytes).map_err(|error| {
            CurrentStateError(format!("project manifest is not UTF-8: {error}"))
        })?;
        let manifest = validate_project_yaml(text).map_err(|error| CurrentStateError(error.0))?;
        let source = Self::validated(
            format!("project-manifest:{}", manifest.project.id),
            SourceKind::ProjectManifest,
            path.into(),
            hash(bytes),
            Authority::Authoritative,
            freshness,
            SourceFacts::ProjectManifest {
                project_id: manifest.project.id.clone(),
                project_name: manifest.project.name.clone(),
            },
        )?;
        Ok((source, manifest))
    }

    /// Validate adapter-registry bytes and construct their authoritative source.
    ///
    /// # Errors
    /// Returns an error when the path is unsafe or the shared adapter validator rejects the bytes.
    pub fn adapter_registry(
        path: impl Into<String>,
        bytes: &[u8],
        freshness: Freshness,
    ) -> Result<(Self, AdapterRegistry), CurrentStateError> {
        let text = std::str::from_utf8(bytes).map_err(|error| {
            CurrentStateError(format!("adapter registry is not UTF-8: {error}"))
        })?;
        let registry =
            validate_adapter_registry_json(text).map_err(|error| CurrentStateError(error.0))?;
        let source = Self::validated(
            "adapter-registry".into(),
            SourceKind::AdapterRegistry,
            path.into(),
            hash(bytes),
            Authority::Authoritative,
            freshness,
            SourceFacts::AdapterRegistry {
                bindings: registry
                    .bindings
                    .iter()
                    .map(|binding| BindingFact {
                        id: binding.id.clone(),
                        target_scope_id: binding.target_scope_id.clone(),
                    })
                    .collect(),
            },
        )?;
        Ok((source, registry))
    }

    /// Load and validate a KB registry root, then construct its advisory source.
    ///
    /// # Errors
    /// Returns an error when `kb::load_registry` rejects the root or the validator-produced
    /// registry path or hash is unsafe.
    pub fn knowledge_base(
        root: &Path,
        freshness: Freshness,
    ) -> Result<(Self, ValidatedKb), CurrentStateError> {
        let validated = load_registry(root).map_err(|error| CurrentStateError(error.0))?;
        let source = Self::validated(
            "knowledge-base".into(),
            SourceKind::KnowledgeBase,
            display_path(&validated.registry_path)?,
            validated.registry_sha256.clone(),
            Authority::AdvisoryOnly,
            freshness,
            SourceFacts::KnowledgeBase {
                scopes: validated
                    .entries
                    .iter()
                    .flat_map(|entry| &entry.scopes.manifest.scopes)
                    .map(|scope| ScopeFact {
                        id: scope.id.clone(),
                        title: scope.title.clone(),
                    })
                    .collect(),
            },
        )?;
        Ok((source, validated))
    }

    /// Validate research-run bytes and construct their proposal-only source.
    ///
    /// # Errors
    /// Returns an error when the path is unsafe or the research validator rejects the bytes.
    pub fn research_run(
        path: impl Into<String>,
        bytes: &[u8],
        freshness: Freshness,
    ) -> Result<(Self, ResearchRun), CurrentStateError> {
        let text = std::str::from_utf8(bytes)
            .map_err(|error| CurrentStateError(format!("research run is not UTF-8: {error}")))?;
        let run = validate_run_json(text).map_err(|error| CurrentStateError(error.0))?;
        let source = Self::validated(
            format!("research-run:{}", run.run_id),
            SourceKind::ResearchRun,
            path.into(),
            hash(bytes),
            Authority::ProposalOnly,
            freshness,
            SourceFacts::ResearchRun {
                run_id: run.run_id.clone(),
            },
        )?;
        Ok((source, run))
    }

    fn validated(
        id: String,
        kind: SourceKind,
        path: String,
        sha256: String,
        authority: Authority,
        freshness: Freshness,
        facts: SourceFacts,
    ) -> Result<Self, CurrentStateError> {
        identifier(&id, "source id")?;
        safe_path(&path)?;
        validate_sha256(&sha256)?;
        Ok(Self {
            id,
            kind,
            path,
            sha256,
            authority,
            freshness,
            facts,
        })
    }

    #[must_use]
    pub fn id(&self) -> &str {
        &self.id
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, PartialOrd, Ord)]
pub struct StateNode {
    id: String,
    domain_id: String,
    kind: NodeKind,
    label: String,
    status: String,
    source_id: String,
    authority: Authority,
}

impl StateNode {
    /// Construct the project node from a validated manifest and its sealed source.
    ///
    /// # Errors
    /// Returns an error when the source kind or derived identity is invalid.
    pub fn project(
        source: &ProjectionSource,
        manifest: &ProjectManifest,
    ) -> Result<Self, CurrentStateError> {
        require_source(source, SourceKind::ProjectManifest)?;
        let SourceFacts::ProjectManifest {
            project_id,
            project_name,
        } = &source.facts
        else {
            return Err(CurrentStateError("project source facts are invalid".into()));
        };
        require(
            manifest.project.id == *project_id && manifest.project.name == *project_name,
            "project node manifest must match the validated project source",
        )?;
        Self::new(
            format!("project:{}", manifest.project.id),
            manifest.project.id.clone(),
            NodeKind::Project,
            manifest.project.name.clone(),
            "valid",
            source,
        )
    }

    /// Construct one adapter-binding node from a validated registry entry.
    ///
    /// # Errors
    /// Returns an error when the source kind or derived identity is invalid.
    pub fn adapter_binding(
        source: &ProjectionSource,
        binding: &AdapterBinding,
    ) -> Result<Self, CurrentStateError> {
        require_source(source, SourceKind::AdapterRegistry)?;
        require(
            source
                .binding_fact(&binding.id)
                .is_some_and(|fact| fact.target_scope_id == binding.target_scope_id),
            "adapter binding must match the validated adapter source",
        )?;
        Self::new(
            format!("adapter:{}", binding.id),
            binding.id.clone(),
            NodeKind::AdapterBinding,
            binding.id.clone(),
            "ready",
            source,
        )
    }

    /// Construct the KB node from a handle returned by `kb::load_registry`.
    ///
    /// # Errors
    /// Returns an error when the source kind or label is invalid.
    pub fn knowledge_base(
        source: &ProjectionSource,
        label: impl Into<String>,
    ) -> Result<Self, CurrentStateError> {
        require_source(source, SourceKind::KnowledgeBase)?;
        Self::new(
            "knowledge-base".into(),
            "knowledge-base".into(),
            NodeKind::KnowledgeBase,
            label.into(),
            "valid",
            source,
        )
    }

    /// Construct one registered Scope node under a validated KB source.
    ///
    /// # Errors
    /// Returns an error when the source kind, id, or label is invalid.
    pub fn scope(
        source: &ProjectionSource,
        id: &str,
        label: impl Into<String>,
    ) -> Result<Self, CurrentStateError> {
        require_source(source, SourceKind::KnowledgeBase)?;
        identifier(id, "scope id")?;
        let label = label.into();
        require(
            source
                .scope_fact(id)
                .is_some_and(|fact| fact.title == label),
            "scope node must match a Scope loaded by the validated KB source",
        )?;
        Self::new(
            format!("scope:{id}"),
            id.to_owned(),
            NodeKind::Scope,
            label,
            "valid",
            source,
        )
    }

    /// Construct a research node from a run accepted by the research validator.
    ///
    /// # Errors
    /// Returns an error when the source kind or run identity is invalid.
    pub fn research_run(
        source: &ProjectionSource,
        run: &ResearchRun,
    ) -> Result<Self, CurrentStateError> {
        require_source(source, SourceKind::ResearchRun)?;
        require(
            matches!(&source.facts, SourceFacts::ResearchRun { run_id } if run.run_id == *run_id),
            "research run must match the validated research source",
        )?;
        Self::new(
            format!("research:{}", run.run_id),
            run.run_id.clone(),
            NodeKind::ResearchRun,
            run.run_id.clone(),
            "valid",
            source,
        )
    }

    fn new(
        id: String,
        domain_id: String,
        kind: NodeKind,
        label: String,
        status: &str,
        source: &ProjectionSource,
    ) -> Result<Self, CurrentStateError> {
        identifier(&id, "node id")?;
        identifier(&domain_id, "node domain id")?;
        nonempty(&label, "node label")?;
        Ok(Self {
            id,
            domain_id,
            kind,
            label,
            status: status.into(),
            source_id: source.id.clone(),
            authority: source.authority,
        })
    }

    #[must_use]
    pub fn id(&self) -> &str {
        &self.id
    }

    #[must_use]
    pub fn domain_id(&self) -> &str {
        &self.domain_id
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, PartialOrd, Ord)]
pub struct StateRelationship {
    from: String,
    relation: RelationshipKind,
    to: String,
    source_id: String,
    authority: Authority,
}

impl StateRelationship {
    /// Relate one validated research run to the project or Scope it observes.
    ///
    /// # Errors
    /// Returns an error for invalid endpoint kinds or mismatched provenance.
    pub fn observes(
        research: &StateNode,
        target: &StateNode,
        source: &ProjectionSource,
    ) -> Result<Self, CurrentStateError> {
        require(
            research.kind == NodeKind::ResearchRun,
            "observes source must be a research run",
        )?;
        require(
            matches!(target.kind, NodeKind::Project | NodeKind::Scope),
            "observes target must be a project or scope",
        )?;
        require_source(source, SourceKind::ResearchRun)?;
        require(
            research.source_id == source.id,
            "observes provenance must be the research source",
        )?;
        Ok(Self::new(
            research,
            RelationshipKind::Observes,
            target,
            source,
        ))
    }

    /// Relate one registered Scope to its validated KB.
    ///
    /// # Errors
    /// Returns an error for invalid endpoint kinds or mismatched provenance.
    pub fn registered_in(
        scope: &StateNode,
        kb: &StateNode,
        source: &ProjectionSource,
    ) -> Result<Self, CurrentStateError> {
        require(
            scope.kind == NodeKind::Scope,
            "registered_in source must be a scope",
        )?;
        require(
            kb.kind == NodeKind::KnowledgeBase,
            "registered_in target must be a knowledge base",
        )?;
        require_source(source, SourceKind::KnowledgeBase)?;
        require(
            kb.source_id == source.id,
            "registered_in provenance must be the KB source",
        )?;
        Ok(Self::new(scope, RelationshipKind::RegisteredIn, kb, source))
    }

    /// Relate one configured adapter binding to its target Scope.
    ///
    /// # Errors
    /// Returns an error for invalid endpoint kinds or mismatched provenance.
    pub fn targets(
        binding: &StateNode,
        adapter_binding: &AdapterBinding,
        scope: &StateNode,
        source: &ProjectionSource,
    ) -> Result<Self, CurrentStateError> {
        require(
            binding.kind == NodeKind::AdapterBinding,
            "targets source must be an adapter binding",
        )?;
        require(
            scope.kind == NodeKind::Scope,
            "targets target must be a scope",
        )?;
        require_source(source, SourceKind::AdapterRegistry)?;
        require(
            source
                .binding_fact(&adapter_binding.id)
                .is_some_and(|fact| fact.target_scope_id == adapter_binding.target_scope_id),
            "targets binding must come from the validated adapter source",
        )?;
        require(
            binding.source_id == source.id,
            "targets provenance must be the adapter source",
        )?;
        require(
            binding.domain_id == adapter_binding.id,
            "targets binding node must match the validated adapter binding",
        )?;
        require(
            scope.domain_id == adapter_binding.target_scope_id,
            "targets scope must match the validated adapter target_scope_id",
        )?;
        Ok(Self::new(binding, RelationshipKind::Targets, scope, source))
    }

    fn new(
        from: &StateNode,
        relation: RelationshipKind,
        to: &StateNode,
        source: &ProjectionSource,
    ) -> Self {
        Self {
            from: from.id.clone(),
            relation,
            to: to.id.clone(),
            source_id: source.id.clone(),
            authority: source.authority,
        }
    }
}

impl ProjectionSource {
    fn binding_fact(&self, id: &str) -> Option<&BindingFact> {
        match &self.facts {
            SourceFacts::AdapterRegistry { bindings } => {
                bindings.iter().find(|binding| binding.id == id)
            }
            _ => None,
        }
    }

    fn scope_fact(&self, id: &str) -> Option<&ScopeFact> {
        match &self.facts {
            SourceFacts::KnowledgeBase { scopes } => scopes.iter().find(|scope| scope.id == id),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct CurrentStateInput {
    project_id: String,
    sources: Vec<ProjectionSource>,
    nodes: Vec<StateNode>,
    relationships: Vec<StateRelationship>,
}

impl CurrentStateInput {
    /// Assemble sealed sources, nodes, and relationships into projection input.
    ///
    /// # Errors
    /// Returns an error for duplicates or missing provenance references.
    pub fn new(
        project_id: impl Into<String>,
        sources: Vec<ProjectionSource>,
        nodes: Vec<StateNode>,
        relationships: Vec<StateRelationship>,
    ) -> Result<Self, CurrentStateError> {
        let value = Self {
            project_id: project_id.into(),
            sources,
            nodes,
            relationships,
        };
        validate_input(&value)?;
        Ok(value)
    }
}

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

/// Canonically order and emit a read-only projection.
///
/// # Errors
/// Returns an error when the sealed input no longer satisfies referential integrity.
pub fn project_current_state(
    mut input: CurrentStateInput,
) -> Result<CurrentStateProjection, CurrentStateError> {
    validate_input(&input)?;
    input.sources.sort();
    input.nodes.sort();
    input.relationships.sort();
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

fn validate_input(input: &CurrentStateInput) -> Result<(), CurrentStateError> {
    identifier(&input.project_id, "project_id")?;
    require(!input.sources.is_empty(), "sources must not be empty")?;
    require(!input.nodes.is_empty(), "nodes must not be empty")?;
    let source_ids = input
        .sources
        .iter()
        .map(|source| source.id.as_str())
        .collect::<BTreeSet<_>>();
    require(
        source_ids.len() == input.sources.len(),
        "duplicate source id",
    )?;
    let node_ids = input
        .nodes
        .iter()
        .map(|node| node.id.as_str())
        .collect::<BTreeSet<_>>();
    require(node_ids.len() == input.nodes.len(), "duplicate node id")?;
    require(
        input
            .nodes
            .iter()
            .all(|node| source_ids.contains(node.source_id.as_str())),
        "node source is unknown",
    )?;
    require(
        input.relationships.iter().all(|relationship| {
            node_ids.contains(relationship.from.as_str())
                && node_ids.contains(relationship.to.as_str())
                && source_ids.contains(relationship.source_id.as_str())
        }),
        "relationship references an unknown node or source",
    )?;
    let relationships = input.relationships.iter().collect::<BTreeSet<_>>();
    require(
        relationships.len() == input.relationships.len(),
        "duplicate relationship",
    )
}

fn require_source(source: &ProjectionSource, kind: SourceKind) -> Result<(), CurrentStateError> {
    require(
        source.kind == kind,
        "node or relationship uses the wrong source kind",
    )
}

fn display_path(path: &Path) -> Result<String, CurrentStateError> {
    path.to_str()
        .map(str::to_owned)
        .ok_or_else(|| CurrentStateError("source path is not UTF-8".into()))
}

fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
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

fn safe_path(value: &str) -> Result<(), CurrentStateError> {
    nonempty(value, "source path")?;
    require(
        !value.bytes().any(|byte| byte.is_ascii_control()),
        "source path contains control characters",
    )?;
    require(
        Path::new(value).components().all(|component| {
            matches!(
                component,
                Component::Prefix(_) | Component::RootDir | Component::Normal(_)
            )
        }),
        "source path contains unsafe components",
    )
}

fn validate_sha256(value: &str) -> Result<(), CurrentStateError> {
    require(
        value.len() == 64
            && value
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase()),
        "source sha256 must be 64 lowercase hexadecimal characters",
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
