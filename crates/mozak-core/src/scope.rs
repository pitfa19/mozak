use crate::project_contract::validate_project_yaml;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fmt::{Display, Formatter},
    fs,
    path::{Component, Path, PathBuf},
};

const MANIFEST: &str = "scope.json";
const PROJECT_MANIFEST: &str = ".mozak/project.yml";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct LinkIngestionPlan {
    pub schema_version: u64,
    pub scope_manifest_sha256: String,
    pub observed_revision: String,
    pub scope_id: String,
    pub history_entry: HistoryEntry,
    pub existing_source_input_ids: Vec<String>,
    pub inclusions: Vec<LinkInclusion>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct LinkInclusion {
    pub input_id: String,
    pub kind: InputKind,
    pub source_path: String,
    pub source_sha256: String,
    pub media_type: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct LinkIngestionReceipt {
    pub schema_version: u64,
    pub command: &'static str,
    pub auto_discovery: bool,
    pub authority: &'static str,
    pub scope_id: String,
    pub observed_revision: String,
    pub plan_sha256: String,
    pub input_scope_manifest_sha256: String,
    pub output_scope_manifest_sha256: String,
    pub added_input_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScopeError(pub String);
impl Display for ScopeError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for ScopeError {}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum ScopeKind {
    Topic,
    Project,
}
impl Display for ScopeKind {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Topic => "topic",
            Self::Project => "project",
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Scope {
    pub id: String,
    pub kind: ScopeKind,
    pub title: String,
    pub intent: String,
    #[serde(default)]
    pub history: Vec<HistoryEntry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project: Option<ProjectBinding>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct HistoryEntry {
    pub id: String,
    pub at: String,
    pub note: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProjectBinding {
    pub manifest_path: String,
    pub manifest_sha256: String,
    pub project_id: String,
    pub repository_revision: String,
    pub owned_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(deny_unknown_fields)]
pub struct Promotion {
    pub id: String,
    pub source_topic_id: String,
    pub target_project_id: String,
    pub source_topic_sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum GoalRelationshipKind {
    Supports,
    DependsOn,
    RelatedTo,
}
impl Display for GoalRelationshipKind {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Supports => "supports",
            Self::DependsOn => "depends_on",
            Self::RelatedTo => "related_to",
        })
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct MetaGoal {
    pub id: String,
    pub title: String,
    pub authority: GoalAuthority,
    pub scope_ids: Vec<String>,
    #[serde(default)]
    pub relationships: Vec<GoalRelationship>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GoalAuthority {
    AdvisoryOnly,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(deny_unknown_fields)]
pub struct GoalRelationship {
    pub to_goal_id: String,
    pub kind: GoalRelationshipKind,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum InputKind {
    Note,
    Attachment,
}
impl Display for InputKind {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Note => "note",
            Self::Attachment => "attachment",
        })
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ExternalInput {
    pub id: String,
    pub scope_id: String,
    pub kind: InputKind,
    pub path: String,
    pub sha256: String,
    pub media_type: String,
    pub source: InputSource,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note_validation: Option<NoteValidation>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct InputSource {
    pub path: String,
    pub revision: String,
    pub sha256: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct NoteValidation {
    pub wikilinks: Vec<String>,
    pub embeds: Vec<String>,
    pub unresolved: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ScopeManifest {
    pub schema_version: u64,
    pub scopes: Vec<Scope>,
    #[serde(default)]
    pub promotions: Vec<Promotion>,
    #[serde(default)]
    pub meta_goals: Vec<MetaGoal>,
    #[serde(default)]
    pub inputs: Vec<ExternalInput>,
    /// Concepts authored by a scope in this root.
    ///
    /// A Concept is owned by whoever authored it, so a Topic or Project keeps
    /// its own. The registry records the pin; it never becomes a shared pool.
    #[serde(default)]
    pub concepts: Vec<ScopeConcept>,
}

/// A pinned Concept owned by one scope in this root.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ScopeConcept {
    pub id: String,
    pub scope_id: String,
    /// Path relative to the scope root.
    pub path: String,
    pub sha256: String,
}
#[derive(Debug, Clone)]
pub struct ValidatedScopes {
    pub manifest: ScopeManifest,
    pub root: PathBuf,
}
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct SourceCheck {
    pub source_id: String,
    pub declared_revision: String,
    pub observed_revision: String,
    pub declared_sha256: String,
    pub observed_sha256: String,
    pub fresh: bool,
}

/// Loads and validates a closed, offline Scope snapshot. This does not check source freshness.
///
/// # Errors
///
/// Returns an error when the manifest, bound project, object paths, metadata, or bytes are invalid.
pub fn load_scopes(root: &Path) -> Result<ValidatedScopes, ScopeError> {
    let root = root
        .canonicalize()
        .map_err(|e| ScopeError(format!("cannot resolve scope root: {e}")))?;
    if !root.is_dir() {
        return fail("scope root is not a directory");
    }
    let bytes = fs::read(root.join(MANIFEST))
        .map_err(|e| ScopeError(format!("cannot read {MANIFEST}: {e}")))?;
    let manifest = serde_json::from_slice(&bytes)
        .map_err(|e| ScopeError(format!("invalid {MANIFEST}: {e}")))?;
    validate_manifest(&root, &manifest)?;
    Ok(ValidatedScopes { manifest, root })
}

#[allow(clippy::too_many_lines)]
fn validate_manifest(root: &Path, manifest: &ScopeManifest) -> Result<(), ScopeError> {
    if manifest.schema_version != 2 {
        return fail("schema_version must be 2");
    }
    if manifest.scopes.is_empty() {
        return fail("scopes must not be empty");
    }
    let mut scopes = BTreeMap::new();
    for scope in &manifest.scopes {
        valid_id(&scope.id, "scope id")?;
        display_text(&scope.title, "scope title")?;
        display_text(&scope.intent, "scope intent")?;
        if scopes.insert(scope.id.as_str(), scope).is_some() {
            return fail(format!("duplicate scope id: {}", scope.id));
        }
        match (&scope.kind, &scope.project) {
            (ScopeKind::Project, Some(binding)) => validate_project_binding(root, scope, binding)?,
            (ScopeKind::Project, None) => {
                return fail(format!(
                    "project scope requires project binding: {}",
                    scope.id
                ));
            }
            (ScopeKind::Topic, None) => {}
            (ScopeKind::Topic, Some(_)) => {
                return fail(format!(
                    "topic scope cannot have project binding: {}",
                    scope.id
                ));
            }
        }
        let mut ids = BTreeSet::new();
        let mut previous = None;
        for h in &scope.history {
            valid_id(&h.id, "history id")?;
            if !ids.insert(&h.id) {
                return fail(format!("duplicate history id in {}: {}", scope.id, h.id));
            }
            canonical_utc(&h.at)?;
            display_text(&h.note, "history note")?;
            if previous.is_some_and(|p: &str| p >= h.at.as_str()) {
                return fail(format!(
                    "history must be strictly chronological: {}",
                    scope.id
                ));
            }
            previous = Some(&h.at);
        }
    }
    let mut promotion_ids = BTreeSet::new();
    let mut promoted_targets = BTreeSet::new();
    for p in &manifest.promotions {
        valid_id(&p.id, "promotion id")?;
        if !promotion_ids.insert(&p.id) {
            return fail(format!("duplicate promotion id: {}", p.id));
        }
        display_text(&p.source_topic_id, "promotion source topic id")?;
        display_text(&p.target_project_id, "promotion target project id")?;
        let source = scopes.get(p.source_topic_id.as_str()).ok_or_else(|| {
            ScopeError(format!(
                "promotion source does not exist: {}",
                p.source_topic_id
            ))
        })?;
        let target = scopes.get(p.target_project_id.as_str()).ok_or_else(|| {
            ScopeError(format!(
                "promotion target does not exist: {}",
                p.target_project_id
            ))
        })?;
        if source.kind != ScopeKind::Topic || target.kind != ScopeKind::Project {
            return fail(format!("invalid promotion lineage: {}", p.id));
        }
        if !promoted_targets.insert(&p.target_project_id) {
            return fail(format!(
                "project has multiple promotion lineages: {}",
                p.target_project_id
            ));
        }
        validate_hash(&p.source_topic_sha256)?;
        if p.source_topic_sha256 != topic_hash(source)? {
            return fail(format!("promotion source topic hash mismatch: {}", p.id));
        }
    }
    let mut goals = BTreeSet::new();
    for goal in &manifest.meta_goals {
        valid_id(&goal.id, "meta goal id")?;
        display_text(&goal.title, "meta goal title")?;
        if goal.scope_ids.is_empty() {
            return fail(format!(
                "meta goal membership must not be empty: {}",
                goal.id
            ));
        }
        if !goals.insert(&goal.id) {
            return fail(format!("duplicate meta goal id: {}", goal.id));
        }
    }
    let mut edges = BTreeMap::<&str, Vec<&str>>::new();
    for goal in &manifest.meta_goals {
        let mut members = BTreeSet::new();
        for id in &goal.scope_ids {
            valid_id(id, "meta goal scope id")?;
            if !scopes.contains_key(id.as_str()) {
                return fail(format!("meta goal references unknown scope: {id}"));
            }
            if !members.insert(id) {
                return fail(format!("duplicate scope in meta goal {}: {id}", goal.id));
            }
        }
        let mut rels = BTreeSet::new();
        for rel in &goal.relationships {
            valid_id(&rel.to_goal_id, "relationship goal id")?;
            if !goals.contains(&rel.to_goal_id) || rel.to_goal_id == goal.id {
                return fail(format!(
                    "invalid meta goal relationship from {} to {}",
                    goal.id, rel.to_goal_id
                ));
            }
            if !rels.insert(rel) {
                return fail(format!("duplicate meta goal relationship from {}", goal.id));
            }
            if rel.kind == GoalRelationshipKind::DependsOn {
                edges.entry(&goal.id).or_default().push(&rel.to_goal_id);
            }
        }
    }
    detect_cycles(&goals, &edges)?;
    let mut input_ids = BTreeSet::new();
    let mut paths = BTreeSet::new();
    let mut folded = BTreeSet::new();
    let mut object_hashes = BTreeMap::<&str, &str>::new();
    let mut source_paths = BTreeSet::new();
    let mut folded_source_paths = BTreeSet::new();
    for input in &manifest.inputs {
        valid_id(&input.id, "input id")?;
        valid_id(&input.scope_id, "input scope id")?;
        if !input_ids.insert(&input.id) {
            return fail(format!("duplicate input id: {}", input.id));
        }
        if !scopes.contains_key(input.scope_id.as_str()) {
            return fail(format!(
                "input references unknown scope: {}",
                input.scope_id
            ));
        }
        validate_hash(&input.sha256)?;
        validate_hash(&input.source.sha256)?;
        if input.source.sha256 != input.sha256 {
            return fail(format!("source and object hashes differ for {}", input.id));
        }
        validate_media_type(input)?;
        git_revision(&input.source.revision, "input source revision")?;
        safe_source_relative(&input.source.path, "source path")?;
        let exact_source_duplicate = !source_paths.insert(&input.source.path);
        if !folded_source_paths.insert(input.source.path.to_lowercase()) && !exact_source_duplicate
        {
            return fail(format!(
                "case-fold source path collision: {}",
                input.source.path
            ));
        }
        let expected_path = format!("objects/sha256/{}", input.sha256);
        if input.path != expected_path {
            return fail(format!(
                "input object path must be digest-derived: {}",
                input.id
            ));
        }
        safe_relative(&input.path, "input object path")?;
        let exact_duplicate = !paths.insert(&input.path);
        if exact_duplicate && object_hashes.get(input.path.as_str()) != Some(&input.sha256.as_str())
        {
            return fail("object path collision");
        }
        if !folded.insert(input.path.to_lowercase()) && !exact_duplicate {
            return fail(format!("case-fold input path collision: {}", input.path));
        }
        if let Some(existing) = object_hashes.insert(&input.path, &input.sha256) {
            if existing != input.sha256 {
                return fail("object path collision");
            }
        }
        validate_object(root, input)?;
    }
    validate_concepts(root, manifest, &scopes)?;
    Ok(())
}

/// Validates that every declared Concept is owned by a known scope and that its
/// bytes match the recorded pin.
fn validate_concepts(
    root: &Path,
    manifest: &ScopeManifest,
    scopes: &BTreeMap<&str, &Scope>,
) -> Result<(), ScopeError> {
    let mut ids = BTreeSet::new();
    for concept in &manifest.concepts {
        valid_id(&concept.id, "concept id")?;
        valid_id(&concept.scope_id, "concept scope id")?;
        if !ids.insert(&concept.id) {
            return fail(format!("duplicate concept id: {}", concept.id));
        }
        if !scopes.contains_key(concept.scope_id.as_str()) {
            return fail(format!(
                "concept references unknown scope: {}",
                concept.scope_id
            ));
        }
        validate_hash(&concept.sha256)?;
        safe_relative(&concept.path, "concept path")?;
        let path = checked_file(root, &concept.path, "concept")?;
        let bytes = fs::read(path)
            .map_err(|e| ScopeError(format!("cannot read concept {}: {e}", concept.id)))?;
        if hex_sha256(&bytes) != concept.sha256 {
            return fail(format!("concept bytes do not match pin: {}", concept.id));
        }
        // The pinned bytes must be a valid Concept, so a scope cannot register
        // an arbitrary file as transferable knowledge.
        let text = std::str::from_utf8(&bytes)
            .map_err(|_| ScopeError(format!("non-UTF8 concept: {}", concept.id)))?;
        let parsed = crate::concept::validate_concept_json(text)
            .map_err(|error| ScopeError(format!("invalid concept {}: {error}", concept.id)))?;
        if parsed.origin.scope_id != concept.scope_id {
            return fail(format!(
                "concept origin scope does not match its owner: {}",
                concept.id
            ));
        }
    }
    Ok(())
}

fn validate_project_binding(
    root: &Path,
    scope: &Scope,
    binding: &ProjectBinding,
) -> Result<(), ScopeError> {
    let scoped_manifest = format!("projects/{}/.mozak/project.yml", scope.id);
    if binding.manifest_path != PROJECT_MANIFEST && binding.manifest_path != scoped_manifest {
        return fail(format!(
            "project manifest_path must be .mozak/project.yml or projects/{}/.mozak/project.yml",
            scope.id
        ));
    }
    safe_relative(&binding.manifest_path, "project manifest path")?;
    validate_hash(&binding.manifest_sha256)?;
    let path = checked_file(root, &binding.manifest_path, "project manifest")?;
    let bytes =
        fs::read(path).map_err(|e| ScopeError(format!("cannot read project manifest: {e}")))?;
    if hex_sha256(&bytes) != binding.manifest_sha256 {
        return fail(format!("project manifest hash mismatch: {}", scope.id));
    }
    let text = std::str::from_utf8(&bytes)
        .map_err(|_| ScopeError("project manifest is not UTF-8".into()))?;
    let manifest = validate_project_yaml(text)
        .map_err(|e| ScopeError(format!("invalid bound project manifest: {e}")))?;
    if scope.id != manifest.project.id || binding.project_id != manifest.project.id {
        return fail(format!("project binding identity mismatch: {}", scope.id));
    }
    if binding.repository_revision != manifest.repository.revision {
        return fail(format!("project binding revision mismatch: {}", scope.id));
    }
    if binding.owned_paths != manifest.owned_paths {
        return fail(format!(
            "project binding owned_paths mismatch: {}",
            scope.id
        ));
    }
    Ok(())
}
fn validate_object(root: &Path, input: &ExternalInput) -> Result<(), ScopeError> {
    let path = checked_file(root, &input.path, "input object")?;
    let bytes =
        fs::read(path).map_err(|e| ScopeError(format!("cannot read input {}: {e}", input.id)))?;
    if hex_sha256(&bytes) != input.sha256 {
        return fail(format!("SHA-256 mismatch for input {}", input.id));
    }
    match input.kind {
        InputKind::Note => {
            let text = std::str::from_utf8(&bytes)
                .map_err(|_| ScopeError(format!("note input is not UTF-8: {}", input.id)))?;
            let actual = note_metadata(text);
            for reference in actual
                .wikilinks
                .iter()
                .chain(&actual.embeds)
                .chain(&actual.unresolved)
            {
                display_text(reference, "note reference")?;
            }
            if input.note_validation.as_ref() != Some(&actual) {
                return fail(format!("note validation metadata mismatch: {}", input.id));
            }
        }
        InputKind::Attachment if input.note_validation.is_some() => {
            return fail(format!(
                "attachment cannot have note validation metadata: {}",
                input.id
            ));
        }
        InputKind::Attachment => {}
    }
    Ok(())
}

/// Compares one declared source with local source bytes and an explicit observed revision. No networking occurs.
///
/// # Errors
///
/// Returns an error for an unknown source, unsafe path, invalid observed revision, or unreadable bytes.
pub fn check_source(
    validated: &ValidatedScopes,
    source_id: &str,
    source_root: &Path,
    observed_revision: &str,
) -> Result<SourceCheck, ScopeError> {
    valid_id(source_id, "source id")?;
    git_revision(observed_revision, "observed source revision")?;
    let input = validated
        .manifest
        .inputs
        .iter()
        .find(|i| i.id == source_id)
        .ok_or_else(|| ScopeError(format!("unknown source id: {source_id}")))?;
    let root = source_root
        .canonicalize()
        .map_err(|e| ScopeError(format!("cannot resolve source root: {e}")))?;
    if !root.is_dir() {
        return fail("source root is not a directory");
    }
    let path = checked_file(&root, &input.source.path, "source")?;
    let observed_sha256 =
        hex_sha256(&fs::read(path).map_err(|e| ScopeError(format!("cannot read source: {e}")))?);
    let fresh =
        input.source.revision == observed_revision && input.source.sha256 == observed_sha256;
    Ok(SourceCheck {
        source_id: input.id.clone(),
        declared_revision: input.source.revision.clone(),
        observed_revision: observed_revision.to_owned(),
        declared_sha256: input.source.sha256.clone(),
        fresh,
        observed_sha256,
    })
}

fn checked_file(root: &Path, relative: &str, label: &str) -> Result<PathBuf, ScopeError> {
    let relative = safe_relative(relative, label)?;
    let path = root.join(relative);
    let metadata = fs::symlink_metadata(&path)
        .map_err(|e| ScopeError(format!("cannot read {label} {}: {e}", relative.display())))?;
    if !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
        return fail(format!(
            "{label} is not a regular file: {}",
            relative.display()
        ));
    }
    let canonical = path
        .canonicalize()
        .map_err(|e| ScopeError(format!("cannot resolve {label}: {e}")))?;
    if !canonical.starts_with(root) {
        return fail(format!("{label} escapes root"));
    }
    Ok(canonical)
}

pub(crate) fn reference_matches(reference: &str, source_path: &str) -> bool {
    let path = Path::new(source_path);
    if reference.contains('/') {
        if reference == source_path {
            return true;
        }
        return path.extension().is_some_and(|extension| extension == "md")
            && path.with_extension("").to_string_lossy() == reference;
    }
    path.file_name()
        .is_some_and(|name| name.to_string_lossy() == reference)
        || path
            .file_stem()
            .is_some_and(|stem| stem.to_string_lossy() == reference)
}
fn valid_id(value: &str, label: &str) -> Result<(), ScopeError> {
    display_text(value, label)?;
    if value.len() > 128
        || !value.as_bytes()[0].is_ascii_alphanumeric()
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
    {
        return fail(format!("invalid {label}: {value:?}"));
    }
    Ok(())
}
fn display_text(value: &str, label: &str) -> Result<(), ScopeError> {
    if value.trim().is_empty()
        || value != value.trim()
        || value.chars().any(|c| {
            c == '\r' || c == '\n' || c <= '\u{001f}' || ('\u{007f}'..='\u{009f}').contains(&c)
        })
    {
        return fail(format!("invalid {label}"));
    }
    Ok(())
}
fn validate_hash(value: &str) -> Result<(), ScopeError> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    {
        return fail("invalid SHA-256");
    }
    Ok(())
}
fn git_revision(value: &str, label: &str) -> Result<(), ScopeError> {
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
fn safe_relative<'a>(value: &'a str, label: &str) -> Result<&'a Path, ScopeError> {
    if value.contains('\\') || value.contains(':') {
        return fail(format!("unsafe {label}: {value}"));
    }
    let path = Path::new(value);
    if value.is_empty()
        || path.is_absolute()
        || path
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        return fail(format!("unsafe {label}: {value}"));
    }
    display_text(value, label)?;
    Ok(path)
}

fn safe_source_relative<'a>(value: &'a str, label: &str) -> Result<&'a Path, ScopeError> {
    let path = safe_relative(value, label)?;
    if !value.is_ascii() {
        return fail(format!(
            "unsafe {label}: source paths must contain ASCII characters only"
        ));
    }
    Ok(path)
}
fn validate_media_type(input: &ExternalInput) -> Result<(), ScopeError> {
    let valid = match input.kind {
        InputKind::Note => input.media_type == "text/markdown",
        InputKind::Attachment => matches!(
            input.media_type.as_str(),
            "application/pdf" | "image/png" | "image/jpeg" | "text/plain"
        ),
    };
    if !valid {
        return fail(format!("invalid media type for input {}", input.id));
    }
    Ok(())
}
fn canonical_utc(value: &str) -> Result<(), ScopeError> {
    let b = value.as_bytes();
    if b.len() != 20
        || b[4] != b'-'
        || b[7] != b'-'
        || b[10] != b'T'
        || b[13] != b':'
        || b[16] != b':'
        || b[19] != b'Z'
        || b.iter()
            .enumerate()
            .any(|(i, c)| !matches!(i, 4 | 7 | 10 | 13 | 16 | 19) && !c.is_ascii_digit())
    {
        return fail(format!("history timestamp must be canonical UTC: {value}"));
    }
    let num = |a, z| value[a..z].parse::<u32>().unwrap_or(99);
    let (year, month, day, hour, minute, second) = (
        num(0, 4),
        num(5, 7),
        num(8, 10),
        num(11, 13),
        num(14, 16),
        num(17, 19),
    );
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = [
        0,
        31,
        if leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    if year == 0
        || !(1..=12).contains(&month)
        || day == 0
        || day > days[month as usize]
        || hour > 23
        || minute > 59
        || second > 59
    {
        return fail(format!("invalid history timestamp: {value}"));
    }
    Ok(())
}
fn topic_hash(scope: &Scope) -> Result<String, ScopeError> {
    let value = serde_json::to_value(scope).map_err(|e| ScopeError(e.to_string()))?;
    Ok(hex_sha256(
        &serde_json::to_vec(&value).map_err(|e| ScopeError(e.to_string()))?,
    ))
}
fn hex_sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn note_metadata(text: &str) -> NoteValidation {
    let mut wikilinks = Vec::new();
    let mut embeds = Vec::new();
    let bytes = text.as_bytes();
    let mut i = 0;
    while i + 1 < bytes.len() {
        let embed = i > 0 && bytes[i - 1] == b'!';
        if bytes[i] == b'[' && bytes[i + 1] == b'[' {
            if let Some(end) = text[i + 2..].find("]]") {
                let raw = &text[i + 2..i + 2 + end];
                let target = raw
                    .split('|')
                    .next()
                    .unwrap_or("")
                    .split('#')
                    .next()
                    .unwrap_or("")
                    .trim();
                if !target.is_empty() {
                    if embed {
                        embeds.push(target.to_owned());
                    } else {
                        wikilinks.push(target.to_owned());
                    }
                }
                i += end + 4;
                continue;
            }
        }
        i += 1;
    }
    wikilinks.sort();
    wikilinks.dedup();
    embeds.sort();
    embeds.dedup();
    let mut unresolved = wikilinks.iter().chain(&embeds).cloned().collect::<Vec<_>>();
    unresolved.sort();
    unresolved.dedup();
    NoteValidation {
        wikilinks,
        embeds,
        unresolved,
    }
}

fn strict_note_references(text: &str) -> Result<NoteValidation, ScopeError> {
    let bytes = text.as_bytes();
    let mut i = 0;
    while i + 1 < bytes.len() {
        if bytes[i] == b'[' && bytes[i + 1] == b'[' {
            let end = text[i + 2..]
                .find("]]")
                .ok_or_else(|| ScopeError("unterminated wikilink in selected note".into()))?;
            let raw = &text[i + 2..i + 2 + end];
            if raw.contains('|') || raw.contains('#') {
                return fail("aliases and heading references are not supported by ingest-links");
            }
            if raw.trim().is_empty() {
                return fail("wikilink target must not be empty");
            }
            i += end + 4;
            continue;
        }
        i += 1;
    }
    Ok(note_metadata(text))
}

/// Applies one owner-approved, fully declared closed-KB wikilink ingestion plan.
/// All validation completes before the sibling staging directory is created.
///
/// # Errors
///
/// Returns an error for any invalid pin, path, source byte, reference resolution,
/// inclusion, output, staging, reconstruction, or staged Scope validation failure.
#[allow(clippy::too_many_lines)]
pub fn ingest_links(
    scope_root: &Path,
    source_root: &Path,
    observed_revision: &str,
    plan_path: &Path,
    output_root: &Path,
) -> Result<LinkIngestionReceipt, ScopeError> {
    git_revision(observed_revision, "observed source revision")?;
    if fs::symlink_metadata(output_root).is_ok() {
        return fail("output root already exists");
    }
    let source_root = canonical_nonsymlink_root(source_root)?;
    let validated = load_scopes(scope_root)?;
    let manifest_bytes = fs::read(validated.root.join(MANIFEST))
        .map_err(|e| ScopeError(format!("cannot read {MANIFEST}: {e}")))?;
    let manifest_sha256 = hex_sha256(&manifest_bytes);
    let plan_bytes =
        fs::read(plan_path).map_err(|e| ScopeError(format!("cannot read ingestion plan: {e}")))?;
    let plan: LinkIngestionPlan = serde_json::from_slice(&plan_bytes)
        .map_err(|e| ScopeError(format!("invalid ingestion plan: {e}")))?;
    if plan.schema_version != 1 {
        return fail("ingestion plan schema_version must be 1");
    }
    validate_hash(&plan.scope_manifest_sha256)?;
    if plan.scope_manifest_sha256 != manifest_sha256 {
        return fail("ingestion plan scope.json pin drift");
    }
    git_revision(&plan.observed_revision, "plan observed revision")?;
    if plan.observed_revision != observed_revision {
        return fail("observed revision does not match ingestion plan");
    }
    valid_id(&plan.scope_id, "plan scope id")?;
    let scope_index = validated
        .manifest
        .scopes
        .iter()
        .position(|scope| scope.id == plan.scope_id)
        .ok_or_else(|| ScopeError("owner-selected scope_id does not exist".into()))?;
    valid_id(&plan.history_entry.id, "history id")?;
    canonical_utc(&plan.history_entry.at)?;
    display_text(&plan.history_entry.note, "history note")?;
    let scope = &validated.manifest.scopes[scope_index];
    if scope
        .history
        .iter()
        .any(|entry| entry.id == plan.history_entry.id)
    {
        return fail("history entry id already exists");
    }
    if scope
        .history
        .last()
        .is_some_and(|entry| entry.at >= plan.history_entry.at)
    {
        return fail("history entry must append chronologically");
    }

    let existing_by_id = validated
        .manifest
        .inputs
        .iter()
        .map(|input| (input.id.as_str(), input))
        .collect::<BTreeMap<_, _>>();
    let mut selected_ids = BTreeSet::new();
    if plan.existing_source_input_ids.is_empty() {
        return fail("existing_source_input_ids must not be empty");
    }
    for id in &plan.existing_source_input_ids {
        valid_id(id, "existing source input id")?;
        if !selected_ids.insert(id.as_str()) {
            return fail("duplicate existing_source_input_ids");
        }
        let input = existing_by_id
            .get(id.as_str())
            .ok_or_else(|| ScopeError(format!("unknown existing source input id: {id}")))?;
        if input.kind != InputKind::Note || input.scope_id != plan.scope_id {
            return fail(format!(
                "selected input is not a note in scope {}: {id}",
                plan.scope_id
            ));
        }
        if input.source.revision != observed_revision {
            return fail(format!("selected input revision differs: {id}"));
        }
        let source = checked_nonsymlink_file(&source_root, &input.source.path, "selected source")?;
        let bytes = fs::read(source)
            .map_err(|e| ScopeError(format!("cannot read selected source {id}: {e}")))?;
        if hex_sha256(&bytes) != input.source.sha256 {
            return fail(format!("selected source bytes changed: {id}"));
        }
    }

    let mut all_ids = existing_by_id.keys().copied().collect::<BTreeSet<_>>();
    let mut source_paths = validated
        .manifest
        .inputs
        .iter()
        .map(|input| input.source.path.as_str())
        .collect::<BTreeSet<_>>();
    let mut folded_paths = source_paths
        .iter()
        .map(|path| path.to_lowercase())
        .collect::<BTreeSet<_>>();
    let mut inclusion_bytes = BTreeMap::new();
    for inclusion in &plan.inclusions {
        valid_id(&inclusion.input_id, "inclusion input id")?;
        if !all_ids.insert(&inclusion.input_id) {
            return fail(format!(
                "duplicate inclusion input id: {}",
                inclusion.input_id
            ));
        }
        safe_source_relative(&inclusion.source_path, "inclusion source path")?;
        if !source_paths.insert(&inclusion.source_path) {
            return fail(format!("duplicate source path: {}", inclusion.source_path));
        }
        if !folded_paths.insert(inclusion.source_path.to_lowercase()) {
            return fail(format!(
                "case-fold source path collision: {}",
                inclusion.source_path
            ));
        }
        validate_hash(&inclusion.source_sha256)?;
        let probe = ExternalInput {
            id: inclusion.input_id.clone(),
            scope_id: plan.scope_id.clone(),
            kind: inclusion.kind.clone(),
            path: format!("objects/sha256/{}", inclusion.source_sha256),
            sha256: inclusion.source_sha256.clone(),
            media_type: inclusion.media_type.clone(),
            source: InputSource {
                path: inclusion.source_path.clone(),
                revision: observed_revision.to_owned(),
                sha256: inclusion.source_sha256.clone(),
            },
            note_validation: None,
        };
        validate_media_type(&probe)?;
        let source =
            checked_nonsymlink_file(&source_root, &inclusion.source_path, "inclusion source")?;
        let bytes = fs::read(source).map_err(|e| {
            ScopeError(format!("cannot read inclusion {}: {e}", inclusion.input_id))
        })?;
        if hex_sha256(&bytes) != inclusion.source_sha256 {
            return fail(format!(
                "inclusion source bytes changed: {}",
                inclusion.input_id
            ));
        }
        inclusion_bytes.insert(inclusion.input_id.as_str(), bytes);
    }

    let candidates = validated
        .manifest
        .inputs
        .iter()
        .map(|input| (input.id.as_str(), input.source.path.as_str()))
        .chain(
            plan.inclusions
                .iter()
                .map(|item| (item.input_id.as_str(), item.source_path.as_str())),
        )
        .collect::<Vec<_>>();
    let inclusion_ids = plan
        .inclusions
        .iter()
        .map(|item| item.input_id.as_str())
        .collect::<BTreeSet<_>>();
    let mut used_inclusions = BTreeSet::new();
    for id in &plan.existing_source_input_ids {
        let input = existing_by_id[id.as_str()];
        let bytes = fs::read(validated.root.join(&input.path))
            .map_err(|e| ScopeError(format!("cannot read selected object {id}: {e}")))?;
        let text = std::str::from_utf8(&bytes)
            .map_err(|_| ScopeError(format!("selected note is not UTF-8: {id}")))?;
        let metadata = strict_note_references(text)?;
        for reference in metadata.wikilinks.iter().chain(&metadata.embeds) {
            safe_source_relative(reference, "wikilink target")?;
            let matches = candidates
                .iter()
                .filter(|(_, path)| reference_matches(reference, path))
                .collect::<Vec<_>>();
            if matches.len() != 1 {
                return fail(format!(
                    "reference {reference:?} in {id} resolved to {} matches",
                    matches.len()
                ));
            }
            if inclusion_ids.contains(matches[0].0) {
                used_inclusions.insert(matches[0].0);
            }
        }
    }
    if used_inclusions != inclusion_ids {
        let unused = inclusion_ids
            .difference(&used_inclusions)
            .copied()
            .collect::<Vec<_>>();
        return fail(format!("unused inclusions: {}", unused.join(", ")));
    }

    let mut manifest = validated.manifest.clone();
    manifest.scopes[scope_index]
        .history
        .push(plan.history_entry.clone());
    for inclusion in &plan.inclusions {
        let bytes = &inclusion_bytes[inclusion.input_id.as_str()];
        let note_validation = match inclusion.kind {
            InputKind::Note => Some(note_metadata(std::str::from_utf8(bytes).map_err(|_| {
                ScopeError(format!(
                    "included note is not UTF-8: {}",
                    inclusion.input_id
                ))
            })?)),
            InputKind::Attachment => None,
        };
        manifest.inputs.push(ExternalInput {
            id: inclusion.input_id.clone(),
            scope_id: plan.scope_id.clone(),
            kind: inclusion.kind.clone(),
            path: format!("objects/sha256/{}", inclusion.source_sha256),
            sha256: inclusion.source_sha256.clone(),
            media_type: inclusion.media_type.clone(),
            source: InputSource {
                path: inclusion.source_path.clone(),
                revision: observed_revision.to_owned(),
                sha256: inclusion.source_sha256.clone(),
            },
            note_validation,
        });
    }
    manifest.scopes.sort_by(|a, b| a.id.cmp(&b.id));
    manifest.promotions.sort();
    manifest.meta_goals.sort_by(|a, b| a.id.cmp(&b.id));
    manifest.inputs.sort_by(|a, b| a.id.cmp(&b.id));
    let output_manifest = serde_json::to_vec_pretty(&manifest)
        .map_err(|e| ScopeError(format!("cannot serialize output manifest: {e}")))?;
    let output_hash = hex_sha256(&output_manifest);
    let parent = output_root
        .parent()
        .ok_or_else(|| ScopeError("output root must have a parent".into()))?;
    let name = output_root
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| ScopeError("output root must have a safe UTF-8 name".into()))?;
    display_text(name, "output root name")?;
    let parent = parent
        .canonicalize()
        .map_err(|e| ScopeError(format!("cannot resolve output parent: {e}")))?;
    let output_root = parent.join(name);
    let stage = parent.join(format!(".{name}.mozak-stage"));
    for (root, label) in [(&validated.root, "input Scope"), (&source_root, "source")] {
        if output_root.starts_with(root) {
            return fail(format!(
                "output root must not be inside or equal to {label} root"
            ));
        }
        if stage.starts_with(root) {
            return fail(format!(
                "staging root must not be inside or equal to {label} root"
            ));
        }
    }
    if fs::symlink_metadata(&output_root).is_ok() {
        return fail("output root already exists");
    }
    if fs::symlink_metadata(&stage).is_ok() {
        return fail("staging root already exists");
    }
    fs::create_dir(&stage).map_err(|e| ScopeError(format!("cannot create staging root: {e}")))?;
    let staged = (|| -> Result<(), ScopeError> {
        for scope in &manifest.scopes {
            if let Some(binding) = &scope.project {
                copy_declared_file(&validated.root, &stage, &binding.manifest_path)?;
            }
        }
        fs::create_dir_all(stage.join("objects/sha256"))
            .map_err(|e| ScopeError(format!("cannot create object directory: {e}")))?;
        for input in &validated.manifest.inputs {
            copy_declared_file(&validated.root, &stage, &input.path)?;
        }
        for inclusion in &plan.inclusions {
            fs::write(
                stage.join(format!("objects/sha256/{}", inclusion.source_sha256)),
                &inclusion_bytes[inclusion.input_id.as_str()],
            )
            .map_err(|e| ScopeError(format!("cannot write included object: {e}")))?;
        }
        fs::write(stage.join(MANIFEST), &output_manifest)
            .map_err(|e| ScopeError(format!("cannot write staged manifest: {e}")))?;
        load_scopes(&stage)?;
        Ok(())
    })();
    if let Err(error) = staged {
        let _ = fs::remove_dir_all(&stage);
        return Err(error);
    }
    install_staged_root(&stage, &output_root)?;
    Ok(LinkIngestionReceipt {
        schema_version: 1,
        command: "scope ingest-links",
        auto_discovery: false,
        authority: "source_vault_remains_authoritative",
        scope_id: plan.scope_id,
        observed_revision: observed_revision.to_owned(),
        plan_sha256: hex_sha256(&plan_bytes),
        input_scope_manifest_sha256: manifest_sha256,
        output_scope_manifest_sha256: output_hash,
        added_input_ids: plan
            .inclusions
            .into_iter()
            .map(|item| item.input_id)
            .collect(),
    })
}

fn install_staged_root(stage: &Path, output_root: &Path) -> Result<(), ScopeError> {
    if let Err(error) = fs::rename(stage, output_root) {
        let _ = fs::remove_dir_all(stage);
        return Err(ScopeError(format!(
            "cannot atomically install output root: {error}"
        )));
    }
    Ok(())
}

fn canonical_nonsymlink_root(root: &Path) -> Result<PathBuf, ScopeError> {
    if !root.is_absolute() {
        return fail("source root must be an absolute canonical path");
    }
    let canonical = root
        .canonicalize()
        .map_err(|e| ScopeError(format!("cannot resolve source root: {e}")))?;
    if canonical != root || !canonical.is_dir() {
        return fail("source root must be an absolute canonical directory");
    }
    let mut current = PathBuf::new();
    for component in canonical.components() {
        current.push(component.as_os_str());
        let metadata = fs::symlink_metadata(&current)
            .map_err(|e| ScopeError(format!("cannot inspect source path chain: {e}")))?;
        if metadata.file_type().is_symlink() {
            return fail("source root path chain must not contain symlinks");
        }
    }
    Ok(canonical)
}

fn checked_nonsymlink_file(
    root: &Path,
    relative: &str,
    label: &str,
) -> Result<PathBuf, ScopeError> {
    let relative = safe_relative(relative, label)?;
    let mut current = root.to_path_buf();
    for component in relative.components() {
        current.push(component.as_os_str());
        let metadata = fs::symlink_metadata(&current).map_err(|e| {
            ScopeError(format!(
                "cannot inspect {label} path chain {}: {e}",
                relative.display()
            ))
        })?;
        if metadata.file_type().is_symlink() {
            return fail(format!("{label} path chain must not contain symlinks"));
        }
    }
    checked_file(root, relative.to_string_lossy().as_ref(), label)
}

fn copy_declared_file(
    source_root: &Path,
    output_root: &Path,
    relative: &str,
) -> Result<(), ScopeError> {
    let source = checked_file(source_root, relative, "declared source file")?;
    let destination = output_root.join(safe_relative(relative, "declared output path")?);
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| ScopeError(format!("cannot create output directory: {e}")))?;
    }
    fs::copy(source, destination)
        .map_err(|e| ScopeError(format!("cannot copy declared file: {e}")))?;
    Ok(())
}
fn detect_cycles<'a>(
    goals: &BTreeSet<&'a String>,
    edges: &BTreeMap<&'a str, Vec<&'a str>>,
) -> Result<(), ScopeError> {
    fn visit<'a>(
        n: &'a str,
        edges: &BTreeMap<&'a str, Vec<&'a str>>,
        active: &mut BTreeSet<&'a str>,
        done: &mut BTreeSet<&'a str>,
    ) -> Result<(), ScopeError> {
        if done.contains(n) {
            return Ok(());
        }
        if !active.insert(n) {
            return fail(format!("meta goal dependency cycle at {n}"));
        }
        if let Some(next) = edges.get(n) {
            for child in next {
                visit(child, edges, active, done)?;
            }
        }
        active.remove(n);
        done.insert(n);
        Ok(())
    }
    let mut active = BTreeSet::new();
    let mut done = BTreeSet::new();
    for goal in goals {
        visit(goal, edges, &mut active, &mut done)?;
    }
    Ok(())
}
fn fail<T>(message: impl Into<String>) -> Result<T, ScopeError> {
    Err(ScopeError(message.into()))
}
fn md(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('`', "\\`")
        .replace('*', "\\*")
        .replace('_', "\\_")
        .replace('[', "\\[")
        .replace(']', "\\]")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

#[must_use]
#[allow(clippy::too_many_lines)]
pub fn markdown_export(validated: &ValidatedScopes) -> String {
    use std::fmt::Write as _;
    let mut scopes = validated.manifest.scopes.clone();
    scopes.sort_by(|a, b| a.id.cmp(&b.id));
    let mut promotions = validated.manifest.promotions.clone();
    promotions.sort();
    let mut goals = validated.manifest.meta_goals.clone();
    goals.sort_by(|a, b| a.id.cmp(&b.id));
    let mut inputs = validated.manifest.inputs.clone();
    inputs.sort_by(|a, b| a.id.cmp(&b.id));
    let mut out = String::from("# MOZAK Scopes\n\n## Scopes\n");
    for s in scopes {
        let _ = writeln!(
            out,
            "- **{}** (`{}`): {}\n  - Intent: {}",
            md(&s.title),
            s.kind,
            md(&s.id),
            md(&s.intent)
        );
        if let Some(p) = s.project {
            let _ = writeln!(
                out,
                "  - Project: `{}` revision `{}` owned paths {}",
                md(&p.project_id),
                p.repository_revision,
                p.owned_paths
                    .iter()
                    .map(|x| format!("`{}`", md(x)))
                    .collect::<Vec<_>>()
                    .join(", ")
            );
        }
        for h in s.history {
            let _ = writeln!(
                out,
                "  - History `{}` at `{}`: {}",
                md(&h.id),
                h.at,
                md(&h.note)
            );
        }
    }
    out.push_str("\n## Promotions\n");
    if promotions.is_empty() {
        out.push_str("- None\n");
    } else {
        for p in promotions {
            let _ = writeln!(
                out,
                "- `{}`: `{}` → `{}` (source Topic snapshot `{}`)",
                md(&p.id),
                md(&p.source_topic_id),
                md(&p.target_project_id),
                p.source_topic_sha256
            );
        }
    }
    out.push_str("\n## Meta Goals\n\n> Meta goals are advisory context only. They never transfer truth, mutation, or execution authority.\n");
    if goals.is_empty() {
        out.push_str("- None\n");
    } else {
        for mut g in goals {
            g.scope_ids.sort();
            g.relationships.sort();
            let _ = writeln!(
                out,
                "- **{}** (`{}`) [advisory only]",
                md(&g.title),
                md(&g.id)
            );
            let _ = writeln!(
                out,
                "  - Scopes: {}",
                g.scope_ids
                    .iter()
                    .map(|s| format!("`{}`", md(s)))
                    .collect::<Vec<_>>()
                    .join(", ")
            );
            for r in g.relationships {
                let _ = writeln!(out, "  - {} → `{}`", r.kind, md(&r.to_goal_id));
            }
        }
    }
    out.push_str("\n## External Inputs\n");
    if inputs.is_empty() {
        out.push_str("- None\n");
    } else {
        for i in inputs {
            let _ = writeln!(
                out,
                "- `{}` ({}) for `{}`: `{}` `{}`\n  - Source: `{}` revision `{}` hash `{}`",
                md(&i.id),
                i.kind,
                md(&i.scope_id),
                md(&i.path),
                i.sha256,
                md(&i.source.path),
                md(&i.source.revision),
                i.source.sha256
            );
            if let Some(n) = i.note_validation {
                let _ = writeln!(
                    out,
                    "  - Note references: {} wikilinks, {} embeds, unresolved: {}",
                    n.wikilinks.len(),
                    n.embeds.len(),
                    n.unresolved
                        .iter()
                        .map(|x| format!("`{}`", md(x)))
                        .collect::<Vec<_>>()
                        .join(", ")
                );
            }
        }
    }
    out
}

#[cfg(test)]
mod ingest_transaction_tests {
    use super::install_staged_root;
    use std::fs;

    #[test]
    fn rename_failure_removes_staging_root() {
        let root =
            std::env::temp_dir().join(format!("mozak-rename-cleanup-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let stage = root.join("stage");
        let output = root.join("output");
        fs::create_dir_all(&stage).unwrap();
        fs::write(stage.join("staged"), b"data").unwrap();
        fs::create_dir_all(&output).unwrap();
        fs::write(output.join("occupied"), b"data").unwrap();

        assert!(install_staged_root(&stage, &output).is_err());
        assert!(!stage.exists());
        fs::remove_dir_all(root).unwrap();
    }
}
