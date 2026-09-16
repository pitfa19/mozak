use mozak_core::kb::load_registry;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    env, fs,
    io::Write,
    path::{Component, Path, PathBuf},
    process::ExitCode,
};

const DESTINATIONS: [&str; 4] = [
    ".agents/skills/mozak",
    ".jcode/skills/mozak",
    ".claude/skills/mozak",
    ".codex/skills/mozak",
];
const ADHD_DESTINATIONS: [&str; 4] = [
    ".agents/skills/i-have-adhd",
    ".jcode/skills/i-have-adhd",
    ".claude/skills/i-have-adhd",
    ".codex/skills/i-have-adhd",
];
const FILES: [(&str, &[u8]); 6] = [
    ("SKILL.md", include_bytes!("../../../skills/mozak/SKILL.md")),
    (
        "install.py",
        include_bytes!("../../../skills/mozak/install.py"),
    ),
    ("mcp.json", include_bytes!("../../../skills/mozak/mcp.json")),
    (
        "tests/test_skill.py",
        include_bytes!("../../../skills/mozak/tests/test_skill.py"),
    ),
    (
        "evals/evals.json",
        include_bytes!("../../../skills/mozak/evals/evals.json"),
    ),
    (
        "companion-recommendations.json",
        include_bytes!("../../../skills/mozak/companion-recommendations.json"),
    ),
];
const ADHD_FILES: [(&str, &[u8]); 1] = [(
    "SKILL.md",
    include_bytes!("../../../skills/i-have-adhd/SKILL.md"),
)];

const SKILL_ROOTS: [&str; 4] = [
    ".agents/skills",
    ".jcode/skills",
    ".claude/skills",
    ".codex/skills",
];

#[derive(Default)]
struct SetupOptions {
    owner: Option<String>,
    kb_root: Option<PathBuf>,
}

impl SetupOptions {
    fn parse(args: &[String]) -> Result<Self, String> {
        let mut options = Self::default();
        let mut index = 0;
        while index < args.len() {
            match args[index].as_str() {
                "--owner" => {
                    index += 1;
                    options.owner =
                        Some(args.get(index).ok_or("--owner requires a value")?.clone());
                }
                "--kb-root" => {
                    index += 1;
                    options.kb_root = Some(PathBuf::from(
                        args.get(index).ok_or("--kb-root requires a value")?,
                    ));
                }
                other => return Err(format!("unknown setup option: {other}")),
            }
            index += 1;
        }
        if options.owner.is_none() {
            options.owner = env::var("MOZAK_OWNER").ok().filter(|v| !v.is_empty());
        }
        if options.kb_root.is_none() {
            options.kb_root = env::var_os("MOZAK_KB_ROOT").map(PathBuf::from);
        }
        Ok(options)
    }

    fn has_config_inputs(&self) -> bool {
        self.owner.is_some() || self.kb_root.is_some()
    }

    fn apply_config(&self) -> Result<Option<Value>, String> {
        match (&self.owner, &self.kb_root) {
            (None, None) => Ok(None),
            (Some(owner), Some(kb_root)) => {
                crate::project_registry::setup_config(owner, kb_root).map(Some)
            }
            (Some(_), None) => Err(
                "setup install requires --kb-root or MOZAK_KB_ROOT when owner is supplied".into(),
            ),
            (None, Some(_)) => {
                Err("setup install requires --owner or MOZAK_OWNER when KB root is supplied".into())
            }
        }
    }
}

pub fn setup(command: &str, home: &Path, args: &[String]) -> Result<ExitCode, String> {
    match setup_inner(command, home, args) {
        Ok(code) => Ok(code),
        Err(message) => invalid_report(&format!("setup {command}"), home, &message),
    }
}

fn setup_inner(command: &str, home: &Path, args: &[String]) -> Result<ExitCode, String> {
    let home = safe_home(home)?;
    let setup_options = SetupOptions::parse(args)?;
    let mut checks = preflight(&home)?;
    let drift = checks.iter().any(|check| check["status"] == "drift");
    if command == "install" && !drift {
        for (destination, relative, bytes) in managed_files() {
            let target = home.join(destination).join(relative);
            if !target.exists() {
                install_file(&target, bytes)?;
            }
        }
        checks = preflight(&home)?;
    } else if command != "check" && command != "install" {
        return Err(crate::usage());
    }
    let configured = if command == "install" {
        setup_options.apply_config()?
    } else if setup_options.has_config_inputs() {
        return Err("setup check does not accept owner or KB configuration flags".into());
    } else {
        None
    };
    let parity = checks.iter().all(|check| check["status"] == "ok");
    let state = if drift {
        "invalid"
    } else if parity {
        "ready"
    } else {
        "incomplete"
    };
    let companions = companion_checks(&home);
    println!(
        "{}",
        serde_json::to_string(&json!({
            "schema_version": 1,
            "command": format!("setup {command}"),
            "home": home.to_string_lossy(),
            "state": state,
            "parity": parity,
            "embedded": true,
            "local_config": configured,
            "companion_recommendations": companions,
            "checks": checks
        }))
        .map_err(|error| error.to_string())?
    );
    Ok(match state {
        "ready" => ExitCode::SUCCESS,
        "incomplete" => ExitCode::from(2),
        _ => ExitCode::from(3),
    })
}

