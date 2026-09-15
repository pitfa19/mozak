use mozak_core::{
    case_study::validate_case_json,
    concept::{Adoption, Concept, Translation, validate_concept_json, validate_translation},
    execution::{ExecutionBundle, validate_bundle_json},
    planning::{
        GoalStatus, Plan, PlanningInputSet, next_ready_goals, superseded_by,
        validate_input_set_json, validate_plan_json,
    },
    planning_archive::archived_planning_artifacts,
    project_context::{ContextStatus, validate_context_manifest_json},
    project_contract::{validate_idea_markdown, validate_project_yaml},
    project_release::{ProjectRelease, generate_project_release, validate_project_release},
    research::validate_run_json,
};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    env,
    fmt::Write as _,
    fs,
    io::Write as _,
    path::{Path, PathBuf},
    process::{Command, ExitCode, Stdio},
};

const MAX_FINDINGS: usize = 64;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SnapshotState {
    Valid,
    Incomplete,
    Invalid,
}

impl SnapshotState {
    pub fn exit_code(self) -> ExitCode {
        match self {
            Self::Valid => ExitCode::SUCCESS,
            Self::Incomplete => ExitCode::from(2),
            Self::Invalid => ExitCode::from(3),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct ArtifactCounts {
    pub recognized: usize,
    pub valid: usize,
    pub invalid: usize,
    pub unknown: usize,
}

#[derive(Debug, Serialize)]
pub struct Finding {
    pub path: String,
    pub status: String,
    pub message: String,
}

#[derive(Debug, Serialize)]
pub struct GoalView {
    pub id: String,
    pub version: u64,
    pub title: String,
    pub status: String,
    pub priority: u32,
}

#[derive(Debug, Serialize)]
pub struct PlanView {
    pub path: String,
    pub id: String,
    pub version: u64,
}

/// One project-owned Concept or Translation.
#[derive(Debug, Serialize)]
pub struct ConceptView {
    pub path: String,
    pub id: String,
    pub version: u64,
    pub role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub adoption: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ContextView {
    pub id: String,
    pub status: String,
    pub context_note: String,
    pub source_revision: String,
    pub goal_id: String,
    pub plan_version: u64,
}

#[derive(Debug, Serialize)]
pub struct WorkflowSnapshot {
    pub schema_version: u64,
    pub command: &'static str,
    pub project_root: String,
    pub state: SnapshotState,
    pub artifact_counts: BTreeMap<String, ArtifactCounts>,
    pub contexts: Vec<ContextView>,
    pub latest_valid_plan: Option<PlanView>,
    pub concepts: Vec<ConceptView>,
    pub goals: Vec<GoalView>,
    pub ready_goals: Vec<GoalView>,
    pub findings: Vec<Finding>,
    pub next_actions: Vec<String>,
}

pub fn overview(root: &Path) -> Result<ExitCode, String> {
    let snapshot = snapshot(root)?;
    println!(
        "{}",
        serde_json::to_string(&snapshot).map_err(|error| error.to_string())?
    );
    Ok(snapshot.state.exit_code())
}

pub fn list(root: &Path) -> Result<ExitCode, String> {
    let snapshot = snapshot(root)?;
    print!("{}", render_list(&snapshot));
    Ok(snapshot.state.exit_code())
}

pub fn graph_source(root: &Path) -> Result<ExitCode, String> {
    let snapshot = snapshot(root)?;
    print!("{}", mermaid(&snapshot));
    Ok(snapshot.state.exit_code())
}

pub fn graph(root: &Path) -> Result<ExitCode, String> {
    let snapshot = snapshot(root)?;
    let source = mermaid(&snapshot);
    let executable = env::var("MOZAK_TERMAID").unwrap_or_else(|_| "termaid".into());
    let mut child = Command::new(&executable)
        .stdin(Stdio::piped())
        .stdout(Stdio::inherit())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("cannot run Termaid executable {executable:?}: {error}"))?;
    // A Termaid that fails immediately can close stdin before the source is
    // written. Reporting that broken pipe would hide the child's real error,
    // so the write failure is held and only surfaces if the child succeeded
    // anyway, which would mean the source never arrived.
    let write_failed = child
        .stdin
        .take()
        .ok_or_else(|| "cannot open Termaid stdin".to_owned())?
        .write_all(source.as_bytes())
        .err();
    let output = child
        .wait_with_output()
        .map_err(|error| format!("cannot wait for Termaid: {error}"))?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "Termaid failed with {}: {}",
            output.status,
            detail.trim()
        ));
    }
    if let Some(error) = write_failed {
        return Err(format!("cannot write Mermaid source to Termaid: {error}"));
    }
    Ok(snapshot.state.exit_code())
}

