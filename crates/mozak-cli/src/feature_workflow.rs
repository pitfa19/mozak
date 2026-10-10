//! `mozak feature`: thin feature records over a Pocock-style flow.
//!
//! Every version of a record is its own create-only file
//! `.mozak/features/<id>.v<N>.json`. Nothing is rewritten in place, so a
//! successor never erases what an earlier version pinned. The latest version
//! is the current state. MOZAK performs no networking here: the agent saves
//! issue text under `.mozak/evidence/<id>/` and this command pins its bytes.

use mozak_core::feature::{
    FEATURE_CONTRACT_VERSION, FEATURE_ROOT, Feature, FeatureStatus, IssueLink, pinned_files,
    validate_feature, validate_feature_json, validate_successor,
};
use mozak_core::planning::GoalEvidence;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    io::Write,
    path::{Component, Path, PathBuf},
    process::ExitCode,
};

const USAGE: &str = "usage: mozak feature new <project-root> <feature-id> <title> [spec-url]\n       mozak feature ticket <project-root> <feature-id> <issue-url> [snapshot-path]\n       mozak feature evidence <project-root> <feature-id> <evidence-path>\n       mozak feature close <project-root> <feature-id> <done|dropped>\n       mozak feature <list|validate> <project-root>";

pub fn run(args: &[String]) -> Result<ExitCode, String> {
    match args {
        [command, root, id, title] if command == "new" => new(Path::new(root), id, title, None),
        [command, root, id, title, spec] if command == "new" => {
            new(Path::new(root), id, title, Some(spec))
        }
        [command, root, id, url] if command == "ticket" => ticket(Path::new(root), id, url, None),
        [command, root, id, url, snapshot] if command == "ticket" => {
            ticket(Path::new(root), id, url, Some(snapshot))
        }
        [command, root, id, path] if command == "evidence" => evidence(Path::new(root), id, path),
        [command, root, id, status] if command == "close" => close(Path::new(root), id, status),
        [command, root] if command == "list" => list(Path::new(root), false),
        [command, root] if command == "validate" => list(Path::new(root), true),
        _ => Err(USAGE.into()),
    }
}

/// Current versions of every feature, after verifying every version on disk.
pub struct FeatureState {
    pub current: BTreeMap<String, Feature>,
    /// SHA-256 of the latest version file of each feature.
    pub digests: BTreeMap<String, String>,
    pub problems: Vec<String>,
}

pub fn load(root: &Path) -> Result<FeatureState, String> {
    let dir = root.join(FEATURE_ROOT);
    let mut versions: BTreeMap<String, Vec<(u64, Feature, String)>> = BTreeMap::new();
    let mut problems = Vec::new();
    let entries = match fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(FeatureState {
                current: BTreeMap::new(),
                digests: BTreeMap::new(),
                problems,
            });
        }
        Err(error) => return Err(format!("cannot read {}: {error}", dir.display())),
    };
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let path = entry.path();
        let meta = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
        if !meta.is_file() {
            problems.push(format!("{name}: not a regular file"));
            continue;
        }
        let Some((id, version)) = parse_name(&name) else {
            problems.push(format!("{name}: expected <feature-id>.v<N>.json"));
            continue;
        };
        let bytes = fs::read(&path).map_err(|e| format!("cannot read {name}: {e}"))?;
        let text = String::from_utf8(bytes.clone()).map_err(|_| format!("{name}: not UTF-8"))?;
        let digest = format!("{:x}", Sha256::digest(&bytes));
        match validate_feature_json(&text) {
            Ok(feature) if feature.id == id && feature.version == version => {
                for pin in pinned_files(&feature) {
                    if let Err(error) = verify_pin(root, pin) {
                        problems.push(format!("{name}: {error}"));
                    }
                }
                versions
                    .entry(id)
                    .or_default()
                    .push((version, feature, digest));
            }
            Ok(_) => problems.push(format!(
                "{name}: id or version does not match the file name"
            )),
            Err(error) => problems.push(format!("{name}: {error}")),
        }
    }
    let mut current = BTreeMap::new();
    for (id, mut list) in versions {
        list.sort_by_key(|(version, _, _)| *version);
        for (index, (version, _, _)) in list.iter().enumerate() {
            if *version != u64::try_from(index + 1).unwrap_or(u64::MAX) {
                problems.push(format!("{id}: versions must run 1..N without gaps"));
                break;
            }
        }
        for pair in list.windows(2) {
            if let Err(error) = validate_successor(&pair[0].1, &pair[1].1) {
                problems.push(format!("{id} v{}: {error}", pair[1].0));
            }
            if pair[1].1.previous_sha256.as_deref() != Some(pair[0].2.as_str()) {
                problems.push(format!(
                    "{id} v{}: does not pin the exact bytes of v{}; an earlier version was edited",
                    pair[1].0, pair[0].0
                ));
            }
        }
        if let Some((_, latest, digest)) = list.pop() {
            current.insert(id, (latest, digest));
        }
    }
    Ok(FeatureState {
        current: current
            .iter()
            .map(|(k, (f, _))| (k.clone(), f.clone()))
            .collect(),
        digests: current.into_iter().map(|(k, (_, d))| (k, d)).collect(),
        problems,
    })
}

