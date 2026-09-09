use crate::knowledge_package::{
    ValidatedKnowledgePackage, load_knowledge_package, validate_package_history,
};
use crate::scope::{InputKind, ValidatedScopes, load_scopes, markdown_export};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fmt::{Display, Formatter, Write as _},
    fs,
    path::{Component, Path, PathBuf},
};

const REGISTRY_MANIFEST: &str = "kb.json";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KbError(pub String);

impl Display for KbError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for KbError {}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct KbRegistration {
    pub id: String,
    pub path: String,
    pub scope_manifest_sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct KbRegistry {
    pub schema_version: u64,
    pub registrations: Vec<KbRegistration>,
    #[serde(default)]
    pub packages: Vec<KbPackageRegistration>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct KbPackageRegistration {
    pub package_id: String,
    pub project_id: String,
    pub release_id: String,
    pub path: String,
}

#[derive(Debug, Clone)]
pub struct RegisteredPackage {
    pub registration: KbPackageRegistration,
    pub root: PathBuf,
    pub package: ValidatedKnowledgePackage,
}

#[derive(Debug, Clone)]
pub struct RegisteredScopes {
    pub registration: KbRegistration,
    pub root: PathBuf,
    pub scopes: ValidatedScopes,
}

#[derive(Debug, Clone)]
pub struct ValidatedKb {
    pub registry: KbRegistry,
    pub registry_root: PathBuf,
    pub registry_path: PathBuf,
    pub registry_sha256: String,
    pub entries: Vec<RegisteredScopes>,
    pub packages: Vec<RegisteredPackage>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct SourceFileObservation {
    pub registration_id: String,
    pub input_id: String,
    pub path: String,
    pub observed_revision: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ParityObservationManifest {
    pub schema_version: u64,
    pub registry_sha256: String,
    #[serde(default)]
    pub source_files: Vec<SourceFileObservation>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GateStatus {
    Passed,
    Failed,
    Unsupported,
    Blocked,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ParityGate {
    pub id: &'static str,
    pub status: GateStatus,
    pub observation: String,
    pub evidence: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ParityAssessment {
    pub schema_version: u64,
    pub command: &'static str,
    pub registry_sha256: String,
    pub parity: bool,
    pub gates: Vec<ParityGate>,
}

/// Loads an explicit KB registry and validates every named Scope root and hash.
///
/// No directories are searched for additional Scope roots. Nested roots are loaded only
/// when they have their own registration.
///
/// # Errors
///
/// Returns an error when the registry or a registered Scope root is unsafe, missing,
/// ambiguous, hash-mismatched, or invalid.
#[allow(clippy::too_many_lines)]
pub fn load_registry(root: &Path) -> Result<ValidatedKb, KbError> {
    let registry_root = root
        .canonicalize()
        .map_err(|error| KbError(format!("cannot resolve KB registry root: {error}")))?;
    if !registry_root.is_dir() {
        return fail("KB registry root is not a directory");
    }
    let registry_path =
        checked_regular_file(&registry_root.join(REGISTRY_MANIFEST), "KB registry")?;
    let bytes = fs::read(&registry_path)
        .map_err(|error| KbError(format!("cannot read {REGISTRY_MANIFEST}: {error}")))?;
    let registry: KbRegistry = serde_json::from_slice(&bytes)
        .map_err(|error| KbError(format!("invalid {REGISTRY_MANIFEST}: {error}")))?;
    if registry.schema_version != 1 && registry.schema_version != 2 {
        return fail("KB registry schema_version must be 1 or 2");
    }
    if registry.schema_version == 1 && !registry.packages.is_empty() {
        return fail("KB registry schema_version 1 must not contain packages");
    }
    if registry.registrations.is_empty() {
        return fail("KB registry registrations must not be empty");
    }

    let mut ids = BTreeSet::new();
    let mut roots = BTreeSet::new();
    let mut entries = Vec::new();
    for registration in &registry.registrations {
        valid_id(&registration.id, "registration id")?;
        if !ids.insert(registration.id.as_str()) {
            return fail(format!("duplicate registration id: {}", registration.id));
        }
        validate_hash(&registration.scope_manifest_sha256)?;
        let declared = safe_absolute(&registration.path, "registered Scope root")?;
        let canonical = declared.canonicalize().map_err(|error| {
            KbError(format!(
                "cannot resolve registered Scope root {}: {error}",
                registration.id
            ))
        })?;
        if canonical != declared {
            return fail(format!(
                "registered Scope root must use its canonical absolute path: {}",
                registration.id
            ));
        }
        if !canonical.is_dir() {
            return fail(format!(
                "registered Scope root is not a directory: {}",
                registration.id
            ));
        }
        if !roots.insert(canonical.clone()) {
            return fail(format!(
                "duplicate registered Scope root: {}",
                canonical.display()
            ));
        }
        let manifest_path = checked_regular_file(&canonical.join("scope.json"), "Scope manifest")?;
        let manifest_bytes = fs::read(&manifest_path).map_err(|error| {
            KbError(format!("cannot read {}: {error}", manifest_path.display()))
        })?;
        if hex_sha256(&manifest_bytes) != registration.scope_manifest_sha256 {
            return fail(format!(
                "Scope manifest hash mismatch for registration {}",
                registration.id
            ));
        }
        let scopes = load_scopes(&canonical).map_err(|error| {
            KbError(format!(
                "invalid registered Scope root {}: {error}",
                registration.id
            ))
        })?;
        entries.push(RegisteredScopes {
            registration: registration.clone(),
            root: canonical,
            scopes,
        });
    }
    entries.sort_by(|left, right| left.registration.id.cmp(&right.registration.id));

    let mut package_ids = BTreeSet::new();
    let mut releases = BTreeSet::new();
    let mut packages = Vec::new();
    for registration in &registry.packages {
        if !package_ids.insert(registration.package_id.as_str()) {
            return fail(format!(
                "duplicate registered package id: {}",
                registration.package_id
            ));
        }
        if !releases.insert((
            registration.project_id.as_str(),
            registration.release_id.as_str(),
        )) {
            return fail(format!(
                "duplicate registered project release: {}/{}",
                registration.project_id, registration.release_id
            ));
        }
        let digest = registration
            .package_id
            .strip_prefix("sha256:")
            .ok_or_else(|| KbError("registered package id must use sha256 identity".into()))?;
        if digest.len() != 64
            || !digest
                .bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        {
            return fail("registered package id must be lowercase sha256");
        }
        let expected = format!("packages/sha256/{digest}");
        if registration.path != expected {
            return fail(
                "registered package path is not its canonical content-addressed KB-owned path",
            );
        }
        let root = registry_root.join(&registration.path);
        let meta = fs::symlink_metadata(&root)
            .map_err(|e| KbError(format!("cannot read registered package root: {e}")))?;
        if meta.file_type().is_symlink() || !meta.is_dir() {
            return fail("registered package root must be a non-symlink directory");
        }
        let package = load_knowledge_package(&root)
            .map_err(|e| KbError(format!("invalid registered package: {e}")))?;
        if package.manifest.package_id != registration.package_id
            || package.manifest.project_id != registration.project_id
            || package.manifest.release_id != registration.release_id
        {
            return fail("registered package identity does not match package bytes");
        }
        packages.push(RegisteredPackage {
            registration: registration.clone(),
            root,
            package,
        });
    }
    packages.sort_by(|a, b| {
        (
            &a.registration.project_id,
            &a.registration.release_id,
            &a.registration.package_id,
        )
            .cmp(&(
                &b.registration.project_id,
                &b.registration.release_id,
                &b.registration.package_id,
            ))
    });
    let mut by_project: BTreeMap<&str, Vec<ValidatedKnowledgePackage>> = BTreeMap::new();
    for package in &packages {
        by_project
            .entry(&package.registration.project_id)
            .or_default()
            .push(package.package.clone());
    }
    for history in by_project.values() {
        validate_package_history(history)
            .map_err(|e| KbError(format!("invalid registered package history: {e}")))?;
    }

    Ok(ValidatedKb {
        registry,
        registry_root,
        registry_path,
        registry_sha256: hex_sha256(&bytes),
        entries,
        packages,
    })
}

/// Loads a strict source-observation manifest pinned to one exact registry.
///
/// # Errors
///
/// Returns an error for an invalid contract, unsafe source path, duplicate or unknown
/// observation, invalid revision, or registry hash mismatch.
pub fn load_parity_observations(
    path: &Path,
    kb: &ValidatedKb,
) -> Result<ParityObservationManifest, KbError> {
    let path = checked_regular_file(path, "parity observation manifest")?;
    let bytes = fs::read(&path)
        .map_err(|error| KbError(format!("cannot read {}: {error}", path.display())))?;
    let manifest: ParityObservationManifest = serde_json::from_slice(&bytes)
        .map_err(|error| KbError(format!("invalid parity observation manifest: {error}")))?;
    if manifest.schema_version != 1 {
        return fail("parity observation schema_version must be 1");
    }
    validate_hash(&manifest.registry_sha256)?;
    if manifest.registry_sha256 != kb.registry_sha256 {
        return fail("parity observations do not pin the loaded KB registry");
    }

    let entries = kb
        .entries
        .iter()
        .map(|entry| (entry.registration.id.as_str(), entry))
        .collect::<BTreeMap<_, _>>();
    let mut observed = BTreeSet::new();
    for source in &manifest.source_files {
        valid_id(
            &source.registration_id,
            "source observation registration id",
        )?;
        valid_id(&source.input_id, "source observation input id")?;
        git_revision(&source.observed_revision, "observed source revision")?;
        let _ = safe_absolute(&source.path, "observed source file")?;
        let Some(entry) = entries.get(source.registration_id.as_str()) else {
            return fail(format!(
                "unknown source observation registration: {}",
                source.registration_id
            ));
        };
        if !entry
            .scopes
            .manifest
            .inputs
            .iter()
            .any(|input| input.id == source.input_id)
        {
            return fail(format!(
                "unknown source observation input: {}/{}",
                source.registration_id, source.input_id
            ));
        }
        if !observed.insert((source.registration_id.as_str(), source.input_id.as_str())) {
            return fail(format!(
                "duplicate source observation: {}/{}",
                source.registration_id, source.input_id
            ));
        }
    }
    Ok(manifest)
}

#[must_use]
pub fn render_list(kb: &ValidatedKb) -> String {
    let mut out = format!(
        "Knowledge base registry: {}\nRegistered roots:\n",
        kb.registry_path.display()
    );
    for entry in &kb.entries {
        let _ = writeln!(
            out,
            "  {} {} {}",
            entry.registration.id,
            entry.registration.scope_manifest_sha256,
            entry.root.display()
        );
        let mut scopes = entry.scopes.manifest.scopes.iter().collect::<Vec<_>>();
        scopes.sort_by(|left, right| left.id.cmp(&right.id));
        for scope in scopes {
            let input_count = entry
                .scopes
                .manifest
                .inputs
                .iter()
                .filter(|input| input.scope_id == scope.id)
                .count();
            let _ = writeln!(
                out,
                "    {} [{}] {} ({} inputs)",
                scope.id, scope.kind, scope.title, input_count
            );
            // Concepts appear under the scope that authored them, because
            // ownership is what decides where transferable knowledge lives.
            let mut concepts = entry
                .scopes
                .manifest
                .concepts
                .iter()
                .filter(|concept| concept.scope_id == scope.id)
                .collect::<Vec<_>>();
            concepts.sort_by(|left, right| left.id.cmp(&right.id));
            for concept in concepts {
                let _ = writeln!(
                    out,
                    "      concept: {} [advisory] {}",
                    concept.id,
                    concept_title(&entry.scopes.root, concept)
                );
            }
        }
    }
    if !kb.packages.is_empty() {
        out.push_str("Owned packages:\n");
        for package in &kb.packages {
            let _ = writeln!(
                out,
                "  {} {} {} {}",
                package.registration.project_id,
                package.registration.release_id,
                package.registration.package_id,
                package.registration.path
            );
        }
    }
    out
}

#[must_use]
pub fn render_tree(kb: &ValidatedKb) -> String {
    let parents = parent_indices(&kb.entries);
    let mut top = parents
        .iter()
        .enumerate()
        .filter_map(|(index, parent)| parent.is_none().then_some(index))
        .collect::<Vec<_>>();
    top.sort_by_key(|index| &kb.entries[*index].registration.id);
    let mut out = String::from("Knowledge Base\n");
    for (position, index) in top.iter().enumerate() {
        render_entry_tree(
            &mut out,
            kb,
            &parents,
            *index,
            "",
            position + 1 == top.len() && kb.packages.is_empty(),
        );
    }
    if !kb.packages.is_empty() {
        out.push_str("└── Owned Packages\n");
        for (index, package) in kb.packages.iter().enumerate() {
            let connector = if index + 1 == kb.packages.len() {
                "    └── "
            } else {
                "    ├── "
            };
            let _ = writeln!(
                out,
                "{connector}Package: {} {} {}",
                package.registration.project_id,
                package.registration.release_id,
                package.registration.package_id
            );
        }
    }
    out
}

#[must_use]
#[allow(clippy::too_many_lines)]
pub fn graph_source(kb: &ValidatedKb) -> String {
    let parents = parent_indices(&kb.entries);
    let mut out = format!(
        "flowchart LR\n  kb[\"Knowledge Base\\n{}\"]\n",
        graph_escape(&kb.registry_path.to_string_lossy())
    );
    for (entry_index, entry) in kb.entries.iter().enumerate() {
        let _ = writeln!(
            out,
            "  r{entry_index}[\"{}\\n{}\"]",
            graph_escape(&entry.registration.id),
            graph_escape(&entry.root.to_string_lossy())
        );
        if let Some(parent) = parents[entry_index] {
            let _ = writeln!(out, "  r{parent} -->|registered| r{entry_index}");
        } else {
            let _ = writeln!(out, "  kb -->|registered| r{entry_index}");
        }

        let mut scopes = entry.scopes.manifest.scopes.iter().collect::<Vec<_>>();
        scopes.sort_by(|left, right| left.id.cmp(&right.id));
        for (scope_index, scope) in scopes.iter().enumerate() {
            let input_count = entry
                .scopes
                .manifest
                .inputs
                .iter()
                .filter(|input| input.scope_id == scope.id)
                .count();
            let _ = writeln!(
                out,
                "  s{entry_index}_{scope_index}[\"{}\\n{}\\n{} inputs\"]",
                graph_escape(&scope.id),
                scope.kind,
                input_count
            );
            let _ = writeln!(
                out,
                "  r{entry_index} -->|contains| s{entry_index}_{scope_index}"
            );
        }

        let mut concepts = entry.scopes.manifest.concepts.iter().collect::<Vec<_>>();
        concepts.sort_by(|left, right| left.id.cmp(&right.id));
        for (concept_index, concept) in concepts.iter().enumerate() {
            let _ = writeln!(
                out,
                "  c{entry_index}_{concept_index}[/\"{}\\nadvisory concept\"/]",
                graph_escape(&concept.id)
            );
            // A Concept is authored by one scope, so the edge starts at its owner
            // rather than at the root.
            if let Some(owner) = scopes.iter().position(|scope| scope.id == concept.scope_id) {
                let _ = writeln!(
                    out,
                    "  s{entry_index}_{owner} -->|authors| c{entry_index}_{concept_index}"
                );
            } else {
                let _ = writeln!(
                    out,
                    "  r{entry_index} -->|contains| c{entry_index}_{concept_index}"
                );
            }
        }

        let mut goals = entry.scopes.manifest.meta_goals.iter().collect::<Vec<_>>();
        goals.sort_by(|left, right| left.id.cmp(&right.id));
        for (goal_index, goal) in goals.iter().enumerate() {
            let _ = writeln!(
                out,
                "  g{entry_index}_{goal_index}{{\"{}\\nadvisory\"}}",
                graph_escape(&goal.id)
            );
            let _ = writeln!(
                out,
                "  r{entry_index} -->|contains| g{entry_index}_{goal_index}"
            );
            for scope_id in &goal.scope_ids {
                if let Some(scope_index) = scopes.iter().position(|scope| scope.id == *scope_id) {
                    let _ = writeln!(
                        out,
                        "  g{entry_index}_{goal_index} -.-> s{entry_index}_{scope_index}"
                    );
                }
            }
            for relationship in &goal.relationships {
                if let Some(target) = goals
                    .iter()
                    .position(|candidate| candidate.id == relationship.to_goal_id)
                {
                    let _ = writeln!(
                        out,
                        "  g{entry_index}_{goal_index} -->|{}| g{entry_index}_{target}",
                        relationship.kind
                    );
                }
            }
        }

        for promotion in &entry.scopes.manifest.promotions {
            let Some(source) = scopes
                .iter()
                .position(|scope| scope.id == promotion.source_topic_id)
            else {
                continue;
            };
            let Some(target) = scopes
                .iter()
                .position(|scope| scope.id == promotion.target_project_id)
            else {
                continue;
            };
            let _ = writeln!(
                out,
                "  s{entry_index}_{source} -->|promotes| s{entry_index}_{target}"
            );
        }
    }
    for (index, package) in kb.packages.iter().enumerate() {
        let _ = writeln!(
            out,
            "  p{index}[\"{}\\n{}\\n{}\"]",
            graph_escape(&package.registration.project_id),
            graph_escape(&package.registration.release_id),
            graph_escape(&package.registration.package_id)
        );
        let _ = writeln!(out, "  kb -->|owns package bytes| p{index}");
        if let Some(reference) = &package.package.manifest.predecessor {
            if let Some(predecessor) = kb
                .packages
                .iter()
                .position(|candidate| candidate.registration.package_id == reference.package_id)
            {
                let _ = writeln!(out, "  p{predecessor} -->|predecessor| p{index}");
            }
        }
        if let Some(reference) = &package.package.manifest.restores {
            if let Some(restored) = kb
                .packages
                .iter()
                .position(|candidate| candidate.registration.package_id == reference.package_id)
            {
                let _ = writeln!(out, "  p{index} -.->|restores| p{restored}");
            }
        }
    }
    out
}

/// Executes the bounded, read-only parity observers implemented by this release.
///
/// Unsupported capabilities and gates requiring a witnessed human trial remain explicit;
/// they are never inferred as passing.
#[must_use]
pub fn assess_parity(
    kb: &ValidatedKb,
    observations: &ParityObservationManifest,
) -> ParityAssessment {
    let source_states = observe_sources(kb, observations);
    let mut gates = vec![
        preservation_gate(
            kb,
            &source_states,
            ReferenceKind::Wikilink,
            "markdown_wikilink_preservation",
        ),
        preservation_gate(
            kb,
            &source_states,
            ReferenceKind::Embed,
            "markdown_embed_preservation",
        ),
        resolution_gate(kb, ReferenceKind::Wikilink, "wikilink_resolution"),
        resolution_gate(kb, ReferenceKind::Embed, "embed_resolution"),
        attachment_gate(kb, &source_states),
        hash_gate(kb),
        deterministic_export_gate(kb),
        ParityGate {
            id: "import_export_round_trip",
            status: GateStatus::Unsupported,
            observation: "No Scope import route exists, so an import/export round trip was not run."
                .into(),
            evidence: vec!["scope export is read-only; scope import is not implemented".into()],
        },
        ParityGate {
            id: "version_history",
            status: GateStatus::Unsupported,
            observation: "Scope snapshots carry pinned history metadata, but no version-store or history traversal route exists."
                .into(),
            evidence: vec![format!(
                "observed {} history records without a version-history operation",
                kb.entries
                    .iter()
                    .flat_map(|entry| &entry.scopes.manifest.scopes)
                    .map(|scope| scope.history.len())
                    .sum::<usize>()
            )],
        },
        ParityGate {
            id: "rollback_recovery",
            status: GateStatus::Unsupported,
            observation: "No Scope rollback, corruption repair, or interrupted-migration recovery operation exists."
                .into(),
            evidence: vec!["immutable validation detects corruption but does not repair it".into()],
        },
        ParityGate {
            id: "human_editability",
            status: GateStatus::Blocked,
            observation: "Practical human editing requires a witnessed editing trial and cannot be inferred from file formats."
                .into(),
            evidence: vec!["no witnessed human-editing observation was executed by this CLI".into()],
        },
        agent_discovery_gate(kb),
    ];
    gates.sort_by_key(|gate| gate_order(gate.id));
    let parity = gates.iter().all(|gate| gate.status == GateStatus::Passed);
    ParityAssessment {
        schema_version: 1,
        command: "kb parity",
        registry_sha256: kb.registry_sha256.clone(),
        parity,
        gates,
    }
}

#[derive(Clone, Copy)]
enum ReferenceKind {
    Wikilink,
    Embed,
}

enum TreeChild<'a> {
    Scope(&'a crate::scope::Scope),
    Concept(&'a crate::scope::ScopeConcept),
    Goal(&'a crate::scope::MetaGoal),
    Entry(usize),
}

impl ReferenceKind {
    const fn label(self) -> &'static str {
        match self {
            Self::Wikilink => "wikilink",
            Self::Embed => "embed",
        }
    }
}

#[derive(Debug)]
enum SourceState {
    Fresh(String),
    Failed(String),
    Blocked(String),
}

fn observe_sources(
    kb: &ValidatedKb,
    observations: &ParityObservationManifest,
) -> BTreeMap<(String, String), SourceState> {
    let mut states = BTreeMap::new();
    for observation in &observations.source_files {
        let key = (
            observation.registration_id.clone(),
            observation.input_id.clone(),
        );
        states.insert(key, observe_source(kb, observation));
    }
    states
}

fn observe_source(kb: &ValidatedKb, observation: &SourceFileObservation) -> SourceState {
    let Some(entry) = kb
        .entries
        .iter()
        .find(|entry| entry.registration.id == observation.registration_id)
    else {
        return SourceState::Blocked(format!(
            "{} registration is unavailable",
            observation.registration_id
        ));
    };
    let Some(input) = entry
        .scopes
        .manifest
        .inputs
        .iter()
        .find(|input| input.id == observation.input_id)
    else {
        return SourceState::Blocked(format!(
            "{}/{} input is unavailable",
            observation.registration_id, observation.input_id
        ));
    };
    let declared = PathBuf::from(&observation.path);
    let metadata = match fs::symlink_metadata(&declared) {
        Ok(metadata) => metadata,
        Err(error) => {
            return SourceState::Blocked(format!(
                "{}/{} source is unreadable: {error}",
                observation.registration_id, observation.input_id
            ));
        }
    };
    if metadata.file_type().is_symlink() || !metadata.file_type().is_file() {
        return SourceState::Blocked(format!(
            "{}/{} source is not a regular non-symlink file",
            observation.registration_id, observation.input_id
        ));
    }
    match declared.canonicalize() {
        Err(error) => {
            return SourceState::Blocked(format!(
                "{}/{} source cannot be resolved: {error}",
                observation.registration_id, observation.input_id
            ));
        }
        Ok(canonical) if canonical != declared => {
            return SourceState::Blocked(format!(
                "{}/{} source path is not canonical",
                observation.registration_id, observation.input_id
            ));
        }
        Ok(_) => {}
    }
    let bytes = match fs::read(&declared) {
        Ok(bytes) => bytes,
        Err(error) => {
            return SourceState::Blocked(format!(
                "{}/{} source cannot be read: {error}",
                observation.registration_id, observation.input_id
            ));
        }
    };
    let object_bytes = match fs::read(entry.root.join(&input.path)) {
        Ok(bytes) => bytes,
        Err(error) => {
            return SourceState::Blocked(format!(
                "{}/{} projected object cannot be read: {error}",
                observation.registration_id, observation.input_id
            ));
        }
    };
    let observed_hash = hex_sha256(&bytes);
    if observation.observed_revision != input.source.revision {
        SourceState::Failed(format!(
            "{}/{} revision differs: declared {}, observed {}",
            observation.registration_id,
            observation.input_id,
            input.source.revision,
            observation.observed_revision
        ))
    } else if observed_hash != input.source.sha256 {
        SourceState::Failed(format!(
            "{}/{} source SHA-256 differs: declared {}, observed {}",
            observation.registration_id, observation.input_id, input.source.sha256, observed_hash
        ))
    } else if bytes != object_bytes {
        SourceState::Failed(format!(
            "{}/{} source and projected object bytes differ",
            observation.registration_id, observation.input_id
        ))
    } else {
        SourceState::Fresh(format!(
            "{}/{} exact source bytes and revision observed at {}",
            observation.registration_id, observation.input_id, observation.path
        ))
    }
}

fn preservation_gate(
    kb: &ValidatedKb,
    source_states: &BTreeMap<(String, String), SourceState>,
    kind: ReferenceKind,
    id: &'static str,
) -> ParityGate {
    let mut relevant = Vec::new();
    let mut reference_count = 0;
    for entry in &kb.entries {
        for input in &entry.scopes.manifest.inputs {
            if input.kind != InputKind::Note {
                continue;
            }
            let Some(metadata) = input.note_validation.as_ref() else {
                continue;
            };
            let count = match kind {
                ReferenceKind::Wikilink => metadata.wikilinks.len(),
                ReferenceKind::Embed => metadata.embeds.len(),
            };
            if count > 0 {
                reference_count += count;
                relevant.push((entry.registration.id.as_str(), input.id.as_str()));
            }
        }
    }
    if relevant.is_empty() {
        return ParityGate {
            id,
            status: GateStatus::Blocked,
            observation: format!("No real Markdown {} syntax was registered.", kind.label()),
            evidence: vec![format!("observed 0 {} references", kind.label())],
        };
    }

    let mut evidence = Vec::new();
    let mut failed = false;
    let mut blocked = false;
    for (registration_id, input_id) in relevant {
        match source_states.get(&(registration_id.to_owned(), input_id.to_owned())) {
            Some(SourceState::Fresh(item)) => evidence.push(item.clone()),
            Some(SourceState::Failed(item)) => {
                failed = true;
                evidence.push(item.clone());
            }
            Some(SourceState::Blocked(item)) => {
                blocked = true;
                evidence.push(item.clone());
            }
            None => {
                blocked = true;
                evidence.push(format!(
                    "{registration_id}/{input_id} has no explicit source-file observation"
                ));
            }
        }
    }
    let status = if failed {
        GateStatus::Failed
    } else if blocked {
        GateStatus::Blocked
    } else {
        GateStatus::Passed
    };
    ParityGate {
        id,
        status,
        observation: format!(
            "Observed {reference_count} real Markdown {} references and compared every containing note with an explicit source file.",
            kind.label()
        ),
        evidence,
    }
}

fn resolution_gate(kb: &ValidatedKb, kind: ReferenceKind, id: &'static str) -> ParityGate {
    let mut reference_count = 0;
    let mut issues = Vec::new();
    for entry in &kb.entries {
        for input in &entry.scopes.manifest.inputs {
            if input.kind != InputKind::Note {
                continue;
            }
            let Some(metadata) = input.note_validation.as_ref() else {
                continue;
            };
            let references = match kind {
                ReferenceKind::Wikilink => &metadata.wikilinks,
                ReferenceKind::Embed => &metadata.embeds,
            };
            for reference in references {
                reference_count += 1;
                let matches = resolution_matches(entry, reference);
                if matches != 1 {
                    issues.push(format!(
                        "{}/{} {} {:?} resolved to {matches} registered source paths",
                        entry.registration.id,
                        input.id,
                        kind.label(),
                        reference
                    ));
                }
            }
        }
    }
    if reference_count == 0 {
        return ParityGate {
            id,
            status: GateStatus::Blocked,
            observation: format!(
                "No real Markdown {} resolution was available to observe.",
                kind.label()
            ),
            evidence: vec![format!("observed 0 {} references", kind.label())],
        };
    }
    if issues.is_empty() {
        ParityGate {
            id,
            status: GateStatus::Passed,
            observation: format!(
                "Resolved all {reference_count} {} references uniquely within their explicit registered Scope root.",
                kind.label()
            ),
            evidence: vec![
                "resolution used only registered input source paths; no filesystem discovery was performed"
                    .into(),
            ],
        }
    } else {
        ParityGate {
            id,
            status: GateStatus::Failed,
            observation: format!(
                "Observed {reference_count} {} references; {} were missing or ambiguous in their registered Scope root.",
                kind.label(),
                issues.len()
            ),
            evidence: issues,
        }
    }
}

fn resolution_matches(entry: &RegisteredScopes, reference: &str) -> usize {
    entry
        .scopes
        .manifest
        .inputs
        .iter()
        .filter(|candidate| crate::scope::reference_matches(reference, &candidate.source.path))
        .map(|candidate| (&candidate.source.path, &candidate.sha256))
        .collect::<BTreeSet<_>>()
        .len()
}

fn attachment_gate(
    kb: &ValidatedKb,
    source_states: &BTreeMap<(String, String), SourceState>,
) -> ParityGate {
    let attachments = kb
        .entries
        .iter()
        .flat_map(|entry| {
            entry
                .scopes
                .manifest
                .inputs
                .iter()
                .filter(|input| input.kind == InputKind::Attachment)
                .map(move |input| (entry.registration.id.as_str(), input.id.as_str()))
        })
        .collect::<Vec<_>>();
    if attachments.is_empty() {
        return ParityGate {
            id: "attachments",
            status: GateStatus::Blocked,
            observation: "No real attachment was registered for observation.".into(),
            evidence: vec!["observed 0 attachment inputs".into()],
        };
    }
    let mut evidence = Vec::new();
    let mut failed = false;
    let mut blocked = false;
    for (registration_id, input_id) in attachments {
        match source_states.get(&(registration_id.to_owned(), input_id.to_owned())) {
            Some(SourceState::Fresh(item)) => evidence.push(item.clone()),
            Some(SourceState::Failed(item)) => {
                failed = true;
                evidence.push(item.clone());
            }
            Some(SourceState::Blocked(item)) => {
                blocked = true;
                evidence.push(item.clone());
            }
            None => {
                blocked = true;
                evidence.push(format!(
                    "{registration_id}/{input_id} has no explicit source-file observation"
                ));
            }
        }
    }
    let status = if failed {
        GateStatus::Failed
    } else if blocked {
        GateStatus::Blocked
    } else {
        GateStatus::Passed
    };
    ParityGate {
        id: "attachments",
        status,
        observation:
            "Compared every registered attachment with an explicit source file and pinned revision."
                .into(),
        evidence,
    }
}

fn hash_gate(kb: &ValidatedKb) -> ParityGate {
    let input_count = kb
        .entries
        .iter()
        .map(|entry| entry.scopes.manifest.inputs.len())
        .sum::<usize>();
    ParityGate {
        id: "content_hashes",
        status: GateStatus::Passed,
        observation: "Validated the exact registry hash, every registered scope.json hash, and every content-addressed input object."
            .into(),
        evidence: vec![
            format!("registry_sha256={}", kb.registry_sha256),
            format!("registered_roots={}", kb.entries.len()),
            format!("content_addressed_inputs={input_count}"),
        ],
    }
}

fn deterministic_export_gate(kb: &ValidatedKb) -> ParityGate {
    let mut evidence = Vec::new();
    for entry in &kb.entries {
        let first = markdown_export(&entry.scopes);
        let second = markdown_export(&entry.scopes);
        if first != second {
            return ParityGate {
                id: "deterministic_export",
                status: GateStatus::Failed,
                observation: format!(
                    "Repeated Markdown export differed for registration {}.",
                    entry.registration.id
                ),
                evidence,
            };
        }
        evidence.push(format!(
            "{} export_sha256={}",
            entry.registration.id,
            hex_sha256(first.as_bytes())
        ));
    }
    ParityGate {
        id: "deterministic_export",
        status: GateStatus::Passed,
        observation:
            "Ran every registered Scope Markdown export twice and observed exact byte equality."
                .into(),
        evidence,
    }
}

fn agent_discovery_gate(kb: &ValidatedKb) -> ParityGate {
    let first = (render_list(kb), render_tree(kb), graph_source(kb));
    let second = (render_list(kb), render_tree(kb), graph_source(kb));
    let deterministic = first == second;
    ParityGate {
        id: "agent_discovery",
        status: if deterministic {
            GateStatus::Passed
        } else {
            GateStatus::Failed
        },
        observation: if deterministic {
            "Observed deterministic list, tree, and graph-source views from one explicit registry without hidden root discovery."
        } else {
            "Repeated registry discovery views differed."
        }
        .into(),
        evidence: vec![
            format!("registered_roots={}", kb.entries.len()),
            "only kb.json registrations were loaded".into(),
        ],
    }
}

fn gate_order(id: &str) -> usize {
    [
        "markdown_wikilink_preservation",
        "markdown_embed_preservation",
        "wikilink_resolution",
        "embed_resolution",
        "attachments",
        "content_hashes",
        "deterministic_export",
        "import_export_round_trip",
        "version_history",
        "rollback_recovery",
        "human_editability",
        "agent_discovery",
    ]
    .iter()
    .position(|candidate| *candidate == id)
    .expect("known parity gate")
}

fn parent_indices(entries: &[RegisteredScopes]) -> Vec<Option<usize>> {
    entries
        .iter()
        .enumerate()
        .map(|(index, entry)| {
            entries
                .iter()
                .enumerate()
                .filter(|(candidate_index, candidate)| {
                    *candidate_index != index
                        && entry.root.starts_with(&candidate.root)
                        && entry.root != candidate.root
                })
                .max_by_key(|(_, candidate)| candidate.root.components().count())
                .map(|(candidate_index, _)| candidate_index)
        })
        .collect()
}

fn render_entry_tree(
    out: &mut String,
    kb: &ValidatedKb,
    parents: &[Option<usize>],
    entry_index: usize,
    prefix: &str,
    last: bool,
) {
    let entry = &kb.entries[entry_index];
    let connector = if last { "└── " } else { "├── " };
    let _ = writeln!(
        out,
        "{prefix}{connector}Root: {} {}",
        entry.registration.id,
        entry.root.display()
    );
    let child_prefix = format!("{prefix}{}", if last { "    " } else { "│   " });

    let mut children = Vec::new();
    let mut scopes = entry.scopes.manifest.scopes.iter().collect::<Vec<_>>();
    scopes.sort_by(|left, right| left.id.cmp(&right.id));
    children.extend(scopes.into_iter().map(TreeChild::Scope));
    let mut concepts = entry.scopes.manifest.concepts.iter().collect::<Vec<_>>();
    concepts.sort_by(|left, right| left.id.cmp(&right.id));
    children.extend(concepts.into_iter().map(TreeChild::Concept));
    let mut goals = entry.scopes.manifest.meta_goals.iter().collect::<Vec<_>>();
    goals.sort_by(|left, right| left.id.cmp(&right.id));
    children.extend(goals.into_iter().map(TreeChild::Goal));
    let mut nested = parents
        .iter()
        .enumerate()
        .filter_map(|(index, parent)| (*parent == Some(entry_index)).then_some(index))
        .collect::<Vec<_>>();
    nested.sort_by_key(|index| &kb.entries[*index].registration.id);
    children.extend(nested.into_iter().map(TreeChild::Entry));

    let total = children.len();
    for (position, child) in children.into_iter().enumerate() {
        let child_last = position + 1 == total;
        let child_connector = if child_last {
            "└── "
        } else {
            "├── "
        };
        match child {
            TreeChild::Scope(scope) => {
                let input_count = entry
                    .scopes
                    .manifest
                    .inputs
                    .iter()
                    .filter(|input| input.scope_id == scope.id)
                    .count();
                let _ = writeln!(
                    out,
                    "{child_prefix}{child_connector}Scope: {} [{}] {} ({} inputs)",
                    scope.id, scope.kind, scope.title, input_count
                );
            }
            TreeChild::Concept(concept) => {
                // Reading the pinned bytes lets the tree show the invariant the
                // Concept teaches, which is the part worth seeing at a glance.
                let title = concept_title(&entry.scopes.root, concept);
                let _ = writeln!(
                    out,
                    "{child_prefix}{child_connector}{} [concept] {} [advisory] <- {}",
                    concept.id, title, concept.scope_id
                );
            }
            TreeChild::Goal(goal) => {
                let _ = writeln!(
                    out,
                    "{child_prefix}{child_connector}Meta Goal: {} [advisory] {} -> {}",
                    goal.id,
                    goal.title,
                    goal.scope_ids.join(", ")
                );
            }
            TreeChild::Entry(index) => {
                render_entry_tree(out, kb, parents, index, &child_prefix, child_last);
            }
        }
    }
}

/// Reads a pinned Concept's title for display.
///
/// Validation already proved the bytes match the pin, so a read failure here is
/// reported as unreadable rather than silently shown as a valid Concept.
fn concept_title(root: &Path, concept: &crate::scope::ScopeConcept) -> String {
    let Ok(text) = fs::read_to_string(root.join(&concept.path)) else {
        return "(unreadable)".into();
    };
    match crate::concept::validate_concept_json(&text) {
        Ok(parsed) => parsed.title,
        Err(_) => "(invalid)".into(),
    }
}

fn checked_regular_file(path: &Path, label: &str) -> Result<PathBuf, KbError> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| KbError(format!("cannot read {label} {}: {error}", path.display())))?;
    if metadata.file_type().is_symlink() || !metadata.file_type().is_file() {
        return fail(format!(
            "{label} is not a regular non-symlink file: {}",
            path.display()
        ));
    }
    path.canonicalize()
        .map_err(|error| KbError(format!("cannot resolve {label}: {error}")))
}

fn safe_absolute(value: &str, label: &str) -> Result<PathBuf, KbError> {
    display_text(value, label)?;
    let path = PathBuf::from(value);
    if !path.is_absolute()
        || path.components().any(|component| {
            !matches!(
                component,
                Component::Prefix(_) | Component::RootDir | Component::Normal(_)
            )
        })
    {
        return fail(format!("unsafe {label}: {value}"));
    }
    Ok(path)
}

fn valid_id(value: &str, label: &str) -> Result<(), KbError> {
    display_text(value, label)?;
    if value.len() > 128
        || !value.as_bytes()[0].is_ascii_alphanumeric()
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
    {
        return fail(format!("invalid {label}: {value:?}"));
    }
    Ok(())
}

fn display_text(value: &str, label: &str) -> Result<(), KbError> {
    if value.trim().is_empty()
        || value != value.trim()
        || value.chars().any(|character| {
            character == '\r'
                || character == '\n'
                || character <= '\u{001f}'
                || ('\u{007f}'..='\u{009f}').contains(&character)
        })
    {
        return fail(format!("invalid {label}"));
    }
    Ok(())
}

fn validate_hash(value: &str) -> Result<(), KbError> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return fail("invalid SHA-256");
    }
    Ok(())
}

fn git_revision(value: &str, label: &str) -> Result<(), KbError> {
    if value.len() != 40
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return fail(format!(
            "{label} must be 40 lowercase hexadecimal characters"
        ));
    }
    Ok(())
}

fn graph_escape(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('[', "&#91;")
        .replace(']', "&#93;")
        .replace('{', "&#123;")
        .replace('}', "&#125;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn hex_sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn fail<T>(message: impl Into<String>) -> Result<T, KbError> {
    Err(KbError(message.into()))
}