pub fn doctor(home: &Path, kb_root: Option<&Path>) -> Result<ExitCode, String> {
    match doctor_inner(home, kb_root) {
        Ok(code) => Ok(code),
        Err(message) => invalid_report("doctor", home, &message),
    }
}

fn doctor_inner(home: &Path, kb_root: Option<&Path>) -> Result<ExitCode, String> {
    let home = safe_home(home)?;
    let setup_checks = preflight(&home)?;
    let setup_state = if setup_checks.iter().any(|c| c["status"] == "drift") {
        "invalid"
    } else if setup_checks.iter().all(|c| c["status"] == "ok") {
        "ready"
    } else {
        "incomplete"
    };
    let termaid = find_in_path("termaid");
    let mcp = find_in_path("mozak-mcp");
    let mut checks = vec![json!({"name":"skills", "status":setup_state, "files":setup_checks})];
    checks.push(match mcp {
        Some(path) => json!({"name":"mcp", "status":"ready", "path":path.to_string_lossy()}),
        None => json!({"name":"mcp", "status":"incomplete", "message":"mozak-mcp was not found as an executable on PATH"}),
    });
    checks.push(match termaid {
        Some(path) => json!({"name":"termaid", "status":"ready", "path":path.to_string_lossy()}),
        None => json!({"name":"termaid", "status":"incomplete", "message":"termaid was not found as an executable on PATH"}),
    });
    checks.push(json!({"name":"companion_recommendations", "status":"ready", "companions":companion_checks(&home)}));
    if let Some(root) = kb_root {
        checks.push(match load_registry(root) {
            Ok(kb) => json!({"name":"kb", "status":"ready", "root":kb.registry_root.to_string_lossy(), "sha256":kb.registry_sha256}),
            Err(error) => json!({"name":"kb", "status":"invalid", "root":root.to_string_lossy(), "message":error.to_string()}),
        });
    } else {
        checks.push(json!({"name":"kb", "status":"not_requested"}));
    }
    let state = if checks.iter().any(|c| c["status"] == "invalid") {
        "invalid"
    } else if checks.iter().any(|c| c["status"] == "incomplete") {
        "incomplete"
    } else {
        "ready"
    };
    println!(
        "{}",
        serde_json::to_string(&json!({
            "schema_version":1, "command":"doctor", "home":home.to_string_lossy(),
            "kb_validation_requested":kb_root.is_some(), "state":state, "checks":checks,
            "trust":"no automatic trust, authority, or package selection is inferred"
        }))
        .map_err(|error| error.to_string())?
    );
    Ok(match state {
        "ready" => ExitCode::SUCCESS,
        "incomplete" => ExitCode::from(2),
        _ => ExitCode::from(3),
    })
}

fn invalid_report(command: &str, home: &Path, message: &str) -> Result<ExitCode, String> {
    println!(
        "{}",
        serde_json::to_string(&json!({
            "schema_version": 1,
            "command": command,
            "home": home.to_string_lossy(),
            "state": "invalid",
            "checks": [{"name":"input_safety", "status":"invalid", "message":message}]
        }))
        .map_err(|error| error.to_string())?
    );
    Ok(ExitCode::from(3))
}

fn safe_home(home: &Path) -> Result<PathBuf, String> {
    if !home.is_absolute() || home.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err("HOME must be an absolute path without parent traversal".into());
    }
    let metadata = fs::symlink_metadata(home)
        .map_err(|error| format!("cannot inspect HOME {}: {error}", home.display()))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("HOME must be an existing real directory, not a symlink".into());
    }
    home.canonicalize()
        .map_err(|error| format!("cannot resolve HOME: {error}"))
}

