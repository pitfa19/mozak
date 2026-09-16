use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fmt::{Display, Formatter},
    fs,
    path::{Component, Path, PathBuf},
};

use crate::planning::{Plan, PlanningInputSet, validate_input_set_json, validate_plan_json};

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
    pub retention: PlanningRetentionClass,
    pub sha256: String,
    pub bytes: u64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PlanningArtifactKind {
    AcceptedInputs,
    Plan,
    LegacyAcceptedInputs,
    ActiveIndex,
    Other,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PlanningRetentionClass {
    ActiveContract,
    LegacyContract,
    SupportArtifact,
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

pub type ArchivedPlanningArtifacts = (Vec<(String, PlanningInputSet)>, Vec<(String, Plan)>);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CompactionRecommendation {
    pub recommended: bool,
    pub compactable_count: usize,
    pub compactable_bytes: u64,
    pub retained_count: usize,
    pub reasons: Vec<String>,
    pub plan_command: String,
    pub apply_requires_approval: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlanningArtifactResolver {
    pub archived_inputs: Vec<(String, PlanningInputSet)>,
    pub archived_plans: Vec<(String, Plan)>,
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
    collect_planning_files(&root, &planning, &mut entries)?;
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
    let retained = retained_active_paths(&root, &plan)?;
    let lock = acquire_lock(&root)?;
    let staging = root.join(".mozak/planning/.compact-staging");
    if staging.exists() {
        fail(
            "compaction staging already exists; remove it only after verifying no operation is active",
        )?;
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
    let archive_root = root.join(&plan.archive_root);
    let index_path = root.join(&plan.active_index_path);
    let rollback = apply_transaction(
        &root,
        &plan,
        &retained,
        &archive_stage,
        &index_stage,
        &archive_root,
        &index_path,
    );
    if let Err(error) = rollback {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }
    fs::remove_dir_all(&staging)
        .map_err(|e| PlanningArchiveError(format!("cannot remove staging: {e}")))?;
    drop(lock);
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
    let lock = acquire_lock(&root)?;
    let mut verified = Vec::with_capacity(plan.entries.len());
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
        if bytes.len() as u64 != entry.bytes {
            fail(&format!(
                "archive blob byte count mismatch for {}",
                entry.relative_path
            ))?;
        }
        verified.push((entry, bytes));
    }
    let output = prepare_output_root_staged(output_root)?;
    let output_stage = output.with_extension("restore-staging");
    for (entry, bytes) in verified {
        let target_rel = safe_relative(&entry.relative_path)?;
        let target = output_stage.join(target_rel);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| {
                PlanningArchiveError(format!("cannot create restore directory: {e}"))
            })?;
        }
        fs::write(&target, bytes).map_err(|e| {
            PlanningArchiveError(format!("cannot restore {}: {e}", target.display()))
        })?;
    }
    fs::rename(&output_stage, &output)
        .map_err(|e| PlanningArchiveError(format!("cannot install restore output: {e}")))?;
    drop(lock);
    Ok(receipt(
        "restore",
        &approval.owner,
        &expected,
        &plan,
        Some(output.to_string_lossy().into_owned()),
    ))
}

/// Loads archived accepted input sets and plans from the active index.
///
/// # Errors
/// Returns an error when an active index exists but is malformed, unsafe, corrupt, or internally inconsistent.
pub fn archived_planning_artifacts(
    root: &Path,
) -> Result<ArchivedPlanningArtifacts, PlanningArchiveError> {
    let resolver = resolve_planning_artifacts(root)?;
    Ok((resolver.archived_inputs, resolver.archived_plans))
}

/// Validates and resolves the project planning archive once for all public readers.
///
/// Loose active files win only when their bytes exactly match the active index. Missing
/// loose files are loaded from content-addressed archive blobs, and corruption fails closed.
///
/// # Errors
/// Returns an error when the project root, active index, archive blob, loose artifact,
/// or referenced plan/input pair is missing, unsafe, corrupt, or invalid.
pub fn resolve_planning_artifacts(
    root: &Path,
) -> Result<PlanningArtifactResolver, PlanningArchiveError> {
    let root = canonical_existing_dir(root, "project root")?;
    let index = root.join(".mozak/planning/active-index.json");
    if !index.exists() {
        return Ok(PlanningArtifactResolver {
            archived_inputs: Vec::new(),
            archived_plans: Vec::new(),
        });
    }
    let text = read_text(&index)?;
    let archive: PlanningCompactionPlan = serde_json::from_str(&text)
        .map_err(|e| PlanningArchiveError(format!("invalid active index JSON: {e}")))?;
    validate_plan_shape(&root, &archive)?;
    let mut inputs = Vec::new();
    let mut input_map = BTreeMap::new();
    for entry in archive.entries.iter().filter(|entry| {
        matches!(
            entry.kind,
            PlanningArtifactKind::AcceptedInputs | PlanningArtifactKind::LegacyAcceptedInputs
        )
    }) {
        let (bytes, loose_present) = read_logical_artifact(&root, &archive, entry)?;
        let parsed = validate_input_set_json(std::str::from_utf8(&bytes).map_err(|_| {
            PlanningArchiveError(format!(
                "archived input is not UTF-8: {}",
                entry.relative_path
            ))
        })?)
        .map_err(|e| {
            PlanningArchiveError(format!(
                "invalid archived input {}: {e}",
                entry.relative_path
            ))
        })?;
        input_map.insert(parsed.id.clone(), parsed.clone());
        if !loose_present {
            inputs.push((entry.relative_path.clone(), parsed));
        }
    }
    let mut plans = Vec::new();
    for entry in archive
        .entries
        .iter()
        .filter(|entry| entry.kind == PlanningArtifactKind::Plan)
    {
        let (bytes, loose_present) = read_logical_artifact(&root, &archive, entry)?;
        let text = std::str::from_utf8(&bytes).map_err(|_| {
            PlanningArchiveError(format!(
                "archived plan is not UTF-8: {}",
                entry.relative_path
            ))
        })?;
        let candidate: Plan = serde_json::from_str(text).map_err(|e| {
            PlanningArchiveError(format!(
                "invalid archived plan JSON {}: {e}",
                entry.relative_path
            ))
        })?;
        let input = input_map.get(&candidate.input_set_id).ok_or_else(|| {
            PlanningArchiveError(format!(
                "archived plan references missing archived input set: {}",
                candidate.input_set_id
            ))
        })?;
        let plan = validate_plan_json(text, input).map_err(|e| {
            PlanningArchiveError(format!(
                "invalid archived plan {}: {e}",
                entry.relative_path
            ))
        })?;
        if !loose_present {
            plans.push((entry.relative_path.clone(), plan));
        }
    }
    Ok(PlanningArtifactResolver {
        archived_inputs: inputs,
        archived_plans: plans,
    })
}

/// Returns a read-only compaction recommendation for overview/context surfaces.
///
/// This never mutates project bytes and never implies approval. The apply route remains
/// gated by an exact owner approval artifact pinned to the generated plan hash.
///
/// # Errors
/// Returns an error when planning artifacts cannot be indexed, parsed, or classified safely.
pub fn compaction_recommendation(
    root: &Path,
    generated_at: &str,
) -> Result<CompactionRecommendation, PlanningArchiveError> {
    let plan = build_compaction_plan(root, generated_at)?;
    let root = canonical_existing_dir(root, "project root")?;
    let retained = retained_active_paths(&root, &plan)?;
    let compactable = plan
        .entries
        .iter()
        .filter(|entry| {
            !retained.contains(&entry.relative_path)
                && entry.relative_path != plan.active_index_path
                && matches!(
                    entry.kind,
                    PlanningArtifactKind::AcceptedInputs
                        | PlanningArtifactKind::LegacyAcceptedInputs
                        | PlanningArtifactKind::Plan
                )
        })
        .collect::<Vec<_>>();
    let compactable_bytes = compactable.iter().map(|entry| entry.bytes).sum();
    let compactable_count = compactable.len();
    let mut reasons = Vec::new();
    if compactable_count > 0 {
        reasons.push("superseded planning predecessors are recoverable from the archive while active plan families keep their referenced input sets loose".to_owned());
    }
    Ok(CompactionRecommendation {
        recommended: compactable_count > 0,
        compactable_count,
        compactable_bytes,
        retained_count: retained.len(),
        reasons,
        plan_command: format!(
            "mozak planning compact plan {} <output-plan.json>",
            shell_path(&root)
        ),
        apply_requires_approval: true,
    })
}

fn read_logical_artifact(
    root: &Path,
    archive: &PlanningCompactionPlan,
    entry: &PlanningArchiveEntry,
) -> Result<(Vec<u8>, bool), PlanningArchiveError> {
    let loose = root.join(safe_relative(&entry.relative_path)?);
    if loose.is_file() {
        let bytes = fs::read(&loose).map_err(|e| {
            PlanningArchiveError(format!(
                "cannot read active artifact {}: {e}",
                loose.display()
            ))
        })?;
        if bytes.len() as u64 != entry.bytes || sha_bytes(&bytes) != entry.sha256 {
            fail(&format!(
                "active/archive hash disagreement for {}",
                entry.relative_path
            ))?;
        }
        return Ok((bytes, true));
    }
    Ok((read_archive_blob(root, archive, entry)?, false))
}

fn retained_active_paths(
    root: &Path,
    plan: &PlanningCompactionPlan,
) -> Result<BTreeSet<String>, PlanningArchiveError> {
    let mut inputs_by_id = BTreeMap::<String, String>::new();
    let mut plans = Vec::<(String, Plan)>::new();
    for entry in &plan.entries {
        match entry.kind {
            PlanningArtifactKind::AcceptedInputs | PlanningArtifactKind::LegacyAcceptedInputs => {
                let text = fs::read_to_string(root.join(&entry.relative_path)).map_err(|e| {
                    PlanningArchiveError(format!(
                        "cannot read planning input {}: {e}",
                        entry.relative_path
                    ))
                })?;
                let input = validate_input_set_json(&text).map_err(|e| {
                    PlanningArchiveError(format!(
                        "invalid planning input {}: {e}",
                        entry.relative_path
                    ))
                })?;
                inputs_by_id
                    .entry(input.id)
                    .or_insert_with(|| entry.relative_path.clone());
            }
            PlanningArtifactKind::Plan => {
                let text = fs::read_to_string(root.join(&entry.relative_path)).map_err(|e| {
                    PlanningArchiveError(format!(
                        "cannot read planning plan {}: {e}",
                        entry.relative_path
                    ))
                })?;
                let plan: Plan = serde_json::from_str(&text).map_err(|e| {
                    PlanningArchiveError(format!(
                        "invalid planning plan JSON {}: {e}",
                        entry.relative_path
                    ))
                })?;
                plans.push((entry.relative_path.clone(), plan));
            }
            _ => {}
        }
    }
    let superseded = plans
        .iter()
        .filter_map(|(_, plan)| {
            plan.supersedes
                .as_ref()
                .map(|prev| (prev.id.clone(), prev.version))
        })
        .collect::<BTreeSet<_>>();
    let mut retained = BTreeSet::from([plan.active_index_path.clone()]);
    for (path, candidate) in plans {
        if !superseded.contains(&(candidate.id.clone(), candidate.version)) {
            retained.insert(path);
            if let Some(input_path) = inputs_by_id.get(&candidate.input_set_id) {
                retained.insert(input_path.clone());
            }
        }
    }
    Ok(retained)
}

fn apply_transaction(
    root: &Path,
    plan: &PlanningCompactionPlan,
    retained: &BTreeSet<String>,
    archive_stage: &Path,
    index_stage: &Path,
    archive_root: &Path,
    index_path: &Path,
) -> Result<(), PlanningArchiveError> {
    let rollback = root.join(".mozak/planning/.compact-staging/rollback");
    move_tree_contents(archive_stage, archive_root)?;
    atomic_replace(index_stage, index_path)?;
    archived_planning_artifacts(root)?;
    for entry in &plan.entries {
        if retained.contains(&entry.relative_path) || entry.relative_path == plan.active_index_path
        {
            continue;
        }
        let source = root.join(&entry.relative_path);
        if source.is_file() {
            let target = rollback.join(&entry.relative_path);
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|e| {
                    PlanningArchiveError(format!("cannot stage removal rollback: {e}"))
                })?;
            }
            fs::rename(&source, &target).map_err(|e| {
                PlanningArchiveError(format!("cannot remove loose planning artifact: {e}"))
            })?;
        }
    }
    if let Err(error) = archived_planning_artifacts(root) {
        let _ = move_tree_contents(&rollback, root);
        return Err(error);
    }
    let _ = fs::remove_dir_all(&rollback);
    Ok(())
}