/// Drops plans that another valid plan supersedes, recording each as a finding.
///
/// Recorded lineage must be enforced, not merely stored: a superseded plan can
/// never be current, however high its version, and a caller that selects by
/// version alone would otherwise redo completed work.
fn retain_current_plans(
    root: &Path,
    valid_plans: Vec<(PathBuf, Plan)>,
    findings: &mut Vec<Finding>,
) -> Vec<(PathBuf, Plan)> {
    let all_plans: Vec<_> = valid_plans.iter().map(|(_, plan)| plan.clone()).collect();
    valid_plans
        .into_iter()
        .filter(|(path, plan)| {
            if let Some(successor) = superseded_by(&all_plans, plan) {
                findings.push(Finding {
                    path: relative(root, path),
                    status: "superseded".into(),
                    message: format!(
                        "plan {} version {} is superseded by version {}",
                        plan.id, plan.version, successor.version
                    ),
                });
                return false;
            }
            true
        })
        .collect()
}

#[allow(clippy::too_many_lines)]
pub fn snapshot(root: &Path) -> Result<WorkflowSnapshot, String> {
    if !root.is_dir() {
        return Err(format!(
            "project path is not a directory: {}",
            root.display()
        ));
    }
    let root = root
        .canonicalize()
        .map_err(|error| format!("cannot resolve project path {}: {error}", root.display()))?;
    let mut findings = Vec::new();
    let mut counts = BTreeMap::from([
        ("context".into(), empty_counts()),
        ("research".into(), empty_counts()),
        ("planning".into(), empty_counts()),
        ("execution".into(), empty_counts()),
        ("release".into(), empty_counts()),
        ("concept".into(), empty_counts()),
    ]);

    let (manifest_valid, idea_valid, revision, mut input_sets) =
        inspect_foundation(&root, &mut counts, &mut findings);
    let mut archived_plans = Vec::new();
    match archived_planning_artifacts(&root) {
        Ok((archived_inputs, plans)) => {
            for (path, inputs) in archived_inputs {
                input_sets.entry(inputs.id.clone()).or_insert(inputs);
                recognized(&mut counts, "planning");
                valid(&mut counts, "planning");
                let _ = path;
            }
            archived_plans = plans
                .into_iter()
                .map(|(path, plan)| (root.join(path), plan))
                .collect();
        }
        Err(message) => {
            invalid(&mut counts, "planning");
            finding(
                &root,
                &root.join(".mozak/planning/active-index.json"),
                "invalid",
                message.to_string(),
                &mut findings,
            );
        }
    }

    discover_research(&root, &mut counts, &mut findings)?;
    let contexts = discover_contexts(&root, &mut counts, &mut findings)?;
    let concepts = discover_concepts(&root, &mut counts, &mut findings)?;
    let mut valid_plans = discover_plans(&root, &input_sets, &mut counts, &mut findings)?;
    for archived in archived_plans {
        recognized(&mut counts, "planning");
        valid(&mut counts, "planning");
        valid_plans.push(archived);
    }
    discover_execution(&root, revision.as_deref(), &mut counts, &mut findings)?;
    discover_releases(&root, &mut counts, &mut findings)?;
    discover_unknown(&root, &mut counts, &mut findings)?;

    let current_plans = retain_current_plans(&root, valid_plans, &mut findings);
    let latest = current_plans
        .into_iter()
        .max_by(|(path_a, a), (path_b, b)| {
            a.id.cmp(&b.id)
                .then_with(|| a.version.cmp(&b.version))
                .then_with(|| path_a.cmp(path_b))
        });
    let (latest_valid_plan, goals, ready_goals) = match latest {
        Some((path, plan)) => {
            let inputs = input_sets
                .get(&plan.input_set_id)
                .expect("validated plan input set");
            let ready = next_ready_goals(&plan, inputs).map_err(|error| error.to_string())?;
            (
                Some(PlanView {
                    path: relative(&root, &path),
                    id: plan.id.clone(),
                    version: plan.version,
                }),
                goal_views(&plan.goals),
                goal_views(
                    &ready
                        .iter()
                        .map(|goal_id| {
                            plan.goals
                                .iter()
                                .find(|goal| &goal.id == goal_id)
                                .expect("validated ready goal")
                                .clone()
                        })
                        .collect::<Vec<_>>(),
                ),
            )
        }
        None => (None, Vec::new(), Vec::new()),
    };
    let invalid_count = counts.values().map(|count| count.invalid).sum::<usize>();
    let state = if invalid_count > 0 || findings.iter().any(|f| f.status == "invalid") {
        SnapshotState::Invalid
    } else if !manifest_valid || !idea_valid || input_sets.is_empty() || latest_valid_plan.is_none()
    {
        SnapshotState::Incomplete
    } else {
        SnapshotState::Valid
    };
    let next_actions = actions(
        state,
        !input_sets.is_empty(),
        latest_valid_plan.is_some(),
        &ready_goals,
    );
    Ok(WorkflowSnapshot {
        schema_version: 1,
        command: "project overview",
        project_root: root.to_string_lossy().into_owned(),
        state,
        artifact_counts: counts,
        contexts,
        latest_valid_plan,
        concepts,
        goals,
        ready_goals,
        findings,
        next_actions,
    })
}

