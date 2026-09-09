use mozak_core::project_contract::validate_project_yaml;
use mozak_core::scope::{
    ValidatedScopes, check_source, ingest_links, load_scopes, markdown_export,
};
use serde::Serialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    env,
    fmt::Write as _,
    fs,
    io::Write,
    path::Path,
    process::{Command, ExitCode, Stdio},
};

const MANIFEST: &str = "scope.json";

#[derive(Serialize)]
struct Validation<'a> {
    schema_version: u64,
    command: &'static str,
    validity: &'static str,
    freshness_checked: bool,
    scope_root: &'a str,
    scope_count: usize,
    promotion_count: usize,
    meta_goal_count: usize,
    input_count: usize,
    concept_count: usize,
}

pub fn run(command: &str, root: &Path) -> Result<ExitCode, String> {
    let scopes = load_scopes(root).map_err(|e| e.to_string())?;
    match command {
        "validate" => validate(&scopes),
        "list" => {
            print!("{}", render_list(&scopes));
            Ok(ExitCode::SUCCESS)
        }
        "graph-source" => {
            print!("{}", mermaid(&scopes));
            Ok(ExitCode::SUCCESS)
        }
        "graph" => graph(&scopes),
        "export" => {
            print!("{}", markdown_export(&scopes));
            Ok(ExitCode::SUCCESS)
        }
        _ => Err(crate::usage()),
    }
}
/// Creates a new Topic Scope root from a validated template.
///
/// The route is create-only: it never writes into an existing Scope root and
/// never infers a title or intent. The owner supplies both, so the Scope states
/// its own purpose from the start.
///
/// # Errors
/// Returns an error when a Scope already exists at the root, when the supplied
/// identity or text is invalid, or when the written manifest fails validation.
pub fn init(root: &Path, id: &str, title: &str, intent: &str) -> Result<ExitCode, String> {
    let manifest_path = root.join(MANIFEST);
    if manifest_path.exists() {
        return Err(format!(
            "refusing to overwrite an existing Scope: {}",
            manifest_path.display()
        ));
    }
    fs::create_dir_all(root)
        .map_err(|error| format!("cannot create {}: {error}", root.display()))?;
    let manifest = json!({
        "schema_version": 2,
        "scopes": [topic_entry(id, title, intent)],
        "promotions": [],
        "meta_goals": [],
        "inputs": [],
        "concepts": [],
    });
    commit(
        root,
        &manifest,
        "scope init",
        &json!({ "scope_id": id, "kind": "topic" }),
    )
}

/// Adds another Topic entry to an existing Scope root.
///
/// # Errors
/// Returns an error when the root is missing, the id is already present, or the
/// resulting manifest fails validation.
pub fn add_topic(root: &Path, id: &str, title: &str, intent: &str) -> Result<ExitCode, String> {
    let mut manifest = read_manifest(root)?;
    push_scope(&mut manifest, topic_entry(id, title, intent), id)?;
    commit(
        root,
        &manifest,
        "scope add-topic",
        &json!({ "scope_id": id, "kind": "topic" }),
    )
}

/// Adds a Project entry bound to a real repository.
///
/// The repository stays authoritative. This copies the project manifest into
/// the Scope root, pins its hash, and mirrors the identity, revision, and owned
/// paths the manifest itself declares.
///
/// # Errors
/// Returns an error when the repository has no valid project manifest, when the
/// Scope id does not match the project id, or when validation fails.
pub fn add_project(
    root: &Path,
    id: &str,
    title: &str,
    intent: &str,
    project_root: &Path,
) -> Result<ExitCode, String> {
    let mut manifest = read_manifest(root)?;

    let source = project_root.join(".mozak/project.yml");
    let bytes =
        fs::read(&source).map_err(|error| format!("cannot read {}: {error}", source.display()))?;
    let text =
        std::str::from_utf8(&bytes).map_err(|_| "project manifest is not UTF-8".to_owned())?;
    let project = validate_project_yaml(text)
        .map_err(|error| format!("invalid project manifest: {error}"))?;
    if project.project.id != id {
        return Err(format!(
            "Scope id must equal the project id: expected {}, given {id}",
            project.project.id
        ));
    }

    // The Scope keeps its own copy so it stays verifiable on its own.
    let relative = format!("projects/{id}/.mozak/project.yml");
    let destination = root.join(&relative);
    if destination.exists() {
        return Err(format!("refusing to overwrite {}", destination.display()));
    }
    let parent = destination
        .parent()
        .ok_or_else(|| "invalid project manifest destination".to_owned())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("cannot create {}: {error}", parent.display()))?;
    fs::write(&destination, &bytes)
        .map_err(|error| format!("cannot write {}: {error}", destination.display()))?;

    let entry = json!({
        "id": id,
        "kind": "project",
        "title": title,
        "intent": intent,
        "history": [history_entry("Bound an existing project repository to this Scope.")],
        "project": {
            "manifest_path": relative,
            "manifest_sha256": format!("{:x}", Sha256::digest(&bytes)),
            "project_id": project.project.id,
            "repository_revision": project.repository.revision,
            "owned_paths": project.owned_paths,
        },
    });
    if let Err(error) = push_scope(&mut manifest, entry, id) {
        discard_project_copy(root, id, &destination);
        return Err(error);
    }
    match commit(
        root,
        &manifest,
        "scope add-project",
        &json!({ "scope_id": id, "kind": "project", "bound_manifest": relative }),
    ) {
        Ok(code) => Ok(code),
        Err(error) => {
            discard_project_copy(root, id, &destination);
            Err(error)
        }
    }
}