fn read_archive_blob(
    root: &Path,
    archive: &PlanningCompactionPlan,
    entry: &PlanningArchiveEntry,
) -> Result<Vec<u8>, PlanningArchiveError> {
    let source = root
        .join(&archive.archive_root)
        .join(&entry.sha256[..2])
        .join(format!("{}.json", entry.sha256));
    let bytes = fs::read(&source).map_err(|e| {
        PlanningArchiveError(format!(
            "cannot read archive blob {}: {e}",
            source.display()
        ))
    })?;
    if sha_bytes(&bytes) != entry.sha256 || bytes.len() as u64 != entry.bytes {
        fail(&format!(
            "archive blob corruption detected for {}",
            entry.relative_path
        ))?;
    }
    Ok(bytes)
}

fn collect_planning_files(
    root: &Path,
    dir: &Path,
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
        let rel = path
            .strip_prefix(root)
            .map_err(|_| PlanningArchiveError("artifact outside project root".into()))?
            .to_string_lossy()
            .replace('\\', "/");
        if is_compaction_internal(&rel) {
            continue;
        }
        if path.is_dir() {
            collect_planning_files(root, &path, entries)?;
        } else if fs::metadata(&path)
            .map_err(|e| PlanningArchiveError(format!("cannot inspect {}: {e}", path.display())))?
            .is_file()
        {
            let kind = classify_planning_file(&rel);
            push_entry(root, &path, kind, entries)?;
        }
    }
    Ok(())
}