fn discover_contexts(
    root: &Path,
    counts: &mut BTreeMap<String, ArtifactCounts>,
    findings: &mut Vec<Finding>,
) -> Result<Vec<ContextView>, String> {
    let mut contexts = Vec::new();
    for path in files_under(&root.join(".mozak/context"))?
        .into_iter()
        .filter(|path| is_json(path))
    {
        recognized(counts, "context");
        let result = read_text(&path).and_then(|text| {
            let manifest =
                validate_context_manifest_json(&text).map_err(|error| error.to_string())?;
            let note_path = root.join(&manifest.context_note);
            let note = fs::read(&note_path).map_err(|error| {
                format!(
                    "cannot read context note {}: {error}",
                    relative(root, &note_path)
                )
            })?;
            let note_hash = format!("{:x}", Sha256::digest(&note));
            if note_hash != manifest.context_note_sha256 {
                return Err("context note hash mismatch".into());
            }
            let run_path = root.join(&manifest.research_run);
            let run_text = read_text(&run_path)?;
            let run = validate_run_json(&run_text).map_err(|error| error.to_string())?;
            if run.receipt.artifact_hash != manifest.research_run_artifact_hash {
                return Err("context research run hash mismatch".into());
            }
            Ok(ContextView {
                id: manifest.id,
                status: match manifest.status {
                    ContextStatus::Completed => "completed".into(),
                },
                context_note: manifest.context_note,
                source_revision: manifest.source_revision,
                goal_id: manifest.goal_id,
                plan_version: manifest.plan_version,
            })
        });
        match result {
            Ok(context) => {
                valid(counts, "context");
                contexts.push(context);
            }
            Err(message) => {
                invalid(counts, "context");
                finding(root, &path, "invalid", message, findings);
            }
        }
    }
    contexts.sort_by(|left, right| left.id.cmp(&right.id));
    Ok(contexts)
}