fn parse_name(name: &str) -> Option<(String, u64)> {
    let stem = name.strip_suffix(".json")?;
    let (id, version) = stem.rsplit_once(".v")?;
    let version: u64 = version.parse().ok()?;
    (version >= 1 && !id.is_empty()).then(|| (id.to_owned(), version))
}

fn verify_pin(root: &Path, pin: &GoalEvidence) -> Result<(), String> {
    let path = root.join(&pin.path);
    let meta =
        fs::symlink_metadata(&path).map_err(|_| format!("pinned file missing: {}", pin.path))?;
    if !meta.is_file() {
        return Err(format!("pinned path is not a regular file: {}", pin.path));
    }
    let bytes = fs::read(&path).map_err(|e| format!("cannot read {}: {e}", pin.path))?;
    if format!("{:x}", Sha256::digest(&bytes)) != pin.sha256 {
        return Err(format!("pinned file drifted from its sha256: {}", pin.path));
    }
    Ok(())
}

fn project_root(root: &Path) -> Result<PathBuf, String> {
    let root = root
        .canonicalize()
        .map_err(|e| format!("cannot resolve project root {}: {e}", root.display()))?;
    if !root.join(".mozak/project.yml").is_file() {
        return Err(format!(
            "not a MOZAK project (no .mozak/project.yml): {}",
            root.display()
        ));
    }
    Ok(root)
}

/// Pins an existing project-relative file under the feature's evidence folder.
fn pin_file(root: &Path, id: &str, relative: &str) -> Result<GoalEvidence, String> {
    let rel = Path::new(relative);
    if rel.is_absolute() || rel.components().any(|c| !matches!(c, Component::Normal(_))) {
        return Err(format!(
            "evidence path must be project-relative without ..: {relative}"
        ));
    }
    let required = format!(".mozak/evidence/{id}/");
    if !relative.starts_with(&required) {
        return Err(format!(
            "evidence for feature {id} must live under {required}"
        ));
    }
    let mut current = root.to_path_buf();
    for component in rel.components() {
        current.push(component);
        if fs::symlink_metadata(&current).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err(format!("evidence path has a symlink component: {relative}"));
        }
    }
    let bytes = fs::read(root.join(rel)).map_err(|e| format!("cannot read {relative}: {e}"))?;
    Ok(GoalEvidence {
        path: relative.to_owned(),
        sha256: format!("{:x}", Sha256::digest(&bytes)),
    })
}

fn write_version(root: &Path, feature: &Feature) -> Result<String, String> {
    validate_feature(feature).map_err(|e| e.to_string())?;
    let dir = root.join(FEATURE_ROOT);
    fs::create_dir_all(&dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    let name = format!("{}.v{}.json", feature.id, feature.version);
    let path = dir.join(&name);
    let mut bytes = serde_json::to_vec_pretty(feature).map_err(|e| e.to_string())?;
    bytes.push(b'\n');
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|e| format!("refusing to overwrite or cannot create {name}: {e}"))?;
    let written = file
        .write_all(&bytes)
        .and_then(|()| file.sync_all())
        .map_err(|e| e.to_string());
    if let Err(error) = written {
        let _ = fs::remove_file(&path);
        return Err(error);
    }
    Ok(format!("{FEATURE_ROOT}{name}"))
}

fn current_open(root: &Path, id: &str) -> Result<(Feature, String), String> {
    let state = load(root)?;
    if !state.problems.is_empty() {
        return Err(format!(
            "feature records are invalid; run `mozak feature validate`: {}",
            state.problems.join("; ")
        ));
    }
    let feature = state
        .current
        .get(id)
        .cloned()
        .ok_or_else(|| format!("no feature record named {id}"))?;
    if feature.status != FeatureStatus::Open {
        return Err(format!("feature {id} is {:?} and final", feature.status));
    }
    let digest = state.digests.get(id).cloned().expect("digest for current");
    Ok((feature, digest))
}