fn classify_planning_file(relative: &str) -> PlanningArtifactKind {
    if relative == ".mozak/planning/accepted-inputs.json" {
        PlanningArtifactKind::LegacyAcceptedInputs
    } else if relative == ".mozak/planning/active-index.json" {
        PlanningArtifactKind::ActiveIndex
    } else if relative.starts_with(".mozak/planning/inputs/") && has_json_extension(relative) {
        PlanningArtifactKind::AcceptedInputs
    } else if relative.starts_with(".mozak/planning/")
        && has_json_extension(relative)
        && (relative.starts_with(".mozak/planning/plans/")
            || relative
                .rsplit('/')
                .next()
                .is_some_and(|name| name.starts_with("goal-dag")))
    {
        PlanningArtifactKind::Plan
    } else {
        PlanningArtifactKind::Other
    }
}

fn has_json_extension(value: &str) -> bool {
    Path::new(value)
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("json"))
}

fn shell_path(path: &Path) -> String {
    let text = path.to_string_lossy();
    format!("'{}'", text.replace('\'', "'\\''"))
}

fn is_compaction_internal(relative: &str) -> bool {
    relative == ".mozak/planning/.compact-lock"
        || relative.starts_with(".mozak/planning/archive/")
        || relative.starts_with(".mozak/planning/.compact-staging")
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
        retention: retention_for(kind),
        sha256: sha_bytes(&bytes),
        bytes: bytes.len() as u64,
    });
    Ok(())
}