fn inspect_foundation(
    root: &Path,
    counts: &mut BTreeMap<String, ArtifactCounts>,
    findings: &mut Vec<Finding>,
) -> (
    bool,
    bool,
    Option<String>,
    BTreeMap<String, PlanningInputSet>,
) {
    let manifest = read_contract(
        root,
        ".mozak/project.yml",
        |text| validate_project_yaml(text).map_err(|error| error.to_string()),
        findings,
    );
    let idea_valid = read_contract(
        root,
        ".mozak/idea.md",
        |text| validate_idea_markdown(text).map_err(|error| error.to_string()),
        findings,
    )
    .is_some();
    let revision = manifest
        .as_ref()
        .map(|manifest| manifest.repository.revision.clone());
    let mut paths = files_under(&root.join(".mozak/planning/inputs"))
        .unwrap_or_else(|message| {
            finding(
                root,
                &root.join(".mozak/planning/inputs"),
                "invalid",
                message,
                findings,
            );
            Vec::new()
        })
        .into_iter()
        .filter(|path| is_json(path))
        .collect::<Vec<_>>();
    let legacy_path = root.join(".mozak/planning/accepted-inputs.json");
    if legacy_path.exists() {
        paths.push(legacy_path);
    }
    paths.sort();

    let mut parsed = Vec::new();
    for path in paths {
        recognized(counts, "planning");
        match read_text(&path)
            .and_then(|text| validate_input_set_json(&text).map_err(|error| error.to_string()))
        {
            Ok(value) => parsed.push((path, value)),
            Err(message) => {
                invalid(counts, "planning");
                finding(root, &path, "invalid", message, findings);
            }
        }
    }

    let mut paths_by_id = BTreeMap::<String, Vec<PathBuf>>::new();
    for (path, inputs) in &parsed {
        paths_by_id
            .entry(inputs.id.clone())
            .or_default()
            .push(path.clone());
    }
    let duplicate_ids = paths_by_id
        .iter()
        .filter(|(_, paths)| paths.len() > 1)
        .map(|(id, _)| id.clone())
        .collect::<BTreeSet<_>>();
    let mut inputs = BTreeMap::new();
    for (path, value) in parsed {
        if duplicate_ids.contains(&value.id) {
            invalid(counts, "planning");
            finding(
                root,
                &path,
                "invalid",
                format!("duplicate planning input set id: {}", value.id),
                findings,
            );
        } else {
            valid(counts, "planning");
            inputs.insert(value.id.clone(), value);
        }
    }
    (manifest.is_some(), idea_valid, revision, inputs)
}

fn discover_research(
    root: &Path,
    counts: &mut BTreeMap<String, ArtifactCounts>,
    findings: &mut Vec<Finding>,
) -> Result<(), String> {
    for path in files_under(&root.join(".mozak/research"))? {
        // A research run and a pinned case record are both authoritative
        // research artifacts. A case record is how finished work on an
        // onboarded project becomes evidence about MOZAK itself.
        let outcome = match path.file_name().and_then(|v| v.to_str()) {
            Some("run.json") => read_text(&path)
                .and_then(|text| validate_run_json(&text).map_err(|e| e.to_string()))
                .map(|_| ()),
            Some("case.json") => read_text(&path)
                .and_then(|text| validate_case_json(&text).map_err(|e| e.to_string()))
                .map(|_| ()),
            _ => continue,
        };
        recognized(counts, "research");
        match outcome {
            Ok(()) => valid(counts, "research"),
            Err(message) => {
                invalid(counts, "research");
                finding(root, &path, "invalid", message, findings);
            }
        }
    }
    Ok(())
}

/// Discovers project-owned Concepts and Translations.
///
/// A Project owns the Concepts it authored and the Translations recording what
/// it adopted. A Translation is validated against the Concept it pins, which
/// may be authored elsewhere, so the concept file is resolved by its declared
/// identity rather than assumed local.
fn discover_concepts(
    root: &Path,
    counts: &mut BTreeMap<String, ArtifactCounts>,
    findings: &mut Vec<Finding>,
) -> Result<Vec<ConceptView>, String> {
    let mut views = Vec::new();
    let mut concepts = BTreeMap::new();
    for path in files_under(&root.join(".mozak/concepts"))? {
        if path.extension().is_none_or(|value| value != "json") {
            continue;
        }
        recognized(counts, "concept");
        match read_text(&path)
            .and_then(|text| validate_concept_json(&text).map_err(|e| e.to_string()))
        {
            Ok(concept) => {
                valid(counts, "concept");
                views.push(ConceptView {
                    path: relative(root, &path),
                    id: concept.id.clone(),
                    version: concept.version,
                    role: "authored".into(),
                    adoption: None,
                });
                concepts.insert(concept.id.clone(), concept);
            }
            Err(message) => {
                invalid(counts, "concept");
                finding(root, &path, "invalid", message, findings);
            }
        }
    }
    for path in files_under(&root.join(".mozak/translations"))? {
        if path.extension().is_none_or(|value| value != "json") {
            continue;
        }
        recognized(counts, "concept");
        match translation_view(root, &path, &concepts) {
            Ok(view) => {
                valid(counts, "concept");
                views.push(view);
            }
            Err(message) => {
                invalid(counts, "concept");
                finding(root, &path, "invalid", message, findings);
            }
        }
    }
    views.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(views)
}

