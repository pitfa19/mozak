use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    fmt::{Display, Formatter},
    fs,
    path::{Component, Path, PathBuf},
};

pub const COMPACTION_SCHEMA_VERSION: u64 = 1;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlanningArchiveError(pub String);

impl Display for PlanningArchiveError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}
impl std::error::Error for PlanningArchiveError {}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PlanningArchiveEntry {
    pub relative_path: String,
    pub kind: PlanningArtifactKind,
    pub sha256: String,
    pub bytes: u64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PlanningArtifactKind {
    AcceptedInputs,
    Plan,
    ActiveIndex,
    LegacyAcceptedInputs,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PlanningCompactionPlan {
    pub schema_version: u64,
    pub project_root: String,
    pub generated_at: String,
    pub archive_root: String,
    pub active_index_path: String,
    pub entries: Vec<PlanningArchiveEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PlanningCompactionApproval {
    pub schema_version: u64,
    pub decision: bool,
    pub owner: String,
    pub approved_at: String,
    pub plan_sha256: String,
    pub project_root: String,
    pub rationale: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PlanningCompactionReceipt {
    pub schema_version: u64,
    pub action: String,
    pub owner: String,
    pub plan_sha256: String,
    pub project_root: String,
    pub archive_root: String,
    pub active_index_path: String,
    pub restored_to: Option<String>,
    pub entries: Vec<PlanningArchiveEntry>,
}

/// Builds a deterministic active planning artifact index without mutating artifacts.
///
/// # Errors
/// Returns an error when the project root or planning artifacts cannot be read safely.
pub fn build_compaction_plan(
    root: &Path,
    generated_at: &str,
) -> Result<PlanningCompactionPlan, PlanningArchiveError> {
    let root = canonical_existing_dir(root, "project root")?;
    let planning = root.join(".mozak/planning");
    if !planning.is_dir() {
        fail("missing .mozak/planning directory")?;
    }
    let mut entries = Vec::new();
    collect_json(
        &root,
        &planning.join("inputs"),
        PlanningArtifactKind::AcceptedInputs,
        &mut entries,
    )?;
    collect_json(
        &root,
        &planning.join("plans"),
        PlanningArtifactKind::Plan,
        &mut entries,
    )?;
    let legacy = planning.join("accepted-inputs.json");
    if legacy.is_file() {
        push_entry(
            &root,
            &legacy,
            PlanningArtifactKind::LegacyAcceptedInputs,
            &mut entries,
        )?;
    }
    entries.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    let active_index_path = ".mozak/planning/active-index.json".to_owned();
    let archive_root = ".mozak/planning/archive/sha256".to_owned();
    Ok(PlanningCompactionPlan {
        schema_version: COMPACTION_SCHEMA_VERSION,
        project_root: root.to_string_lossy().into_owned(),
        generated_at: generated_at.to_owned(),
        archive_root,
        active_index_path,
        entries,
    })
}

/// Hashes a serialized compaction plan exactly as the CLI writes it.
///
/// # Errors
/// Returns an error if the plan cannot be serialized as JSON.
pub fn plan_sha256(plan: &PlanningCompactionPlan) -> Result<String, PlanningArchiveError> {
    sha_json(plan)
}

/// Applies an owner-approved compaction plan into content-addressed archive storage.
///
/// # Errors
/// Returns an error for invalid approval, stale source bytes, unsafe paths, or staging/install failures.
pub fn apply_compaction_plan(
    root: &Path,
    plan_path: &Path,
    approval_path: &Path,
) -> Result<PlanningCompactionReceipt, PlanningArchiveError> {
    let plan_text = read_text(plan_path)?;
    let plan: PlanningCompactionPlan = serde_json::from_str(&plan_text)
        .map_err(|e| PlanningArchiveError(format!("invalid compaction plan JSON: {e}")))?;
    validate_plan_shape(root, &plan)?;
    let expected = sha_bytes(plan_text.as_bytes());
    let approval: PlanningCompactionApproval = serde_json::from_str(&read_text(approval_path)?)
        .map_err(|e| PlanningArchiveError(format!("invalid compaction approval JSON: {e}")))?;
    validate_approval(&plan, &approval, &expected)?;
    let root = canonical_existing_dir(root, "project root")?;
    verify_sources(&root, &plan.entries)?;
    let staging = root.join(".mozak/planning/.compact-staging");
    if staging.exists() {
        fs::remove_dir_all(&staging)
            .map_err(|e| PlanningArchiveError(format!("cannot clear stale staging: {e}")))?;
    }
    fs::create_dir_all(&staging)
        .map_err(|e| PlanningArchiveError(format!("cannot create staging: {e}")))?;
    let archive_stage = staging.join("archive");
    let index_stage = staging.join("active-index.json");
    for entry in &plan.entries {
        let source = root.join(&entry.relative_path);
        let target = archive_stage
            .join(&entry.sha256[..2])
            .join(format!("{}.json", entry.sha256));
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| PlanningArchiveError(format!("cannot create archive staging: {e}")))?;
        }
        fs::copy(&source, &target)
            .map_err(|e| PlanningArchiveError(format!("cannot stage archive blob: {e}")))?;
    }
    let index_text = serde_json::to_string_pretty(&plan)
        .map_err(|e| PlanningArchiveError(e.to_string()))?
        + "\n";
    fs::write(&index_stage, index_text)
        .map_err(|e| PlanningArchiveError(format!("cannot stage active index: {e}")))?;
    move_tree_contents(&archive_stage, &root.join(&plan.archive_root))?;
    atomic_replace(&index_stage, &root.join(&plan.active_index_path))?;
    fs::remove_dir_all(&staging)
        .map_err(|e| PlanningArchiveError(format!("cannot remove staging: {e}")))?;
    Ok(receipt("apply", &approval.owner, &expected, &plan, None))
}

/// Restores active planning artifacts from an approved active index into a new output root.
///
/// # Errors
/// Returns an error for invalid approval, unsafe paths, corrupt archive blobs, or an existing output root.
pub fn restore_compaction(
    root: &Path,
    index_path: &Path,
    approval_path: &Path,
    output_root: &Path,
) -> Result<PlanningCompactionReceipt, PlanningArchiveError> {
    let index_text = read_text(index_path)?;
    let plan: PlanningCompactionPlan = serde_json::from_str(&index_text)
        .map_err(|e| PlanningArchiveError(format!("invalid active index JSON: {e}")))?;
    validate_plan_shape(root, &plan)?;
    let expected = sha_bytes(index_text.as_bytes());
    let approval: PlanningCompactionApproval = serde_json::from_str(&read_text(approval_path)?)
        .map_err(|e| PlanningArchiveError(format!("invalid compaction approval JSON: {e}")))?;
    validate_approval(&plan, &approval, &expected)?;
    let root = canonical_existing_dir(root, "project root")?;
    let output = prepare_output_root(output_root)?;
    for entry in &plan.entries {
        let source = root
            .join(&plan.archive_root)
            .join(&entry.sha256[..2])
            .join(format!("{}.json", entry.sha256));
        let bytes = fs::read(&source).map_err(|e| {
            PlanningArchiveError(format!(
                "cannot read archive blob {}: {e}",
                source.display()
            ))
        })?;
        if sha_bytes(&bytes) != entry.sha256 {
            fail(&format!(
                "archive blob corruption detected for {}",
                entry.relative_path
            ))?;
        }
        let target_rel = safe_relative(&entry.relative_path)?;
        let target = output.join(target_rel);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| {
                PlanningArchiveError(format!("cannot create restore directory: {e}"))
            })?;
        }
        fs::write(&target, bytes).map_err(|e| {
            PlanningArchiveError(format!("cannot restore {}: {e}", target.display()))
        })?;
    }
    Ok(receipt(
        "restore",
        &approval.owner,
        &expected,
        &plan,
        Some(output.to_string_lossy().into_owned()),
    ))
}