fn retention_for(kind: PlanningArtifactKind) -> PlanningRetentionClass {
    match kind {
        PlanningArtifactKind::AcceptedInputs
        | PlanningArtifactKind::Plan
        | PlanningArtifactKind::ActiveIndex => PlanningRetentionClass::ActiveContract,
        PlanningArtifactKind::LegacyAcceptedInputs => PlanningRetentionClass::LegacyContract,
        PlanningArtifactKind::Other => PlanningRetentionClass::SupportArtifact,
    }
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

fn prepare_output_root_staged(path: &Path) -> Result<PathBuf, PlanningArchiveError> {
    if path.exists() {
        fail("restore output already exists")?;
    }
    let staging = path.with_extension("restore-staging");
    if staging.exists() {
        fail("restore staging already exists; refusing to overwrite possible interrupted restore")?;
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| PlanningArchiveError(format!("cannot create restore parent: {e}")))?;
    }
    fs::create_dir(&staging)
        .map_err(|e| PlanningArchiveError(format!("cannot create restore staging: {e}")))?;
    path.canonicalize().or_else(|_| Ok(path.to_path_buf()))
}

struct CompactLock(PathBuf);

impl Drop for CompactLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

fn acquire_lock(root: &Path) -> Result<CompactLock, PlanningArchiveError> {
    let path = root.join(".mozak/planning/.compact-lock");
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|e| PlanningArchiveError(format!("cannot acquire compaction lock: {e}")))?;
    Ok(CompactLock(path))
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