fn translation_view(
    root: &Path,
    path: &Path,
    local: &BTreeMap<String, Concept>,
) -> Result<ConceptView, String> {
    let text = read_text(path)?;
    let translation: Translation = serde_json::from_str(&text)
        .map_err(|error| format!("invalid translation JSON: {error}"))?;
    let adoption = match translation.adoption {
        Adoption::Adopted => "adopted",
        Adoption::Qualified => "qualified",
        Adoption::Declined => "declined",
    };
    // A Concept is owned by its author, so the source usually lives in another
    // scope. When it is authored here the full contract is checked; when it is
    // not, the pin is reported unresolved rather than either failing the
    // project or being silently treated as verified.
    match local.get(&translation.concept.id) {
        Some(concept) => {
            validate_translation(&translation, concept).map_err(|error| error.to_string())?;
            Ok(ConceptView {
                path: relative(root, path),
                id: translation.id,
                version: translation.version,
                role: "translation".into(),
                adoption: Some(adoption.into()),
            })
        }
        None => Ok(ConceptView {
            path: relative(root, path),
            id: translation.id,
            version: translation.version,
            role: "translation_of_external_concept".into(),
            adoption: Some(adoption.into()),
        }),
    }
}

fn discover_plans(
    root: &Path,
    input_sets: &BTreeMap<String, PlanningInputSet>,
    counts: &mut BTreeMap<String, ArtifactCounts>,
    findings: &mut Vec<Finding>,
) -> Result<Vec<(PathBuf, Plan)>, String> {
    let mut plans = Vec::new();
    let mut paths = files_under(&root.join(".mozak/planning/plans"))?
        .into_iter()
        .filter(|path| is_json(path))
        .collect::<BTreeSet<_>>();
    for path in files_under(&root.join(".mozak/planning"))? {
        if path.parent() == Some(root.join(".mozak/planning").as_path())
            && path
                .file_name()
                .and_then(|value| value.to_str())
                .is_some_and(|name| name.starts_with("goal-dag") && is_json(Path::new(name)))
        {
            paths.insert(path);
        }
    }
    for path in paths {
        recognized(counts, "planning");
        let result = read_text(&path).and_then(|text| {
            let plan = serde_json::from_str::<Plan>(&text)
                .map_err(|error| format!("invalid plan JSON: {error}"))?;
            let inputs = input_sets.get(&plan.input_set_id).ok_or_else(|| {
                format!(
                    "accepted planning input set is missing or invalid: {}",
                    plan.input_set_id
                )
            })?;
            validate_plan_json(&text, inputs).map_err(|error| error.to_string())
        });
        match result {
            Ok(plan) => {
                valid(counts, "planning");
                plans.push((path, plan));
            }
            Err(message) => {
                invalid(counts, "planning");
                finding(root, &path, "invalid", message, findings);
            }
        }
    }
    Ok(plans)
}