fn collect_json(
    root: &Path,
    dir: &Path,
    kind: PlanningArtifactKind,
    entries: &mut Vec<PlanningArchiveEntry>,
) -> Result<(), PlanningArchiveError> {
    if !dir.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(dir)
        .map_err(|e| PlanningArchiveError(format!("cannot read {}: {e}", dir.display())))?
    {
        let path = entry
            .map_err(|e| PlanningArchiveError(e.to_string()))?
            .path();
        if path.is_dir() {
            collect_json(root, &path, kind, entries)?;
        } else if path.extension().is_some_and(|e| e == "json") {
            push_entry(root, &path, kind, entries)?;
        }
    }
    Ok(())
}

fn push_entry(
    root: &Path,
    path: &Path,
    kind: PlanningArtifactKind,
    entries: &mut Vec<PlanningArchiveEntry>,
) -> Result<(), PlanningArchiveError> {
    let bytes = fs::read(path)
        .map_err(|e| PlanningArchiveError(format!("cannot read {}: {e}", path.display())))?;
    let relative = path
        .strip_prefix(root)
        .map_err(|_| PlanningArchiveError("artifact outside project root".into()))?
        .to_string_lossy()
        .replace('\\', "/");
    safe_relative(&relative)?;
    entries.push(PlanningArchiveEntry {
        relative_path: relative,
        kind,
        sha256: sha_bytes(&bytes),
        bytes: bytes.len() as u64,
    });
    Ok(())
}