fn next_version(previous: &Feature, digest: String) -> Feature {
    let mut next = previous.clone();
    next.version += 1;
    next.previous_sha256 = Some(digest);
    next
}

fn successor(
    root: &Path,
    previous: &Feature,
    next: &Feature,
    command: &str,
) -> Result<ExitCode, String> {
    validate_successor(previous, next).map_err(|e| e.to_string())?;
    let path = write_version(root, next)?;
    print(
        &json!({"command": format!("feature {command}"), "feature": next.id, "version": next.version, "status": next.status, "path": path}),
    )
}

fn new(root: &Path, id: &str, title: &str, spec: Option<&String>) -> Result<ExitCode, String> {
    let root = project_root(root)?;
    let state = load(&root)?;
    if state.current.contains_key(id) {
        return Err(format!(
            "feature {id} already exists; use ticket, evidence or close"
        ));
    }
    let feature = Feature {
        contract_version: FEATURE_CONTRACT_VERSION,
        id: id.to_owned(),
        title: title.to_owned(),
        status: FeatureStatus::Open,
        version: 1,
        spec: spec.map(|url| IssueLink {
            url: url.clone(),
            snapshot: None,
        }),
        tickets: Vec::new(),
        evidence: Vec::new(),
        previous_sha256: None,
    };
    let path = write_version(&root, &feature)?;
    print(
        &json!({"command": "feature new", "feature": id, "version": 1, "status": "open", "path": path}),
    )
}

fn ticket(root: &Path, id: &str, url: &str, snapshot: Option<&String>) -> Result<ExitCode, String> {
    let root = project_root(root)?;
    let (previous, digest) = current_open(&root, id)?;
    let pinned = snapshot.map(|path| pin_file(&root, id, path)).transpose()?;
    let mut next = next_version(&previous, digest);
    if next.spec.as_ref().is_some_and(|spec| spec.url == url) {
        let spec = next.spec.as_mut().expect("checked");
        if spec.snapshot.is_some() {
            return Err(format!("spec {url} already has a pinned snapshot"));
        }
        spec.snapshot = pinned;
    } else if let Some(existing) = next.tickets.iter_mut().find(|t| t.url == url) {
        if existing.snapshot.is_some() {
            return Err(format!("ticket {url} already has a pinned snapshot"));
        }
        existing.snapshot = pinned;
    } else {
        next.tickets.push(IssueLink {
            url: url.to_owned(),
            snapshot: pinned,
        });
    }
    successor(&root, &previous, &next, "ticket")
}

fn evidence(root: &Path, id: &str, path: &str) -> Result<ExitCode, String> {
    let root = project_root(root)?;
    let (previous, digest) = current_open(&root, id)?;
    let pinned = pin_file(&root, id, path)?;
    if pinned_files(&previous)
        .iter()
        .any(|pin| pin.path == pinned.path)
    {
        return Err(format!("{path} is already pinned"));
    }
    let mut next = next_version(&previous, digest);
    next.evidence.push(pinned);
    successor(&root, &previous, &next, "evidence")
}

fn close(root: &Path, id: &str, status: &str) -> Result<ExitCode, String> {
    let root = project_root(root)?;
    let (previous, digest) = current_open(&root, id)?;
    let mut next = next_version(&previous, digest);
    next.status = match status {
        "done" => FeatureStatus::Done,
        "dropped" => FeatureStatus::Dropped,
        _ => return Err("close status must be done or dropped".into()),
    };
    successor(&root, &previous, &next, "close")
}

fn list(root: &Path, strict: bool) -> Result<ExitCode, String> {
    let root = project_root(root)?;
    let state = load(&root)?;
    let features: Vec<Value> = state
        .current
        .values()
        .map(|f| {
            let pinned = f.tickets.iter().filter(|t| t.snapshot.is_some()).count();
            json!({"id": f.id, "title": f.title, "status": f.status, "version": f.version,
                   "spec": f.spec.as_ref().map(|s| &s.url), "tickets": f.tickets.len(),
                   "tickets_pinned": pinned, "evidence": f.evidence.len()})
        })
        .collect();
    let valid = state.problems.is_empty();
    print(
        &json!({"command": if strict {"feature validate"} else {"feature list"},
                  "valid": valid, "features": features, "problems": state.problems,
                  "network": false}),
    )?;
    Ok(if valid || !strict {
        ExitCode::SUCCESS
    } else {
        ExitCode::from(3)
    })
}

fn print(value: &Value) -> Result<ExitCode, String> {
    println!(
        "{}",
        serde_json::to_string(value).map_err(|e| e.to_string())?
    );
    Ok(ExitCode::SUCCESS)
}