fn preflight(home: &Path) -> Result<Vec<Value>, String> {
    let mut checks = Vec::new();
    for destination in DESTINATIONS.into_iter().chain(ADHD_DESTINATIONS) {
        reject_symlink_components(home, Path::new(destination))?;
        for (relative, expected) in files_for_destination(destination) {
            let combined = Path::new(destination).join(relative);
            reject_symlink_components(home, &combined)?;
            let target = home.join(&combined);
            let (status, actual) = match fs::symlink_metadata(&target) {
                Ok(meta) if meta.file_type().is_symlink() => {
                    return Err(format!("managed path is a symlink: {}", target.display()));
                }
                Ok(meta) if !meta.is_file() => {
                    return Err(format!(
                        "managed path is not a regular file: {}",
                        target.display()
                    ));
                }
                Ok(_) => {
                    let bytes = fs::read(&target)
                        .map_err(|e| format!("cannot read {}: {e}", target.display()))?;
                    let hash = sha256(&bytes);
                    (if bytes == *expected { "ok" } else { "drift" }, Some(hash))
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => ("missing", None),
                Err(error) => return Err(format!("cannot inspect {}: {error}", target.display())),
            };
            checks.push(json!({"path":combined.to_string_lossy(), "status":status, "expected_sha256":sha256(expected), "actual_sha256":actual}));
        }
    }
    Ok(checks)
}

fn managed_files() -> impl Iterator<Item = (&'static str, &'static str, &'static [u8])> {
    DESTINATIONS
        .into_iter()
        .flat_map(|destination| {
            FILES
                .into_iter()
                .map(move |(relative, bytes)| (destination, relative, bytes))
        })
        .chain(ADHD_DESTINATIONS.into_iter().flat_map(|destination| {
            ADHD_FILES
                .into_iter()
                .map(move |(relative, bytes)| (destination, relative, bytes))
        }))
}

fn files_for_destination(destination: &str) -> &'static [(&'static str, &'static [u8])] {
    if ADHD_DESTINATIONS.contains(&destination) {
        &ADHD_FILES
    } else {
        &FILES
    }
}