fn validate_plan_shape(
    root: &Path,
    plan: &PlanningCompactionPlan,
) -> Result<(), PlanningArchiveError> {
    if plan.schema_version != COMPACTION_SCHEMA_VERSION {
        fail("unsupported compaction schema_version")?;
    }
    let actual = canonical_existing_dir(root, "project root")?
        .to_string_lossy()
        .into_owned();
    if plan.project_root != actual {
        fail("compaction plan project_root does not match invocation root")?;
    }
    safe_relative(&plan.archive_root)?;
    safe_relative(&plan.active_index_path)?;
    let mut seen = BTreeSet::new();
    for entry in &plan.entries {
        safe_relative(&entry.relative_path)?;
        if !seen.insert(&entry.relative_path) {
            fail("duplicate compaction entry path")?;
        }
        if entry.sha256.len() != 64 || !entry.sha256.bytes().all(|b| b.is_ascii_hexdigit()) {
            fail("invalid entry sha256")?;
        }
    }
    Ok(())
}

fn validate_approval(
    plan: &PlanningCompactionPlan,
    approval: &PlanningCompactionApproval,
    actual_hash: &str,
) -> Result<(), PlanningArchiveError> {
    if approval.schema_version != COMPACTION_SCHEMA_VERSION {
        fail("unsupported approval schema_version")?;
    }
    if !approval.decision {
        fail("compaction approval decision is false")?;
    }
    if approval.plan_sha256 != actual_hash {
        fail("stale approval: plan_sha256 does not match current plan bytes")?;
    }
    if approval.project_root != plan.project_root {
        fail("approval project_root mismatch")?;
    }
    if approval.owner.trim().is_empty()
        || approval.approved_at.trim().is_empty()
        || approval.rationale.trim().is_empty()
    {
        fail("approval must name owner, approved_at, and rationale")?;
    }
    Ok(())
}

fn verify_sources(
    root: &Path,
    entries: &[PlanningArchiveEntry],
) -> Result<(), PlanningArchiveError> {
    for entry in entries {
        let path = root.join(safe_relative(&entry.relative_path)?);
        let bytes = fs::read(&path).map_err(|e| {
            PlanningArchiveError(format!(
                "cannot read active artifact {}: {e}",
                path.display()
            ))
        })?;
        if bytes.len() as u64 != entry.bytes || sha_bytes(&bytes) != entry.sha256 {
            fail(&format!(
                "active artifact changed since plan: {}",
                entry.relative_path
            ))?;
        }
    }
    Ok(())
}

