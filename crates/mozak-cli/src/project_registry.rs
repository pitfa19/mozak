use mozak_core::{
    canonical_hash,
    current_state::{
        CurrentStateInput, Freshness, ProjectionSource, StateNode, StateRelationship,
        project_current_state,
    },
    kb::load_registry,
    project_contract::{
        IdeaDocument, ProjectManifest, validate_idea_markdown, validate_project_yaml,
    },
    research::{ResearchRun, validate_run_json},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    env, fs,
    io::{IsTerminal, Read, Write},
    path::{Component, Path, PathBuf},
    process::{Command, ExitCode},
    time::{SystemTime, UNIX_EPOCH},
};

const SCHEMA_VERSION: u64 = 1;
const CURRENT_SECTION_LIMIT: usize = 12;
const LINKED_SCOPES_INLINE_LIMIT: usize = 10;
const NOTES_INLINE_LIMIT: usize = 10;
const DEFAULT_NOTES_PROFILE: &str = "notes/profile.json";
const DEFAULT_NOTES_LINKS: &str = "notes/mozak-links.json";
const NOTES_LINKS_TARGET: &str = "notes/mozak-links.json";
const MAX_SCAN_ENTRIES: usize = 10_000;
const MAX_ONBOARD_CONTENT_BYTES: usize = 64 * 1024;
const MAX_ONBOARD_TOKENS: usize = 4_096;
const MAX_SCOPE_MATCH_TOKENS: usize = 32;
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    configured_owner: Option<String>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct RefreshAuditEntry {
    schema_version: u64,
    actor: String,
    at: String,
    reason: String,
    old_config_sha256: String,
    new_config_sha256: String,
    old_manifest_sha256: String,
    new_manifest_sha256: String,
    entry_sha256: String,
}

#[derive(Serialize)]
struct RefreshAuditDigest<'a> {
    schema_version: u64,
    actor: &'a str,
    at: &'a str,
    reason: &'a str,
    old_config_sha256: &'a str,
    new_config_sha256: &'a str,
    old_manifest_sha256: &'a str,
    new_manifest_sha256: &'a str,
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
        configured_owner: Some(approval.owner.clone()),
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
        configured_owner: old
            .configured_owner
            .clone()
            .or_else(|| Some(old.approval.owner.clone())),
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
    atomic_replace_exact(&target, &bytes, base, None)?;
    println!("{}", serde_json::to_string(&serde_json::json!({"schema_version":1,"command":"project refresh","config_path":proposal.target_config_path,"previous_config_sha256":base,"config_sha256":hash(&bytes),"proposal_digest":proposal.proposal_digest,"project_count":config.projects.len(),"additions":additions,"removals":removals,"changed_pins":changed_pins,"refreshed":true,"trust_transfer":false,"auto_discovery":false})).map_err(|e| e.to_string())?);
    Ok(ExitCode::SUCCESS)
}

pub fn refresh_history() -> Result<ExitCode, String> {
    let config_path = default_config_path()?;
    validate_target_path(&config_path)?;
    let bytes = read_optional_regular(&config_path)?
        .ok_or_else(|| format!("local config does not exist: {}", config_path.display()))?;
    let config: LocalConfig = serde_json::from_slice(&bytes)
        .map_err(|e| format!("invalid local config {}: {e}", config_path.display()))?;
    validate_local_config(&config)?;
    let entries = load_refresh_history(&config_path)?;
    println!(
        "{}",
        serde_json::to_string(&serde_json::json!({
            "schema_version": 1,
            "command": "project refresh history",
            "config_path": path_text(&config_path)?,
            "config_sha256": hash(&bytes),
            "entries": entries,
            "tamper_evident": true,
            "auto_discovery": false
        }))
        .map_err(|e| e.to_string())?
    );
    Ok(ExitCode::SUCCESS)
}

/// Lists the exact locally configured project identifiers without consulting the
/// live KB. This remains usable when the KB pin has drifted, so callers can
/// resolve an exact project id before deciding whether a reviewed refresh is
/// required.
pub fn registrations() -> Result<ExitCode, String> {
    let config_path = default_config_path()?;
    validate_target_path(&config_path)?;
    let bytes = read_optional_regular(&config_path)?
        .ok_or_else(|| format!("local config does not exist: {}", config_path.display()))?;
    let config: LocalConfig = serde_json::from_slice(&bytes)
        .map_err(|e| format!("invalid local config {}: {e}", config_path.display()))?;
    validate_local_config(&config)?;
    let projects = config
        .projects
        .values()
        .map(|project| {
            serde_json::json!({
                "id": project.id,
                "name": project.name,
                "root": project.root,
            })
        })
        .collect::<Vec<_>>();
    println!(
        "{}",
        serde_json::to_string(&serde_json::json!({
            "schema_version": 1,
            "command": "project registrations",
            "config_path": path_text(&config_path)?,
            "config_sha256": hash(&bytes),
            "configured_owner": configured_owner(&config),
            "projects": projects,
            "live_kb_consulted": false,
            "mutation": false,
        }))
        .map_err(|e| e.to_string())?
    );
    Ok(ExitCode::SUCCESS)
}

#[allow(clippy::too_many_lines)]
struct CurrentDocument {
    presentation: Value,
    full_projection: Value,
    research_views: Vec<Value>,
}

fn current_document(id: &str) -> Result<Value, String> {
    Ok(current_document_with_full_state(id)?.presentation)
}