/// Adds an advisory Meta Goal over Scopes that already exist in this root.
///
/// # Errors
/// Returns an error when the goal id is taken, when no Scope is named, or when
/// any named Scope is absent from the root.
pub fn add_goal(
    root: &Path,
    id: &str,
    title: &str,
    scope_ids: &[String],
) -> Result<ExitCode, String> {
    let mut manifest = read_manifest(root)?;
    if scope_ids.is_empty() {
        return Err("a Meta Goal must name at least one Scope".to_owned());
    }
    let known = manifest["scopes"]
        .as_array()
        .ok_or_else(|| "invalid scope.json: scopes must be an array".to_owned())?
        .iter()
        .filter_map(|scope| scope["id"].as_str().map(ToOwned::to_owned))
        .collect::<Vec<_>>();
    for scope_id in scope_ids {
        if !known.contains(scope_id) {
            return Err(format!(
                "Meta Goal names a Scope that is not in this root: {scope_id}"
            ));
        }
    }
    let goals = manifest["meta_goals"]
        .as_array_mut()
        .ok_or_else(|| "invalid scope.json: meta_goals must be an array".to_owned())?;
    if goals.iter().any(|goal| goal["id"] == id) {
        return Err(format!("refusing to replace an existing Meta Goal: {id}"));
    }
    goals.push(json!({
        "id": id,
        "title": title,
        // A Meta Goal coordinates; it never confers authority.
        "authority": "advisory_only",
        "scope_ids": scope_ids,
        "relationships": [],
    }));
    commit(
        root,
        &manifest,
        "scope add-goal",
        &json!({ "goal_id": id, "scope_ids": scope_ids, "authority": "advisory_only" }),
    )
}

/// Removes a manifest copy and the directories this route created for it, so a
/// failed `add-project` leaves the Scope root exactly as it was found.
fn discard_project_copy(root: &Path, scope_id: &str, file: &Path) {
    let _ = fs::remove_file(file);
    // Only prune the two levels this route creates, and only while empty.
    for relative in [
        format!("projects/{scope_id}/.mozak"),
        format!("projects/{scope_id}"),
    ] {
        let directory = root.join(relative);
        if fs::read_dir(&directory).is_ok_and(|mut entries| entries.next().is_none()) {
            let _ = fs::remove_dir(&directory);
        }
    }
    let projects = root.join("projects");
    if fs::read_dir(&projects).is_ok_and(|mut entries| entries.next().is_none()) {
        let _ = fs::remove_dir(&projects);
    }
}

fn topic_entry(id: &str, title: &str, intent: &str) -> serde_json::Value {
    json!({
        "id": id,
        "kind": "topic",
        "title": title,
        "intent": intent,
        "history": [history_entry("Created an empty Topic Scope. No inputs are accepted yet.")],
    })
}

fn history_entry(note: &str) -> serde_json::Value {
    json!({
        "id": format!("created-{}", crate::lab_workflow::today()),
        "at": crate::lab_workflow::now(),
        "note": note,
    })
}

fn read_manifest(root: &Path) -> Result<serde_json::Value, String> {
    let path = root.join(MANIFEST);
    let bytes =
        fs::read(&path).map_err(|error| format!("cannot read {}: {error}", path.display()))?;
    serde_json::from_slice(&bytes).map_err(|error| format!("invalid {}: {error}", path.display()))
}