fn discover_execution(
    root: &Path,
    revision: Option<&str>,
    counts: &mut BTreeMap<String, ArtifactCounts>,
    findings: &mut Vec<Finding>,
) -> Result<(), String> {
    for path in files_under(&root.join(".mozak/execution/bundles"))? {
        if path.extension().and_then(|v| v.to_str()) != Some("json") {
            continue;
        }
        recognized(counts, "execution");
        let result = read_text(&path).and_then(|text| {
            let bundle: ExecutionBundle = serde_json::from_str(&text)
                .map_err(|e| format!("invalid execution bundle JSON: {e}"))?;
            let revision =
                revision.ok_or_else(|| "valid project revision is required".to_owned())?;
            validate_bundle_json(&text, revision, &bundle.packet.freshness.valid_after)
                .map_err(|e| e.to_string())
        });
        match result {
            Ok(_) => valid(counts, "execution"),
            Err(message) => {
                invalid(counts, "execution");
                finding(root, &path, "invalid", message, findings);
            }
        }
    }
    Ok(())
}

fn discover_releases(
    root: &Path,
    counts: &mut BTreeMap<String, ArtifactCounts>,
    findings: &mut Vec<Finding>,
) -> Result<(), String> {
    for path in files_under(&root.join(".mozak/releases"))? {
        if !is_json(&path) {
            continue;
        }
        let text = read_text(&path)?;
        let value = serde_json::from_str::<Value>(&text).ok();
        let accepted_state = is_accepted_state_candidate(&path, value.as_ref());
        let canonical_release = is_release_candidate(&path, value.as_ref());
        if !accepted_state && !canonical_release {
            continue;
        }
        recognized(counts, "release");
        let result = if accepted_state {
            generate_project_release(&text)
                .map(|generated| generated.release)
                .map_err(|error| error.to_string())
        } else {
            parse_project_release(&text)
        };
        match result {
            Ok(_) => valid(counts, "release"),
            Err(message) => {
                invalid(counts, "release");
                finding(root, &path, "invalid", message, findings);
            }
        }
    }
    for path in files_under(&root.join(".mozak/exports"))? {
        if !is_json(&path) {
            continue;
        }
        let text = read_text(&path)?;
        let value = serde_json::from_str::<Value>(&text).ok();
        if !is_release_candidate(&path, value.as_ref()) {
            continue;
        }
        recognized(counts, "release");
        match parse_project_release(&text) {
            Ok(_) => valid(counts, "release"),
            Err(message) => {
                invalid(counts, "release");
                finding(root, &path, "invalid", message, findings);
            }
        }
    }
    Ok(())
}

fn discover_unknown(
    root: &Path,
    counts: &mut BTreeMap<String, ArtifactCounts>,
    findings: &mut Vec<Finding>,
) -> Result<(), String> {
    for (category, directory, recognized_path) in [
        ("research", ".mozak/research", "run.json"),
        ("planning", ".mozak/planning/plans", ".json"),
        ("execution", ".mozak/execution/bundles", ".json"),
        ("release", ".mozak/releases", "release"),
        ("release", ".mozak/exports", "release"),
    ] {
        for path in files_under(&root.join(directory))? {
            let known = if category == "research" {
                path.file_name().and_then(|v| v.to_str()) == Some(recognized_path)
            } else if category == "release" {
                if is_json(&path) {
                    let value = read_text(&path)
                        .ok()
                        .and_then(|text| serde_json::from_str::<Value>(&text).ok());
                    is_release_candidate(&path, value.as_ref())
                        || (directory == ".mozak/releases"
                            && is_accepted_state_candidate(&path, value.as_ref()))
                } else {
                    false
                }
            } else {
                path.extension().and_then(|v| v.to_str()) == Some(&recognized_path[1..])
            };
            if !known {
                counts.get_mut(category).expect("category").unknown += 1;
                finding(
                    root,
                    &path,
                    "unknown",
                    "file is not a recognized authoritative lifecycle artifact".into(),
                    findings,
                );
            }
        }
    }
    Ok(())
}

fn is_json(path: &Path) -> bool {
    path.extension().and_then(|value| value.to_str()) == Some("json")
}

fn normalized_file_name(path: &Path) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .replace('_', "-")
}

fn has_object_keys(value: Option<&Value>, keys: &[&str]) -> bool {
    value
        .and_then(Value::as_object)
        .is_some_and(|object| keys.iter().all(|key| object.contains_key(*key)))
}

