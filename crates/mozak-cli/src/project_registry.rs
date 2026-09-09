use mozak_core::{
    kb::load_registry,
    project_contract::{
        IdeaDocument, ProjectManifest, validate_idea_markdown, validate_project_yaml,
    },
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    env, fs,
    io::Write,
    path::{Component, Path, PathBuf},
    process::{Command, ExitCode},
    time::{SystemTime, UNIX_EPOCH},
};

const SCHEMA_VERSION: u64 = 1;
const MAX_SCAN_ENTRIES: usize = 100_000;
const PRUNED: [&str; 8] = [
    ".git",
    ".mozak",
    "node_modules",
    "target",
    "build",
    "dist",
    "venv",
    ".venv",
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ProjectRecord {
    id: String,
    name: String,
    root: String,
    manifest_path: String,
    idea_path: String,
    manifest_sha256: String,
    idea_sha256: String,
    manifest_revision: String,
    observed_git_head: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct DiscoveryProposal {
    schema_version: u64,
    command: String,
    target_config_path: String,
    config_base_sha256: Option<String>,
    kb_root: String,
    kb_sha256: String,
    workspace_roots: Vec<String>,
    projects: Vec<ProjectRecord>,
    proposal_digest: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Approval {
    schema_version: u64,
    decision: bool,
    proposal_digest: String,
    target_config_path: String,
    owner: String,
    approved_at: String,
    rationale: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RefreshApproval {
    schema_version: u64,
    decision: bool,
    intent: String,
    proposal_digest: String,
    target_config_path: String,
    owner: String,
    approved_at: String,
    rationale: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct LocalConfig {
    schema_version: u64,
    kb_root: String,
    kb_sha256: String,
    projects: BTreeMap<String, ProjectRecord>,
    approval: ConfigApproval,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ConfigApproval {
    proposal_digest: String,
    owner: String,
    approved_at: String,
    rationale: String,
}

#[derive(Serialize)]
struct ProposalDigest<'a> {
    schema_version: u64,
    command: &'a str,
    target_config_path: &'a str,
    config_base_sha256: &'a Option<String>,
    kb_root: &'a str,
    kb_sha256: &'a str,
    workspace_roots: &'a [String],
    projects: &'a [ProjectRecord],
}

pub fn discover(kb_root: &Path, roots: &[PathBuf]) -> Result<ExitCode, String> {
    if roots.is_empty() {
        return Err("project discover requires at least one explicit workspace root".into());
    }
    let kb_root = safe_existing_directory(kb_root, "KB root")?;
    let kb = load_registry(&kb_root).map_err(|error| format!("invalid KB: {error}"))?;
    let target = default_config_path()?;
    validate_target_path(&target)?;
    let base = read_optional_regular(&target)?.map(|bytes| hash(&bytes));

    let mut root_paths = Vec::new();
    let mut projects = Vec::new();
    let mut ids = BTreeSet::new();
    for root in roots {
        let root = safe_existing_directory(root, "workspace root")?;
        root_paths.push(root);
    }
    root_paths.sort_by(|a, b| {
        a.components()
            .count()
            .cmp(&b.components().count())
            .then_with(|| a.cmp(b))
    });
    root_paths.dedup();
    let mut scan_roots = Vec::new();
    for root in root_paths {
        if !scan_roots
            .iter()
            .any(|parent: &PathBuf| root.starts_with(parent))
        {
            scan_roots.push(root);
        }
    }
    for root in &scan_roots {
        scan_root(root, &kb_root, &mut projects)?;
    }
    let mut canonical_roots = scan_roots
        .iter()
        .map(|root| path_text(root))
        .collect::<Result<Vec<_>, _>>()?;
    canonical_roots.sort();
    projects.sort_by(|a, b| a.id.cmp(&b.id).then_with(|| a.root.cmp(&b.root)));
    for project in &projects {
        if !ids.insert(project.id.clone()) {
            return Err(format!("duplicate project id discovered: {}", project.id));
        }
    }
    let mut proposal = DiscoveryProposal {
        schema_version: SCHEMA_VERSION,
        command: "project discover".into(),
        target_config_path: path_text(&target)?,
        config_base_sha256: base,
        kb_root: path_text(&kb.registry_root)?,
        kb_sha256: kb.registry_sha256,
        workspace_roots: canonical_roots,
        projects,
        proposal_digest: String::new(),
    };
    proposal.proposal_digest = proposal_hash(&proposal)?;
    println!(
        "{}",
        serde_json::to_string(&proposal).map_err(|e| e.to_string())?
    );
    Ok(ExitCode::SUCCESS)
}

pub fn review(discovery_path: &Path) -> Result<ExitCode, String> {
    let proposal = validated_proposal(discovery_path)?;
    let (target, current_bytes) = validate_proposal_target_and_base(&proposal)?;
    let proposed = validate_live_proposal(&proposal)?;

    let (config_exists, current, current_kb_root, current_kb_sha256) = match current_bytes.as_ref()
    {
        None => (false, BTreeMap::new(), None, None),
        Some(bytes) => {
            let current: LocalConfig = serde_json::from_slice(bytes)
                .map_err(|e| format!("invalid existing local config {}: {e}", target.display()))?;
            validate_local_config(&current)?;
            (
                true,
                current.projects,
                Some(current.kb_root),
                Some(current.kb_sha256),
            )
        }
    };
    let additions = proposed
        .keys()
        .filter(|id| !current.contains_key(*id))
        .cloned()
        .collect::<Vec<_>>();
    let removals = current
        .keys()
        .filter(|id| !proposed.contains_key(*id))
        .cloned()
        .collect::<Vec<_>>();
    let changed_pins = proposed
        .iter()
        .filter(|(id, record)| current.get(*id).is_some_and(|prior| prior != *record))
        .map(|(id, _)| id.clone())
        .collect::<Vec<_>>();
    let unchanged = proposed
        .iter()
        .filter(|(id, record)| current.get(*id).is_some_and(|prior| prior == *record))
        .map(|(id, _)| id.clone())
        .collect::<Vec<_>>();
    let kb_changed = config_exists
        && (current_kb_root.as_deref() != Some(proposal.kb_root.as_str())
            || current_kb_sha256.as_deref() != Some(proposal.kb_sha256.as_str()));
    let action = if !config_exists {
        "register"
    } else if !kb_changed && additions.is_empty() && removals.is_empty() && changed_pins.is_empty()
    {
        "none"
    } else {
        "refresh"
    };

    println!(
        "{}",
        serde_json::to_string(&serde_json::json!({
            "schema_version": 1,
            "command": "project review",
            "action": action,
            "target_config_path": proposal.target_config_path,
            "config_base_sha256": proposal.config_base_sha256,
            "proposal_digest": proposal.proposal_digest,
            "kb_root": proposal.kb_root,
            "kb_sha256": proposal.kb_sha256,
            "kb_changed": kb_changed,
            "project_count": proposed.len(),
            "additions": additions,
            "removals": removals,
            "changed_pins": changed_pins,
            "unchanged": unchanged,
            "auto_discovery": false,
            "trust_transfer": false,
            "mutation": false
        }))
        .map_err(|e| e.to_string())?
    );
    Ok(ExitCode::SUCCESS)
}

pub fn register(discovery_path: &Path, approval_path: &Path) -> Result<ExitCode, String> {
    let proposal = validated_proposal(discovery_path)?;
    let approval: Approval = strict_json_file(approval_path, "approval")?;
    validate_approval(&approval, &proposal)?;
    let (target, _) = validate_proposal_target_and_base(&proposal)?;
    let map = validate_live_proposal(&proposal)?;
    let config = LocalConfig {
        schema_version: SCHEMA_VERSION,
        kb_root: proposal.kb_root.clone(),
        kb_sha256: proposal.kb_sha256.clone(),
        projects: map,
        approval: ConfigApproval {
            proposal_digest: proposal.proposal_digest.clone(),
            owner: approval.owner,
            approved_at: approval.approved_at,
            rationale: approval.rationale,
        },
    };
    let bytes = serde_json::to_vec(&config).map_err(|e| e.to_string())?;
    atomic_install_absent(&target, &bytes, proposal.config_base_sha256.as_deref())?;
    println!(
        "{}",
        serde_json::to_string(&serde_json::json!({
            "schema_version": 1,
            "command": "project register",
            "config_path": proposal.target_config_path,
            "config_sha256": hash(&bytes),
            "proposal_digest": proposal.proposal_digest,
            "project_count": config.projects.len(),
            "registered": true,
            "trust_transfer": false
        }))
        .map_err(|e| e.to_string())?
    );
    Ok(ExitCode::SUCCESS)
}

pub fn refresh(discovery_path: &Path, approval_path: &Path) -> Result<ExitCode, String> {
    let proposal = validated_proposal(discovery_path)?;
    let base = proposal
        .config_base_sha256
        .as_deref()
        .ok_or("project refresh requires a proposal based on an existing local config")?;
    let approval: RefreshApproval = strict_json_file(approval_path, "refresh approval")?;
    validate_refresh_approval(&approval, &proposal)?;
    let (target, old_bytes) = validate_proposal_target_and_base(&proposal)?;
    let old_bytes = old_bytes.ok_or("project refresh requires an existing local config")?;
    let old: LocalConfig = serde_json::from_slice(&old_bytes)
        .map_err(|e| format!("invalid existing local config {}: {e}", target.display()))?;
    validate_local_config(&old)?;
    let projects = validate_live_proposal(&proposal)?;
    let additions = projects
        .keys()
        .filter(|id| !old.projects.contains_key(*id))
        .count();
    let removals = old
        .projects
        .keys()
        .filter(|id| !projects.contains_key(*id))
        .count();
    let changed_pins = projects
        .iter()
        .filter(|(id, record)| old.projects.get(*id).is_some_and(|prior| prior != *record))
        .count();
    let kb_changed = old.kb_root != proposal.kb_root || old.kb_sha256 != proposal.kb_sha256;
    if !kb_changed && additions == 0 && removals == 0 && changed_pins == 0 {
        return Err("project refresh proposal has no registry changes".into());
    }
    let config = LocalConfig {
        schema_version: SCHEMA_VERSION,
        kb_root: proposal.kb_root.clone(),
        kb_sha256: proposal.kb_sha256.clone(),
        projects,
        approval: ConfigApproval {
            proposal_digest: proposal.proposal_digest.clone(),
            owner: approval.owner,
            approved_at: approval.approved_at,
            rationale: approval.rationale,
        },
    };
    let bytes = serde_json::to_vec(&config).map_err(|e| e.to_string())?;
    atomic_replace_exact(&target, &bytes, base)?;
    println!("{}", serde_json::to_string(&serde_json::json!({"schema_version":1,"command":"project refresh","config_path":proposal.target_config_path,"previous_config_sha256":base,"config_sha256":hash(&bytes),"proposal_digest":proposal.proposal_digest,"project_count":config.projects.len(),"additions":additions,"removals":removals,"changed_pins":changed_pins,"refreshed":true,"trust_transfer":false,"auto_discovery":false})).map_err(|e| e.to_string())?);
    Ok(ExitCode::SUCCESS)
}

pub fn context(id: &str) -> Result<ExitCode, String> {
    if id.is_empty() || id.chars().any(char::is_control) {
        return Err("project id is empty or contains control characters".into());
    }
    let config_path = default_config_path()?;
    validate_target_path(&config_path)?;
    let bytes = read_optional_regular(&config_path)?
        .ok_or_else(|| format!("local config does not exist: {}", config_path.display()))?;
    let config: LocalConfig = serde_json::from_slice(&bytes)
        .map_err(|e| format!("invalid local config {}: {e}", config_path.display()))?;
    validate_local_config(&config)?;
    let configured = config
        .projects
        .get(id)
        .ok_or_else(|| format!("project id is not registered: {id}"))?;
    let live_kb = load_registry(Path::new(&config.kb_root));
    let (current_kb_hash, kb_drift, kb_valid, kb_error) = match &live_kb {
        Ok(kb) => {
            let current = Some(kb.registry_sha256.clone());
            let drift = current.as_deref() != Some(config.kb_sha256.as_str());
            (current, drift, true, None)
        }
        Err(error) => (None, true, false, Some(error.to_string())),
    };
    let live = inspect_project(Path::new(&configured.root));
    let (current, project_valid, project_error) = match live {
        Ok(value) => (Some(value), true, None),
        Err(error) => (None, false, Some(error)),
    };
    let root = Path::new(&configured.root);
    let idea = read_idea(root).ok();
    let snapshot_result = crate::project_workflow::snapshot(root);
    let (snapshot, workflow_error) = match snapshot_result {
        Ok(value) => (Some(value), None),
        Err(error) => (None, Some(error)),
    };
    let current_manifest_hash = current.as_ref().map(|v| v.manifest_sha256.clone());
    let current_idea_hash = current.as_ref().map(|v| v.idea_sha256.clone());
    let current_head = current.as_ref().and_then(|v| v.observed_git_head.clone());
    let manifest_revision = current.as_ref().map_or_else(
        || configured.manifest_revision.clone(),
        |v| v.manifest_revision.clone(),
    );
    let revision_matches_head = current_head.as_deref() == Some(manifest_revision.as_str());
    let project_drift = current.as_ref() != Some(configured);
    let workflow_invalid = snapshot
        .as_ref()
        .is_some_and(|value| value.state == crate::project_workflow::SnapshotState::Invalid);
    let state = if !kb_valid || !project_valid || workflow_error.is_some() || workflow_invalid {
        "invalid"
    } else {
        "ready"
    };
    let (scope_matches, package_matches) = match &live_kb {
        Ok(kb) => knowledge_matches(kb, id)?,
        Err(_) => (Vec::new(), Vec::new()),
    };
    let context_notes = snapshot
        .as_ref()
        .map_or_else(Vec::new, |value| context_note_paths(value, root));
    let output = serde_json::json!({
        "schema_version": 1,
        "command": "project context",
        "state": state,
        "project": {"id": configured.id, "name": configured.name, "root": configured.root},
        "config": {"path": path_text(&config_path)?, "sha256": hash(&bytes)},
        "kb": {"root": config.kb_root, "configured_sha256": config.kb_sha256, "current_sha256": current_kb_hash, "valid": kb_valid, "drift": kb_drift, "error": kb_error},
        "knowledge": {"scope_matches": scope_matches, "package_matches": package_matches},
        "foundation": {
            "valid": project_valid,
            "error": project_error,
            "manifest": {"path": configured.manifest_path, "configured_sha256": configured.manifest_sha256, "current_sha256": current_manifest_hash, "drift": current_manifest_hash.as_deref() != Some(configured.manifest_sha256.as_str())},
            "idea": {"path": configured.idea_path, "configured_sha256": configured.idea_sha256, "current_sha256": current_idea_hash, "drift": current_idea_hash.as_deref() != Some(configured.idea_sha256.as_str())},
            "project_drift": project_drift,
            "manifest_revision": manifest_revision,
            "observed_git_head": current_head,
            "revision_matches_git_head": revision_matches_head
        },
        "idea": idea.map(|v| serde_json::json!({"title": v.title, "intent": v.sections.get("Intent").cloned().unwrap_or_default()})),
        "workflow": snapshot.as_ref().map(|s| serde_json::json!({"state": s.state, "latest_plan": s.latest_valid_plan, "ready_goals": s.ready_goals})),
        "workflow_error": workflow_error,
        "context_notes": context_notes,
        "next_actions": snapshot.as_ref().map_or_else(|| vec!["Run `mozak project validate <project-root>` to inspect invalid current project bytes.".to_owned()], |s| s.next_actions.clone()),
        "detail_commands": [format!("mozak project overview {}", shell_path(root)), format!("mozak project validate {}", shell_path(root)), format!("mozak project graph {}", shell_path(root))],
        "trust_transfer": false
    });
    println!(
        "{}",
        serde_json::to_string(&output).map_err(|e| e.to_string())?
    );
    Ok(if state == "ready" {
        ExitCode::SUCCESS
    } else {
        ExitCode::from(3)
    })
}

pub(crate) fn configured_kb_root() -> Result<PathBuf, String> {
    let config_path = default_config_path()?;
    validate_target_path(&config_path)?;
    let bytes = read_optional_regular(&config_path)?
        .ok_or_else(|| format!("local config does not exist: {}", config_path.display()))?;
    let config: LocalConfig = serde_json::from_slice(&bytes)
        .map_err(|e| format!("invalid local config {}: {e}", config_path.display()))?;
    validate_local_config(&config)?;
    let kb = load_registry(Path::new(&config.kb_root))
        .map_err(|error| format!("invalid configured KB: {error}"))?;
    if kb.registry_sha256 != config.kb_sha256 {
        return Err(format!(
            "configured KB drifted: expected {}, observed {}",
            config.kb_sha256, kb.registry_sha256
        ));
    }
    Ok(kb.registry_root)
}

fn knowledge_matches(
    kb: &mozak_core::kb::ValidatedKb,
    project_id: &str,
) -> Result<(Vec<serde_json::Value>, Vec<serde_json::Value>), String> {
    let mut scopes = Vec::new();
    for entry in &kb.entries {
        for scope in &entry.scopes.manifest.scopes {
            if scope
                .project
                .as_ref()
                .is_some_and(|binding| binding.project_id == project_id)
            {
                scopes.push(serde_json::json!({
                    "registration_id": entry.registration.id,
                    "scope_id": scope.id,
                    "title": scope.title,
                    "root": path_text(&entry.root)?
                }));
            }
        }
    }
    let packages = kb
        .packages
        .iter()
        .filter(|package| package.registration.project_id == project_id)
        .map(|package| {
            Ok(serde_json::json!({
                "package_id": package.registration.package_id,
                "release_id": package.registration.release_id,
                "root": path_text(&package.root)?
            }))
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok((scopes, packages))
}

fn context_note_paths(
    snapshot: &crate::project_workflow::WorkflowSnapshot,
    root: &Path,
) -> Vec<String> {
    snapshot
        .contexts
        .iter()
        .filter_map(|item| {
            let path = root.join(&item.context_note);
            safe_context_note(root, &path)
                .ok()
                .and_then(|value| path_text(&value).ok())
        })
        .collect()
}

fn scan_root(
    root: &Path,
    excluded_kb_root: &Path,
    projects: &mut Vec<ProjectRecord>,
) -> Result<(), String> {
    let mut stack = vec![root.to_path_buf()];
    let mut observed = 0usize;
    while let Some(directory) = stack.pop() {
        let mut entries = Vec::new();
        for entry in fs::read_dir(&directory)
            .map_err(|e| format!("cannot scan {}: {e}", directory.display()))?
        {
            observed += 1;
            if observed > MAX_SCAN_ENTRIES {
                return Err(format!("scan limit exhausted ({MAX_SCAN_ENTRIES} entries)"));
            }
            entries.push(entry.map_err(|e| format!("cannot scan {}: {e}", directory.display()))?);
        }
        entries.sort_by_key(fs::DirEntry::file_name);
        for entry in entries.into_iter().rev() {
            let name = entry.file_name();
            let name = name
                .to_str()
                .ok_or_else(|| format!("non-UTF8 path under {}", root.display()))?;
            if name.chars().any(char::is_control) {
                return Err(format!(
                    "control character in path under {}",
                    root.display()
                ));
            }
            let kind = entry.file_type().map_err(|e| e.to_string())?;
            if kind.is_symlink() {
                continue;
            }
            if kind.is_dir() {
                if entry.path() == excluded_kb_root {
                    continue;
                }
                if name == ".mozak" {
                    let candidate = directory.join(".mozak/project.yml");
                    let idea = directory.join(".mozak/idea.md");
                    if candidate.exists() || idea.exists() {
                        projects.push(inspect_project(&directory)?);
                    }
                    continue;
                }
                if PRUNED.contains(&name) {
                    continue;
                }
                stack.push(entry.path());
            }
        }
    }
    Ok(())
}

fn inspect_project(root: &Path) -> Result<ProjectRecord, String> {
    let root = safe_existing_directory(root, "project root")?;
    let manifest_path = root.join(".mozak/project.yml");
    let idea_path = root.join(".mozak/idea.md");
    ensure_regular_no_symlink(&manifest_path, "project manifest")?;
    ensure_regular_no_symlink(&idea_path, "project idea")?;
    let manifest_bytes = fs::read(&manifest_path)
        .map_err(|e| format!("cannot read {}: {e}", manifest_path.display()))?;
    let idea_bytes =
        fs::read(&idea_path).map_err(|e| format!("cannot read {}: {e}", idea_path.display()))?;
    let manifest_text = std::str::from_utf8(&manifest_bytes)
        .map_err(|_| format!("non-UTF8 project manifest: {}", manifest_path.display()))?;
    let idea_text = std::str::from_utf8(&idea_bytes)
        .map_err(|_| format!("non-UTF8 project idea: {}", idea_path.display()))?;
    let manifest: ProjectManifest = validate_project_yaml(manifest_text)
        .map_err(|e| format!("invalid project {}: {e}", root.display()))?;
    let idea = validate_idea_markdown(idea_text)
        .map_err(|e| format!("invalid project {}: {e}", root.display()))?;
    let name_context = format!("project name in {}", manifest_path.display());
    display_safe(&name_context, &manifest.project.name)?;
    let title_context = format!("idea title in {}", idea_path.display());
    display_safe(&title_context, &idea.title)?;
    // A multi-line section body is exactly what `project validate` accepts, so
    // discovery must apply the same rule or the two routes disagree about one
    // file. Only genuinely unprintable controls are rejected here.
    let intent_context = format!("idea Intent in {}", idea_path.display());
    display_safe_multiline(
        &intent_context,
        idea.sections
            .get("Intent")
            .expect("validated Intent section"),
    )?;
    Ok(ProjectRecord {
        id: manifest.project.id,
        name: manifest.project.name,
        root: path_text(&root)?,
        manifest_path: path_text(&manifest_path)?,
        idea_path: path_text(&idea_path)?,
        manifest_sha256: hash(&manifest_bytes),
        idea_sha256: hash(&idea_bytes),
        manifest_revision: manifest.repository.revision,
        observed_git_head: git_head(&root),
    })
}

fn read_idea(root: &Path) -> Result<IdeaDocument, String> {
    let text = fs::read_to_string(root.join(".mozak/idea.md")).map_err(|e| e.to_string())?;
    validate_idea_markdown(&text).map_err(|e| e.to_string())
}

fn validate_proposal_shape(p: &DiscoveryProposal) -> Result<(), String> {
    if p.schema_version != 1 || p.command != "project discover" || p.workspace_roots.is_empty() {
        return Err("invalid discovery proposal shape".into());
    }
    let mut ids = BTreeSet::new();
    if p.projects.iter().any(|v| !ids.insert(v.id.as_str())) {
        return Err("duplicate project ids in discovery proposal".into());
    }
    Ok(())
}

fn validated_proposal(path: &Path) -> Result<DiscoveryProposal, String> {
    let proposal: DiscoveryProposal = strict_json_file(path, "discovery proposal")?;
    validate_proposal_shape(&proposal)?;
    if proposal.proposal_digest != proposal_hash(&proposal)? {
        return Err("discovery proposal digest mismatch".into());
    }
    let mut prior_root: Option<&str> = None;
    let mut roots = Vec::new();
    for value in &proposal.workspace_roots {
        if prior_root.is_some_and(|prior| prior >= value) {
            return Err("workspace roots in discovery proposal must be sorted and unique".into());
        }
        let root = safe_existing_directory(Path::new(value), "workspace root")?;
        if path_text(&root)? != *value {
            return Err("workspace root in discovery proposal is not canonical".into());
        }
        prior_root = Some(value);
        roots.push(root);
    }
    if proposal.projects.iter().any(|project| {
        !roots
            .iter()
            .any(|root| Path::new(&project.root).starts_with(root))
    }) {
        return Err("project root is outside discovery workspace roots".into());
    }
    Ok(proposal)
}

fn validate_proposal_target_and_base(
    proposal: &DiscoveryProposal,
) -> Result<(PathBuf, Option<Vec<u8>>), String> {
    let target = PathBuf::from(&proposal.target_config_path);
    if target != default_config_path()? {
        return Err("proposal target config path is not the current default config path".into());
    }
    validate_target_path(&target)?;
    let live = read_optional_regular(&target)?;
    if live.as_deref().map(hash) != proposal.config_base_sha256 {
        return Err("stale config base: compare-and-swap check failed".into());
    }
    Ok((target, live))
}

fn validate_live_proposal(
    proposal: &DiscoveryProposal,
) -> Result<BTreeMap<String, ProjectRecord>, String> {
    let kb_root = safe_existing_directory(Path::new(&proposal.kb_root), "KB root")?;
    let kb = load_registry(&kb_root).map_err(|error| format!("invalid live KB: {error}"))?;
    if path_text(&kb.registry_root)? != proposal.kb_root || kb.registry_sha256 != proposal.kb_sha256
    {
        return Err("live KB path or hash drifted since discovery".into());
    }
    let mut projects = BTreeMap::new();
    for record in &proposal.projects {
        if inspect_project(Path::new(&record.root))? != *record {
            return Err(format!(
                "live project drifted since discovery: {}",
                record.id
            ));
        }
        if projects.insert(record.id.clone(), record.clone()).is_some() {
            return Err(format!("duplicate project id: {}", record.id));
        }
    }
    Ok(projects)
}

fn validate_local_config(config: &LocalConfig) -> Result<(), String> {
    if config.schema_version != SCHEMA_VERSION {
        return Err("unsupported local config schema_version".into());
    }
    validate_absolute_safe_path("KB root", &config.kb_root)?;
    validate_lower_hex("KB SHA-256", &config.kb_sha256, 64)?;
    for (key, record) in &config.projects {
        if key != &record.id {
            return Err(format!(
                "invalid local config: project map key {key} does not match record id {}",
                record.id
            ));
        }
        if !valid_project_id(&record.id) {
            return Err(format!(
                "invalid local config: project id {} must use lowercase ASCII letters, digits, and single hyphens",
                record.id
            ));
        }
        display_safe("project name", &record.name)?;
        validate_absolute_safe_path("project root", &record.root)?;
        validate_absolute_safe_path("project manifest path", &record.manifest_path)?;
        validate_absolute_safe_path("project idea path", &record.idea_path)?;
        let root = Path::new(&record.root);
        if Path::new(&record.manifest_path) != root.join(".mozak/project.yml") {
            return Err(format!(
                "invalid local config: project manifest path does not match root for {}",
                record.id
            ));
        }
        if Path::new(&record.idea_path) != root.join(".mozak/idea.md") {
            return Err(format!(
                "invalid local config: project idea path does not match root for {}",
                record.id
            ));
        }
        validate_lower_hex("project manifest SHA-256", &record.manifest_sha256, 64)?;
        validate_lower_hex("project idea SHA-256", &record.idea_sha256, 64)?;
        validate_lower_hex("project manifest revision", &record.manifest_revision, 40)?;
        if let Some(head) = &record.observed_git_head {
            validate_lower_hex("project observed Git head", head, 40)?;
        }
    }
    validate_lower_hex(
        "stored approval proposal digest",
        &config.approval.proposal_digest,
        64,
    )?;
    display_safe("stored approval owner", &config.approval.owner)?;
    if !canonical_utc(&config.approval.approved_at) {
        return Err("stored approval approved_at must be canonical UTC".into());
    }
    display_safe("stored approval rationale", &config.approval.rationale)?;
    Ok(())
}

fn validate_absolute_safe_path(label: &str, value: &str) -> Result<(), String> {
    let path = Path::new(value);
    if !path.is_absolute()
        || value.chars().any(char::is_control)
        || path
            .components()
            .any(|component| !matches!(component, Component::RootDir | Component::Normal(_)))
    {
        return Err(format!(
            "invalid local config: {label} must be an absolute safe path"
        ));
    }
    reject_symlink_chain(path, label).map_err(|error| format!("invalid local config: {error}"))?;
    Ok(())
}

fn valid_project_id(id: &str) -> bool {
    !id.is_empty()
        && !id.starts_with('-')
        && !id.ends_with('-')
        && !id.contains("--")
        && id
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

fn validate_lower_hex(label: &str, value: &str, length: usize) -> Result<(), String> {
    if value.len() != length
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err(format!(
            "invalid local config: {label} must be {length} lowercase hexadecimal characters"
        ));
    }
    Ok(())
}

fn validate_approval(a: &Approval, p: &DiscoveryProposal) -> Result<(), String> {
    if a.schema_version != 1 || !a.decision {
        return Err("approval must pin schema_version=1 and decision=true".into());
    }
    if a.proposal_digest != p.proposal_digest {
        return Err("approval proposal digest mismatch".into());
    }
    if a.target_config_path != p.target_config_path {
        return Err("approval target config path mismatch".into());
    }
    for (name, value) in [("owner", &a.owner), ("rationale", &a.rationale)] {
        if value.trim().is_empty() || value.chars().any(char::is_control) {
            return Err(format!(
                "approval {name} must be non-empty and contain no control characters"
            ));
        }
    }
    if !canonical_utc(&a.approved_at) {
        return Err("approved_at must be canonical UTC like 2026-09-03T07:21:10Z".into());
    }
    Ok(())
}

fn validate_refresh_approval(a: &RefreshApproval, p: &DiscoveryProposal) -> Result<(), String> {
    if a.schema_version != 1 || !a.decision || a.intent != "project refresh" {
        return Err(
            "refresh approval must pin schema_version=1, decision=true, and intent=project refresh"
                .into(),
        );
    }
    if a.proposal_digest != p.proposal_digest {
        return Err("refresh approval proposal digest mismatch".into());
    }
    if a.target_config_path != p.target_config_path {
        return Err("refresh approval target config path mismatch".into());
    }
    for (name, value) in [("owner", &a.owner), ("rationale", &a.rationale)] {
        if value.trim().is_empty() || value.chars().any(char::is_control) {
            return Err(format!(
                "refresh approval {name} must be non-empty and contain no control characters"
            ));
        }
    }
    if !canonical_utc(&a.approved_at) {
        return Err("approved_at must be canonical UTC like 2026-09-03T07:21:10Z".into());
    }
    Ok(())
}

fn canonical_utc(value: &str) -> bool {
    let b = value.as_bytes();
    if b.len() != 20
        || b[4] != b'-'
        || b[7] != b'-'
        || b[10] != b'T'
        || b[13] != b':'
        || b[16] != b':'
        || b[19] != b'Z'
        || b.iter().enumerate().any(|(index, byte)| {
            !matches!(index, 4 | 7 | 10 | 13 | 16 | 19) && !byte.is_ascii_digit()
        })
    {
        return false;
    }
    let number = |start: usize, end: usize| {
        value[start..end]
            .parse::<u32>()
            .expect("validated ASCII digits")
    };
    let year = number(0, 4);
    let month = number(5, 7);
    let day = number(8, 10);
    let hour = number(11, 13);
    let minute = number(14, 16);
    let second = number(17, 19);
    if year == 0 || !(1..=12).contains(&month) || hour > 23 || minute > 59 || second > 59 {
        return false;
    }
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = match month {
        2 if leap => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    };
    (1..=days).contains(&day)
}

fn proposal_hash(p: &DiscoveryProposal) -> Result<String, String> {
    let value = ProposalDigest {
        schema_version: p.schema_version,
        command: &p.command,
        target_config_path: &p.target_config_path,
        config_base_sha256: &p.config_base_sha256,
        kb_root: &p.kb_root,
        kb_sha256: &p.kb_sha256,
        workspace_roots: &p.workspace_roots,
        projects: &p.projects,
    };
    serde_json::to_vec(&value)
        .map(|v| hash(&v))
        .map_err(|e| e.to_string())
}

fn default_config_path() -> Result<PathBuf, String> {
    let base = match env::var_os("XDG_CONFIG_HOME") {
        Some(value) => PathBuf::from(value),
        None => PathBuf::from(env::var_os("HOME").ok_or("HOME is not set")?).join(".config"),
    };
    if !base.is_absolute() {
        return Err("config base path must be absolute".into());
    }
    reject_unsafe_lexical(&base)?;
    Ok(base.join("mozak/config.json"))
}

fn safe_existing_directory(path: &Path, label: &str) -> Result<PathBuf, String> {
    reject_unsafe_lexical(path)?;
    reject_symlink_chain(path, label)?;
    let metadata = fs::symlink_metadata(path)
        .map_err(|e| format!("cannot inspect {label} {}: {e}", path.display()))?;
    if metadata.file_type().is_symlink() {
        return Err(format!("{label} must not be a symlink: {}", path.display()));
    }
    if !metadata.is_dir() {
        return Err(format!("{label} is not a directory: {}", path.display()));
    }
    let canonical = fs::canonicalize(path).map_err(|e| format!("cannot resolve {label}: {e}"))?;
    path_text(&canonical)?;
    Ok(canonical)
}

fn reject_unsafe_lexical(path: &Path) -> Result<(), String> {
    if path.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err(format!("path traversal is not allowed: {}", path.display()));
    }
    path_text(path)?;
    Ok(())
}

fn validate_target_path(path: &Path) -> Result<(), String> {
    reject_unsafe_lexical(path)?;
    let mut current = PathBuf::new();
    for component in path.components() {
        current.push(component.as_os_str());
        if current == path {
            break;
        }
        if let Ok(meta) = fs::symlink_metadata(&current) {
            if meta.file_type().is_symlink() {
                return Err(format!(
                    "config path has symlink ancestor: {}",
                    current.display()
                ));
            }
            if !meta.is_dir() {
                return Err(format!(
                    "config path ancestor is not a directory: {}",
                    current.display()
                ));
            }
        }
    }
    if let Ok(meta) = fs::symlink_metadata(path) {
        if meta.file_type().is_symlink() || !meta.is_file() {
            return Err(format!(
                "config path is not a regular non-symlink file: {}",
                path.display()
            ));
        }
    }
    Ok(())
}

fn ensure_regular_no_symlink(path: &Path, label: &str) -> Result<(), String> {
    reject_symlink_chain(path, label)?;
    let meta = fs::symlink_metadata(path)
        .map_err(|e| format!("cannot inspect {label} {}: {e}", path.display()))?;
    if meta.file_type().is_symlink() || !meta.is_file() {
        return Err(format!(
            "{label} must be a regular non-symlink file: {}",
            path.display()
        ));
    }
    Ok(())
}

fn safe_context_note(root: &Path, path: &Path) -> Result<PathBuf, String> {
    ensure_regular_no_symlink(path, "context note")?;
    let canonical = fs::canonicalize(path).map_err(|e| e.to_string())?;
    if !canonical.starts_with(root) {
        return Err("context note escapes project root".into());
    }
    Ok(canonical)
}

fn reject_symlink_chain(path: &Path, label: &str) -> Result<(), String> {
    let mut current = PathBuf::new();
    for component in path.components() {
        current.push(component.as_os_str());
        if let Ok(metadata) = fs::symlink_metadata(&current) {
            if metadata.file_type().is_symlink() {
                return Err(format!(
                    "{label} path has a symlink component: {}",
                    current.display()
                ));
            }
        }
    }
    Ok(())
}

fn display_safe(label: &str, value: &str) -> Result<(), String> {
    if value.trim().is_empty() || value.chars().any(char::is_control) {
        return Err(format!(
            "{label} must be non-empty and contain no control characters"
        ));
    }
    Ok(())
}

/// Applies the display rule to a contract section body that may legitimately
/// wrap across lines.
///
/// Line feeds and carriage returns are ordinary Markdown paragraph formatting,
/// so only other control characters are rejected.
fn display_safe_multiline(label: &str, value: &str) -> Result<(), String> {
    let unprintable = value
        .chars()
        .any(|value| value.is_control() && value != '\n' && value != '\r');
    if value.trim().is_empty() || unprintable {
        return Err(format!(
            "{label} must be non-empty and contain no control characters other than line breaks"
        ));
    }
    Ok(())
}

fn read_optional_regular(path: &Path) -> Result<Option<Vec<u8>>, String> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_symlink() || !meta.is_file() => Err(format!(
            "path is not a regular non-symlink file: {}",
            path.display()
        )),
        Ok(_) => fs::read(path)
            .map(Some)
            .map_err(|e| format!("cannot read {}: {e}", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("cannot inspect {}: {e}", path.display())),
    }
}

fn atomic_install_absent(path: &Path, bytes: &[u8], base: Option<&str>) -> Result<(), String> {
    if base.is_some() {
        return Err(
            "updating an existing local config is not supported by this create-only registration route"
                .into(),
        );
    }
    validate_target_path(path)?;
    let parent = path.parent().ok_or("config path has no parent")?;
    fs::create_dir_all(parent).map_err(|e| format!("cannot create config directory: {e}"))?;
    validate_target_path(path)?;
    let live = read_optional_regular(path)?.map(|v| hash(&v));
    if live.as_deref() != base {
        return Err("stale config base during atomic write".into());
    }
    let temp = parent.join(format!(".config.json.{}.tmp", std::process::id()));
    let mut options = fs::OpenOptions::new();
    let mut file = options
        .write(true)
        .create_new(true)
        .open(&temp)
        .map_err(|e| format!("cannot create temporary config: {e}"))?;
    let result = (|| {
        file.write_all(bytes).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        fs::hard_link(&temp, path)
            .map_err(|e| format!("cannot atomically install absent config: {e}"))?;
        fs::remove_file(&temp).map_err(|e| format!("cannot remove temporary config link: {e}"))?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

fn atomic_replace_exact(path: &Path, bytes: &[u8], base: &str) -> Result<(), String> {
    validate_target_path(path)?;
    let parent = path.parent().ok_or("config path has no parent")?;
    let lock = parent.join(".config.json.refresh.lock");
    let lock_file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&lock)
        .map_err(|e| format!("cannot acquire exclusive config refresh lock: {e}"))?;
    let result = (|| {
        validate_target_path(path)?;
        let live = read_optional_regular(path)?.ok_or("local config disappeared during refresh")?;
        if hash(&live) != base {
            return Err("stale config base during atomic refresh".into());
        }
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos();
        let temp = parent.join(format!(".config.json.{}.{}.tmp", std::process::id(), nonce));
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|e| format!("cannot create temporary config: {e}"))?;
        let written = (|| {
            file.write_all(bytes).map_err(|e| e.to_string())?;
            file.sync_all().map_err(|e| e.to_string())?;
            validate_target_path(path)?;
            let current =
                read_optional_regular(path)?.ok_or("local config disappeared during refresh")?;
            if hash(&current) != base {
                return Err("stale config base during atomic refresh".into());
            }
            fs::rename(&temp, path)
                .map_err(|e| format!("cannot atomically replace config: {e}"))?;
            fs::File::open(parent)
                .and_then(|dir| dir.sync_all())
                .map_err(|e| format!("cannot sync config directory: {e}"))?;
            Ok(())
        })();
        if written.is_err() {
            let _ = fs::remove_file(&temp);
        }
        written
    })();
    drop(lock_file);
    let unlock =
        fs::remove_file(&lock).map_err(|e| format!("cannot release config refresh lock: {e}"));
    result.and(unlock)
}

fn strict_json_file<T: for<'de> Deserialize<'de>>(path: &Path, label: &str) -> Result<T, String> {
    ensure_regular_no_symlink(path, label)?;
    let bytes = fs::read(path).map_err(|e| format!("cannot read {label}: {e}"))?;
    serde_json::from_slice(&bytes).map_err(|e| format!("invalid {label}: {e}"))
}

fn git_head(root: &Path) -> Option<String> {
    let output = Command::new("git")
        .args(["-C", root.to_str()?, "rev-parse", "--verify", "HEAD"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let value = String::from_utf8(output.stdout).ok()?.trim().to_owned();
    (value.len() == 40
        && value
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()))
    .then_some(value)
}

fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn path_text(path: &Path) -> Result<String, String> {
    let value = path
        .to_str()
        .ok_or_else(|| format!("path is not UTF-8: {}", path.display()))?;
    if value.chars().any(char::is_control) {
        return Err(format!(
            "path contains control characters: {}",
            path.display()
        ));
    }
    Ok(value.to_owned())
}
fn shell_path(path: &Path) -> String {
    format!("'{}'", path.to_string_lossy().replace('\'', "'\\''"))
}