fn push_scope(
    manifest: &mut serde_json::Value,
    entry: serde_json::Value,
    id: &str,
) -> Result<(), String> {
    let scopes = manifest["scopes"]
        .as_array_mut()
        .ok_or_else(|| "invalid scope.json: scopes must be an array".to_owned())?;
    if scopes.iter().any(|scope| scope["id"] == id) {
        return Err(format!("refusing to replace an existing Scope entry: {id}"));
    }
    scopes.push(entry);
    Ok(())
}

/// Writes the manifest, then validates it. A manifest that does not validate is
/// rolled back, so an authoring route never leaves a broken Scope root behind.
fn commit(
    root: &Path,
    manifest: &serde_json::Value,
    command: &'static str,
    detail: &serde_json::Value,
) -> Result<ExitCode, String> {
    let path = root.join(MANIFEST);
    let previous = fs::read(&path).ok();
    let serialized = serde_json::to_string_pretty(manifest).map_err(|e| e.to_string())?;
    fs::write(&path, serialized + "\n")
        .map_err(|error| format!("cannot write {}: {error}", path.display()))?;

    let scopes = match load_scopes(root) {
        Ok(scopes) => scopes,
        Err(error) => {
            match previous {
                Some(bytes) => {
                    let _ = fs::write(&path, bytes);
                }
                None => {
                    let _ = fs::remove_file(&path);
                }
            }
            return Err(error.to_string());
        }
    };

    let mut receipt = json!({
        "schema_version": 1,
        "command": command,
        "scope_root": root.display().to_string(),
        "state": "valid",
        "scope_count": scopes.manifest.scopes.len(),
        "meta_goal_count": scopes.manifest.meta_goals.len(),
        "authority": "authoring records structure only; it transfers no trust or truth",
        "next": "this changed scope.json; if this Scope is registered, re-pin it with `mozak kb repin REGISTRY_ROOT REGISTRATION_ID SCOPE_ROOT`, then re-pin a configured KB with `mozak project discover`, `project review`, `project refresh`",
    });
    if let (Some(target), Some(source)) = (receipt.as_object_mut(), detail.as_object()) {
        for (key, value) in source {
            target.insert(key.clone(), value.clone());
        }
    }
    println!(
        "{}",
        serde_json::to_string(&receipt).map_err(|e| e.to_string())?
    );
    Ok(ExitCode::SUCCESS)
}

pub fn source_check(
    root: &Path,
    source_id: &str,
    source_root: &Path,
    observed_revision: &str,
) -> Result<ExitCode, String> {
    let scopes = load_scopes(root).map_err(|e| e.to_string())?;
    let result = check_source(&scopes, source_id, source_root, observed_revision)
        .map_err(|e| e.to_string())?;
    println!(
        "{}",
        serde_json::to_string(&result).map_err(|e| e.to_string())?
    );
    if result.fresh {
        Ok(ExitCode::SUCCESS)
    } else {
        Ok(ExitCode::from(2))
    }
}