#[allow(clippy::too_many_lines)]
fn current_document_with_full_state(id: &str) -> Result<CurrentDocument, String> {
    if id.is_empty() || id.chars().any(char::is_control) {
        return Err("project id is empty or contains control characters".into());
    }
    let config_path = default_config_path()?;
    validate_target_path(&config_path)?;
    let config_bytes = read_optional_regular(&config_path)?
        .ok_or_else(|| format!("local config does not exist: {}", config_path.display()))?;
    let config: LocalConfig = serde_json::from_slice(&config_bytes)
        .map_err(|e| format!("invalid local config {}: {e}", config_path.display()))?;
    validate_local_config(&config)?;
    let project = config
        .projects
        .get(id)
        .ok_or_else(|| format!("project id is not registered: {id}"))?;
    let root = Path::new(&project.root);
    let manifest_bytes = fs::read(&project.manifest_path).map_err(|e| {
        format!(
            "cannot read project manifest {}: {e}",
            project.manifest_path
        )
    })?;
    if hash(&manifest_bytes) != project.manifest_sha256 {
        return Err(
            "project manifest hash drift; run project context or reviewed refresh first".into(),
        );
    }
    let (project_source, manifest) = ProjectionSource::project_manifest(
        &project.manifest_path,
        &manifest_bytes,
        Freshness::Current,
    )
    .map_err(|e| e.to_string())?;
    let project_node = StateNode::project(&project_source, &manifest).map_err(|e| e.to_string())?;

    let kb = load_registry(Path::new(&config.kb_root)).map_err(|e| e.to_string())?;
    if kb.registry_sha256 != config.kb_sha256 {
        return Err("configured KB hash drift; reviewed project refresh is required".into());
    }
    let (kb_source, loaded_kb) =
        ProjectionSource::knowledge_base(Path::new(&config.kb_root), Freshness::Current)
            .map_err(|e| e.to_string())?;
    let kb_node = StateNode::knowledge_base(&kb_source, "configured knowledge base")
        .map_err(|e| e.to_string())?;
    let mut sources = vec![project_source.clone(), kb_source.clone()];
    let mut nodes = vec![project_node.clone(), kb_node.clone()];
    let mut relationships = Vec::new();
    let mut scope_nodes = BTreeMap::new();
    for entry in &loaded_kb.entries {
        for scope in &entry.scopes.manifest.scopes {
            let scope_node =
                StateNode::scope(&kb_source, &scope.id, &scope.title).map_err(|e| e.to_string())?;
            relationships.push(
                StateRelationship::registered_in(&scope_node, &kb_node, &kb_source)
                    .map_err(|e| e.to_string())?,
            );
            scope_nodes.insert(scope.id.clone(), scope_node.clone());
            nodes.push(scope_node);
        }
    }

    let adapter_path = adapter_registry_path()?;
    let adapter_registry = if adapter_path.exists() {
        let adapter_bytes = fs::read(&adapter_path).map_err(|e| {
            format!(
                "cannot read adapter registry {}: {e}",
                adapter_path.display()
            )
        })?;
        let (adapter_source, registry) = ProjectionSource::adapter_registry(
            path_text(&adapter_path)?,
            &adapter_bytes,
            Freshness::Current,
        )
        .map_err(|e| e.to_string())?;
        let mut bindings_json = Vec::new();
        for binding in &registry.bindings {
            let binding_node =
                StateNode::adapter_binding(&adapter_source, binding).map_err(|e| e.to_string())?;
            if let Some(scope_node) = scope_nodes.get(&binding.target_scope_id) {
                relationships.push(
                    StateRelationship::targets(&binding_node, binding, scope_node, &adapter_source)
                        .map_err(|e| e.to_string())?,
                );
            }
            bindings_json.push(binding_current_view(binding)?);
            nodes.push(binding_node);
        }
        sources.push(adapter_source);
        Some((registry, bindings_json))
    } else {
        None
    };

    let mut research_views = Vec::new();
    if let Some((registry, _)) = &adapter_registry {
        for binding in &registry.bindings {
            if !adapter_binding_callable(binding) {
                continue;
            }
            for (path, run, stale) in validated_runs_in(Path::new(&binding.runs_dir))? {
                let bytes = fs::read(&path).map_err(|e| format!("cannot read run: {e}"))?;
                let freshness = if stale {
                    Freshness::Stale
                } else {
                    Freshness::Current
                };
                let (source, validated) =
                    ProjectionSource::research_run(path_text(&path)?, &bytes, freshness)
                        .map_err(|e| e.to_string())?;
                let research_record_id = format!(
                    "research-run:{}:{}:{}",
                    run.run_id,
                    hash(path_text(&path)?.as_bytes()),
                    hash(&bytes)
                );
                let research_node =
                    StateNode::research_run(&source, &validated).map_err(|e| e.to_string())?;
                research_views.push(serde_json::json!({
                    "record_id": research_record_id,
                    "projection_source_id": source.id(),
                    "binding_id": binding.id,
                    "path": path_text(&path)?,
                    "run_id": run.run_id,
                    "latest_recorded": run.created_at,
                    "latest_observed": path.metadata().ok().and_then(|m| m.modified().ok()).and_then(system_time_text),
                    "freshness": if stale {"stale"} else {"current"},
                    "authority": "proposal_only",
                    "accepted": false
                }));
                if !stale {
                    let target = scope_nodes.get(&binding.target_scope_id).ok_or_else(|| {
                        format!(
                            "adapter binding {} targets unknown Scope {}",
                            binding.id, binding.target_scope_id
                        )
                    })?;
                    relationships.push(
                        StateRelationship::observes(&research_node, target, &source)
                            .map_err(|e| e.to_string())?,
                    );
                    sources.push(source);
                    nodes.push(research_node);
                }
            }
        }
    }
    research_views.sort_by(|a, b| {
        b["latest_recorded"]
            .as_str()
            .cmp(&a["latest_recorded"].as_str())
    });
    let newest = research_views.first().cloned();
    let snapshot = crate::project_workflow::snapshot(root)?;
    let projection = project_current_state(
        CurrentStateInput::new(id, sources, nodes, relationships).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let full_projection = serde_json::to_value(&projection).map_err(|e| e.to_string())?;
    let projection_summary = bounded_projection_summary(&projection)?;
    let presentation = serde_json::json!({
        "schema_version": 1,
        "command": "project current",
        "project": {"id": project.id, "name": project.name, "root": project.root},
        "labels": {"latest_recorded": "artifact-declared time", "latest_observed": "local filesystem observation time", "accepted": "owner-accepted planning state only"},
        "goal_state": {"workflow_state": snapshot.state, "latest_recorded": snapshot.latest_valid_plan, "accepted": snapshot.ready_goals, "ready_goals": snapshot.ready_goals},
        "adapter_freshness": bounded_values(adapter_registry.as_ref().map(|(_, views)| views.clone()).unwrap_or_default()),
        "proposal_only_research": bounded_values(research_views.clone()),
        "newest_proposal_only_research": newest,
        "superseded_artifacts": {"compaction": snapshot.compaction, "findings": bounded_values(snapshot.findings.iter().filter(|f| f.status.contains("superseded") || f.message.contains("superseded")).map(|f| serde_json::to_value(f).unwrap_or(Value::Null)).collect::<Vec<_>>())},
        "next_owner_decision": snapshot.next_actions.first().cloned().unwrap_or_else(|| "No ready goals; owner may choose whether to refresh research, compact superseded artifacts, or define a new accepted goal.".into()),
        "current_state_projection": projection_summary,
        "bounded_directories": {"project_root": project.root, "kb_root": config.kb_root, "adapter_registry": path_text(&adapter_path)?},
        "mutation": false,
        "trust_transfer": false,
        "automatic_promotion": false
    });
    Ok(CurrentDocument {
        presentation,
        full_projection,
        research_views,
    })
}

struct ResolvedCurrentRecord {
    source: Option<Value>,
    node: Option<Value>,
    research: Option<Value>,
    relationships: Vec<Value>,
}

fn resolve_current_record(
    current: &CurrentDocument,
    record_id: &str,
) -> Result<ResolvedCurrentRecord, String> {
    let sources = current.full_projection["sources"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let nodes = current.full_projection["nodes"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let relationships = current.full_projection["relationships"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let source = sources.iter().find(|v| v["id"] == record_id).cloned();
    let node = nodes.iter().find(|v| v["id"] == record_id).cloned();
    let research = current
        .research_views
        .iter()
        .find(|v| v["record_id"] == record_id)
        .cloned();
    let projection_source_id = research
        .as_ref()
        .and_then(|v| v["projection_source_id"].as_str());
    let projection_node_id = research
        .as_ref()
        .and_then(|v| v["run_id"].as_str())
        .map(|run_id| format!("research:{run_id}"));
    let resolved_source = source.clone().or_else(|| {
        projection_source_id
            .and_then(|source_id| sources.iter().find(|v| v["id"] == source_id).cloned())
    });
    let resolved_node = node.clone().or_else(|| {
        projection_node_id
            .as_deref()
            .and_then(|node_id| nodes.iter().find(|v| v["id"] == node_id).cloned())
    });
    let related = relationships
        .into_iter()
        .filter(|r| {
            r["from"] == record_id
                || r["to"] == record_id
                || r["source_id"] == record_id
                || projection_source_id.is_some_and(|source_id| r["source_id"] == source_id)
                || projection_node_id
                    .as_deref()
                    .is_some_and(|node_id| r["from"] == node_id || r["to"] == node_id)
        })
        .collect::<Vec<_>>();
    if source.is_none() && node.is_none() && research.is_none() && related.is_empty() {
        return Err(format!(
            "record id is not declared in current-state projection: {record_id}"
        ));
    }
    Ok(ResolvedCurrentRecord {
        source: resolved_source,
        node: resolved_node,
        research,
        relationships: related,
    })
}

pub fn current(id: &str) -> Result<ExitCode, String> {
    let value = current_document(id)?;
    println!(
        "{}",
        serde_json::to_string(&value).map_err(|e| e.to_string())?
    );
    Ok(ExitCode::SUCCESS)
}

pub fn browse(id: &str) -> Result<ExitCode, String> {
    let current = current_document(id)?;
    let projection = &current["current_state_projection"];
    println!(
        "{}",
        serde_json::to_string(&serde_json::json!({
            "schema_version": 1,
            "command": "project browse",
            "project": current["project"].clone(),
            "records": {
                "sources": projection["sources"].clone(),
                "nodes": projection["nodes"].clone(),
                "relationships": projection["relationships"].clone(),
                "proposal_only_research": current["proposal_only_research"].clone(),
                "newest_proposal_only_research": current["newest_proposal_only_research"].clone(),
                "adapter_freshness": current["adapter_freshness"].clone()
            },
            "boundary": {
                "configured_records_only": true,
                "arbitrary_filesystem_scanning": false,
                "ranking": false,
                "recommendation": false,
                "acceptance": false,
                "truth_claim": false,
                "note_bodies": false,
                "full_kb_dump": false
            },
            "mutation": false,
            "trust_transfer": false,
            "automatic_promotion": false
        }))
        .map_err(|e| e.to_string())?
    );
    Ok(ExitCode::SUCCESS)
}

pub fn resolve(id: &str, record_id: &str) -> Result<ExitCode, String> {
    let current = current_document_with_full_state(id)?;
    let resolved = resolve_current_record(&current, record_id)?;
    if resolved
        .source
        .as_ref()
        .is_some_and(|s| s["freshness"] == "stale")
        || resolved
            .research
            .as_ref()
            .is_some_and(|s| s["freshness"] == "stale")
    {
        return Err(format!(
            "record id has stale hash/freshness and cannot be resolved: {record_id}"
        ));
    }
    println!(
        "{}",
        serde_json::to_string(&serde_json::json!({
            "schema_version": 1,
            "command": "project resolve",
            "project": current.presentation["project"].clone(),
            "record_id": record_id,
            "record": {"source": resolved.source, "node": resolved.node, "research": resolved.research},
            "declared_relationships": bounded_values(resolved.relationships),
            "relationship_policy": "only declared Stage 1 projection relationships are followed",
            "undeclared_relationships_followed": false,
            "mutation": false,
            "trust_transfer": false,
            "automatic_promotion": false
        }))
        .map_err(|e| e.to_string())?
    );
    Ok(ExitCode::SUCCESS)
}

pub fn why(id: &str, record_id: &str) -> Result<ExitCode, String> {
    let current = current_document_with_full_state(id)?;
    let resolved = resolve_current_record(&current, record_id)?;
    let freshness = resolved
        .source
        .as_ref()
        .or(resolved.research.as_ref())
        .and_then(|s| s["freshness"].as_str())
        .unwrap_or("derived_from_source");
    let authority = resolved
        .source
        .as_ref()
        .or(resolved.node.as_ref())
        .or(resolved.research.as_ref())
        .and_then(|v| v["authority"].as_str())
        .unwrap_or("declared_relationship");
    let block = if freshness == "stale" {
        "stale records are shown for explanation only and cannot be resolved or accepted"
    } else if authority == "proposal_only" {
        "proposal-only records are not accepted project knowledge"
    } else {
        "no blocking condition for read-only display"
    };
    println!(
        "{}",
        serde_json::to_string(&serde_json::json!({
            "schema_version": 1,
            "command": "project why",
            "project": current.presentation["project"].clone(),
            "record_id": record_id,
            "inclusion": "included only because it is present in validated configured project, KB, adapter, or adapter-declared research records",
            "freshness": freshness,
            "authority": authority,
            "blocking_conditions": [block],
            "declared_relationships": bounded_values(resolved.relationships),
            "supersession_explanation": "A newer DAIR run supersedes an older recorded DAIR run only as latest recorded proposal-only research from the same configured adapter runs_dir. This does not accept either run, does not rank either run as truth, and transfers no trust.",
            "mutation": false,
            "trust_transfer": false,
            "automatic_promotion": false
        }))
        .map_err(|e| e.to_string())?
    );
    Ok(ExitCode::SUCCESS)
}

pub fn refresh_rollback(target_digest: &str) -> Result<ExitCode, String> {
    validate_lower_hex("rollback target config SHA-256", target_digest, 64)?;
    let config_path = default_config_path()?;
    validate_target_path(&config_path)?;
    let current_bytes = read_optional_regular(&config_path)?
        .ok_or_else(|| format!("local config does not exist: {}", config_path.display()))?;
    let current_digest = hash(&current_bytes);
    if current_digest == target_digest {
        return Err("rollback target is already the current config generation".into());
    }
    let target_bytes = read_generation(&config_path, target_digest)?;
    let current: LocalConfig = serde_json::from_slice(&current_bytes)
        .map_err(|e| format!("invalid current local config: {e}"))?;
    let target: LocalConfig = serde_json::from_slice(&target_bytes)
        .map_err(|e| format!("invalid rollback config generation: {e}"))?;
    validate_local_config(&current)?;
    validate_local_config(&target)?;
    require_identity_preserving_config_change(&current, &target)?;
    let project_id = single_changed_project(&current, &target)?;
    let old_record = current.projects.get(&project_id).expect("known project");
    let new_record = target.projects.get(&project_id).expect("known project");
    let history = load_refresh_history(&config_path)?;
    if !history.iter().any(|entry| {
        entry.old_config_sha256 == target_digest || entry.new_config_sha256 == target_digest
    }) {
        return Err("rollback target is not an audited automatic refresh generation".into());
    }
    if old_record.manifest_sha256 != new_record.manifest_sha256 {
        let old_manifest = read_manifest_snapshot(&config_path, &current_digest, &project_id)?;
        let new_manifest = read_manifest_snapshot(&config_path, target_digest, &project_id)?;
        if !same_manifest_identity_and_authority(&old_manifest, &new_manifest) {
            return Err(
                "rollback would change manifest identity or authority; explicit approval is required"
                    .into(),
            );
        }
    }
    let audit = make_audit_entry(
        configured_owner(&current),
        "project refresh rollback of identity-preserving registration drift",
        &current_digest,
        target_digest,
        &old_record.manifest_sha256,
        &new_record.manifest_sha256,
    )?;
    atomic_replace_exact(&config_path, &target_bytes, &current_digest, Some(&audit))?;
    println!(
        "{}",
        serde_json::to_string(&serde_json::json!({
            "schema_version": 1,
            "command": "project refresh rollback",
            "config_path": path_text(&config_path)?,
            "previous_config_sha256": current_digest,
            "config_sha256": target_digest,
            "project_id": project_id,
            "rolled_back": true,
            "auto_discovery": false,
            "trust_transfer": false
        }))
        .map_err(|e| e.to_string())?
    );
    Ok(ExitCode::SUCCESS)
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum ContextOutputMode {
    Auto,
    Json,
    Human,
}

#[allow(clippy::too_many_lines)]
pub fn context(id: &str, mode: ContextOutputMode) -> Result<ExitCode, String> {
    if id.is_empty() || id.chars().any(char::is_control) {
        return Err("project id is empty or contains control characters".into());
    }
    let config_path = default_config_path()?;
    validate_target_path(&config_path)?;
    let mut bytes = read_optional_regular(&config_path)?
        .ok_or_else(|| format!("local config does not exist: {}", config_path.display()))?;
    let mut config: LocalConfig = serde_json::from_slice(&bytes)
        .map_err(|e| format!("invalid local config {}: {e}", config_path.display()))?;
    validate_local_config(&config)?;
    let mut configured = config
        .projects
        .get(id)
        .cloned()
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
    let mut reconciliation = None;
    if !kb_drift && project_valid && current.as_ref().is_some_and(|value| value != &configured) {
        let value = current.as_ref().expect("validated live project");
        if identity_preserving_registration_drift(&config_path, &bytes, &configured, value)? {
            let old_digest = hash(&bytes);
            let mut updated = config.clone();
            updated.projects.insert(id.to_owned(), value.clone());
            let new_bytes = serde_json::to_vec(&updated).map_err(|e| e.to_string())?;
            let new_digest = hash(&new_bytes);
            let audit = make_audit_entry(
                configured_owner(&config),
                "project context self-reconciled identity-preserving registration drift",
                &old_digest,
                &new_digest,
                &configured.manifest_sha256,
                &value.manifest_sha256,
            )?;
            if let Err(error) =
                atomic_replace_exact(&config_path, &new_bytes, &old_digest, Some(&audit))
            {
                if error.contains("stale config base during atomic refresh") {
                    return context(id, mode);
                }
                return Err(error);
            }
            bytes = new_bytes;
            config = updated;
            configured = value.clone();
            reconciliation = Some(serde_json::json!({
                "performed": true,
                "reason": audit.reason,
                "old_config_sha256": old_digest,
                "new_config_sha256": new_digest,
                "audit_entry_sha256": audit.entry_sha256
            }));
        }
    }
    ensure_generation_snapshot(&config_path, &bytes, &config)?;
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
    let project_drift = current.as_ref() != Some(&configured);
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
    let all_linked_scopes = match &live_kb {
        Ok(kb) if kb_valid && !kb_drift => knowledge_linked_scopes(kb, id)?,
        _ => Vec::new(),
    };
    let linked_scope_total = all_linked_scopes.len();
    let all_linked_scopes_for_notes = all_linked_scopes
        .iter()
        .filter(|linked| {
            linked["relationship"] == "shared_meta_goal"
                || linked["relationship"] == "promotion_source"
        })
        .cloned()
        .collect::<Vec<_>>();
    let linked_scopes = all_linked_scopes
        .into_iter()
        .take(LINKED_SCOPES_INLINE_LIMIT)
        .collect::<Vec<_>>();
    let linked_scope_returned = linked_scopes.len();
    let linked_scope_truncated = linked_scope_total > linked_scope_returned;
    let linked_scope_detail_command = format!(
        "mozak project linked-scopes {} --limit {} --offset 0",
        shell_arg(id),
        LINKED_SCOPES_INLINE_LIMIT
    );
    let context_notes = snapshot
        .as_ref()
        .map_or_else(Vec::new, |value| context_note_paths(value, root));
    let notes_summary = if !kb_valid || kb_drift {
        serde_json::json!({"state": "invalid", "count": 0, "truncated": false, "detail_command": format!("mozak project notes {} --limit {} --offset 0", shell_arg(id), NOTES_INLINE_LIMIT), "reason": "configured KB is invalid or drifted"})
    } else {
        match notes_inline_count(id, &config, &all_linked_scopes_for_notes) {
            Ok((state, count)) => {
                serde_json::json!({"state": state, "count": count, "truncated": count > NOTES_INLINE_LIMIT, "limit": NOTES_INLINE_LIMIT, "detail_command": format!("mozak project notes {} --limit {} --offset 0", shell_arg(id), NOTES_INLINE_LIMIT)})
            }
            Err(error) => {
                serde_json::json!({"state": "invalid", "count": 0, "truncated": false, "detail_command": format!("mozak project notes {} --limit {} --offset 0", shell_arg(id), NOTES_INLINE_LIMIT), "error": error})
            }
        }
    };
    let output = serde_json::json!({
        "schema_version": 1,
        "command": "project context",
        "state": state,
        "configured_owner": configured_owner(&config),
        "project": {"id": configured.id, "name": configured.name, "root": configured.root},
        "config": {"path": path_text(&config_path)?, "sha256": hash(&bytes)},
        "reconciliation": reconciliation.unwrap_or_else(|| serde_json::json!({"performed": false})),
        "kb": {"root": config.kb_root, "configured_sha256": config.kb_sha256, "current_sha256": current_kb_hash, "valid": kb_valid, "drift": kb_drift, "error": kb_error},
        "knowledge": {"scope_matches": scope_matches, "package_matches": package_matches, "linked_scopes": linked_scopes, "linked_scopes_total_count": linked_scope_total, "linked_scopes_returned_count": linked_scope_returned, "linked_scopes_truncated": linked_scope_truncated, "linked_scopes_limit": LINKED_SCOPES_INLINE_LIMIT, "linked_scopes_detail_command": linked_scope_detail_command},
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
        "workflow": snapshot.as_ref().map(|s| serde_json::json!({"state": s.state, "latest_plan": s.latest_valid_plan, "ready_goals": s.ready_goals, "compaction": s.compaction})),
        "workflow_error": workflow_error,
        "context_notes": context_notes,
        "notes": notes_summary,
        "next_actions": snapshot.as_ref().map_or_else(|| vec!["Run `mozak project validate <project-root>` to inspect invalid current project bytes.".to_owned()], |s| s.next_actions.clone()),
        "detail_commands": [format!("mozak project overview {}", shell_path(root)), format!("mozak project validate {}", shell_path(root)), format!("mozak project graph {}", shell_path(root)), linked_scope_detail_command],
        "trust_transfer": false
    });
    let human = mode == ContextOutputMode::Human
        || (mode == ContextOutputMode::Auto && std::io::stdout().is_terminal());
    if human {
        print_context_human(&output)?;
    } else {
        println!(
            "{}",
            serde_json::to_string(&output).map_err(|e| e.to_string())?
        );
    }
    Ok(if state == "ready" {
        ExitCode::SUCCESS
    } else {
        ExitCode::from(3)
    })
}

pub fn linked_scopes(id: &str, args: &[String]) -> Result<ExitCode, String> {
    if id.is_empty() || id.chars().any(char::is_control) {
        return Err("project id is empty or contains control characters".into());
    }
    let (limit, offset) = parse_limit_offset(args, LINKED_SCOPES_INLINE_LIMIT)?;
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
    let kb = load_registry(Path::new(&config.kb_root)).map_err(|error| error.to_string())?;
    if kb.registry_sha256 != config.kb_sha256 {
        println!(
            "{}",
            serde_json::to_string(&serde_json::json!({
                "schema_version": 1,
                "command": "project linked-scopes",
                "project": {"id": configured.id, "name": configured.name, "root": configured.root},
                "kb": {"root": config.kb_root, "configured_sha256": config.kb_sha256, "current_sha256": kb.registry_sha256, "valid": true, "drift": true},
                "records": [],
                "total_count": 0,
                "returned_count": 0,
                "offset": offset,
                "limit": limit,
                "truncated": false,
                "advisory_only": true,
                "accepted": false,
                "trust_transfer": false,
                "error": "configured KB hash drift; linked Scope records are fail-closed"
            }))
            .map_err(|e| e.to_string())?
        );
        return Ok(ExitCode::from(3));
    }
    let records = knowledge_linked_scopes(&kb, id)?;
    let total = records.len();
    let page = records
        .into_iter()
        .skip(offset)
        .take(limit)
        .collect::<Vec<_>>();
    let returned = page.len();
    println!(
        "{}",
        serde_json::to_string(&serde_json::json!({
            "schema_version": 1,
            "command": "project linked-scopes",
            "project": {"id": configured.id, "name": configured.name, "root": configured.root},
            "kb": {"root": config.kb_root, "configured_sha256": config.kb_sha256, "current_sha256": kb.registry_sha256, "valid": true, "drift": false},
            "records": page,
            "total_count": total,
            "returned_count": returned,
            "offset": offset,
            "limit": limit,
            "truncated": offset.saturating_add(returned) < total,
            "advisory_only": true,
            "accepted": false,
            "trust_transfer": false
        }))
        .map_err(|e| e.to_string())?
    );
    Ok(ExitCode::SUCCESS)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct NotesProfile {
    schema_version: u64,
    #[serde(default)]
    _comment: Option<String>,
    destinations: Vec<NotesDestination>,
    #[serde(default, rename = "preferences")]
    _preferences: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct NotesDestination {
    id: String,
    root: String,
    #[serde(default)]
    purpose: Option<String>,
    #[serde(default)]
    default: Option<bool>,
    #[serde(default)]
    routing_signals: Option<Vec<String>>,
    #[serde(default)]
    trim: Option<String>,
    #[serde(default)]
    obsidian: Option<bool>,
    #[serde(default)]
    excluded_paths: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct NotesLinksProfile {
    schema_version: u64,
    links: BTreeMap<String, Vec<NotesLink>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct NotesLink {
    destination_id: String,
    safe_relative_path_prefixes: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct NotesLinksPin {
    state: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    sha256: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct NotesMatchEvidence {
    source: String,
    destination_id: String,
    relative_path: String,
    matched_tokens: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct NotesOnboardBinding {
    scope_id: String,
    scope_kind: String,
    destination_id: String,
    safe_relative_path_prefixes: Vec<String>,
    confidence: String,
    score: u64,
    evidence: Vec<NotesMatchEvidence>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct NotesOnboardCandidate {
    destination_id: String,
    relative_path: String,
    confidence: String,
    score: u64,
    evidence: Vec<NotesMatchEvidence>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct NotesOnboardUnresolved {
    scope_id: String,
    scope_kind: String,
    reason: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    best_candidate: Option<NotesOnboardCandidate>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct NotesOnboardScan {
    destination_count: usize,
    entry_ceiling: usize,
    entries_seen: usize,
    markdown_files_seen: usize,
    content_byte_ceiling_per_file: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct NotesOnboardProposal {
    schema_version: u64,
    command: String,
    target: String,
    config_sha256: String,
    profile_sha256: String,
    kb_sha256: String,
    links_base: NotesLinksPin,
    bindings: Vec<NotesOnboardBinding>,
    unresolved_scopes: Vec<NotesOnboardUnresolved>,
    scan: NotesOnboardScan,
    proposal_digest: String,
    accepted: bool,
    trust_transfer: bool,
}

#[derive(Serialize)]
struct NotesOnboardProposalDigest<'a> {
    schema_version: u64,
    command: &'a str,
    target: &'a str,
    config_sha256: &'a str,
    profile_sha256: &'a str,
    kb_sha256: &'a str,
    links_base: &'a NotesLinksPin,
    bindings: &'a [NotesOnboardBinding],
    unresolved_scopes: &'a [NotesOnboardUnresolved],
    scan: &'a NotesOnboardScan,
    accepted: bool,
    trust_transfer: bool,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct NotesOnboardApproval {
    schema_version: u64,
    decision: bool,
    intent: String,
    proposal_digest: String,
    target: String,
    links_base: NotesLinksPin,
    profile_sha256: String,
    kb_sha256: String,
    owner: String,
    approved_at: String,
    rationale: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RegisteredNoteScope {
    id: String,
    kind: String,
    title: String,
    intent: String,
}

#[derive(Debug, Clone)]
struct OnboardNoteCandidate {
    destination_id: String,
    relative_path: String,
    path_tokens: BTreeSet<String>,
    heading_tokens: BTreeSet<String>,
    body_tokens: BTreeSet<String>,
    exact_path_components: BTreeSet<String>,
}

pub fn notes_scope(id: &str, args: &[String]) -> Result<ExitCode, String> {
    validate_safe_id(id, "scope id")?;
    let (limit, offset) = parse_limit_offset(args, NOTES_INLINE_LIMIT)?;
    let (config, config_sha256, kb, kb_drift) = load_drift_free_kb()?;
    let scopes = registered_note_scopes(&kb)?;
    let scope = scopes
        .get(id)
        .ok_or_else(|| format!("scope id is not registered in configured KB: {id}"))?;
    notes_for_scopes(
        "notes scope",
        None,
        None,
        &config,
        &config_sha256,
        &kb.registry_sha256,
        kb_drift,
        vec![(scope.id.clone(), format!("direct_{}_scope", scope.kind))],
        limit,
        offset,
    )
}

pub fn notes_onboard_propose(output: &Path) -> Result<ExitCode, String> {
    let (_config, config_sha256, kb, kb_drift) = load_drift_free_kb()?;
    if kb_drift {
        return Err("configured KB drifted; refusing Notes onboarding proposal".into());
    }
    let profile_path = notes_profile_path()?;
    let profile_bytes =
        read_optional_notes_input(&profile_path, "notes profile")?.ok_or_else(|| {
            "notes profile is missing; onboarding requires an existing profile".to_owned()
        })?;
    let profile: NotesProfile = serde_json::from_slice(&profile_bytes)
        .map_err(|error| format!("invalid notes profile: {error}"))?;
    let destinations = validate_notes_profile(&profile)?;
    let links_path = notes_links_path()?;
    let links_bytes = read_optional_notes_input(&links_path, "notes links")?;
    let links_base = notes_links_pin(links_bytes.as_deref());
    let existing_links = match links_bytes.as_deref() {
        Some(bytes) => {
            let links: NotesLinksProfile = serde_json::from_slice(bytes)
                .map_err(|error| format!("invalid notes links: {error}"))?;
            validate_notes_links(&links, &destinations)?;
            Some(links)
        }
        None => None,
    };
    let scopes = registered_note_scopes(&kb)?;
    if let Some(links) = &existing_links {
        validate_notes_mapping_integrity(links, &destinations, &scopes)?;
    }
    ensure_output_outside_note_roots(output, destinations.values())?;

    let (candidates, entries_seen, markdown_files_seen) =
        scan_onboard_candidates(&profile, &destinations)?;
    let mut bindings = Vec::new();
    let mut unresolved_scopes = Vec::new();
    for scope in scopes.values() {
        if let Some(links) = existing_links
            .as_ref()
            .and_then(|links| links.links.get(&scope.id))
        {
            for link in links {
                bindings.push(NotesOnboardBinding {
                    scope_id: scope.id.clone(),
                    scope_kind: scope.kind.clone(),
                    destination_id: link.destination_id.clone(),
                    safe_relative_path_prefixes: link.safe_relative_path_prefixes.clone(),
                    confidence: "high".to_owned(),
                    score: 100,
                    evidence: vec![NotesMatchEvidence {
                        source: "existing_mapping".to_owned(),
                        destination_id: link.destination_id.clone(),
                        relative_path: link.safe_relative_path_prefixes.join(","),
                        matched_tokens: Vec::new(),
                    }],
                });
            }
            continue;
        }
        match best_scope_candidate(scope, &candidates) {
            ScopeCandidateResult::Binding(binding) => bindings.push(binding),
            ScopeCandidateResult::Unresolved(unresolved) => unresolved_scopes.push(unresolved),
        }
    }
    bindings.sort_by(|a, b| {
        a.scope_id
            .cmp(&b.scope_id)
            .then(a.destination_id.cmp(&b.destination_id))
            .then(
                a.safe_relative_path_prefixes
                    .cmp(&b.safe_relative_path_prefixes),
            )
    });
    unresolved_scopes.sort_by(|a, b| a.scope_id.cmp(&b.scope_id));
    let mut proposal = NotesOnboardProposal {
        schema_version: 1,
        command: "notes onboard propose".to_owned(),
        target: NOTES_LINKS_TARGET.to_owned(),
        config_sha256,
        profile_sha256: hash(&profile_bytes),
        kb_sha256: kb.registry_sha256,
        links_base,
        bindings,
        unresolved_scopes,
        scan: NotesOnboardScan {
            destination_count: destinations.len(),
            entry_ceiling: MAX_SCAN_ENTRIES,
            entries_seen,
            markdown_files_seen,
            content_byte_ceiling_per_file: MAX_ONBOARD_CONTENT_BYTES,
        },
        proposal_digest: String::new(),
        accepted: false,
        trust_transfer: false,
    };
    proposal.proposal_digest = notes_onboard_proposal_hash(&proposal)?;
    validate_notes_onboard_proposal(&proposal)?;
    let bytes = serde_json::to_vec_pretty(&proposal).map_err(|error| error.to_string())?;
    atomic_create_output(output, &bytes)?;
    println!(
        "{}",
        serde_json::to_string(&serde_json::json!({
            "schema_version": 1,
            "command": "notes onboard propose",
            "state": "proposed",
            "proposal_digest": proposal.proposal_digest,
            "binding_count": proposal.bindings.len(),
            "unresolved_scope_count": proposal.unresolved_scopes.len(),
            "accepted": false,
            "trust_transfer": false
        }))
        .map_err(|error| error.to_string())?
    );
    Ok(ExitCode::SUCCESS)
}

pub fn notes_onboard_apply(proposal_path: &Path, approval_path: &Path) -> Result<ExitCode, String> {
    let proposal: NotesOnboardProposal =
        strict_json_file(proposal_path, "Notes onboarding proposal")?;
    validate_notes_onboard_proposal(&proposal)?;
    let approval: NotesOnboardApproval =
        strict_json_file(approval_path, "Notes onboarding approval")?;
    validate_notes_onboard_approval(&approval, &proposal)?;

    let (destinations, scopes) = validate_notes_onboard_live_state(&proposal, &approval)?;

    let links_path = notes_links_path()?;
    let live_links = read_optional_notes_input(&links_path, "notes links")?;
    let live_pin = notes_links_pin(live_links.as_deref());
    if live_pin != proposal.links_base || approval.links_base != proposal.links_base {
        return Err("stale Notes onboarding proposal: links base changed".into());
    }
    let mut links = BTreeMap::<String, Vec<NotesLink>>::new();
    for binding in &proposal.bindings {
        links
            .entry(binding.scope_id.clone())
            .or_default()
            .push(NotesLink {
                destination_id: binding.destination_id.clone(),
                safe_relative_path_prefixes: binding.safe_relative_path_prefixes.clone(),
            });
    }
    for scope_links in links.values_mut() {
        scope_links.sort_by(|a, b| {
            a.destination_id.cmp(&b.destination_id).then(
                a.safe_relative_path_prefixes
                    .cmp(&b.safe_relative_path_prefixes),
            )
        });
        scope_links.dedup();
    }
    let links_profile = NotesLinksProfile {
        schema_version: 1,
        links,
    };
    validate_notes_links(&links_profile, &destinations)?;
    validate_notes_mapping_integrity(&links_profile, &destinations, &scopes)?;
    let bytes = serde_json::to_vec_pretty(&links_profile).map_err(|error| error.to_string())?;
    atomic_write_notes_links(&links_path, &bytes, &proposal.links_base, || {
        validate_notes_onboard_live_state(&proposal, &approval).map(|_| ())
    })?;
    println!(
        "{}",
        serde_json::to_string(&serde_json::json!({
            "schema_version": 1,
            "command": "notes onboard apply",
            "state": "applied",
            "target": NOTES_LINKS_TARGET,
            "proposal_digest": proposal.proposal_digest,
            "previous_links": proposal.links_base,
            "links_sha256": hash(&bytes),
            "profile_sha256": proposal.profile_sha256,
            "config_sha256": proposal.config_sha256,
            "kb_sha256": proposal.kb_sha256,
            "binding_count": proposal.bindings.len(),
            "unresolved_scope_count": proposal.unresolved_scopes.len(),
            "owner": approval.owner,
            "approved_at": approval.approved_at,
            "mapping_approved": true,
            "accepted": false,
            "trust_transfer": false,
            "vaults_mutated": false
        }))
        .map_err(|error| error.to_string())?
    );
    Ok(ExitCode::SUCCESS)
}

pub fn notes_check() -> Result<ExitCode, String> {
    let (config, config_sha256, kb, kb_drift) = load_drift_free_kb()?;
    if kb_drift {
        println!(
            "{}",
            serde_json::to_string(&serde_json::json!({
                "schema_version": 1, "command": "notes check", "state": "invalid",
                "reason": "configured KB drifted", "config_sha256": config_sha256,
                "configured_kb_sha256": config.kb_sha256, "current_kb_sha256": kb.registry_sha256,
                "accepted": false, "trust_transfer": false
            }))
            .map_err(|error| error.to_string())?
        );
        return Ok(ExitCode::from(3));
    }
    let profile_path = notes_profile_path()?;
    let links_path = notes_links_path()?;
    let Some(profile_bytes) = read_optional_notes_input(&profile_path, "notes profile")? else {
        println!(
            "{}",
            serde_json::to_string(&serde_json::json!({
                "schema_version": 1, "command": "notes check", "state": "needs_input",
                "missing": "notes/profile.json", "accepted": false, "trust_transfer": false
            }))
            .map_err(|error| error.to_string())?
        );
        return Ok(ExitCode::from(2));
    };
    let profile: NotesProfile = serde_json::from_slice(&profile_bytes)
        .map_err(|error| format!("invalid notes profile: {error}"))?;
    let destinations = validate_notes_profile(&profile)?;
    let Some(links_bytes) = read_optional_notes_input(&links_path, "notes links")? else {
        println!(
            "{}",
            serde_json::to_string(&serde_json::json!({
                "schema_version": 1, "command": "notes check", "state": "needs_input",
                "missing": NOTES_LINKS_TARGET, "profile_sha256": hash(&profile_bytes),
                "accepted": false, "trust_transfer": false
            }))
            .map_err(|error| error.to_string())?
        );
        return Ok(ExitCode::from(2));
    };
    let links: NotesLinksProfile = serde_json::from_slice(&links_bytes)
        .map_err(|error| format!("invalid notes links: {error}"))?;
    validate_notes_links(&links, &destinations)?;
    let scopes = registered_note_scopes(&kb)?;
    let prefix_count = validate_notes_mapping_integrity(&links, &destinations, &scopes)?;
    validate_notes_mapping_no_symlinks(&links, &destinations)?;
    println!(
        "{}",
        serde_json::to_string(&serde_json::json!({
            "schema_version": 1, "command": "notes check", "state": "ready",
            "target": NOTES_LINKS_TARGET, "profile_sha256": hash(&profile_bytes),
            "links_sha256": hash(&links_bytes), "config_sha256": config_sha256,
            "kb_sha256": kb.registry_sha256, "destination_count": destinations.len(),
            "mapped_scope_count": links.links.len(), "mapped_prefix_count": prefix_count,
            "registered_scope_count": scopes.len(), "accepted": false, "trust_transfer": false,
            "checks": ["profile_schema", "mapping_schema", "registered_scope_ids", "root_containment", "mapped_prefix_exists", "no_symlinks"]
        }))
        .map_err(|error| error.to_string())?
    );
    Ok(ExitCode::SUCCESS)
}

enum ScopeCandidateResult {
    Binding(NotesOnboardBinding),
    Unresolved(NotesOnboardUnresolved),
}

fn registered_note_scopes(
    kb: &mozak_core::kb::ValidatedKb,
) -> Result<BTreeMap<String, RegisteredNoteScope>, String> {
    let mut scopes = BTreeMap::new();
    for entry in &kb.entries {
        for scope in &entry.scopes.manifest.scopes {
            let record = RegisteredNoteScope {
                id: scope.id.clone(),
                kind: scope.kind.to_string(),
                title: scope.title.clone(),
                intent: scope.intent.clone(),
            };
            if let Some(existing) = scopes.insert(scope.id.clone(), record.clone())
                && existing != record
            {
                return Err(format!(
                    "configured KB contains conflicting Scope definitions for {}",
                    scope.id
                ));
            }
        }
    }
    Ok(scopes)
}

fn notes_links_pin(bytes: Option<&[u8]>) -> NotesLinksPin {
    match bytes {
        Some(bytes) => NotesLinksPin {
            state: "present".to_owned(),
            sha256: Some(hash(bytes)),
        },
        None => NotesLinksPin {
            state: "absent".to_owned(),
            sha256: None,
        },
    }
}

fn validate_notes_links_pin(pin: &NotesLinksPin) -> Result<(), String> {
    match (pin.state.as_str(), pin.sha256.as_deref()) {
        ("absent", None) => Ok(()),
        ("present", Some(digest)) => validate_lower_hex("notes links digest", digest, 64),
        _ => Err("notes links pin must be absent without a digest or present with one".into()),
    }
}

fn notes_onboard_proposal_hash(proposal: &NotesOnboardProposal) -> Result<String, String> {
    let digest = NotesOnboardProposalDigest {
        schema_version: proposal.schema_version,
        command: &proposal.command,
        target: &proposal.target,
        config_sha256: &proposal.config_sha256,
        profile_sha256: &proposal.profile_sha256,
        kb_sha256: &proposal.kb_sha256,
        links_base: &proposal.links_base,
        bindings: &proposal.bindings,
        unresolved_scopes: &proposal.unresolved_scopes,
        scan: &proposal.scan,
        accepted: proposal.accepted,
        trust_transfer: proposal.trust_transfer,
    };
    serde_json::to_vec(&digest)
        .map(|bytes| hash(&bytes))
        .map_err(|error| error.to_string())
}

fn validate_notes_onboard_proposal(proposal: &NotesOnboardProposal) -> Result<(), String> {
    if proposal.schema_version != 1 || proposal.command != "notes onboard propose" {
        return Err("unsupported Notes onboarding proposal contract".into());
    }
    if proposal.target != NOTES_LINKS_TARGET {
        return Err("Notes onboarding proposal target is not the exact managed target".into());
    }
    for (label, digest) in [
        ("config digest", proposal.config_sha256.as_str()),
        ("profile digest", proposal.profile_sha256.as_str()),
        ("KB digest", proposal.kb_sha256.as_str()),
        ("proposal digest", proposal.proposal_digest.as_str()),
    ] {
        validate_lower_hex(label, digest, 64)?;
    }
    validate_notes_links_pin(&proposal.links_base)?;
    if proposal.accepted || proposal.trust_transfer {
        return Err(
            "Notes onboarding proposal must remain unaccepted with no trust transfer".into(),
        );
    }
    if proposal.scan.entry_ceiling != MAX_SCAN_ENTRIES
        || proposal.scan.content_byte_ceiling_per_file != MAX_ONBOARD_CONTENT_BYTES
        || proposal.scan.entries_seen > MAX_SCAN_ENTRIES
    {
        return Err("Notes onboarding proposal scan bounds are invalid".into());
    }
    let mut resolved = BTreeSet::new();
    for binding in &proposal.bindings {
        validate_safe_id(&binding.scope_id, "scope id")?;
        if binding.scope_kind != "project" && binding.scope_kind != "topic" {
            return Err("Notes onboarding binding has invalid Scope kind".into());
        }
        validate_safe_id(&binding.destination_id, "destination id")?;
        if binding.confidence != "high" && binding.confidence != "medium" {
            return Err("Notes onboarding binding confidence must be high or medium".into());
        }
        if binding.safe_relative_path_prefixes.is_empty() || binding.evidence.is_empty() {
            return Err("Notes onboarding binding must include prefixes and evidence".into());
        }
        for prefix in &binding.safe_relative_path_prefixes {
            safe_note_relative(prefix)?;
        }
        resolved.insert(binding.scope_id.clone());
    }
    for unresolved in &proposal.unresolved_scopes {
        validate_safe_id(&unresolved.scope_id, "scope id")?;
        if !resolved.insert(unresolved.scope_id.clone()) {
            return Err("Notes onboarding proposal resolves a Scope more than once".into());
        }
    }
    if notes_onboard_proposal_hash(proposal)? != proposal.proposal_digest {
        return Err("Notes onboarding proposal digest mismatch".into());
    }
    Ok(())
}

fn validate_notes_onboard_approval(
    approval: &NotesOnboardApproval,
    proposal: &NotesOnboardProposal,
) -> Result<(), String> {
    if approval.schema_version != 1 || !approval.decision {
        return Err("Notes onboarding approval must set schema_version 1 and decision true".into());
    }
    if approval.intent != "notes onboard apply" {
        return Err("Notes onboarding approval intent must be 'notes onboard apply'".into());
    }
    if approval.proposal_digest != proposal.proposal_digest
        || approval.target != proposal.target
        || approval.links_base != proposal.links_base
        || approval.profile_sha256 != proposal.profile_sha256
        || approval.kb_sha256 != proposal.kb_sha256
    {
        return Err("Notes onboarding approval does not pin the exact proposal state".into());
    }
    display_safe("Notes onboarding approval owner", &approval.owner)?;
    display_safe("Notes onboarding approval rationale", &approval.rationale)?;
    if !canonical_utc(&approval.approved_at) {
        return Err("Notes onboarding approved_at must be canonical UTC".into());
    }
    Ok(())
}

fn validate_notes_onboard_live_state(
    proposal: &NotesOnboardProposal,
    approval: &NotesOnboardApproval,
) -> Result<
    (
        BTreeMap<String, PathBuf>,
        BTreeMap<String, RegisteredNoteScope>,
    ),
    String,
> {
    let (config, config_sha256, kb, kb_drift) = load_drift_free_kb()?;
    let configured_owner = config
        .configured_owner
        .as_deref()
        .ok_or("local config has no configured owner")?;
    if approval.owner != configured_owner {
        return Err("Notes onboarding approval owner is not the configured owner".into());
    }
    if config_sha256 != proposal.config_sha256 {
        return Err("stale Notes onboarding proposal: local config digest changed".into());
    }
    if kb_drift || kb.registry_sha256 != proposal.kb_sha256 {
        return Err("stale Notes onboarding proposal: KB digest changed".into());
    }
    let profile_path = notes_profile_path()?;
    let profile_bytes = read_optional_notes_input(&profile_path, "notes profile")?
        .ok_or("notes profile disappeared before apply")?;
    if hash(&profile_bytes) != proposal.profile_sha256 {
        return Err("stale Notes onboarding proposal: profile digest changed".into());
    }
    let profile: NotesProfile = serde_json::from_slice(&profile_bytes)
        .map_err(|error| format!("invalid notes profile: {error}"))?;
    let destinations = validate_notes_profile(&profile)?;
    let scopes = registered_note_scopes(&kb)?;
    validate_notes_proposal_live_bindings(proposal, &destinations, &scopes)?;
    Ok((destinations, scopes))
}

fn validate_notes_proposal_live_bindings(
    proposal: &NotesOnboardProposal,
    destinations: &BTreeMap<String, PathBuf>,
    scopes: &BTreeMap<String, RegisteredNoteScope>,
) -> Result<(), String> {
    let mut accounted = BTreeSet::new();
    for binding in &proposal.bindings {
        let scope = scopes
            .get(&binding.scope_id)
            .ok_or_else(|| format!("proposal names unregistered Scope: {}", binding.scope_id))?;
        if scope.kind != binding.scope_kind {
            return Err(format!("proposal Scope kind drifted: {}", binding.scope_id));
        }
        let root = destinations.get(&binding.destination_id).ok_or_else(|| {
            format!(
                "proposal names unknown destination: {}",
                binding.destination_id
            )
        })?;
        for prefix in &binding.safe_relative_path_prefixes {
            validate_mapped_prefix(root, prefix)?;
        }
        accounted.insert(binding.scope_id.clone());
    }
    for unresolved in &proposal.unresolved_scopes {
        let scope = scopes.get(&unresolved.scope_id).ok_or_else(|| {
            format!(
                "proposal names unregistered unresolved Scope: {}",
                unresolved.scope_id
            )
        })?;
        if scope.kind != unresolved.scope_kind {
            return Err(format!(
                "proposal Scope kind drifted: {}",
                unresolved.scope_id
            ));
        }
        accounted.insert(unresolved.scope_id.clone());
    }
    if accounted.len() != scopes.len() || !scopes.keys().all(|id| accounted.contains(id)) {
        return Err(
            "proposal does not account for every registered Project and Topic Scope".into(),
        );
    }
    Ok(())
}

fn validate_notes_mapping_integrity(
    links: &NotesLinksProfile,
    destinations: &BTreeMap<String, PathBuf>,
    scopes: &BTreeMap<String, RegisteredNoteScope>,
) -> Result<usize, String> {
    let mut prefix_count = 0usize;
    for (scope_id, scope_links) in &links.links {
        if !scopes.contains_key(scope_id) {
            return Err(format!(
                "notes mapping names unregistered Scope: {scope_id}"
            ));
        }
        for link in scope_links {
            let root = destinations.get(&link.destination_id).ok_or_else(|| {
                format!(
                    "notes mapping names unknown destination: {}",
                    link.destination_id
                )
            })?;
            for prefix in &link.safe_relative_path_prefixes {
                validate_mapped_prefix(root, prefix)?;
                prefix_count += 1;
            }
        }
    }
    Ok(prefix_count)
}

fn validate_notes_mapping_no_symlinks(
    links: &NotesLinksProfile,
    destinations: &BTreeMap<String, PathBuf>,
) -> Result<(), String> {
    let mut records = Vec::new();
    let mut seen = BTreeSet::new();
    let mut scanned_entries = 0usize;
    for (scope_id, scope_links) in &links.links {
        for link in scope_links {
            let root = destinations
                .get(&link.destination_id)
                .ok_or("notes mapping names unknown destination")?;
            for prefix in &link.safe_relative_path_prefixes {
                let start = root.join(safe_note_relative(prefix)?);
                scan_notes(
                    root,
                    &start,
                    scope_id,
                    "integrity_check",
                    &link.destination_id,
                    &mut records,
                    &mut seen,
                    &mut scanned_entries,
                )?;
            }
        }
    }
    Ok(())
}

fn validate_mapped_prefix(root: &Path, prefix: &str) -> Result<PathBuf, String> {
    let relative = safe_note_relative(prefix)?;
    let joined = root.join(relative);
    reject_symlink_chain(&joined, "notes mapped prefix")
        .map_err(|_| format!("mapped notes prefix has a symlinked ancestor: {prefix}"))?;
    let metadata = fs::symlink_metadata(&joined)
        .map_err(|error| format!("mapped notes prefix does not exist: {prefix}: {error}"))?;
    if metadata.file_type().is_symlink() || (!metadata.is_file() && !metadata.is_dir()) {
        return Err(format!(
            "mapped notes prefix is not a regular file or directory: {prefix}"
        ));
    }
    contain_notes_path(root, &joined)
}

fn scan_onboard_candidates(
    profile: &NotesProfile,
    destinations: &BTreeMap<String, PathBuf>,
) -> Result<(Vec<OnboardNoteCandidate>, usize, usize), String> {
    let mut candidates = Vec::new();
    let mut entries_seen = 0usize;
    let mut markdown_files_seen = 0usize;
    let mut ordered = profile.destinations.clone();
    ordered.sort_by(|a, b| a.id.cmp(&b.id));
    for destination in ordered {
        let root = destinations
            .get(&destination.id)
            .ok_or("validated Notes destination disappeared")?;
        let excluded_paths = destination
            .excluded_paths
            .as_deref()
            .unwrap_or_default()
            .iter()
            .map(|value| safe_note_relative(value).map(|relative| root.join(relative)))
            .collect::<Result<Vec<_>, _>>()?;
        scan_onboard_directory(
            root,
            root,
            &destination.id,
            &excluded_paths,
            &mut candidates,
            &mut entries_seen,
            &mut markdown_files_seen,
        )?;
    }
    candidates.sort_by(|a, b| {
        a.destination_id
            .cmp(&b.destination_id)
            .then(a.relative_path.cmp(&b.relative_path))
    });
    Ok((candidates, entries_seen, markdown_files_seen))
}

fn scan_onboard_directory(
    root: &Path,
    path: &Path,
    destination_id: &str,
    excluded_paths: &[PathBuf],
    candidates: &mut Vec<OnboardNoteCandidate>,
    entries_seen: &mut usize,
    markdown_files_seen: &mut usize,
) -> Result<(), String> {
    *entries_seen += 1;
    if *entries_seen > MAX_SCAN_ENTRIES {
        return Err(format!(
            "notes scan exceeded entry ceiling of {MAX_SCAN_ENTRIES}"
        ));
    }
    reject_symlink_chain(path, "notes onboarding scan")?;
    let canonical = contain_notes_path(root, path)?;
    if canonical.is_file() {
        add_onboard_candidate(
            root,
            &canonical,
            destination_id,
            candidates,
            markdown_files_seen,
        )?;
        return Ok(());
    }
    let mut entries = fs::read_dir(&canonical)
        .map_err(|error| format!("cannot read notes directory: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("cannot inspect notes entry: {error}"))?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let file_name = entry.file_name();
        if file_name.to_string_lossy().starts_with('.') {
            continue;
        }
        let child = entry.path();
        if excluded_paths
            .iter()
            .any(|excluded| child.starts_with(excluded))
        {
            continue;
        }
        let metadata = fs::symlink_metadata(&child)
            .map_err(|error| format!("cannot inspect notes path: {error}"))?;
        if metadata.file_type().is_symlink() {
            return Err("notes onboarding scan encountered a symlink".into());
        }
        if metadata.is_dir() {
            scan_onboard_directory(
                root,
                &child,
                destination_id,
                excluded_paths,
                candidates,
                entries_seen,
                markdown_files_seen,
            )?;
        } else if metadata.is_file() {
            *entries_seen += 1;
            if *entries_seen > MAX_SCAN_ENTRIES {
                return Err(format!(
                    "notes scan exceeded entry ceiling of {MAX_SCAN_ENTRIES}"
                ));
            }
            add_onboard_candidate(
                root,
                &child,
                destination_id,
                candidates,
                markdown_files_seen,
            )?;
        }
    }
    Ok(())
}

fn add_onboard_candidate(
    root: &Path,
    path: &Path,
    destination_id: &str,
    candidates: &mut Vec<OnboardNoteCandidate>,
    markdown_files_seen: &mut usize,
) -> Result<(), String> {
    if path.extension().and_then(|value| value.to_str()) != Some("md") {
        return Ok(());
    }
    let path = contain_notes_path(root, path)?;
    let relative = path
        .strip_prefix(root)
        .map_err(|error| error.to_string())?
        .to_string_lossy()
        .replace('\\', "/");
    safe_note_relative(&relative)?;
    let mut bytes = Vec::new();
    fs::File::open(&path)
        .map_err(|error| format!("cannot open note during onboarding scan: {error}"))?
        .take((MAX_ONBOARD_CONTENT_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("cannot read bounded note content: {error}"))?;
    bytes.truncate(MAX_ONBOARD_CONTENT_BYTES);
    let content = String::from_utf8_lossy(&bytes);
    let mut heading_tokens = BTreeSet::new();
    let mut body_tokens = BTreeSet::new();
    for line in content.lines() {
        if line.trim_start().starts_with('#') {
            extend_bounded_tokens(&mut heading_tokens, line);
        } else {
            extend_bounded_tokens(&mut body_tokens, line);
        }
    }
    let mut path_tokens = BTreeSet::new();
    extend_bounded_tokens(&mut path_tokens, &relative);
    let exact_path_components = Path::new(&relative)
        .components()
        .filter_map(|component| match component {
            Component::Normal(value) => value.to_str(),
            _ => None,
        })
        .map(|value| {
            Path::new(value)
                .file_stem()
                .and_then(|stem| stem.to_str())
                .unwrap_or(value)
        })
        .map(compact_ascii)
        .filter(|value| !value.is_empty())
        .collect();
    *markdown_files_seen += 1;
    candidates.push(OnboardNoteCandidate {
        destination_id: destination_id.to_owned(),
        relative_path: relative,
        path_tokens,
        heading_tokens,
        body_tokens,
        exact_path_components,
    });
    Ok(())
}

fn best_scope_candidate(
    scope: &RegisteredNoteScope,
    candidates: &[OnboardNoteCandidate],
) -> ScopeCandidateResult {
    let tokens = scope_match_tokens(scope);
    let compact_id = compact_ascii(&scope.id);
    let mut ranked = candidates
        .iter()
        .filter_map(|candidate| score_scope_candidate(&tokens, &compact_id, candidate))
        .collect::<Vec<_>>();
    ranked.sort_by(|a, b| {
        confidence_rank(&b.confidence)
            .cmp(&confidence_rank(&a.confidence))
            .then(b.score.cmp(&a.score))
            .then(a.destination_id.cmp(&b.destination_id))
            .then(a.relative_path.cmp(&b.relative_path))
    });
    let Some(best) = ranked.first().cloned() else {
        return ScopeCandidateResult::Unresolved(NotesOnboardUnresolved {
            scope_id: scope.id.clone(),
            scope_kind: scope.kind.clone(),
            reason: "no_specific_token_match".to_owned(),
            best_candidate: None,
        });
    };
    if best.confidence == "low" {
        return ScopeCandidateResult::Unresolved(NotesOnboardUnresolved {
            scope_id: scope.id.clone(),
            scope_kind: scope.kind.clone(),
            reason: "low_confidence_owner_review_required".to_owned(),
            best_candidate: Some(best),
        });
    }
    if ranked
        .get(1)
        .is_some_and(|next| next.confidence == best.confidence && next.score == best.score)
    {
        return ScopeCandidateResult::Unresolved(NotesOnboardUnresolved {
            scope_id: scope.id.clone(),
            scope_kind: scope.kind.clone(),
            reason: "ambiguous_top_candidates_owner_review_required".to_owned(),
            best_candidate: Some(best),
        });
    }
    ScopeCandidateResult::Binding(NotesOnboardBinding {
        scope_id: scope.id.clone(),
        scope_kind: scope.kind.clone(),
        destination_id: best.destination_id.clone(),
        safe_relative_path_prefixes: vec![best.relative_path.clone()],
        confidence: best.confidence,
        score: best.score,
        evidence: best.evidence,
    })
}

fn score_scope_candidate(
    scope_tokens: &BTreeSet<String>,
    compact_id: &str,
    candidate: &OnboardNoteCandidate,
) -> Option<NotesOnboardCandidate> {
    let path = intersection(scope_tokens, &candidate.path_tokens);
    let heading = intersection(scope_tokens, &candidate.heading_tokens);
    let body = intersection(scope_tokens, &candidate.body_tokens);
    let exact_id = candidate.exact_path_components.contains(compact_id);
    let score = u64::from(exact_id) * 20
        + u64::try_from(path.len()).ok()? * 6
        + u64::try_from(heading.len()).ok()? * 4
        + u64::try_from(body.len().min(2)).ok()?;
    if score == 0 {
        return None;
    }
    let confidence = if exact_id
        || path.len() >= 2
        || (!path.is_empty() && !heading.is_empty())
        || heading.len() >= 3
    {
        "high"
    } else if score >= 8 && (!path.is_empty() || !heading.is_empty()) {
        "medium"
    } else {
        "low"
    };
    let mut evidence = Vec::new();
    if exact_id {
        evidence.push(NotesMatchEvidence {
            source: "exact_scope_id_path_component".to_owned(),
            destination_id: candidate.destination_id.clone(),
            relative_path: candidate.relative_path.clone(),
            matched_tokens: Vec::new(),
        });
    }
    for (source, matched) in [("path", path), ("heading", heading), ("bounded_body", body)] {
        if !matched.is_empty() {
            evidence.push(NotesMatchEvidence {
                source: source.to_owned(),
                destination_id: candidate.destination_id.clone(),
                relative_path: candidate.relative_path.clone(),
                matched_tokens: matched,
            });
        }
    }
    Some(NotesOnboardCandidate {
        destination_id: candidate.destination_id.clone(),
        relative_path: candidate.relative_path.clone(),
        confidence: confidence.to_owned(),
        score,
        evidence,
    })
}

fn scope_match_tokens(scope: &RegisteredNoteScope) -> BTreeSet<String> {
    let mut tokens = BTreeSet::new();
    for value in [&scope.id, &scope.title, &scope.intent] {
        for token in tokenize(value) {
            if tokens.len() == MAX_SCOPE_MATCH_TOKENS {
                return tokens;
            }
            tokens.insert(token);
        }
    }
    tokens
}

fn extend_bounded_tokens(tokens: &mut BTreeSet<String>, value: &str) {
    for token in tokenize(value) {
        if tokens.len() == MAX_ONBOARD_TOKENS {
            return;
        }
        tokens.insert(token);
    }
}

fn tokenize(value: &str) -> Vec<String> {
    value
        .split(|character: char| !character.is_ascii_alphanumeric())
        .map(str::to_ascii_lowercase)
        .filter(|token| token.len() >= 4 && !generic_match_token(token))
        .collect()
}

fn generic_match_token(token: &str) -> bool {
    matches!(
        token,
        "about"
            | "build"
            | "building"
            | "data"
            | "document"
            | "documents"
            | "knowledge"
            | "local"
            | "markdown"
            | "note"
            | "notes"
            | "project"
            | "research"
            | "scope"
            | "system"
            | "topic"
            | "using"
            | "with"
    )
}

fn compact_ascii(value: &str) -> String {
    value
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .flat_map(char::to_lowercase)
        .collect()
}

fn intersection(left: &BTreeSet<String>, right: &BTreeSet<String>) -> Vec<String> {
    left.intersection(right).cloned().collect()
}

fn confidence_rank(value: &str) -> u8 {
    match value {
        "high" => 3,
        "medium" => 2,
        "low" => 1,
        _ => 0,
    }
}

fn ensure_output_outside_note_roots<'a>(
    output: &Path,
    roots: impl Iterator<Item = &'a PathBuf>,
) -> Result<(), String> {
    reject_unsafe_lexical(output)?;
    let absolute = if output.is_absolute() {
        output.to_path_buf()
    } else {
        env::current_dir()
            .map_err(|error| error.to_string())?
            .join(output)
    };
    let parent = absolute.parent().ok_or("proposal output has no parent")?;
    reject_symlink_chain(parent, "Notes onboarding proposal output")
        .map_err(|_| "Notes onboarding proposal output has a symlinked ancestor".to_owned())?;
    let mut existing = parent;
    while !existing.exists() {
        existing = existing
            .parent()
            .ok_or("proposal output has no existing ancestor")?;
    }
    let canonical_existing = existing
        .canonicalize()
        .map_err(|error| format!("cannot resolve proposal output ancestor: {error}"))?;
    let missing = parent
        .strip_prefix(existing)
        .map_err(|error| error.to_string())?;
    let candidate = canonical_existing.join(missing).join(
        absolute
            .file_name()
            .ok_or("proposal output must name a JSON file")?,
    );
    if roots.into_iter().any(|root| candidate.starts_with(root)) {
        return Err("Notes onboarding proposal output must be outside every Notes root".into());
    }
    Ok(())
}

pub fn project_notes(id: &str, args: &[String]) -> Result<ExitCode, String> {
    if id.is_empty() || id.chars().any(char::is_control) {
        return Err("project id is empty or contains control characters".into());
    }
    let (limit, offset) = parse_limit_offset(args, NOTES_INLINE_LIMIT)?;
    let (config, config_sha256, kb, kb_drift) = load_drift_free_kb()?;
    let configured = config
        .projects
        .get(id)
        .ok_or_else(|| format!("project id is not registered: {id}"))?;
    let mut scope_ids = kb
        .entries
        .iter()
        .flat_map(|entry| entry.scopes.manifest.scopes.iter())
        .filter(|scope| scope.id == id)
        .map(|scope| (scope.id.clone(), "direct_project_scope".to_owned()))
        .collect::<Vec<_>>();
    for linked in knowledge_linked_scopes(&kb, id)? {
        let Some(scope_id) = linked.get("scope_id").and_then(Value::as_str) else {
            continue;
        };
        let Some(relationship) = linked.get("relationship").and_then(Value::as_str) else {
            continue;
        };
        if relationship != "shared_meta_goal" && relationship != "promotion_source" {
            continue;
        }
        scope_ids.push((scope_id.to_owned(), relationship.to_owned()));
    }
    scope_ids.sort();
    scope_ids.dedup();
    notes_for_scopes(
        "project notes",
        Some(
            serde_json::json!({"id": configured.id, "name": configured.name, "root": configured.root}),
        ),
        None,
        &config,
        &config_sha256,
        &kb.registry_sha256,
        kb_drift,
        scope_ids,
        limit,
        offset,
    )
}

pub fn meta_goal_notes(id: &str, args: &[String]) -> Result<ExitCode, String> {
    if id.is_empty() || id.chars().any(char::is_control) {
        return Err("meta goal id is empty or contains control characters".into());
    }
    let (limit, offset) = parse_limit_offset(args, NOTES_INLINE_LIMIT)?;
    let (config, config_sha256, kb, kb_drift) = load_drift_free_kb()?;
    let mut scope_ids = Vec::new();
    for entry in &kb.entries {
        for goal in &entry.scopes.manifest.meta_goals {
            if goal.id == id {
                for scope_id in &goal.scope_ids {
                    scope_ids.push((scope_id.clone(), "shared_meta_goal".to_owned()));
                }
            }
        }
    }
    if scope_ids.is_empty() {
        return Err(format!(
            "meta goal id is not registered in configured KB: {id}"
        ));
    }
    notes_for_scopes(
        "notes meta-goal",
        None,
        Some(serde_json::json!({"id": id})),
        &config,
        &config_sha256,
        &kb.registry_sha256,
        kb_drift,
        scope_ids,
        limit,
        offset,
    )
}

fn load_drift_free_kb() -> Result<(LocalConfig, String, mozak_core::kb::ValidatedKb, bool), String>
{
    let config_path = default_config_path()?;
    validate_target_path(&config_path)?;
    let bytes = read_optional_regular(&config_path)?
        .ok_or_else(|| format!("local config does not exist: {}", config_path.display()))?;
    let config: LocalConfig = serde_json::from_slice(&bytes)
        .map_err(|e| format!("invalid local config {}: {e}", config_path.display()))?;
    validate_local_config(&config)?;
    let kb = load_registry(Path::new(&config.kb_root)).map_err(|error| error.to_string())?;
    let drift = kb.registry_sha256 != config.kb_sha256;
    Ok((config, hash(&bytes), kb, drift))
}

#[allow(clippy::too_many_arguments)]
fn notes_for_scopes(
    command: &str,
    project: Option<Value>,
    meta_goal: Option<Value>,
    config: &LocalConfig,
    config_sha256: &str,
    current_kb_sha256: &str,
    kb_drift: bool,
    scope_ids: Vec<(String, String)>,
    limit: usize,
    offset: usize,
) -> Result<ExitCode, String> {
    if kb_drift {
        println!(
            "{}",
            serde_json::to_string(&serde_json::json!({
                "schema_version": 1,
                "command": command,
                "state": "invalid",
                "config": {"sha256": config_sha256},
                "kb": {"root": config.kb_root, "configured_sha256": config.kb_sha256, "current_sha256": current_kb_sha256, "valid": true, "drift": true},
                "records": [],
                "accepted": false,
                "trust_transfer": false,
                "labels": ["device_local", "advisory_only"]
            }))
            .map_err(|e| e.to_string())?
        );
        return Ok(ExitCode::from(3));
    }
    let profile_path = notes_profile_path()?;
    let links_path = notes_links_path()?;
    let Some(profile_bytes) = read_optional_notes_input(&profile_path, "notes profile")? else {
        println!("{}", serde_json::to_string(&serde_json::json!({
            "schema_version": 1, "command": command, "state": "needs_input",
            "profile": {"path": path_text(&profile_path)?, "status": "missing"},
            "records": [], "total_count": 0, "returned_count": 0, "offset": offset, "limit": limit,
            "accepted": false, "trust_transfer": false, "labels": ["device_local", "advisory_only"]
        })).map_err(|e| e.to_string())?);
        return Ok(ExitCode::from(2));
    };
    let Some(links_bytes) = read_optional_notes_input(&links_path, "notes links")? else {
        println!("{}", serde_json::to_string(&serde_json::json!({
            "schema_version": 1, "command": command, "state": "needs_input",
            "profile": {"path": path_text(&profile_path)?, "sha256": hash(&profile_bytes)},
            "links": {"path": path_text(&links_path)?, "status": "missing"},
            "records": [], "total_count": 0, "returned_count": 0, "offset": offset, "limit": limit,
            "accepted": false, "trust_transfer": false, "labels": ["device_local", "advisory_only"]
        })).map_err(|e| e.to_string())?);
        return Ok(ExitCode::from(2));
    };
    let profile: NotesProfile = serde_json::from_slice(&profile_bytes)
        .map_err(|e| format!("invalid notes profile {}: {e}", profile_path.display()))?;
    let destinations = validate_notes_profile(&profile)?;
    let links_profile: NotesLinksProfile = serde_json::from_slice(&links_bytes)
        .map_err(|e| format!("invalid notes links {}: {e}", links_path.display()))?;
    validate_notes_links(&links_profile, &destinations)?;
    let mut records = Vec::new();
    let mut seen = BTreeSet::new();
    let mut scanned_entries = 0usize;
    for (scope_id, relationship) in scope_ids {
        if let Some(links) = links_profile.links.get(&scope_id) {
            for link in links {
                let root = destinations.get(&link.destination_id).ok_or_else(|| {
                    format!("notes link for {scope_id} names unknown destination")
                })?;
                for prefix in &link.safe_relative_path_prefixes {
                    let prefix_path = safe_note_relative(prefix)?;
                    let start = root.join(&prefix_path);
                    scan_notes(
                        &root,
                        &start,
                        &scope_id,
                        &relationship,
                        &link.destination_id,
                        &mut records,
                        &mut seen,
                        &mut scanned_entries,
                    )?;
                }
            }
        }
    }
    records.sort_by(|a, b| {
        a["path"]
            .as_str()
            .cmp(&b["path"].as_str())
            .then(a["scope_id"].as_str().cmp(&b["scope_id"].as_str()))
    });
    let total = records.len();
    let mut page = records
        .into_iter()
        .skip(offset)
        .take(limit)
        .collect::<Vec<_>>();
    for record in &mut page {
        let destination_id = record["destination_id"]
            .as_str()
            .ok_or("note record is missing destination id")?;
        let relative = record["path"]
            .as_str()
            .ok_or("note record is missing relative path")?;
        let root = destinations
            .get(destination_id)
            .ok_or("note record names unknown destination")?;
        let path = contain_notes_path(root, &root.join(safe_note_relative(relative)?))?;
        record["sha256"] = Value::String(streaming_sha256_file(&path)?);
    }
    println!("{}", serde_json::to_string(&serde_json::json!({
        "schema_version": 1, "command": command, "state": "ready",
        "project": project, "meta_goal": meta_goal,
        "profile": {"path": path_text(&profile_path)?, "sha256": hash(&profile_bytes)},
        "links": {"path": path_text(&links_path)?, "sha256": hash(&links_bytes)},
        "kb": {"root": config.kb_root, "configured_sha256": config.kb_sha256, "current_sha256": current_kb_sha256, "valid": true, "drift": false},
            "records": page, "total_count": total, "returned_count": total.saturating_sub(offset).min(limit), "offset": offset, "limit": limit, "truncated": offset + limit < total,
        "scan": {"entry_ceiling": MAX_SCAN_ENTRIES, "entries_seen": scanned_entries},
        "accepted": false, "trust_transfer": false, "labels": ["device_local", "advisory_only"]
    })).map_err(|e| e.to_string())?);
    Ok(ExitCode::SUCCESS)
}

fn notes_profile_path() -> Result<PathBuf, String> {
    let config = env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")))
        .ok_or("HOME or XDG_CONFIG_HOME is required for notes profile path")?;
    Ok(config.join(DEFAULT_NOTES_PROFILE))
}

fn notes_links_path() -> Result<PathBuf, String> {
    let config = env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")))
        .ok_or("HOME or XDG_CONFIG_HOME is required for notes links path")?;
    Ok(config.join(DEFAULT_NOTES_LINKS))
}

fn notes_inline_count(
    project_id: &str,
    _config: &LocalConfig,
    linked_scopes: &[Value],
) -> Result<(&'static str, usize), String> {
    let profile_path = notes_profile_path()?;
    let links_path = notes_links_path()?;
    let Some(profile_bytes) = read_optional_notes_input(&profile_path, "notes profile")? else {
        return Ok(("needs_input", 0));
    };
    let Some(links_bytes) = read_optional_notes_input(&links_path, "notes links")? else {
        return Ok(("needs_input", 0));
    };
    let profile: NotesProfile = serde_json::from_slice(&profile_bytes)
        .map_err(|e| format!("invalid notes profile {}: {e}", profile_path.display()))?;
    let destinations = validate_notes_profile(&profile)?;
    let links_profile: NotesLinksProfile = serde_json::from_slice(&links_bytes)
        .map_err(|e| format!("invalid notes links {}: {e}", links_path.display()))?;
    validate_notes_links(&links_profile, &destinations)?;
    let mut scope_ids = BTreeSet::new();
    scope_ids.insert(project_id.to_owned());
    for linked in linked_scopes {
        if let Some(scope_id) = linked.get("scope_id").and_then(Value::as_str) {
            scope_ids.insert(scope_id.to_owned());
        }
    }
    let mut count = 0usize;
    for scope_id in scope_ids {
        if let Some(links) = links_profile.links.get(&scope_id) {
            for link in links {
                let root = destinations.get(&link.destination_id).ok_or_else(|| {
                    format!("notes link for {scope_id} names unknown destination")
                })?;
                let mut records = Vec::new();
                let mut seen = BTreeSet::new();
                let mut scanned_entries = 0usize;
                for prefix in &link.safe_relative_path_prefixes {
                    let start = root.join(safe_note_relative(prefix)?);
                    scan_notes(
                        &root,
                        &start,
                        &scope_id,
                        "summary_count",
                        &link.destination_id,
                        &mut records,
                        &mut seen,
                        &mut scanned_entries,
                    )?;
                }
                count += records.len();
            }
        }
    }
    Ok(("ready", count))
}

fn validate_notes_profile(profile: &NotesProfile) -> Result<BTreeMap<String, PathBuf>, String> {
    if profile.schema_version != 1 {
        return Err("unsupported notes profile schema_version".into());
    }
    if profile.destinations.is_empty() {
        return Err("notes profile destinations must not be empty".into());
    }
    let mut destinations = BTreeMap::new();
    let mut default_count = 0usize;
    for destination in &profile.destinations {
        validate_safe_id(&destination.id, "destination id")?;
        let root = safe_notes_root(&destination.root)?;
        if let Some(purpose) = &destination.purpose {
            display_safe("notes destination purpose", purpose)?;
        }
        if destination.default == Some(true) {
            default_count += 1;
        }
        if let Some(trim) = destination.trim.as_deref()
            && !matches!(trim, "low" | "medium" | "high")
        {
            return Err("notes destination trim must be low, medium, or high".into());
        }
        if let Some(signals) = &destination.routing_signals {
            let mut seen = BTreeSet::new();
            for signal in signals {
                display_safe("notes destination routing signal", signal)?;
                if !seen.insert(signal) {
                    return Err(
                        "notes destination routing signals must not contain duplicates".into(),
                    );
                }
            }
        }
        if let Some(excluded_paths) = &destination.excluded_paths {
            let mut seen = BTreeSet::new();
            for excluded in excluded_paths {
                let relative = safe_note_relative(excluded)?;
                if !seen.insert(relative.clone()) {
                    return Err(
                        "notes destination excluded paths must not contain duplicates".into(),
                    );
                }
                let excluded_path = root.join(relative);
                reject_symlink_chain(&excluded_path, "notes excluded path")
                    .map_err(|_| "notes excluded path has a symlinked ancestor".to_owned())?;
                if excluded_path.exists() {
                    let canonical = excluded_path
                        .canonicalize()
                        .map_err(|error| format!("cannot resolve notes excluded path: {error}"))?;
                    if !canonical.starts_with(&root) {
                        return Err("notes excluded path escapes destination root".into());
                    }
                }
            }
        }
        if destinations.insert(destination.id.clone(), root).is_some() {
            return Err(format!(
                "duplicate notes destination id: {}",
                destination.id
            ));
        }
    }
    if default_count > 1 {
        return Err("notes profile must not declare more than one default destination".into());
    }
    Ok(destinations)
}

fn validate_notes_links(
    links_profile: &NotesLinksProfile,
    destinations: &BTreeMap<String, PathBuf>,
) -> Result<(), String> {
    if links_profile.schema_version != 1 {
        return Err("unsupported notes links schema_version".into());
    }
    for (scope_id, links) in &links_profile.links {
        validate_safe_id(scope_id, "scope id")?;
        if links.is_empty() {
            return Err(format!("notes links for {scope_id} must not be empty"));
        }
        for link in links {
            validate_safe_id(&link.destination_id, "destination id")?;
            if !destinations.contains_key(&link.destination_id) {
                return Err(format!(
                    "notes link for {scope_id} names unknown destination"
                ));
            }
            if link.safe_relative_path_prefixes.is_empty() {
                return Err(format!("notes link for {scope_id} has no safe prefixes"));
            }
            for prefix in &link.safe_relative_path_prefixes {
                let _ = safe_note_relative(prefix)?;
            }
        }
    }
    Ok(())
}

fn validate_safe_id(value: &str, label: &str) -> Result<(), String> {
    if value.is_empty()
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err(format!("invalid {label}: {value}"));
    }
    Ok(())
}

fn safe_notes_root(root: &str) -> Result<PathBuf, String> {
    let path = Path::new(root);
    if !path.is_absolute() || path.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err("notes destination root must be absolute without parent traversal".into());
    }
    reject_symlink_chain(path, "notes destination root")
        .map_err(|_| "notes destination root has a symlinked ancestor".to_owned())?;
    let meta = fs::symlink_metadata(path)
        .map_err(|e| format!("cannot inspect notes destination root: {e}"))?;
    if meta.file_type().is_symlink() || !meta.is_dir() {
        return Err("notes destination root must be a real directory".into());
    }
    path.canonicalize()
        .map_err(|e| format!("cannot resolve notes destination root: {e}"))
}

fn safe_note_relative(value: &str) -> Result<PathBuf, String> {
    let path = Path::new(value);
    if value.is_empty() || path.is_absolute() {
        return Err("notes prefix/path must be safe relative".into());
    }
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => out.push(part),
            _ => {
                return Err(
                    "notes prefix/path must not contain '.', '..', roots, or prefixes".into(),
                );
            }
        }
    }
    Ok(out)
}

fn scan_notes(
    root: &Path,
    start: &Path,
    scope_id: &str,
    relationship: &str,
    destination_id: &str,
    records: &mut Vec<Value>,
    seen: &mut BTreeSet<String>,
    scanned_entries: &mut usize,
) -> Result<(), String> {
    *scanned_entries += 1;
    if *scanned_entries > MAX_SCAN_ENTRIES {
        return Err(format!(
            "notes scan exceeded entry ceiling of {MAX_SCAN_ENTRIES}"
        ));
    }
    let start = contain_notes_path(root, start)?;
    if start.is_file() {
        maybe_add_note(
            root,
            &start,
            scope_id,
            relationship,
            destination_id,
            records,
            seen,
        )?;
        return Ok(());
    }
    if !start.is_dir() {
        return Ok(());
    }
    for entry in
        fs::read_dir(&start).map_err(|e| format!("cannot read mapped notes directory: {e}"))?
    {
        let entry = entry.map_err(|e| format!("cannot inspect notes entry: {e}"))?;
        let path = entry.path();
        let meta = fs::symlink_metadata(&path)
            .map_err(|e| format!("cannot inspect mapped notes path: {e}"))?;
        if meta.file_type().is_symlink() {
            return Err("mapped notes path is a symlink".into());
        }
        *scanned_entries += 1;
        if *scanned_entries > MAX_SCAN_ENTRIES {
            return Err(format!(
                "notes scan exceeded entry ceiling of {MAX_SCAN_ENTRIES}"
            ));
        }
        if meta.is_dir() {
            scan_notes(
                root,
                &path,
                scope_id,
                relationship,
                destination_id,
                records,
                seen,
                scanned_entries,
            )?;
        } else if meta.is_file() {
            maybe_add_note(
                root,
                &path,
                scope_id,
                relationship,
                destination_id,
                records,
                seen,
            )?;
        }
    }
    Ok(())
}

fn contain_notes_path(root: &Path, path: &Path) -> Result<PathBuf, String> {
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("cannot resolve mapped notes path: {e}"))?;
    if !canonical.starts_with(root) {
        return Err("mapped notes path escapes destination root".into());
    }
    Ok(canonical)
}

fn maybe_add_note(
    root: &Path,
    path: &Path,
    scope_id: &str,
    relationship: &str,
    destination_id: &str,
    records: &mut Vec<Value>,
    seen: &mut BTreeSet<String>,
) -> Result<(), String> {
    if path.extension().and_then(|v| v.to_str()) != Some("md") {
        return Ok(());
    }
    let path = contain_notes_path(root, path)?;
    let relative = path
        .strip_prefix(root)
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .replace('\\', "/");
    let key = format!("{scope_id}\0{destination_id}\0{relative}");
    if !seen.insert(key) {
        return Ok(());
    }
    let mtime = fs::metadata(&path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs());
    records.push(serde_json::json!({
        "scope_id": scope_id, "relationship": relationship, "source_scope": scope_id,
        "destination_id": destination_id, "path": relative,
        "sha256": Value::Null, "mtime": mtime,
        "labels": ["device_local", "advisory_only"], "accepted": false, "trust_transfer": false
    }));
    Ok(())
}

fn streaming_sha256_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|e| format!("cannot open mapped note: {e}"))?;
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|e| format!("cannot hash mapped note: {e}"))?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn parse_limit_offset(args: &[String], default_limit: usize) -> Result<(usize, usize), String> {
    let mut limit = default_limit;
    let mut offset = 0usize;
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--limit" => {
                i += 1;
                let value = args.get(i).ok_or("--limit requires a value")?;
                limit = value
                    .parse::<usize>()
                    .map_err(|_| "--limit must be a non-negative integer".to_owned())?;
                if limit == 0 || limit > 100 {
                    return Err("--limit must be between 1 and 100".into());
                }
            }
            "--offset" => {
                i += 1;
                let value = args.get(i).ok_or("--offset requires a value")?;
                offset = value
                    .parse::<usize>()
                    .map_err(|_| "--offset must be a non-negative integer".to_owned())?;
            }
            other => return Err(format!("unknown project linked-scopes option: {other}")),
        }
        i += 1;
    }
    Ok((limit, offset))
}

fn configured_owner(config: &LocalConfig) -> &str {
    config
        .configured_owner
        .as_deref()
        .unwrap_or(&config.approval.owner)
}

fn adapter_registry_path() -> Result<PathBuf, String> {
    let base = env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")))
        .ok_or("HOME or XDG_CONFIG_HOME is required")?;
    Ok(base.join("mozak/adapters.json"))
}

fn binding_current_view(binding: &mozak_core::adapter::AdapterBinding) -> Result<Value, String> {
    let drifted = drifted_adapter_pins(binding);
    let callable = drifted.is_empty();
    if !callable {
        return Ok(serde_json::json!({
            "binding_id": binding.id,
            "adapter": binding.adapter,
            "target_scope_id": binding.target_scope_id,
            "runs_dir": binding.runs_dir,
            "latest_recorded": Value::Null,
            "latest_observed": Value::Null,
            "accepted": false,
            "freshness": "needs_recheck",
            "state": "needs_recheck",
            "callable": false,
            "drifted": drifted,
            "stale_run_count": 0,
            "authority": "owner_configured_needs_recheck"
        }));
    }
    let runs = validated_runs_in(Path::new(&binding.runs_dir))?;
    let newest = runs.iter().find(|(_, _, stale)| !*stale);
    Ok(serde_json::json!({
        "binding_id": binding.id,
        "adapter": binding.adapter,
        "target_scope_id": binding.target_scope_id,
        "runs_dir": binding.runs_dir,
        "latest_recorded": newest.map(|(_, run, _)| run.created_at.clone()),
        "latest_observed": newest.and_then(|(path, _, _)| path.metadata().ok()).and_then(|m| m.modified().ok()).and_then(system_time_text),
        "accepted": false,
        "freshness": if newest.is_some() {"current"} else {"not_observed"},
        "state": "ready",
        "callable": true,
        "drifted": [],
        "stale_run_count": runs.iter().filter(|(_, _, stale)| *stale).count(),
        "authority": "owner_configured_callable"
    }))
}

fn adapter_binding_callable(binding: &mozak_core::adapter::AdapterBinding) -> bool {
    drifted_adapter_pins(binding).is_empty()
}

fn drifted_adapter_pins(binding: &mozak_core::adapter::AdapterBinding) -> Vec<Value> {
    [
        ("request", &binding.request_path, &binding.request_sha256),
        ("runner", &binding.runner_path, &binding.runner_sha256),
    ]
    .into_iter()
    .filter(|(_, path, expected)| adapter_pin_status(path, expected) != "ready")
    .map(|(label, path, expected)| {
        serde_json::json!({
            "pin": label,
            "path": path,
            "pinned_sha256": expected,
            "observed_sha256": fs::read(path).ok().map(|bytes| hash(&bytes)),
        })
    })
    .collect()
}

fn adapter_pin_status(path: &str, expected: &str) -> &'static str {
    fs::read(path)
        .ok()
        .filter(|bytes| hash(bytes) == expected)
        .map_or("drifted", |_| "ready")
}

fn bounded_values(values: Vec<Value>) -> Value {
    let total = values.len();
    let records = values
        .into_iter()
        .take(CURRENT_SECTION_LIMIT)
        .collect::<Vec<_>>();
    serde_json::json!({
        "records": records,
        "total_count": total,
        "returned_count": records.len(),
        "truncated": total > records.len(),
        "limit": CURRENT_SECTION_LIMIT
    })
}

fn bounded_projection_summary(
    projection: &mozak_core::current_state::CurrentStateProjection,
) -> Result<Value, String> {
    let value = serde_json::to_value(projection).map_err(|e| e.to_string())?;
    let sources = value["sources"].as_array().cloned().unwrap_or_default();
    let nodes = value["nodes"].as_array().cloned().unwrap_or_default();
    let relationships = value["relationships"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let observes = relationships
        .iter()
        .filter(|relationship| relationship["relation"] == "observes")
        .cloned()
        .collect::<Vec<_>>();
    Ok(serde_json::json!({
        "schema_version": projection.schema_version,
        "project_id": projection.project_id,
        "canonical_hash": canonical_hash(projection).map_err(|e| e.to_string())?,
        "mutation": projection.mutation,
        "automatic_promotion": projection.automatic_promotion,
        "counts": {"sources": sources.len(), "nodes": nodes.len(), "relationships": relationships.len()},
        "sources": bounded_values(sources),
        "nodes": bounded_values(nodes),
        "relationships": bounded_values(relationships),
        "observes_relationships": bounded_values(observes),
        "bounded_summary": true
    }))
}

fn validated_runs_in(dir: &Path) -> Result<Vec<(PathBuf, ResearchRun, bool)>, String> {
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let root_metadata = fs::symlink_metadata(dir)
        .map_err(|e| format!("cannot inspect adapter runs_dir {}: {e}", dir.display()))?;
    if root_metadata.file_type().is_symlink() {
        return Err(format!(
            "adapter runs_dir must not be a symlink: {}",
            dir.display()
        ));
    }
    if !root_metadata.is_dir() {
        return Err(format!(
            "adapter runs_dir is not a directory: {}",
            dir.display()
        ));
    }
    let canonical_root = dir.canonicalize().map_err(|e| {
        format!(
            "cannot canonicalize adapter runs_dir {}: {e}",
            dir.display()
        )
    })?;
    let mut candidates = Vec::new();
    let mut inspected = 0usize;
    collect_run_json_candidates(dir, &canonical_root, dir, &mut candidates, &mut inspected)?;
    let mut runs = Vec::new();
    for path in candidates {
        let input = fs::read_to_string(&path)
            .map_err(|e| format!("cannot read research run {}: {e}", path.display()))?;
        let run = validate_run_json(&input)
            .map_err(|e| format!("invalid research run {}: {e}", path.display()))?;
        runs.push((path, run, false));
    }
    runs.sort_by(|a, b| {
        b.1.created_at
            .cmp(&a.1.created_at)
            .then_with(|| b.1.run_id.cmp(&a.1.run_id))
            .then_with(|| a.0.cmp(&b.0))
    });
    for (_, _, stale) in runs.iter_mut().skip(1) {
        *stale = true;
    }
    Ok(runs)
}

fn collect_run_json_candidates(
    root: &Path,
    canonical_root: &Path,
    dir: &Path,
    output: &mut Vec<PathBuf>,
    inspected: &mut usize,
) -> Result<(), String> {
    if output.len() > 512 || *inspected > 512 {
        return Err(format!(
            "too many research run candidates under {}",
            root.display()
        ));
    }
    for entry in
        fs::read_dir(dir).map_err(|e| format!("cannot read runs_dir {}: {e}", dir.display()))?
    {
        *inspected += 1;
        if *inspected > 512 {
            return Err(format!(
                "too many research run candidates under {}",
                root.display()
            ));
        }
        let path = entry.map_err(|e| e.to_string())?.path();
        let metadata = fs::symlink_metadata(&path)
            .map_err(|e| format!("cannot inspect run candidate {}: {e}", path.display()))?;
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "adapter runs_dir contains symlinked entry: {}",
                path.display()
            ));
        }
        let canonical_path = path
            .canonicalize()
            .map_err(|e| format!("cannot canonicalize run candidate {}: {e}", path.display()))?;
        if !canonical_path.starts_with(canonical_root) {
            return Err(format!(
                "adapter runs_dir candidate escapes configured root: {}",
                path.display()
            ));
        }
        if metadata.is_dir() {
            collect_run_json_candidates(root, canonical_root, &path, output, inspected)?;
        } else if metadata.is_file()
            && (path.file_name().and_then(|v| v.to_str()) == Some("run.json")
                || (dir == root && path.extension().and_then(|v| v.to_str()) == Some("json")))
        {
            output.push(path);
        }
    }
    Ok(())
}

fn system_time_text(value: SystemTime) -> Option<String> {
    let seconds = value.duration_since(UNIX_EPOCH).ok()?.as_secs();
    Some(format!("unix:{seconds}"))
}

fn history_root(config_path: &Path) -> Result<PathBuf, String> {
    Ok(config_path
        .parent()
        .ok_or("config path has no parent")?
        .join("refresh-history"))
}

fn generation_path(config_path: &Path, digest: &str) -> Result<PathBuf, String> {
    Ok(history_root(config_path)?
        .join("generations")
        .join(format!("{digest}.json")))
}

fn manifest_snapshot_path(
    config_path: &Path,
    config_digest: &str,
    project_id: &str,
) -> Result<PathBuf, String> {
    Ok(history_root(config_path)?
        .join("manifests")
        .join(format!("{config_digest}.{project_id}.yml")))
}

fn atomic_create_verified(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("history path has no parent")?;
    fs::create_dir_all(parent).map_err(|e| format!("cannot create refresh history: {e}"))?;
    reject_symlink_chain(parent, "refresh history")?;
    match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
    {
        Ok(mut file) => {
            file.write_all(bytes).map_err(|e| e.to_string())?;
            file.sync_all().map_err(|e| e.to_string())?;
            fs::File::open(parent)
                .and_then(|dir| dir.sync_all())
                .map_err(|e| format!("cannot sync refresh history directory: {e}"))
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            ensure_regular_no_symlink(path, "refresh history artifact")?;
            let existing = fs::read(path).map_err(|e| e.to_string())?;
            if existing == bytes {
                Ok(())
            } else {
                Err(format!(
                    "refresh history artifact collision: {}",
                    path.display()
                ))
            }
        }
        Err(error) => Err(format!("cannot create refresh history artifact: {error}")),
    }
}

fn ensure_generation_snapshot(
    config_path: &Path,
    config_bytes: &[u8],
    config: &LocalConfig,
) -> Result<(), String> {
    let digest = hash(config_bytes);
    atomic_create_verified(&generation_path(config_path, &digest)?, config_bytes)?;
    for record in config.projects.values() {
        let Ok(manifest) = fs::read(&record.manifest_path) else {
            continue;
        };
        if hash(&manifest) == record.manifest_sha256 {
            atomic_create_verified(
                &manifest_snapshot_path(config_path, &digest, &record.id)?,
                &manifest,
            )?;
        }
    }
    Ok(())
}

fn read_generation(config_path: &Path, digest: &str) -> Result<Vec<u8>, String> {
    let path = generation_path(config_path, digest)?;
    ensure_regular_no_symlink(&path, "config generation")?;
    let bytes = fs::read(&path).map_err(|e| format!("cannot read config generation: {e}"))?;
    if hash(&bytes) != digest {
        return Err("config generation digest mismatch".into());
    }
    Ok(bytes)
}

fn read_manifest_snapshot(
    config_path: &Path,
    config_digest: &str,
    project_id: &str,
) -> Result<ProjectManifest, String> {
    let path = manifest_snapshot_path(config_path, config_digest, project_id)?;
    ensure_regular_no_symlink(&path, "project manifest snapshot")?;
    let text = fs::read_to_string(&path)
        .map_err(|e| format!("cannot read project manifest snapshot: {e}"))?;
    validate_project_yaml(&text).map_err(|e| format!("invalid project manifest snapshot: {e}"))
}

fn same_manifest_identity_and_authority(old: &ProjectManifest, new: &ProjectManifest) -> bool {
    old.version == new.version
        && old.framework_contract_version == new.framework_contract_version
        && old.project == new.project
        && old.owned_paths == new.owned_paths
}

fn same_record_identity(old: &ProjectRecord, new: &ProjectRecord) -> bool {
    old.id == new.id
        && old.name == new.name
        && old.root == new.root
        && old.manifest_path == new.manifest_path
        && old.idea_path == new.idea_path
}

fn identity_preserving_registration_drift(
    config_path: &Path,
    config_bytes: &[u8],
    old: &ProjectRecord,
    new: &ProjectRecord,
) -> Result<bool, String> {
    if !same_record_identity(old, new) {
        return Ok(false);
    }
    if old.manifest_sha256 == new.manifest_sha256 {
        return Ok(true);
    }
    let Ok(old_manifest) = read_manifest_snapshot(config_path, &hash(config_bytes), &old.id) else {
        return Ok(false);
    };
    let new_text = fs::read_to_string(&new.manifest_path)
        .map_err(|e| format!("cannot read live project manifest: {e}"))?;
    let new_manifest = validate_project_yaml(&new_text)
        .map_err(|e| format!("invalid live project manifest: {e}"))?;
    Ok(same_manifest_identity_and_authority(
        &old_manifest,
        &new_manifest,
    ))
}

fn require_identity_preserving_config_change(
    old: &LocalConfig,
    new: &LocalConfig,
) -> Result<(), String> {
    if old.kb_root != new.kb_root
        || old.kb_sha256 != new.kb_sha256
        || old.configured_owner != new.configured_owner
        || old.projects.keys().ne(new.projects.keys())
    {
        return Err("rollback would change configured identity, project membership, roots, or KB; explicit approval is required".into());
    }
    for (id, old_record) in &old.projects {
        let new_record = new.projects.get(id).expect("matching project keys");
        if !same_record_identity(old_record, new_record) {
            return Err(
                "rollback would change project identity or root; explicit approval is required"
                    .into(),
            );
        }
    }
    Ok(())
}

fn single_changed_project(old: &LocalConfig, new: &LocalConfig) -> Result<String, String> {
    let changed = old
        .projects
        .iter()
        .filter(|(id, record)| new.projects.get(*id) != Some(*record))
        .map(|(id, _)| id.clone())
        .collect::<Vec<_>>();
    match changed.as_slice() {
        [id] => Ok(id.clone()),
        _ => Err(
            "rollback must restore exactly one identity-preserving project registration generation"
                .into(),
        ),
    }
}

fn make_audit_entry(
    actor: &str,
    reason: &str,
    old_config_sha256: &str,
    new_config_sha256: &str,
    old_manifest_sha256: &str,
    new_manifest_sha256: &str,
) -> Result<RefreshAuditEntry, String> {
    let at = utc_timestamp();
    let digest = RefreshAuditDigest {
        schema_version: 1,
        actor,
        at: &at,
        reason,
        old_config_sha256,
        new_config_sha256,
        old_manifest_sha256,
        new_manifest_sha256,
    };
    let entry_sha256 = hash(&serde_json::to_vec(&digest).map_err(|e| e.to_string())?);
    Ok(RefreshAuditEntry {
        schema_version: 1,
        actor: actor.to_owned(),
        at,
        reason: reason.to_owned(),
        old_config_sha256: old_config_sha256.to_owned(),
        new_config_sha256: new_config_sha256.to_owned(),
        old_manifest_sha256: old_manifest_sha256.to_owned(),
        new_manifest_sha256: new_manifest_sha256.to_owned(),
        entry_sha256,
    })
}

fn validate_audit_entry(entry: &RefreshAuditEntry) -> Result<(), String> {
    let digest = RefreshAuditDigest {
        schema_version: entry.schema_version,
        actor: &entry.actor,
        at: &entry.at,
        reason: &entry.reason,
        old_config_sha256: &entry.old_config_sha256,
        new_config_sha256: &entry.new_config_sha256,
        old_manifest_sha256: &entry.old_manifest_sha256,
        new_manifest_sha256: &entry.new_manifest_sha256,
    };
    if entry.schema_version != 1
        || !canonical_utc(&entry.at)
        || hash(&serde_json::to_vec(&digest).map_err(|e| e.to_string())?) != entry.entry_sha256
    {
        return Err("invalid or tampered refresh audit entry".into());
    }
    display_safe("refresh audit actor", &entry.actor)?;
    display_safe("refresh audit reason", &entry.reason)?;
    for value in [
        &entry.old_config_sha256,
        &entry.new_config_sha256,
        &entry.old_manifest_sha256,
        &entry.new_manifest_sha256,
        &entry.entry_sha256,
    ] {
        validate_lower_hex("refresh audit digest", value, 64)?;
    }
    Ok(())
}

fn persist_audit_entry(config_path: &Path, entry: &RefreshAuditEntry) -> Result<(), String> {
    validate_audit_entry(entry)?;
    let path = history_root(config_path)?
        .join("entries")
        .join(format!("{}.json", entry.entry_sha256));
    let bytes = serde_json::to_vec(entry).map_err(|e| e.to_string())?;
    atomic_create_verified(&path, &bytes)
}

fn load_refresh_history(config_path: &Path) -> Result<Vec<RefreshAuditEntry>, String> {
    let directory = history_root(config_path)?.join("entries");
    if !directory.exists() {
        return Ok(Vec::new());
    }
    reject_symlink_chain(&directory, "refresh history")?;
    let mut entries = Vec::new();
    for item in fs::read_dir(&directory).map_err(|e| format!("cannot read refresh history: {e}"))? {
        let path = item.map_err(|e| e.to_string())?.path();
        ensure_regular_no_symlink(&path, "refresh audit entry")?;
        let entry: RefreshAuditEntry = strict_json_file(&path, "refresh audit entry")?;
        validate_audit_entry(&entry)?;
        if path.file_name().and_then(|v| v.to_str())
            != Some(&format!("{}.json", entry.entry_sha256))
        {
            return Err("refresh audit entry filename digest mismatch".into());
        }
        let old = read_generation(config_path, &entry.old_config_sha256)?;
        let new = read_generation(config_path, &entry.new_config_sha256)?;
        if hash(&old) != entry.old_config_sha256 || hash(&new) != entry.new_config_sha256 {
            return Err("refresh audit references a tampered config generation".into());
        }
        entries.push(entry);
    }
    entries.sort_by(|a, b| {
        a.at.cmp(&b.at)
            .then_with(|| a.entry_sha256.cmp(&b.entry_sha256))
    });
    Ok(entries)
}

fn utc_timestamp() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs());
    let days = seconds / 86_400;
    let time = seconds % 86_400;
    let (year, month, day) = civil_from_days(i64::try_from(days).unwrap_or(0));
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        time / 3600,
        (time % 3600) / 60,
        time % 60
    )
}

#[allow(clippy::many_single_char_names)]
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    let year = y + i64::from(month <= 2);
    (
        year,
        u32::try_from(month).unwrap_or(1),
        u32::try_from(day).unwrap_or(1),
    )
}

fn print_context_human(output: &Value) -> Result<(), String> {
    let project = output
        .get("project")
        .and_then(Value::as_object)
        .ok_or("invalid context output")?;
    println!("MOZAK project context");
    println!(
        "- state: {}",
        output
            .get("state")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
    );
    println!(
        "- project: {} ({})",
        project.get("name").and_then(Value::as_str).unwrap_or(""),
        project.get("id").and_then(Value::as_str).unwrap_or("")
    );
    println!(
        "- root: {}",
        project.get("root").and_then(Value::as_str).unwrap_or("")
    );
    println!(
        "- configured owner: {}",
        output
            .get("configured_owner")
            .and_then(Value::as_str)
            .unwrap_or("")
    );
    if let Some(kb) = output.get("kb").and_then(Value::as_object) {
        println!(
            "- KB: {} drift={}",
            kb.get("root").and_then(Value::as_str).unwrap_or(""),
            kb.get("drift").and_then(Value::as_bool).unwrap_or(true)
        );
    }
    if let Some(compaction) = output
        .get("workflow")
        .and_then(|workflow| workflow.get("compaction"))
        .and_then(Value::as_object)
    {
        let count = compaction
            .get("compactable_count")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        println!(
            "- compaction recommendation: compactable_artifacts={} approval_required={}",
            count,
            compaction
                .get("apply_requires_approval")
                .and_then(Value::as_bool)
                .unwrap_or(true)
        );
    }
    if let Some(actions) = output.get("next_actions").and_then(Value::as_array) {
        println!("Next actions:");
        for (index, action) in actions.iter().take(5).filter_map(Value::as_str).enumerate() {
            println!("{}. {action}", index + 1);
        }
    }
    Ok(())
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

pub(crate) fn setup_config(owner: &str, kb_root: &Path) -> Result<Value, String> {
    display_safe("setup owner", owner)?;
    let kb = load_registry(kb_root).map_err(|error| format!("invalid setup KB: {error}"))?;
    let target = default_config_path()?;
    validate_target_path(&target)?;
    let config = LocalConfig {
        schema_version: SCHEMA_VERSION,
        configured_owner: Some(owner.to_owned()),
        kb_root: path_text(&kb.registry_root)?,
        kb_sha256: kb.registry_sha256.clone(),
        projects: BTreeMap::new(),
        approval: ConfigApproval {
            proposal_digest: "0".repeat(64),
            owner: owner.to_owned(),
            approved_at: "1970-01-01T00:00:00Z".to_owned(),
            rationale: "Installation-time default KB registry configuration".to_owned(),
        },
    };
    validate_local_config(&config)?;
    let bytes = serde_json::to_vec(&config).map_err(|e| e.to_string())?;
    let status = match read_optional_regular(&target)? {
        None => {
            atomic_install_absent(&target, &bytes, None)?;
            "created"
        }
        Some(existing) if existing == bytes => "unchanged",
        Some(existing) => {
            let existing_config: LocalConfig = serde_json::from_slice(&existing)
                .map_err(|e| format!("invalid existing local config {}: {e}", target.display()))?;
            validate_local_config(&existing_config)?;
            return Err(format!(
                "local config already exists with different content: {}; refusing to overwrite",
                target.display()
            ));
        }
    };
    Ok(serde_json::json!({
        "status": status,
        "path": path_text(&target)?,
        "owner": owner,
        "kb_root": path_text(&kb.registry_root)?,
        "kb_sha256": kb.registry_sha256,
        "config_sha256": hash(&bytes),
    }))
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

fn knowledge_linked_scopes(
    kb: &mozak_core::kb::ValidatedKb,
    project_id: &str,
) -> Result<Vec<serde_json::Value>, String> {
    let mut records = Vec::new();
    let mut seen = BTreeSet::new();
    for entry in &kb.entries {
        let project_scope_ids = entry
            .scopes
            .manifest
            .scopes
            .iter()
            .filter(|scope| {
                scope
                    .project
                    .as_ref()
                    .is_some_and(|binding| binding.project_id == project_id)
            })
            .map(|scope| scope.id.clone())
            .collect::<BTreeSet<_>>();
        if project_scope_ids.is_empty() {
            continue;
        }
        let scopes_by_id = entry
            .scopes
            .manifest
            .scopes
            .iter()
            .map(|scope| (scope.id.as_str(), scope))
            .collect::<BTreeMap<_, _>>();

        for promotion in &entry.scopes.manifest.promotions {
            if project_scope_ids.contains(&promotion.target_project_id) {
                add_linked_scope_record(
                    &mut records,
                    &mut seen,
                    entry,
                    scopes_by_id
                        .get(promotion.source_topic_id.as_str())
                        .copied(),
                    "promotion_source",
                    "promotion",
                    &promotion.id,
                )?;
            }
        }

        for goal in &entry.scopes.manifest.meta_goals {
            if goal
                .scope_ids
                .iter()
                .any(|scope_id| project_scope_ids.contains(scope_id))
            {
                for scope_id in &goal.scope_ids {
                    if !project_scope_ids.contains(scope_id) {
                        add_linked_scope_record(
                            &mut records,
                            &mut seen,
                            entry,
                            scopes_by_id.get(scope_id.as_str()).copied(),
                            "shared_meta_goal",
                            "meta_goal",
                            &goal.id,
                        )?;
                    }
                }
                for relationship in &goal.relationships {
                    let label = format!("meta_goal_{}", relationship.kind);
                    let via_id = format!("{}->{}", goal.id, relationship.to_goal_id);
                    for target_goal in &entry.scopes.manifest.meta_goals {
                        if target_goal.id == relationship.to_goal_id {
                            for scope_id in &target_goal.scope_ids {
                                if !project_scope_ids.contains(scope_id) {
                                    add_linked_scope_record(
                                        &mut records,
                                        &mut seen,
                                        entry,
                                        scopes_by_id.get(scope_id.as_str()).copied(),
                                        &label,
                                        "meta_goal_relationship",
                                        &via_id,
                                    )?;
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    records.sort_by_key(|record| {
        (
            record["registration_id"]
                .as_str()
                .unwrap_or_default()
                .to_owned(),
            record["scope_id"].as_str().unwrap_or_default().to_owned(),
            record["relationship"]
                .as_str()
                .unwrap_or_default()
                .to_owned(),
            record["via"]["type"]
                .as_str()
                .unwrap_or_default()
                .to_owned(),
            record["via"]["id"].as_str().unwrap_or_default().to_owned(),
        )
    });
    Ok(records)
}

fn add_linked_scope_record(
    records: &mut Vec<serde_json::Value>,
    seen: &mut BTreeSet<(String, String, String, String, String)>,
    entry: &mozak_core::kb::RegisteredScopes,
    scope: Option<&mozak_core::scope::Scope>,
    relationship: &str,
    via_type: &str,
    via_id: &str,
) -> Result<(), String> {
    let Some(scope) = scope else {
        return Ok(());
    };
    let key = (
        entry.registration.id.clone(),
        scope.id.clone(),
        relationship.to_owned(),
        via_type.to_owned(),
        via_id.to_owned(),
    );
    if !seen.insert(key) {
        return Ok(());
    }
    records.push(serde_json::json!({
        "registration_id": entry.registration.id,
        "scope_id": scope.id,
        "kind": scope.kind,
        "title": scope.title,
        "root": path_text(&entry.root)?,
        "relationship": relationship,
        "via": {"type": via_type, "id": via_id},
        "authority": "advisory_only",
        "accepted": false,
        "trust_transfer": false
    }));
    Ok(())
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
    if let Some(owner) = &config.configured_owner {
        display_safe("configured owner", owner)?;
    }
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

fn read_optional_notes_input(path: &Path, label: &str) -> Result<Option<Vec<u8>>, String> {
    reject_symlink_chain(path, label).map_err(|_| format!("{label} has a symlinked ancestor"))?;
    read_optional_regular(path)
}

fn atomic_create_output(path: &Path, bytes: &[u8]) -> Result<(), String> {
    reject_unsafe_lexical(path)?;
    let parent = path.parent().ok_or("output path has no parent")?;
    validate_target_path(path)?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("cannot create output directory: {error}"))?;
    validate_target_path(path)?;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| format!("cannot create output file: {error}"))?;
    let result = (|| {
        file.write_all(bytes).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        let readback =
            fs::read(path).map_err(|error| format!("cannot read back output: {error}"))?;
        if readback != bytes {
            return Err("output readback did not match written bytes".into());
        }
        fs::File::open(parent)
            .and_then(|directory| directory.sync_all())
            .map_err(|error| format!("cannot sync output directory: {error}"))
    })();
    if result.is_err() {
        let _ = fs::remove_file(path);
    }
    result
}

fn atomic_write_notes_links<F>(
    path: &Path,
    bytes: &[u8],
    base: &NotesLinksPin,
    revalidate_live_state: F,
) -> Result<(), String>
where
    F: FnOnce() -> Result<(), String>,
{
    validate_notes_links_pin(base)?;
    validate_target_path(path)?;
    let parent = path.parent().ok_or("notes links path has no parent")?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("cannot create Notes config directory: {error}"))?;
    validate_target_path(path)?;
    let lock = parent.join(".mozak-links.json.lock");
    let lock_file = (0..200)
        .find_map(|_| {
            match fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&lock)
            {
                Ok(file) => Some(Ok(file)),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                    std::thread::sleep(std::time::Duration::from_millis(10));
                    None
                }
                Err(error) => Some(Err(error)),
            }
        })
        .unwrap_or_else(|| {
            Err(std::io::Error::new(
                std::io::ErrorKind::WouldBlock,
                "timed out waiting for existing Notes onboarding transaction",
            ))
        })
        .map_err(|error| format!("cannot acquire exclusive Notes links lock: {error}"))?;
    let result = (|| {
        validate_target_path(path)?;
        let original = read_optional_regular(path)?;
        if notes_links_pin(original.as_deref()) != *base {
            return Err("stale Notes links base during atomic apply".into());
        }
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| error.to_string())?
            .as_nanos();
        let temp = parent.join(format!(
            ".mozak-links.json.{}.{}.tmp",
            std::process::id(),
            nonce
        ));
        let backup = parent.join(format!(
            ".mozak-links.json.{}.{}.bak",
            std::process::id(),
            nonce
        ));
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|error| format!("cannot create temporary Notes links: {error}"))?;
        let written = (|| {
            file.write_all(bytes).map_err(|error| error.to_string())?;
            file.sync_all().map_err(|error| error.to_string())?;
            if fs::read(&temp).map_err(|error| error.to_string())? != bytes {
                return Err("temporary Notes links readback mismatch".into());
            }
            revalidate_live_state()?;
            if notes_links_pin(read_optional_regular(path)?.as_deref()) != *base {
                return Err("stale Notes links base during atomic apply".into());
            }
            if original.is_some() {
                fs::hard_link(path, &backup)
                    .map_err(|error| format!("cannot preserve previous Notes links: {error}"))?;
                fs::rename(&temp, path)
                    .map_err(|error| format!("cannot atomically replace Notes links: {error}"))?;
            } else {
                fs::hard_link(&temp, path).map_err(|error| {
                    format!("cannot atomically install absent Notes links: {error}")
                })?;
            }
            if fs::read(path).map_err(|error| error.to_string())? != bytes {
                return Err("Notes links readback mismatch".into());
            }
            fs::File::open(parent)
                .and_then(|directory| directory.sync_all())
                .map_err(|error| format!("cannot sync Notes config directory: {error}"))?;
            Ok(())
        })();
        if written.is_err() {
            let _ = fs::remove_file(&temp);
            if backup.exists() {
                let _ = fs::remove_file(path);
                let _ = fs::rename(&backup, path);
                let _ = fs::File::open(parent).and_then(|directory| directory.sync_all());
            } else if original.is_none() {
                let _ = fs::remove_file(path);
                let _ = fs::File::open(parent).and_then(|directory| directory.sync_all());
            }
        } else {
            let _ = fs::remove_file(&temp);
            let _ = fs::remove_file(&backup);
            let _ = fs::File::open(parent).and_then(|directory| directory.sync_all());
        }
        written
    })();
    finish_notes_lock(result, lock_file, &lock)
}

fn finish_notes_lock(
    transaction: Result<(), String>,
    lock_file: fs::File,
    lock: &Path,
) -> Result<(), String> {
    drop(lock_file);
    let _ = fs::remove_file(lock);
    transaction
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

fn atomic_replace_exact(
    path: &Path,
    bytes: &[u8],
    base: &str,
    audit: Option<&RefreshAuditEntry>,
) -> Result<(), String> {
    validate_target_path(path)?;
    let parent = path.parent().ok_or("config path has no parent")?;
    let lock = parent.join(".config.json.refresh.lock");
    let lock_file = (0..200)
        .find_map(|_| {
            match fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&lock)
            {
                Ok(file) => Some(Ok(file)),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                    std::thread::sleep(std::time::Duration::from_millis(10));
                    None
                }
                Err(error) => Some(Err(error)),
            }
        })
        .unwrap_or_else(|| {
            Err(std::io::Error::new(
                std::io::ErrorKind::WouldBlock,
                "timed out waiting for existing refresh transaction",
            ))
        })
        .map_err(|e| format!("cannot acquire exclusive config refresh lock: {e}"))?;
    let result = (|| {
        validate_target_path(path)?;
        let live = read_optional_regular(path)?.ok_or("local config disappeared during refresh")?;
        if hash(&live) != base {
            return Err("stale config base during atomic refresh".into());
        }
        let old_config: LocalConfig = serde_json::from_slice(&live)
            .map_err(|e| format!("invalid existing local config during refresh: {e}"))?;
        let new_config: LocalConfig = serde_json::from_slice(bytes)
            .map_err(|e| format!("invalid replacement local config during refresh: {e}"))?;
        validate_local_config(&old_config)?;
        validate_local_config(&new_config)?;
        ensure_generation_snapshot(path, &live, &old_config)?;
        ensure_generation_snapshot(path, bytes, &new_config)?;
        if let Some(entry) = audit {
            if entry.old_config_sha256 != base || entry.new_config_sha256 != hash(bytes) {
                return Err("refresh audit entry does not pin the CAS config digests".into());
            }
            persist_audit_entry(path, entry)?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(unix)]
    fn notes_committed_transaction_ignores_unlock_cleanup_failure() {
        let root = env::temp_dir().join(format!(
            "mozak-notes-unlock-cleanup-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        let lock = root.join("lock");
        let lock_file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&lock)
            .unwrap();
        fs::remove_file(&lock).unwrap();
        fs::create_dir(&lock).unwrap();
        assert!(finish_notes_lock(Ok(()), lock_file, &lock).is_ok());
        fs::remove_dir_all(root).unwrap();
    }
}
fn shell_path(path: &Path) -> String {
    shell_arg(&path.to_string_lossy())
}

fn shell_arg(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}