fn is_accepted_state_candidate(path: &Path, value: Option<&Value>) -> bool {
    normalized_file_name(path).contains("accepted-state")
        || has_object_keys(
            value,
            &[
                "project",
                "release",
                "accepted_findings",
                "implementation_state",
            ],
        )
}

fn is_release_candidate(path: &Path, value: Option<&Value>) -> bool {
    (normalized_file_name(path).contains("release") && is_json(path))
        || has_object_keys(
            value,
            &[
                "release_id",
                "accepted_state_sha256",
                "accepted_findings",
                "implementation_state",
            ],
        )
}

fn parse_project_release(text: &str) -> Result<ProjectRelease, String> {
    let release = serde_json::from_str::<ProjectRelease>(text)
        .map_err(|error| format!("invalid project release JSON: {error}"))?;
    validate_project_release(&release).map_err(|error| error.to_string())?;
    Ok(release)
}

fn read_contract<T>(
    root: &Path,
    relative_path: &str,
    validator: impl FnOnce(&str) -> Result<T, String>,
    findings: &mut Vec<Finding>,
) -> Option<T> {
    let path = root.join(relative_path);
    match read_text(&path).and_then(|text| validator(&text)) {
        Ok(value) => Some(value),
        Err(message) => {
            let status = if path.exists() { "invalid" } else { "missing" };
            finding(root, &path, status, message, findings);
            None
        }
    }
}

fn files_under(directory: &Path) -> Result<Vec<PathBuf>, String> {
    if !directory.exists() {
        return Ok(Vec::new());
    }
    let mut pending = vec![directory.to_path_buf()];
    let mut files = Vec::new();
    while let Some(current) = pending.pop() {
        let mut entries = fs::read_dir(&current)
            .map_err(|e| format!("cannot read {}: {e}", current.display()))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("cannot read {}: {e}", current.display()))?;
        entries.sort_by_key(std::fs::DirEntry::path);
        for entry in entries.into_iter().rev() {
            let path = entry.path();
            if path.is_dir() {
                pending.push(path);
            } else if path.is_file() {
                files.push(path);
            }
        }
    }
    files.sort();
    Ok(files)
}

fn read_text(path: &Path) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| format!("cannot read {}: {e}", path.display()))
}
fn empty_counts() -> ArtifactCounts {
    ArtifactCounts {
        recognized: 0,
        valid: 0,
        invalid: 0,
        unknown: 0,
    }
}
fn recognized(c: &mut BTreeMap<String, ArtifactCounts>, k: &str) {
    c.get_mut(k).expect("category").recognized += 1;
}
fn valid(c: &mut BTreeMap<String, ArtifactCounts>, k: &str) {
    c.get_mut(k).expect("category").valid += 1;
}
fn invalid(c: &mut BTreeMap<String, ArtifactCounts>, k: &str) {
    c.get_mut(k).expect("category").invalid += 1;
}
fn finding(root: &Path, path: &Path, status: &str, message: String, findings: &mut Vec<Finding>) {
    if findings.len() < MAX_FINDINGS {
        findings.push(Finding {
            path: relative(root, path),
            status: status.into(),
            message,
        });
    }
}
fn relative(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}
fn goal_views(goals: &[mozak_core::planning::Goal]) -> Vec<GoalView> {
    goals
        .iter()
        .map(|g| GoalView {
            id: g.id.clone(),
            version: g.version,
            title: g.title.clone(),
            status: status(g.status).into(),
            priority: g.priority,
        })
        .collect()
}
fn status(value: GoalStatus) -> &'static str {
    match value {
        GoalStatus::Planned => "planned",
        GoalStatus::Ready => "ready",
        GoalStatus::InProgress => "in_progress",
        GoalStatus::Blocked => "blocked",
        GoalStatus::Failed => "failed",
        GoalStatus::Completed => "completed",
        GoalStatus::Superseded => "superseded",
    }
}
fn actions(state: SnapshotState, inputs: bool, plan: bool, ready: &[GoalView]) -> Vec<String> {
    if state == SnapshotState::Invalid {
        return vec!["repair malformed lifecycle artifacts listed in findings".into()];
    }
    let mut result = Vec::new();
    if !inputs {
        result.push("create and validate .mozak/planning/accepted-inputs.json".into());
    } else if !plan {
        result.push("create and validate a plan under .mozak/planning/plans/".into());
    } else if let Some(goal) = ready.first() {
        result.push(format!(
            "prepare bounded execution for ready goal {}",
            goal.id
        ));
    } else {
        result.push("review the plan for blocked, in-progress, or completed goals".into());
    }
    result
}