fn reject_symlink_components(home: &Path, relative: &Path) -> Result<(), String> {
    let mut current = home.to_path_buf();
    for component in relative.components() {
        current.push(component.as_os_str());
        match fs::symlink_metadata(&current) {
            Ok(meta) if meta.file_type().is_symlink() => {
                return Err(format!(
                    "managed path component is a symlink: {}",
                    current.display()
                ));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => break,
            Err(error) => return Err(format!("cannot inspect {}: {error}", current.display())),
        }
    }
    Ok(())
}

fn install_file(target: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = target
        .parent()
        .ok_or_else(|| "managed target has no parent".to_owned())?;
    fs::create_dir_all(parent).map_err(|e| format!("cannot create {}: {e}", parent.display()))?;
    reject_symlink_components(parent, Path::new(""))?;
    let temporary = parent.join(format!(
        ".{}.mozak-new",
        target.file_name().unwrap().to_string_lossy()
    ));
    let mut options = fs::OpenOptions::new();
    let mut file = options
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|e| format!("cannot stage {}: {e}", temporary.display()))?;
    if let Err(error) = file.write_all(bytes).and_then(|()| file.sync_all()) {
        let _ = fs::remove_file(&temporary);
        return Err(format!("cannot write {}: {error}", temporary.display()));
    }
    fs::rename(&temporary, target).map_err(|e| {
        let _ = fs::remove_file(&temporary);
        format!("cannot publish {}: {e}", target.display())
    })
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn find_in_path(name: &str) -> Option<PathBuf> {
    let path = env::var_os("PATH")?;
    env::split_paths(&path)
        .map(|root| root.join(name))
        .find(|candidate| {
            fs::metadata(candidate)
                .is_ok_and(|metadata| metadata.is_file() && executable(&metadata))
        })
}

fn companion_checks(home: &Path) -> Value {
    let manifest: Value = serde_json::from_slice(include_bytes!(
        "../../../skills/mozak/companion-recommendations.json"
    ))
    .expect("embedded companion recommendations manifest must be valid JSON");
    let manifest_companions = manifest
        .get("companions")
        .and_then(Value::as_array)
        .expect("manifest companions array");
    let manifest_ids: Vec<&str> = manifest_companions
        .iter()
        .filter_map(|v| v.get("id").and_then(Value::as_str))
        .collect();
    assert_eq!(
        manifest_ids,
        vec![
            "termaid",
            "mmdr",
            "adhd-skill",
            "caveman-skill",
            "drawing-skills"
        ]
    );
    json!({
        "schema_version": 1,
        "manifest_path": "companion-recommendations.json",
        "policy": "MOZAK-managed companions are version-matched embedded payloads; missing recommended companions are reported only and are never auto-installed",
        "managed": [
            skill_companion(home, "adhd-skill", "ADHD skill", "managed", &["i-have-adhd"]),
        ],
        "required": [
            executable_companion("termaid", "Termaid", "required"),
        ],
        "recommended": [
            executable_companion("mmdr", "mmdr", "recommended"),
            skill_companion(home, "caveman-skill", "Caveman skill", "recommended", &["caveman"]),
            skill_companion(home, "drawing-skills", "Drawing skills", "recommended", &["archify", "excalidraw-skill"]),
        ]
    })
}

fn executable_companion(executable_name: &str, display_name: &str, classification: &str) -> Value {
    match find_in_path(executable_name) {
        Some(path) => json!({
            "id": executable_name,
            "name": display_name,
            "classification": classification,
            "kind": "executable",
            "status": "present",
            "path": path.to_string_lossy(),
        }),
        None => json!({
            "id": executable_name,
            "name": display_name,
            "classification": classification,
            "kind": "executable",
            "status": "missing",
            "message": format!("{executable_name} was not found as an executable on PATH"),
        }),
    }
}

fn skill_companion(
    home: &Path,
    id: &str,
    name: &str,
    classification: &str,
    skill_names: &[&str],
) -> Value {
    let matches = find_exact_skills(home, skill_names);
    let status = if matches.is_empty() {
        "missing"
    } else {
        "present"
    };
    json!({
        "id": id,
        "name": name,
        "classification": classification,
        "kind": "skill",
        "status": status,
        "matches": matches,
    })
}

fn find_exact_skills(home: &Path, skill_names: &[&str]) -> Vec<String> {
    let mut matches = Vec::new();
    for root in SKILL_ROOTS {
        for name in skill_names {
            let relative = Path::new(root).join(name);
            if home.join(&relative).is_dir() {
                matches.push(relative.to_string_lossy().into_owned());
            }
        }
    }
    matches
}

#[cfg(unix)]
fn executable(metadata: &fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;
    metadata.permissions().mode() & 0o111 != 0
}
#[cfg(not(unix))]
fn executable(_: &fs::Metadata) -> bool {
    true
}

/// Reports how this exact binary was installed and who owns updates.
///
/// The installed `mozak` command is a managed launcher that intercepts
/// `delivery status`, `update`, and `rollback`. This route therefore runs only
/// when the real binary is invoked directly. It observes local installation
/// layout and never performs networking, updating, or activation.
pub fn delivery_status() -> Result<ExitCode, String> {
    let report = match managed_build() {
        Some((build_dir, build)) => {
            // versions/<build-id> -> versions -> lib/mozak -> lib -> PREFIX
            let launcher = build_dir
                .parent()
                .and_then(Path::parent)
                .and_then(Path::parent)
                .and_then(Path::parent)
                .map(|prefix| prefix.join("bin/mozak"));
            json!({
                "installation": "managed",
                "build_id": build.get("build_id"),
                "version": build.get("version"),
                "revision": build.get("revision"),
                "channel": build.get("channel"),
                "build_directory": build_dir.to_string_lossy(),
                "launcher": launcher.map(|path| path.to_string_lossy().into_owned()),
                "note": "run delivery status through the installed launcher for channel and auto-update settings",
            })
        }
        None => json!({
            "installation": "unmanaged",
            "version": env!("CARGO_PKG_VERSION"),
            "note": "this binary was run directly; install the managed launcher to use update and rollback",
        }),
    };
    println!(
        "{}",
        serde_json::to_string(&json!({
            "schema_version": 1,
            "command": "delivery status",
            "state": report,
            "networking": "this binary performs no networking",
            "state_boundary": "projects, registries, scopes, adapters, and KB roots are not delivery state",
        }))
        .map_err(|error| error.to_string())?
    );
    Ok(ExitCode::SUCCESS)
}

/// Refuses launcher-owned delivery mutations from the real binary.
pub fn delivery_unavailable(command: &str) -> Result<ExitCode, String> {
    let hint = match managed_build() {
        Some((build_dir, _)) => format!(
            "run `mozak {command}` through the installed launcher instead of {}",
            build_dir.join("mozak").display()
        ),
        None => format!(
            "`mozak {command}` is provided by the managed launcher; install MOZAK with scripts/install.sh first"
        ),
    };
    Err(hint)
}

fn managed_build() -> Option<(PathBuf, Value)> {
    let binary = env::current_exe().ok()?.canonicalize().ok()?;
    let build_dir = binary.parent()?.to_path_buf();
    if build_dir.parent()?.file_name()? != "versions" {
        return None;
    }
    let bytes = fs::read(build_dir.join("build.json")).ok()?;
    let value: Value = serde_json::from_slice(&bytes).ok()?;
    value.get("build_id")?.as_str()?;
    Some((build_dir, value))
}