fn prepare_output_root(path: &Path) -> Result<PathBuf, PlanningArchiveError> {
    if path.exists() {
        fail("restore output already exists")?;
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| PlanningArchiveError(format!("cannot create restore parent: {e}")))?;
    }
    fs::create_dir(path)
        .map_err(|e| PlanningArchiveError(format!("cannot create restore output: {e}")))?;
    path.canonicalize()
        .map_err(|e| PlanningArchiveError(format!("cannot resolve restore output: {e}")))
}

fn safe_relative(value: &str) -> Result<PathBuf, PlanningArchiveError> {
    let path = Path::new(value);
    if path.is_absolute() || value.is_empty() {
        fail("path must be safe relative")?;
    }
    let mut clean = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => clean.push(part),
            _ => fail("path traversal is not allowed")?,
        }
    }
    Ok(clean)
}

fn move_tree_contents(from: &Path, to: &Path) -> Result<(), PlanningArchiveError> {
    fs::create_dir_all(to)
        .map_err(|e| PlanningArchiveError(format!("cannot create archive root: {e}")))?;
    if !from.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(from).map_err(|e| PlanningArchiveError(e.to_string()))? {
        let source = entry
            .map_err(|e| PlanningArchiveError(e.to_string()))?
            .path();
        let target = to.join(
            source
                .file_name()
                .ok_or_else(|| PlanningArchiveError("invalid staged path".into()))?,
        );
        if source.is_dir() {
            move_tree_contents(&source, &target)?;
        } else if !target.exists() {
            fs::rename(&source, &target)
                .map_err(|e| PlanningArchiveError(format!("cannot install archive blob: {e}")))?;
        }
    }
    Ok(())
}

fn atomic_replace(from: &Path, to: &Path) -> Result<(), PlanningArchiveError> {
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| PlanningArchiveError(format!("cannot create index parent: {e}")))?;
    }
    let temp = to.with_extension("json.tmp");
    if temp.exists() {
        fs::remove_file(&temp)
            .map_err(|e| PlanningArchiveError(format!("cannot remove stale index temp: {e}")))?;
    }
    fs::copy(from, &temp)
        .map_err(|e| PlanningArchiveError(format!("cannot stage active index: {e}")))?;
    fs::rename(&temp, to)
        .map_err(|e| PlanningArchiveError(format!("cannot install active index: {e}")))
}

fn receipt(
    action: &str,
    owner: &str,
    hash: &str,
    plan: &PlanningCompactionPlan,
    restored_to: Option<String>,
) -> PlanningCompactionReceipt {
    PlanningCompactionReceipt {
        schema_version: COMPACTION_SCHEMA_VERSION,
        action: action.to_owned(),
        owner: owner.to_owned(),
        plan_sha256: hash.to_owned(),
        project_root: plan.project_root.clone(),
        archive_root: plan.archive_root.clone(),
        active_index_path: plan.active_index_path.clone(),
        restored_to,
        entries: plan.entries.clone(),
    }
}

fn canonical_existing_dir(path: &Path, label: &str) -> Result<PathBuf, PlanningArchiveError> {
    let canonical = path
        .canonicalize()
        .map_err(|e| PlanningArchiveError(format!("cannot resolve {label}: {e}")))?;
    if !canonical.is_dir() {
        fail(&format!("{label} is not a directory"))?;
    }
    Ok(canonical)
}
fn read_text(path: &Path) -> Result<String, PlanningArchiveError> {
    fs::read_to_string(path)
        .map_err(|e| PlanningArchiveError(format!("cannot read {}: {e}", path.display())))
}
fn sha_bytes(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn sha_json<T: Serialize>(value: &T) -> Result<String, PlanningArchiveError> {
    Ok(sha_bytes(
        (serde_json::to_string_pretty(value).map_err(|e| PlanningArchiveError(e.to_string()))?
            + "\n")
            .as_bytes(),
    ))
}
fn fail<T>(message: &str) -> Result<T, PlanningArchiveError> {
    Err(PlanningArchiveError(message.to_owned()))
}