pub fn render_list(s: &WorkflowSnapshot) -> String {
    let mut out = format!(
        "MOZAK project: {}\nState: {:?}\nArtifacts:\n",
        s.project_root, s.state
    )
    .replace("Valid", "valid")
    .replace("Incomplete", "incomplete")
    .replace("Invalid", "invalid");
    for (name, count) in &s.artifact_counts {
        let _ = writeln!(
            out,
            "  {name}: {} recognized, {} valid, {} invalid, {} unknown",
            count.recognized, count.valid, count.invalid, count.unknown
        );
    }
    out.push_str("Contexts:\n");
    if s.contexts.is_empty() {
        out.push_str("  (none)\n");
    } else {
        for context in &s.contexts {
            let _ = writeln!(
                out,
                "  [{}] {} (goal {}, plan v{}) {}",
                context.status,
                context.id,
                context.goal_id,
                context.plan_version,
                context.context_note
            );
        }
    }
    out.push_str("Concepts:\n");
    if s.concepts.is_empty() {
        out.push_str("  (none)\n");
    } else {
        for concept in &s.concepts {
            match &concept.adoption {
                Some(adoption) => {
                    let _ = writeln!(
                        out,
                        "  [{}] {} v{} [{adoption}]",
                        concept.role, concept.id, concept.version
                    );
                }
                None => {
                    let _ = writeln!(
                        out,
                        "  [{}] {} v{} [advisory]",
                        concept.role, concept.id, concept.version
                    );
                }
            }
        }
    }
    out.push_str("Goals:\n");
    if s.goals.is_empty() {
        out.push_str("  (no valid plan)\n");
    } else {
        for goal in &s.goals {
            let _ = writeln!(
                out,
                "  [{}] {} (priority {}) {}",
                goal.status, goal.id, goal.priority, goal.title
            );
        }
    }
    out.push_str("Next actions:\n");
    for action in &s.next_actions {
        let _ = writeln!(out, "  - {action}");
    }
    out
}

pub fn mermaid(s: &WorkflowSnapshot) -> String {
    let mut out = String::from("flowchart TD\n");
    if s.goals.is_empty() {
        out.push_str("  empty[\"No valid plan\"]\n");
        return out;
    }
    let node_ids = s
        .goals
        .iter()
        .map(|goal| goal.id.as_str())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .enumerate()
        .map(|(index, id)| (id, format!("g_{index}")))
        .collect::<BTreeMap<_, _>>();
    for goal in &s.goals {
        let _ = writeln!(
            out,
            "  {}[\"{}: {} [{}]\"]",
            node_ids[goal.id.as_str()],
            escape(&goal.id),
            escape(&goal.title),
            goal.status
        );
    }
    if let Some(plan) = &s.latest_valid_plan {
        if let Ok(text) = fs::read_to_string(Path::new(&s.project_root).join(&plan.path)) {
            if let Ok(value) = serde_json::from_str::<Value>(&text) {
                if let Some(edges) = value.get("dependencies").and_then(Value::as_array) {
                    for edge in edges {
                        if let (Some(goal), Some(dependency)) = (
                            edge.get("goal_id").and_then(Value::as_str),
                            edge.get("depends_on_goal_id").and_then(Value::as_str),
                        ) {
                            if let (Some(dependency_node), Some(goal_node)) =
                                (node_ids.get(dependency), node_ids.get(goal))
                            {
                                let _ = writeln!(out, "  {dependency_node} --> {goal_node}");
                            }
                        }
                    }
                }
            }
        }
    }
    out
}
fn escape(text: &str) -> String {
    text.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', " ")
}