pub fn ingest(
    scope_root: &Path,
    source_root: &Path,
    observed_revision: &str,
    plan: &Path,
    output_root: &Path,
) -> Result<ExitCode, String> {
    let receipt = ingest_links(
        scope_root,
        source_root,
        observed_revision,
        plan,
        output_root,
    )
    .map_err(|error| error.to_string())?;
    println!(
        "{}",
        serde_json::to_string(&receipt).map_err(|error| error.to_string())?
    );
    Ok(ExitCode::SUCCESS)
}
fn validate(scopes: &ValidatedScopes) -> Result<ExitCode, String> {
    let root = scopes.root.to_string_lossy();
    println!(
        "{}",
        serde_json::to_string(&Validation {
            schema_version: 2,
            command: "scope validate",
            validity: "snapshot_valid",
            freshness_checked: false,
            scope_root: &root,
            scope_count: scopes.manifest.scopes.len(),
            promotion_count: scopes.manifest.promotions.len(),
            meta_goal_count: scopes.manifest.meta_goals.len(),
            input_count: scopes.manifest.inputs.len(),
            concept_count: scopes.manifest.concepts.len(),
        })
        .map_err(|e| e.to_string())?
    );
    Ok(ExitCode::SUCCESS)
}
fn render_list(validated: &ValidatedScopes) -> String {
    let mut scopes = validated.manifest.scopes.clone();
    scopes.sort_by(|a, b| a.id.cmp(&b.id));
    let mut promotions = validated.manifest.promotions.clone();
    promotions.sort();
    let mut goals = validated.manifest.meta_goals.clone();
    goals.sort_by(|a, b| a.id.cmp(&b.id));
    let mut concepts = validated.manifest.concepts.clone();
    concepts.sort_by(|a, b| a.id.cmp(&b.id));
    let mut out = String::from("Scopes:\n");
    for s in scopes {
        let _ = writeln!(out, "  {} [{}] {}", s.id, s.kind, s.title);
    }
    out.push_str("Promotions:\n");
    if promotions.is_empty() {
        out.push_str("  (none)\n");
    } else {
        for p in promotions {
            let _ = writeln!(
                out,
                "  {}: {} -> {}",
                p.id, p.source_topic_id, p.target_project_id
            );
        }
    }
    out.push_str("Concepts:\n");
    if concepts.is_empty() {
        out.push_str("  (none)\n");
    } else {
        for c in concepts {
            let _ = writeln!(
                out,
                "  {} [advisory] owned by {} ({})",
                c.id, c.scope_id, c.path
            );
        }
    }
    out.push_str("Meta goals:\n");
    if goals.is_empty() {
        out.push_str("  (none)\n");
    } else {
        for g in goals {
            let _ = writeln!(out, "  {}: {}", g.id, g.title);
        }
    }
    out
}
fn mermaid(validated: &ValidatedScopes) -> String {
    let mut scopes = validated.manifest.scopes.clone();
    scopes.sort_by(|a, b| a.id.cmp(&b.id));
    let mut goals = validated.manifest.meta_goals.clone();
    goals.sort_by(|a, b| a.id.cmp(&b.id));
    let mut promotions = validated.manifest.promotions.clone();
    promotions.sort();
    let mut concepts = validated.manifest.concepts.clone();
    concepts.sort_by(|a, b| a.id.cmp(&b.id));
    let mut out = String::from("flowchart LR\n");
    for (i, s) in scopes.iter().enumerate() {
        let _ = writeln!(out, "  s{i}[\"{}\\n{}\"]", graph_escape(&s.id), s.kind);
    }
    for (i, g) in goals.iter().enumerate() {
        let _ = writeln!(out, "  g{i}{{\"{}\"}}", graph_escape(&g.id));
    }
    for (i, c) in concepts.iter().enumerate() {
        let _ = writeln!(out, "  c{i}[/\"{}\\nadvisory\"/]", graph_escape(&c.id));
        if let Some(owner) = scopes.iter().position(|s| s.id == c.scope_id) {
            let _ = writeln!(out, "  s{owner} -->|authors| c{i}");
        }
    }
    for p in promotions {
        let from = scopes
            .iter()
            .position(|s| s.id == p.source_topic_id)
            .expect("validated");
        let to = scopes
            .iter()
            .position(|s| s.id == p.target_project_id)
            .expect("validated");
        let _ = writeln!(out, "  s{from} -->|promotes| s{to}");
    }
    for (i, g) in goals.iter().enumerate() {
        for sid in &g.scope_ids {
            let to = scopes.iter().position(|s| s.id == *sid).expect("validated");
            let _ = writeln!(out, "  g{i} -.-> s{to}");
        }
        for r in &g.relationships {
            let to = goals
                .iter()
                .position(|x| x.id == r.to_goal_id)
                .expect("validated");
            let _ = writeln!(out, "  g{i} -->|{}| g{to}", r.kind);
        }
    }
    out
}
fn graph(validated: &ValidatedScopes) -> Result<ExitCode, String> {
    let source = mermaid(validated);
    let executable = env::var("MOZAK_TERMAID").unwrap_or_else(|_| "termaid".into());
    let mut child = Command::new(&executable)
        .stdin(Stdio::piped())
        .stdout(Stdio::inherit())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("cannot run Termaid executable {executable:?}: {e}"))?;
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
        .map_err(|e| format!("cannot wait for Termaid: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "Termaid failed with {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    if let Some(error) = write_failed {
        return Err(format!("cannot write Termaid stdin: {error}"));
    }
    Ok(ExitCode::SUCCESS)
}
fn graph_escape(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('{', "&#123;")
        .replace('}', "&#125;")
        .replace('|', "&#124;")
}
