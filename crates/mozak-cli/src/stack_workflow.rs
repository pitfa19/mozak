//! Explicit, use-case-driven tool stack.
//!
//! The shipped `tool-stack.json` catalog names every use case and the exact
//! third-party tools that apply to it. These routes only read: they perform no
//! networking, never launch or install a tool, never complete an MCP handshake,
//! and never emit a credential value. `stack check` observes presence from
//! explicit files under the supplied HOME and the PATH, so the strongest state
//! it can report is `configured`. Handshake, service usability, and write
//! grants belong to the agent host and the owner and are reported as
//! unobserved rather than inferred.

use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    env, fs,
    io::Read,
    path::{Component, Path, PathBuf},
    process::ExitCode,
};

pub(crate) const CATALOG_BYTES: &[u8] = include_bytes!("../../../skills/mozak/tool-stack.json");
pub(crate) const CATALOG_FILE: &str = "tool-stack.json";

const MAX_CONFIG_BYTES: u64 = 8 * 1024 * 1024;
const MAX_PREFS_PROFILES: usize = 32;
const BASELINE: &str = "baseline";
const MAX_MCP_TOOL_IDS: usize = 16;
const NOT_OBSERVED: [&str; 4] = [
    "mcp_handshake",
    "service_usability",
    "write_grants",
    "network",
];

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
#[allow(clippy::struct_field_names)]
pub(crate) struct Catalog {
    pub schema_version: u32,
    pub catalog_id: String,
    pub catalog_version: String,
    pub policy: BTreeMap<String, String>,
    pub readiness_ladder: Vec<Ladder>,
    pub observed_states: Vec<String>,
    pub hosts: Vec<Host>,
    pub use_cases: Vec<UseCase>,
    pub tools: Vec<Tool>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Ladder {
    pub id: String,
    pub observed_by: String,
    pub meaning: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Host {
    pub id: String,
    pub config_path: String,
    pub format: String,
    pub servers_key: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct UseCase {
    pub id: String,
    pub title: String,
    pub summary: String,
    pub tools: Vec<UseCaseTool>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct UseCaseTool {
    pub tool_id: String,
    pub requirement: String,
    #[serde(default)]
    pub group: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
#[allow(dead_code)]
pub(crate) struct Tool {
    pub id: String,
    pub name: String,
    pub kind: String,
    #[serde(default)]
    pub companion_classification: Option<String>,
    pub shipped_by_mozak: bool,
    pub ready_at: String,
    #[serde(default)]
    pub upstream: Option<Value>,
    pub detection: Detection,
    #[serde(default)]
    pub prerequisites: Vec<Prerequisite>,
    #[serde(default)]
    pub credentials: Credentials,
    #[serde(default)]
    pub effects: Option<Value>,
    pub install: Vec<String>,
    #[serde(default)]
    pub registration: Option<Value>,
    #[serde(default)]
    pub probes: Option<Value>,
    pub notes: String,
}

#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub(crate) struct Detection {
    #[serde(default)]
    pub executables: Vec<String>,
    #[serde(default)]
    pub launcher_executables: Vec<String>,
    #[serde(default)]
    pub skill_dirs: Vec<String>,
    #[serde(default)]
    pub skill_match: Option<String>,
    #[serde(default)]
    pub host_server_names: Vec<String>,
    #[serde(default)]
    pub command_markers: Vec<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Prerequisite {
    pub id: String,
    pub kind: String,
    #[serde(default)]
    pub executables: Vec<String>,
    #[serde(default)]
    pub path_env: Option<String>,
    #[serde(default)]
    pub home_paths: Vec<String>,
    #[serde(default)]
    pub prefs: Option<Prefs>,
    #[serde(default)]
    pub env: Option<String>,
    /// Alternative satisfaction: every named env key is declared in the
    /// matched host server config or the process env. Only names are checked.
    #[serde(default)]
    pub alternative_env_all: Vec<String>,
    #[serde(default)]
    pub alternative_label: Option<String>,
    pub message: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Prefs {
    pub dir: String,
    pub file: String,
    pub pref: String,
    pub join: String,
}

#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub(crate) struct Credentials {
    #[serde(default)]
    pub required_env: Vec<String>,
    #[serde(default)]
    pub optional_env: Vec<String>,
}

impl Catalog {
    fn tool(&self, id: &str) -> Option<&Tool> {
        self.tools.iter().find(|tool| tool.id == id)
    }

    fn use_case(&self, id: &str) -> Option<&UseCase> {
        self.use_cases.iter().find(|use_case| use_case.id == id)
    }

    fn use_case_ids(&self) -> Vec<&str> {
        self.use_cases.iter().map(|u| u.id.as_str()).collect()
    }
}

/// Parses and validates the embedded catalog.
pub(crate) fn load_catalog() -> Result<Catalog, String> {
    parse_catalog(CATALOG_BYTES)
}

pub(crate) fn catalog_sha256() -> String {
    format!("{:x}", Sha256::digest(CATALOG_BYTES))
}

fn parse_catalog(bytes: &[u8]) -> Result<Catalog, String> {
    let catalog: Catalog = serde_json::from_slice(bytes)
        .map_err(|error| format!("invalid tool-stack catalog: {error}"))?;
    validate_catalog(&catalog)?;
    Ok(catalog)
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        && !value.starts_with('-')
}

fn valid_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
        && value != "."
        && value != ".."
}

fn safe_relative(value: &str) -> bool {
    let path = Path::new(value);
    !value.is_empty()
        && path
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
}

fn validate_catalog(catalog: &Catalog) -> Result<(), String> {
    if catalog.schema_version != 1 {
        return Err("tool-stack catalog schema_version must be 1".into());
    }
    if catalog.catalog_id != "mozak-tool-stack" || catalog.catalog_version.is_empty() {
        return Err("tool-stack catalog identity is invalid".into());
    }
    let ladder: Vec<&str> = catalog
        .readiness_ladder
        .iter()
        .map(|l| l.id.as_str())
        .collect();
    if ladder
        != [
            "missing",
            "installed",
            "configured",
            "handshake_ok",
            "usable",
            "write_granted",
        ]
    {
        return Err("tool-stack readiness ladder is not the fixed contract".into());
    }
    if catalog.observed_states != ["missing", "installed", "configured", "prerequisite_missing"] {
        return Err("tool-stack observed_states is not the fixed contract".into());
    }
    for host in &catalog.hosts {
        if !valid_id(&host.id)
            || !safe_relative(&host.config_path)
            || !matches!(host.format.as_str(), "json" | "toml")
            || host.servers_key.is_empty()
        {
            return Err(format!("invalid host entry: {}", host.id));
        }
    }
    let mut tool_ids = BTreeSet::new();
    for tool in &catalog.tools {
        validate_tool(tool)?;
        if !tool_ids.insert(tool.id.as_str()) {
            return Err(format!("duplicate tool id: {}", tool.id));
        }
    }
    let mut use_case_ids = BTreeSet::new();
    for use_case in &catalog.use_cases {
        if !valid_id(&use_case.id) || !use_case_ids.insert(use_case.id.as_str()) {
            return Err(format!("invalid or duplicate use case id: {}", use_case.id));
        }
        if use_case.tools.is_empty() || use_case.title.is_empty() || use_case.summary.is_empty() {
            return Err(format!("use case {} is incomplete", use_case.id));
        }
        for entry in &use_case.tools {
            if !tool_ids.contains(entry.tool_id.as_str()) {
                return Err(format!(
                    "use case {} names unknown tool {}",
                    use_case.id, entry.tool_id
                ));
            }
            match (entry.requirement.as_str(), &entry.group) {
                ("any_of", Some(group)) if valid_id(group) => {}
                ("required" | "optional", None) => {}
                _ => {
                    return Err(format!(
                        "use case {} has invalid requirement for {}",
                        use_case.id, entry.tool_id
                    ));
                }
            }
        }
    }
    if !use_case_ids.contains(BASELINE) {
        return Err("tool-stack catalog must define the baseline use case".into());
    }
    Ok(())
}

fn validate_tool(tool: &Tool) -> Result<(), String> {
    let fail = |reason: &str| Err(format!("tool {} is invalid: {reason}", tool.id));
    if !valid_id(&tool.id) || tool.name.is_empty() || tool.notes.is_empty() {
        return fail("identity");
    }
    if !matches!(
        tool.kind.as_str(),
        "managed_skill" | "skill" | "executable" | "mcp_server"
    ) {
        return fail("kind");
    }
    if !matches!(tool.ready_at.as_str(), "installed" | "configured") {
        return fail("ready_at");
    }
    if tool
        .companion_classification
        .as_deref()
        .is_some_and(|class| !matches!(class, "managed" | "required" | "recommended"))
    {
        return fail("companion_classification");
    }
    let d = &tool.detection;
    let names = d
        .executables
        .iter()
        .chain(&d.launcher_executables)
        .chain(&d.skill_dirs)
        .chain(&d.host_server_names);
    for name in names.chain(&d.command_markers) {
        if !valid_name(name) {
            return fail("detection name");
        }
    }
    if d.skill_match
        .as_deref()
        .is_some_and(|mode| !matches!(mode, "all" | "any"))
    {
        return fail("skill_match");
    }
    if d.executables.is_empty() && d.skill_dirs.is_empty() && d.host_server_names.is_empty() {
        return fail("no detection");
    }
    if tool.kind == "mcp_server" {
        let upstream = tool.upstream.as_ref().and_then(Value::as_object);
        let pinned = upstream.is_some_and(|u| {
            [
                "repository",
                "package",
                "pinned_version",
                "verified_at",
                "docs_url",
            ]
            .iter()
            .all(|key| {
                u.get(*key)
                    .and_then(Value::as_str)
                    .is_some_and(|v| !v.is_empty())
            })
        });
        if !pinned || tool.registration.is_none() || tool.probes.is_none() || tool.shipped_by_mozak
        {
            return fail(
                "mcp server needs upstream pins, registration, probes, and is never shipped",
            );
        }
        if d.host_server_names.is_empty() {
            return fail("mcp server needs host_server_names");
        }
    }
    for env_name in tool
        .credentials
        .required_env
        .iter()
        .chain(&tool.credentials.optional_env)
    {
        if !valid_env_name(env_name) {
            return fail("credential env name");
        }
    }
    for prerequisite in &tool.prerequisites {
        validate_prerequisite(prerequisite)
            .map_err(|reason| format!("tool {}: {reason}", tool.id))?;
    }
    Ok(())
}

fn valid_env_name(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_')
}

fn validate_prerequisite(p: &Prerequisite) -> Result<(), String> {
    if !valid_id(&p.id) || p.message.is_empty() {
        return Err(format!("prerequisite {} identity", p.id));
    }
    let ok = match p.kind.as_str() {
        "executable_any" => {
            !p.executables.is_empty() && p.executables.iter().all(|e| valid_name(e))
        }
        "file_any" => {
            p.home_paths.iter().all(|path| safe_relative(path))
                && p.path_env.as_deref().is_none_or(valid_env_name)
                && p.prefs.as_ref().is_none_or(|prefs| {
                    safe_relative(&prefs.dir)
                        && valid_name(&prefs.file)
                        && valid_name(&prefs.join)
                        && !prefs.pref.is_empty()
                })
                && (!p.home_paths.is_empty() || p.path_env.is_some() || p.prefs.is_some())
        }
        "credential_env" => p.env.as_deref().is_some_and(valid_env_name),
        _ => false,
    } && p
        .alternative_env_all
        .iter()
        .all(|name| valid_env_name(name))
        && p.alternative_env_all.is_empty() == p.alternative_label.is_none();
    if ok {
        Ok(())
    } else {
        Err(format!("prerequisite {} is malformed", p.id))
    }
}

/// Validates tool IDs a Lab request selects: non-empty, distinct, and each an
/// exact catalog entry of kind `mcp_server`. Never reads HOME or any registry.
pub(crate) fn validate_mcp_tool_ids(ids: &[String]) -> Result<(), String> {
    validate_mcp_tool_ids_in(&load_catalog()?, ids)
}

fn validate_mcp_tool_ids_in(catalog: &Catalog, ids: &[String]) -> Result<(), String> {
    if ids.is_empty() {
        return Err("at least one MCP tool id is required".into());
    }
    if ids.len() > MAX_MCP_TOOL_IDS {
        return Err(format!(
            "at most {MAX_MCP_TOOL_IDS} MCP tool ids are allowed"
        ));
    }
    let mut seen = BTreeSet::new();
    for id in ids {
        if !seen.insert(id.as_str()) {
            return Err(format!("duplicate MCP tool id: {id}"));
        }
        match catalog.tool(id) {
            Some(tool) if tool.kind == "mcp_server" => {}
            Some(tool) => {
                return Err(format!(
                    "tool {id} is kind {} and not an MCP server",
                    tool.kind
                ));
            }
            None => return Err(format!("unknown MCP tool id: {id}")),
        }
    }
    Ok(())
}

/// Use cases that gate readiness: baseline, then the named one once.
fn gating_use_cases(use_case: Option<&str>) -> Vec<&str> {
    match use_case {
        Some(id) if id != BASELINE => vec![BASELINE, id],
        _ => vec![BASELINE],
    }
}

pub fn run(args: &[String]) -> Result<ExitCode, String> {
    let catalog = match load_catalog() {
        Ok(catalog) => catalog,
        Err(message) => return invalid("stack", &message, &[]),
    };
    match args
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>()
        .as_slice()
    {
        ["catalog"] => print_catalog(&catalog),
        ["recommend", use_case] => recommend(&catalog, use_case),
        ["check", home] => check(&catalog, Path::new(home), None),
        ["check", home, use_case] => check(&catalog, Path::new(home), Some(use_case)),
        _ => Err(crate::usage()),
    }
}

fn emit(value: &Value) -> Result<(), String> {
    println!(
        "{}",
        serde_json::to_string(value).map_err(|error| error.to_string())?
    );
    Ok(())
}

fn catalog_identity(catalog: &Catalog) -> Value {
    json!({
        "id": catalog.catalog_id,
        "version": catalog.catalog_version,
        "file": CATALOG_FILE,
        "sha256": catalog_sha256(),
    })
}

fn invalid(command: &str, message: &str, valid_use_cases: &[&str]) -> Result<ExitCode, String> {
    let mut report = json!({
        "schema_version": 1,
        "command": command,
        "state": "invalid",
        "message": message,
    });
    if !valid_use_cases.is_empty() {
        report["valid_use_cases"] = json!(valid_use_cases);
    }
    emit(&report)?;
    Ok(ExitCode::from(3))
}

fn print_catalog(catalog: &Catalog) -> Result<ExitCode, String> {
    let document: Value =
        serde_json::from_slice(CATALOG_BYTES).map_err(|error| error.to_string())?;
    emit(&json!({
        "schema_version": 1,
        "command": "stack catalog",
        "catalog": catalog_identity(catalog),
        "use_cases": catalog.use_cases.iter().map(|u| json!({
            "id": u.id,
            "title": u.title,
            "tool_ids": u.tools.iter().map(|t| t.tool_id.as_str()).collect::<Vec<_>>(),
        })).collect::<Vec<_>>(),
        "document": document,
        "effects": no_effects(),
    }))?;
    Ok(ExitCode::SUCCESS)
}

fn no_effects() -> Value {
    json!({
        "network": false,
        "executes_external_programs": false,
        "installs": false,
        "writes": false,
        "reads_credential_values": false,
    })
}

/// Use cases selected for a request: baseline first, then the named one.
fn selected<'a>(catalog: &'a Catalog, use_case: &str) -> Vec<&'a UseCase> {
    let mut out = Vec::new();
    if let Some(baseline) = catalog.use_case(BASELINE) {
        out.push(baseline);
    }
    if use_case != BASELINE {
        if let Some(named) = catalog.use_case(use_case) {
            out.push(named);
        }
    }
    out
}

fn tool_document(tool: &Tool) -> Result<Value, String> {
    let document: Value =
        serde_json::from_slice(CATALOG_BYTES).map_err(|error| error.to_string())?;
    document["tools"]
        .as_array()
        .and_then(|tools| tools.iter().find(|t| t["id"] == tool.id.as_str()))
        .cloned()
        .ok_or_else(|| format!("catalog tool {} disappeared", tool.id))
}

fn recommend(catalog: &Catalog, use_case: &str) -> Result<ExitCode, String> {
    if catalog.use_case(use_case).is_none() {
        return invalid(
            "stack recommend",
            &format!("unknown use case: {use_case}"),
            &catalog.use_case_ids(),
        );
    }
    let mut use_cases = Vec::new();
    for selected in selected(catalog, use_case) {
        let mut tools = Vec::new();
        for entry in &selected.tools {
            let tool = catalog
                .tool(&entry.tool_id)
                .ok_or_else(|| format!("unknown tool {}", entry.tool_id))?;
            let mut document = tool_document(tool)?;
            document["requirement"] = json!(entry.requirement);
            if let Some(group) = &entry.group {
                document["group"] = json!(group);
            }
            tools.push(document);
        }
        use_cases.push(json!({
            "id": selected.id,
            "title": selected.title,
            "summary": selected.summary,
            "tools": tools,
        }));
    }
    emit(&json!({
        "schema_version": 1,
        "command": "stack recommend",
        "use_case": use_case,
        "catalog": catalog_identity(catalog),
        "use_cases": use_cases,
        "policy": catalog.policy,
        "readiness_ladder": catalog.readiness_ladder.iter().map(|l| json!({
            "id": l.id, "observed_by": l.observed_by, "meaning": l.meaning,
        })).collect::<Vec<_>>(),
        "next_step": format!("Run `mozak stack check HOME {use_case}` to observe what is already installed or configured."),
        "effects": no_effects(),
    }))?;
    Ok(ExitCode::SUCCESS)
}

// ---------------------------------------------------------------- observation

pub(crate) fn safe_home(home: &Path) -> Result<PathBuf, String> {
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

pub(crate) fn find_in_path(name: &str) -> Option<PathBuf> {
    let path = env::var_os("PATH")?;
    env::split_paths(&path)
        .filter(|root| root.is_absolute())
        .map(|root| root.join(name))
        .find(|candidate| {
            fs::metadata(candidate)
                .is_ok_and(|metadata| metadata.is_file() && executable(&metadata))
        })
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

pub(crate) const SKILL_ROOTS: [&str; 4] = [
    ".agents/skills",
    ".jcode/skills",
    ".claude/skills",
    ".codex/skills",
];

/// Exact skill directories under HOME, in deterministic root-major order.
pub(crate) fn find_exact_skills(home: &Path, skill_names: &[String]) -> Vec<String> {
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

fn read_bounded(path: &Path) -> Result<Option<String>, String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("cannot inspect: {}", error.kind())),
    };
    if metadata.file_type().is_symlink() {
        return Err("symlink refused".into());
    }
    if !metadata.is_file() {
        return Err("not a regular file".into());
    }
    if metadata.len() > MAX_CONFIG_BYTES {
        return Err("larger than the read ceiling".into());
    }
    let mut text = String::new();
    fs::File::open(path)
        .and_then(|file| file.take(MAX_CONFIG_BYTES).read_to_string(&mut text))
        .map_err(|error| format!("cannot read: {}", error.kind()))?;
    Ok(Some(text))
}

/// Reads a file at a safe relative path under HOME, refusing any symlinked
/// component so a host config can never redirect the read outside HOME.
fn read_in_home(home: &Path, relative: &Path) -> Result<Option<String>, String> {
    let mut current = home.to_path_buf();
    for component in relative.components() {
        let Component::Normal(part) = component else {
            return Err("unsafe relative path".into());
        };
        current.push(part);
        match fs::symlink_metadata(&current) {
            Ok(meta) if meta.file_type().is_symlink() => {
                return Err("symlink refused".into());
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(format!("cannot inspect: {}", error.kind())),
        }
    }
    read_bounded(&current)
}

/// One MCP server entry from a host config. Only the command line strings and
/// env key names are kept; env values are kept solely for keys the catalog
/// declares as non-secret paths.
struct HostServer {
    host: String,
    config_path: String,
    name: String,
    command_line: Vec<String>,
    env_keys: BTreeSet<String>,
    path_values: BTreeMap<String, String>,
}

struct HostObservation {
    hosts: Vec<Value>,
    servers: Vec<HostServer>,
}

fn path_env_keys(catalog: &Catalog) -> BTreeSet<String> {
    catalog
        .tools
        .iter()
        .flat_map(|tool| tool.prerequisites.iter())
        .filter_map(|p| p.path_env.clone())
        .collect()
}

fn observe_hosts(catalog: &Catalog, home: &Path) -> HostObservation {
    let path_keys = path_env_keys(catalog);
    let mut hosts = Vec::new();
    let mut servers = Vec::new();
    for host in &catalog.hosts {
        let status = match read_in_home(home, Path::new(&host.config_path)) {
            Ok(None) => "absent".to_owned(),
            Err(reason) => format!("unreadable: {reason}"),
            Ok(Some(text)) => {
                let parsed = if host.format == "json" {
                    parse_json_servers(&text, &host.servers_key, &path_keys)
                } else {
                    parse_toml_servers(&text, &host.servers_key, &path_keys)
                };
                match parsed {
                    Ok(found) => {
                        let count = found.len();
                        for (name, command_line, env_keys, path_values) in found {
                            servers.push(HostServer {
                                host: host.id.clone(),
                                config_path: host.config_path.clone(),
                                name,
                                command_line,
                                env_keys,
                                path_values,
                            });
                        }
                        format!("read ({count} servers)")
                    }
                    Err(reason) => format!("unreadable: {reason}"),
                }
            }
        };
        hosts.push(json!({"host": host.id, "config_path": host.config_path, "status": status}));
    }
    HostObservation { hosts, servers }
}

type ParsedServer = (
    String,
    Vec<String>,
    BTreeSet<String>,
    BTreeMap<String, String>,
);

fn parse_json_servers(
    text: &str,
    key: &str,
    path_keys: &BTreeSet<String>,
) -> Result<Vec<ParsedServer>, String> {
    let value: Value = serde_json::from_str(text).map_err(|_| "malformed JSON".to_owned())?;
    let Some(servers) = value.get(key).and_then(Value::as_object) else {
        return Ok(Vec::new());
    };
    let mut out = Vec::new();
    for (name, server) in servers {
        // Only a real server object launching a command or naming a URL counts.
        let Some(server) = server.as_object() else {
            continue;
        };
        let has_command = server
            .get("command")
            .and_then(Value::as_str)
            .is_some_and(|c| !c.trim().is_empty());
        let has_url = server
            .get("url")
            .and_then(Value::as_str)
            .is_some_and(|u| !u.trim().is_empty());
        if !has_command && !has_url {
            continue;
        }
        if server.get("disabled").and_then(Value::as_bool) == Some(true)
            || server.get("enabled").and_then(Value::as_bool) == Some(false)
        {
            continue;
        }
        let mut command_line = Vec::new();
        if let Some(command) = server.get("command").and_then(Value::as_str) {
            command_line.push(command.to_owned());
        }
        if let Some(args) = server.get("args").and_then(Value::as_array) {
            command_line.extend(args.iter().filter_map(Value::as_str).map(str::to_owned));
        }
        let mut env_keys = BTreeSet::new();
        let mut path_values = BTreeMap::new();
        if let Some(env_map) = server.get("env").and_then(Value::as_object) {
            for (env_key, env_value) in env_map {
                env_keys.insert(env_key.clone());
                if let Some(text) = env_value.as_str().filter(|_| path_keys.contains(env_key)) {
                    path_values.insert(env_key.clone(), text.to_owned());
                }
            }
        }
        out.push((name.clone(), command_line, env_keys, path_values));
    }
    Ok(out)
}

/// Removes a trailing `#` comment that is outside a basic or literal string.
fn strip_comment(line: &str) -> &str {
    let mut quote: Option<char> = None;
    let mut escaped = false;
    for (index, ch) in line.char_indices() {
        match quote {
            Some('"') if escaped => escaped = false,
            Some('"') if ch == '\\' => escaped = true,
            Some(q) if ch == q => quote = None,
            None if ch == '"' || ch == '\'' => quote = Some(ch),
            None if ch == '#' => return &line[..index],
            Some(_) | None => {}
        }
    }
    line
}

/// A complete single-line TOML string without escapes, or `None`.
fn toml_string(raw: &str) -> Option<String> {
    let raw = raw.trim();
    let inner = raw
        .strip_prefix('"')
        .and_then(|s| s.strip_suffix('"'))
        .filter(|s| !s.contains('"') && !s.contains('\\'))
        .or_else(|| {
            raw.strip_prefix('\'')
                .and_then(|s| s.strip_suffix('\''))
                .filter(|s| !s.contains('\''))
        })?;
    Some(inner.to_owned())
}

/// A bare or simply quoted TOML key without dots.
fn toml_key(raw: &str) -> Option<String> {
    let raw = raw.trim();
    if let Some(quoted) = toml_string(raw) {
        return (!quoted.is_empty() && !quoted.contains('.')).then_some(quoted);
    }
    (!raw.is_empty()
        && raw
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-'))
    .then(|| raw.to_owned())
}

fn toml_string_array(raw: &str) -> Option<Vec<String>> {
    let inner = raw.trim().strip_prefix('[')?.strip_suffix(']')?.trim();
    let inner = inner.strip_suffix(',').unwrap_or(inner);
    if inner.trim().is_empty() {
        return Some(Vec::new());
    }
    inner.split(',').map(toml_string).collect()
}

fn toml_inline_table(raw: &str) -> Option<Vec<(String, String)>> {
    let inner = raw.trim().strip_prefix('{')?.strip_suffix('}')?.trim();
    if inner.is_empty() {
        return Some(Vec::new());
    }
    inner
        .split(',')
        .map(|pair| {
            let (key, value) = pair.split_once('=')?;
            Some((toml_key(key)?, toml_string(value)?))
        })
        .collect()
}

#[derive(Default)]
struct TomlServer {
    name: String,
    command: Option<String>,
    url: bool,
    args: Vec<String>,
    env_keys: BTreeSet<String>,
    path_values: BTreeMap<String, String>,
    disabled: bool,
}

/// Parses a `[KEY.NAME]` or `[KEY.NAME.env]` header. `Ok(None)` means the
/// header is outside the servers table; `Err` means it is inside but outside
/// the supported subset, which fails the whole file closed.
fn toml_server_header(line: &str, key: &str) -> Result<Option<(String, bool)>, String> {
    let unsupported = || Err(format!("unsupported TOML header in {key}: {line}"));
    if line.starts_with("[[") {
        return if line.trim_start_matches('[').trim().starts_with(key) {
            unsupported()
        } else {
            Ok(None)
        };
    }
    let Some(header) = line.strip_prefix('[').and_then(|s| s.strip_suffix(']')) else {
        return if line.trim_start_matches('[').trim().starts_with(key) {
            unsupported()
        } else {
            Err("malformed TOML table header".into())
        };
    };
    let header = header.trim();
    if header == key {
        return Ok(Some((String::new(), false)));
    }
    let Some(rest) = header.strip_prefix(key).and_then(|r| r.strip_prefix('.')) else {
        return Ok(None);
    };
    let (name, is_env) = match rest.strip_suffix(".env") {
        Some(name) => (name, true),
        None => (rest, false),
    };
    match toml_key(name) {
        Some(name) => Ok(Some((name, is_env))),
        None => unsupported(),
    }
}

fn apply_toml_field(
    server: &mut TomlServer,
    is_env: bool,
    field: &str,
    value: &str,
    path_keys: &BTreeSet<String>,
) -> Result<(), String> {
    let bad = || format!("unsupported TOML value for {}.{field}", server.name);
    if is_env {
        let value = toml_string(value).ok_or_else(bad)?;
        if path_keys.contains(field) {
            server.path_values.insert(field.to_owned(), value);
        }
        server.env_keys.insert(field.to_owned());
        return Ok(());
    }
    match field {
        "command" => server.command = Some(toml_string(value).ok_or_else(bad)?),
        "url" => server.url = !toml_string(value).ok_or_else(bad)?.trim().is_empty(),
        "args" => server.args = toml_string_array(value).ok_or_else(bad)?,
        "enabled" => match value.trim() {
            "true" => {}
            "false" => server.disabled = true,
            _ => return Err(bad()),
        },
        "env" => {
            for (env_key, env_value) in toml_inline_table(value).ok_or_else(bad)? {
                if path_keys.contains(&env_key) {
                    server.path_values.insert(env_key.clone(), env_value);
                }
                server.env_keys.insert(env_key);
            }
        }
        _ => {}
    }
    Ok(())
}

/// Conservative scanner for `[mcp_servers.NAME]` tables in a Codex TOML
/// config. Supported subset: single-line `[mcp_servers.NAME]` and
/// `[mcp_servers.NAME.env]` headers, simple strings without escapes,
/// single-line string arrays, single-line inline env tables, and boolean
/// `enabled`. Anything else inside the servers table fails the whole file
/// closed. A server counts only when it names a non-empty command or url and
/// is not disabled. Nothing is evaluated or executed.
fn parse_toml_servers(
    text: &str,
    key: &str,
    path_keys: &BTreeSet<String>,
) -> Result<Vec<ParsedServer>, String> {
    let mut servers: Vec<TomlServer> = Vec::new();
    let mut current: Option<(usize, bool)> = None;
    let mut in_root_table = false;
    for raw_line in text.lines() {
        let line = strip_comment(raw_line).trim();
        if line.is_empty() {
            continue;
        }
        if line.starts_with('[') {
            current = None;
            in_root_table = false;
            match toml_server_header(line, key)? {
                None => {}
                Some((name, _)) if name.is_empty() => in_root_table = true,
                Some((name, is_env)) => {
                    let index = servers
                        .iter()
                        .position(|s| s.name == name)
                        .unwrap_or_else(|| {
                            servers.push(TomlServer {
                                name,
                                ..TomlServer::default()
                            });
                            servers.len() - 1
                        });
                    current = Some((index, is_env));
                }
            }
            continue;
        }
        if in_root_table {
            return Err(format!("unsupported dotted keys directly under [{key}]"));
        }
        let Some((index, is_env)) = current else {
            continue;
        };
        let (field, value) = line
            .split_once('=')
            .ok_or_else(|| "malformed TOML key/value line".to_owned())?;
        let field = toml_key(field).ok_or_else(|| "unsupported TOML key".to_owned())?;
        apply_toml_field(&mut servers[index], is_env, &field, value, path_keys)?;
    }
    Ok(servers
        .into_iter()
        .filter(|s| {
            !s.disabled && (s.url || s.command.as_ref().is_some_and(|c| !c.trim().is_empty()))
        })
        .map(|s| {
            let mut command_line: Vec<String> = s.command.into_iter().collect();
            command_line.extend(s.args);
            (s.name, command_line, s.env_keys, s.path_values)
        })
        .collect())
}

fn server_matches(tool: &Tool, server: &HostServer) -> bool {
    if tool.detection.host_server_names.contains(&server.name) {
        return true;
    }
    tool.detection.command_markers.iter().any(|marker| {
        server.command_line.iter().any(|part| {
            Path::new(part)
                .file_name()
                .is_some_and(|f| f.to_string_lossy() == marker.as_str())
                || part == marker
                || part.starts_with(&format!("{marker}@"))
                || part.starts_with(&format!("{marker}=="))
                || part.starts_with(&format!("{marker}["))
        })
    })
}

fn zotero_style_prefs_data_dirs(home: &Path, prefs: &Prefs) -> Vec<PathBuf> {
    if read_in_home(home, Path::new(&prefs.dir)).is_err_and(|e| e.contains("symlink")) {
        return Vec::new();
    }
    let root = home.join(&prefs.dir);
    if !fs::symlink_metadata(&root).is_ok_and(|m| m.is_dir()) {
        return Vec::new();
    }
    let Ok(entries) = fs::read_dir(&root) else {
        return Vec::new();
    };
    let mut profiles: Vec<std::ffi::OsString> = entries
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
        .map(|e| e.file_name())
        .collect();
    profiles.sort();
    let needle = format!("\"{}\"", prefs.pref);
    let mut out = Vec::new();
    for profile in profiles.into_iter().take(MAX_PREFS_PROFILES) {
        let relative = Path::new(&prefs.dir).join(profile).join(&prefs.file);
        let Ok(Some(text)) = read_in_home(home, &relative) else {
            continue;
        };
        for line in text.lines().filter(|line| line.contains(&needle)) {
            let after = line.split_once(&needle).map_or("", |(_, rest)| rest);
            let quoted: Vec<&str> = after.split('"').collect();
            if let Some(dir) = quoted.get(1).filter(|dir| Path::new(dir).is_absolute()) {
                out.push(Path::new(dir).join(&prefs.join));
            }
        }
    }
    out
}

struct Context<'a> {
    home: &'a Path,
    hosts: &'a HostObservation,
}

fn check_prerequisite(p: &Prerequisite, ctx: &Context, matched: &[&HostServer]) -> Value {
    match p.kind.as_str() {
        "executable_any" => {
            let found: Vec<Value> = p
                .executables
                .iter()
                .filter_map(|name| {
                    find_in_path(name)
                        .map(|path| json!({"name": name, "path": path.to_string_lossy()}))
                })
                .collect();
            json!({"id": p.id, "kind": p.kind, "status": if found.is_empty() {"missing"} else {"satisfied"}, "found": found, "message": p.message})
        }
        "file_any" => {
            let mut candidates: Vec<(String, PathBuf)> = Vec::new();
            if let Some(key) = &p.path_env {
                for server in matched {
                    if let Some(value) = server.path_values.get(key) {
                        candidates.push((format!("{} {key}", server.host), PathBuf::from(value)));
                    }
                }
                if let Some(value) = env::var_os(key) {
                    candidates.push((format!("process {key}"), PathBuf::from(value)));
                }
            }
            if let Some(prefs) = &p.prefs {
                for path in zotero_style_prefs_data_dirs(ctx.home, prefs) {
                    candidates.push((format!("{} {}", prefs.file, prefs.pref), path));
                }
            }
            for relative in &p.home_paths {
                candidates.push(("default".into(), ctx.home.join(relative)));
            }
            let checked: Vec<Value> = candidates
                .iter()
                .map(|(source, path)| {
                    let exists = regular_file_without_symlinks(path);
                    json!({"source": source, "path": path.to_string_lossy(), "exists": exists})
                })
                .collect();
            let found = checked.iter().any(|c| c["exists"] == true);
            let alternative = alternative_present(p, matched);
            let satisfied = found || alternative.as_ref().is_some_and(|a| a["present"] == true);
            json!({
                "id": p.id, "kind": p.kind,
                "status": if satisfied {"satisfied"} else {"missing"},
                "satisfied_by": if found {"file"} else if satisfied {"alternative"} else {"none"},
                "checked": checked,
                "alternative": alternative,
                "message": p.message,
            })
        }
        "credential_env" => {
            let name = p.env.clone().unwrap_or_default();
            let in_host = matched.iter().any(|s| s.env_keys.contains(&name));
            let in_process = env::var_os(&name).is_some();
            json!({
                "id": p.id, "kind": p.kind, "env_name": name,
                "status": if in_host || in_process {"satisfied"} else {"missing"},
                "present_in_host_config": in_host, "present_in_process_env": in_process,
                "value_reported": false, "message": p.message,
            })
        }
        _ => json!({"id": p.id, "kind": p.kind, "status": "unsupported", "message": p.message}),
    }
}

/// True only for an absolute path to a regular file where no component,
/// including the file itself, is a symlink.
fn regular_file_without_symlinks(path: &Path) -> bool {
    if !path.is_absolute() || path.components().any(|c| matches!(c, Component::ParentDir)) {
        return false;
    }
    let mut current = PathBuf::new();
    for component in path.components() {
        current.push(component.as_os_str());
        match fs::symlink_metadata(&current) {
            Ok(meta) if meta.file_type().is_symlink() => return false,
            Ok(_) => {}
            Err(_) => return false,
        }
    }
    fs::symlink_metadata(&current).is_ok_and(|m| m.is_file())
}

/// Alternative satisfaction must come from one source: every named key in a
/// single matched host server, or every named key in the process env. Names
/// are never unioned across sources, and values are never read.
fn alternative_present(p: &Prerequisite, matched: &[&HostServer]) -> Option<Value> {
    if p.alternative_env_all.is_empty() {
        return None;
    }
    let server = matched.iter().find(|s| {
        p.alternative_env_all
            .iter()
            .all(|name| s.env_keys.contains(name))
    });
    let process = p
        .alternative_env_all
        .iter()
        .all(|name| env::var_os(name).is_some());
    let source = match (server, process) {
        (Some(s), _) => json!({"kind": "host_config", "host": s.host, "server_name": s.name}),
        (None, true) => json!({"kind": "process_env"}),
        (None, false) => Value::Null,
    };
    Some(json!({
        "label": p.alternative_label,
        "env_names": p.alternative_env_all,
        "present": !source.is_null(),
        "source": source,
        "values_reported": false,
    }))
}

fn rank(state: &str) -> u8 {
    match state {
        "installed" => 1,
        "configured" => 2,
        _ => 0,
    }
}

fn observe_tool(tool: &Tool, entry: &UseCaseTool, ctx: &Context) -> (Value, bool) {
    let d = &tool.detection;
    let executables: Vec<Value> = d
        .executables
        .iter()
        .filter_map(|name| {
            find_in_path(name).map(|path| json!({"name": name, "path": path.to_string_lossy()}))
        })
        .collect();
    let launchers: Vec<Value> = d
        .launcher_executables
        .iter()
        .filter_map(|name| {
            find_in_path(name).map(|path| json!({"name": name, "path": path.to_string_lossy()}))
        })
        .collect();
    let skills = find_exact_skills(ctx.home, &d.skill_dirs);
    let skills_ok = if d.skill_dirs.is_empty() {
        false
    } else if d.skill_match.as_deref() == Some("all") {
        d.skill_dirs.iter().all(|name| {
            skills.iter().any(|m| {
                Path::new(m)
                    .file_name()
                    .is_some_and(|f| f.to_string_lossy() == name.as_str())
            })
        })
    } else {
        !skills.is_empty()
    };
    let installed = !executables.is_empty() || skills_ok;
    let matched: Vec<&HostServer> = ctx
        .hosts
        .servers
        .iter()
        .filter(|server| !d.host_server_names.is_empty() && server_matches(tool, server))
        .collect();
    // Only an enabled host MCP server entry configures a tool. MOZAK adapter
    // registries are never read and never count.
    let configured = !matched.is_empty();
    let mut state = if configured {
        "configured"
    } else if installed {
        "installed"
    } else {
        "missing"
    };
    let prerequisites: Vec<Value> = tool
        .prerequisites
        .iter()
        .map(|p| check_prerequisite(p, ctx, &matched))
        .collect();
    let unmet = prerequisites.iter().any(|p| p["status"] != "satisfied");
    if state != "missing" && unmet {
        state = "prerequisite_missing";
    }
    let ready = state != "prerequisite_missing" && rank(state) >= rank(&tool.ready_at);
    let mcp = tool.kind == "mcp_server";
    let report = json!({
        "id": tool.id,
        "name": tool.name,
        "kind": tool.kind,
        "requirement": entry.requirement,
        "group": entry.group,
        "ready_at": tool.ready_at,
        "state": state,
        "ready": ready,
        "installed": {
            "status": if installed {"present"} else {"absent"},
            "executables": executables,
            "launchers": launchers,
            "skills": skills,
        },
        "configured": {
            "status": if configured {"present"} else {"absent"},
            "hosts": matched.iter().map(|s| json!({"host": s.host, "config_path": s.config_path, "server_name": s.name})).collect::<Vec<_>>(),
        },
        "prerequisites": prerequisites,
        "credentials": credential_presence(tool, &matched),
        "handshake": if mcp {"not_observed"} else {"not_applicable"},
        "usable": "unknown",
        "write_grant": "not_observed",
        "next_step": next_step(tool, state, &prerequisites),
    });
    (report, ready)
}

/// Reports which declared credential env names are present. Never values.
fn credential_presence(tool: &Tool, matched: &[&HostServer]) -> Value {
    let declared: BTreeSet<&String> = tool
        .credentials
        .required_env
        .iter()
        .chain(&tool.credentials.optional_env)
        .collect();
    let host_env: BTreeSet<&String> = matched
        .iter()
        .flat_map(|s| s.env_keys.iter())
        .filter(|k| declared.contains(k))
        .collect();
    let process_env: Vec<&String> = declared
        .iter()
        .copied()
        .filter(|k| env::var_os(k).is_some())
        .collect();
    json!({
        "required_env_names": tool.credentials.required_env,
        "optional_env_names": tool.credentials.optional_env,
        "present_in_host_config": host_env,
        "present_in_process_env": process_env,
        "values_reported": false,
    })
}

fn next_step(tool: &Tool, state: &str, prerequisites: &[Value]) -> String {
    let probe = |key: &str| {
        tool.probes
            .as_ref()
            .and_then(|p| p[key].as_str())
            .map(str::to_owned)
    };
    match state {
        "missing" => tool.install.first().map_or_else(
            || {
                format!(
                    "{} is optional and only detected when already present.",
                    tool.name
                )
            },
            |step| format!("Owner runs deliberately: {step}"),
        ),
        "installed" if tool.ready_at == "configured" => format!(
            "Register server `{}` with the agent host. Exact snippets: `mozak stack recommend USE_CASE`.",
            tool.detection
                .host_server_names
                .first()
                .map_or("", String::as_str)
        ),
        "prerequisite_missing" => prerequisites
            .iter()
            .find(|p| p["status"] != "satisfied")
            .and_then(|p| p["message"].as_str())
            .unwrap_or_default()
            .to_owned(),
        _ => probe("handshake").map_or_else(
            || "Nothing to do.".into(),
            |h| format!("Agent-host probe (not run by MOZAK): {h}"),
        ),
    }
}

fn evaluate_use_case(catalog: &Catalog, use_case: &UseCase, ctx: &Context) -> Value {
    let mut tools = Vec::new();
    let mut required_ok = true;
    let mut groups: BTreeMap<&str, bool> = BTreeMap::new();
    for entry in &use_case.tools {
        let Some(tool) = catalog.tool(&entry.tool_id) else {
            continue;
        };
        let (report, ready) = observe_tool(tool, entry, ctx);
        match (entry.requirement.as_str(), entry.group.as_deref()) {
            ("required", _) => required_ok &= ready,
            ("any_of", Some(group)) => *groups.entry(group).or_insert(false) |= ready,
            _ => {}
        }
        tools.push(report);
    }
    let ready = required_ok && groups.values().all(|ok| *ok);
    json!({
        "id": use_case.id,
        "title": use_case.title,
        "state": if ready {"ready"} else {"incomplete"},
        "tools": tools,
    })
}

fn check(catalog: &Catalog, home: &Path, use_case: Option<&str>) -> Result<ExitCode, String> {
    let home = match safe_home(home) {
        Ok(home) => home,
        Err(message) => return invalid("stack check", &message, &[]),
    };
    if use_case.is_some_and(|id| catalog.use_case(id).is_none()) {
        let id = use_case.unwrap_or_default();
        return invalid(
            "stack check",
            &format!("unknown use case: {id}"),
            &catalog.use_case_ids(),
        );
    }
    let hosts = observe_hosts(catalog, &home);
    let ctx = Context {
        home: &home,
        hosts: &hosts,
    };
    let chosen: Vec<&UseCase> = match use_case {
        Some(id) => selected(catalog, id),
        None => catalog.use_cases.iter().collect(),
    };
    let reports: Vec<Value> = chosen
        .iter()
        .map(|u| evaluate_use_case(catalog, u, &ctx))
        .collect();
    let gating = gating_use_cases(use_case);
    let ready = reports
        .iter()
        .filter(|r| gating.iter().any(|g| r["id"] == *g))
        .all(|r| r["state"] == "ready");
    let mut next_steps: Vec<Value> = Vec::new();
    for report in reports
        .iter()
        .filter(|r| gating.iter().any(|g| r["id"] == *g))
    {
        for tool in report["tools"].as_array().into_iter().flatten() {
            let blocking = matches!(tool["requirement"].as_str(), Some("required" | "any_of"));
            if blocking && tool["ready"] == false {
                next_steps.push(json!({"tool_id": tool["id"], "use_case": report["id"], "step": tool["next_step"]}));
            }
        }
    }
    emit(&json!({
        "schema_version": 1,
        "command": "stack check",
        "home": home.to_string_lossy(),
        "use_case": use_case,
        "catalog": catalog_identity(catalog),
        "state": if ready {"ready"} else {"incomplete"},
        "gating_use_cases": gating,
        "observation_boundary": {
            "observed": ["executables_on_path", "skill_directories", "host_mcp_config_files", "declared_prerequisite_files", "credential_env_names"],
            "not_observed": NOT_OBSERVED,
            "strongest_observable_state": "configured",
        },
        "host_configs": hosts.hosts,
        "use_cases": reports,
        "next_steps": next_steps,
        "effects": no_effects(),
    }))?;
    Ok(if ready {
        ExitCode::SUCCESS
    } else {
        ExitCode::from(2)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The embedded catalog with any legacy adapter material stripped, so
    /// these tests exercise the MCP-only parser independent of catalog edits.
    fn clean_value() -> Value {
        let mut value: Value = serde_json::from_slice(CATALOG_BYTES).unwrap();
        let object = value.as_object_mut().unwrap();
        object.remove("adapter_registry_path");
        let legacy: BTreeSet<String> = object["tools"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|t| t["kind"] == "legacy_adapter")
            .map(|t| t["id"].as_str().unwrap().to_owned())
            .collect();
        object["tools"]
            .as_array_mut()
            .unwrap()
            .retain(|t| t["kind"] != "legacy_adapter");
        for tool in object["tools"].as_array_mut().unwrap() {
            let tool = tool.as_object_mut().unwrap();
            tool.remove("adapter");
            tool["detection"]
                .as_object_mut()
                .unwrap()
                .remove("adapter_bindings");
        }
        let use_cases = object["use_cases"].as_array_mut().unwrap();
        for use_case in use_cases.iter_mut() {
            use_case["tools"].as_array_mut().unwrap().retain(|t| {
                !legacy.contains(t["tool_id"].as_str().unwrap())
                    && t["requirement"] != "legacy_alternative"
            });
        }
        use_cases.retain(|u| !u["tools"].as_array().unwrap().is_empty());
        value
    }

    fn clean_catalog() -> Catalog {
        parse_catalog(&serde_json::to_vec(&clean_value()).unwrap()).unwrap()
    }

    fn parse_err(value: &Value) -> String {
        parse_catalog(&serde_json::to_vec(value).unwrap())
            .err()
            .expect("catalog must be rejected")
    }

    #[test]
    fn embedded_catalog_is_valid() {
        let catalog = load_catalog().unwrap();
        assert!(catalog.use_case("literature").is_some());
        assert!(catalog.tools.iter().all(|t| t.kind != "legacy_adapter"));
    }

    #[test]
    fn clean_catalog_parses() {
        let catalog = clean_catalog();
        assert!(catalog.use_case(BASELINE).is_some());
    }

    #[test]
    fn legacy_adapter_catalog_shapes_are_rejected() {
        let mut registry = clean_value();
        registry["adapter_registry_path"] = json!(".config/mozak/adapters.json");
        assert!(parse_err(&registry).contains("adapter_registry_path"));

        let mut kind = clean_value();
        kind["tools"][0]["kind"] = json!("legacy_adapter");
        assert!(parse_err(&kind).contains("kind"));

        let mut field = clean_value();
        field["tools"][0]["adapter"] = json!("arxiv");
        assert!(parse_err(&field).contains("adapter"));

        let mut bindings = clean_value();
        bindings["tools"][0]["detection"]["adapter_bindings"] = json!(["arxiv"]);
        assert!(parse_err(&bindings).contains("adapter_bindings"));

        let mut requirement = clean_value();
        requirement["use_cases"][0]["tools"][0]["requirement"] = json!("legacy_alternative");
        assert!(parse_err(&requirement).contains("invalid requirement"));
    }

    #[test]
    fn mcp_tool_ids_must_be_exact_distinct_mcp_servers() {
        let catalog = clean_catalog();
        let ids = |v: &[&str]| v.iter().map(|s| (*s).to_owned()).collect::<Vec<_>>();
        assert!(validate_mcp_tool_ids_in(&catalog, &ids(&["arxiv-mcp"])).is_ok());
        assert!(validate_mcp_tool_ids_in(&catalog, &ids(&["arxiv-mcp", "zotero-mcp"])).is_ok());
        assert!(validate_mcp_tool_ids_in(&catalog, &[]).is_err());
        let many = vec!["arxiv-mcp".to_owned(); MAX_MCP_TOOL_IDS + 1];
        assert!(
            validate_mcp_tool_ids_in(&catalog, &many)
                .unwrap_err()
                .contains("at most")
        );
        let dup = validate_mcp_tool_ids_in(&catalog, &ids(&["arxiv-mcp", "arxiv-mcp"]));
        assert!(dup.unwrap_err().contains("duplicate"));
        let skill = validate_mcp_tool_ids_in(&catalog, &ids(&["adhd-skill"]));
        assert!(skill.unwrap_err().contains("not an MCP server"));
        let exe = validate_mcp_tool_ids_in(&catalog, &ids(&["termaid"]));
        assert!(exe.unwrap_err().contains("not an MCP server"));
        for bad in ["", "ARXIV-MCP", "arxiv", "arxiv-mcp ", "adapter-arxiv"] {
            assert!(
                validate_mcp_tool_ids_in(&catalog, &ids(&[bad])).is_err(),
                "{bad:?} accepted"
            );
        }
    }

    #[test]
    fn gating_never_duplicates_baseline() {
        assert_eq!(gating_use_cases(None), [BASELINE]);
        assert_eq!(gating_use_cases(Some(BASELINE)), [BASELINE]);
        assert_eq!(
            gating_use_cases(Some("literature")),
            [BASELINE, "literature"]
        );
    }

    #[test]
    fn catalog_rejects_unknown_tool_reference() {
        let mut value: Value = serde_json::from_slice(CATALOG_BYTES).unwrap();
        value["use_cases"][1]["tools"][0]["tool_id"] = json!("nope");
        let bytes = serde_json::to_vec(&value).unwrap();
        let err = parse_catalog(&bytes).err().unwrap();
        assert!(err.contains("unknown tool"));
    }

    #[test]
    fn catalog_rejects_unpinned_mcp_server() {
        let mut value: Value = serde_json::from_slice(CATALOG_BYTES).unwrap();
        let tools = value["tools"].as_array_mut().unwrap();
        let arxiv = tools.iter_mut().find(|t| t["id"] == "arxiv-mcp").unwrap();
        arxiv["upstream"]["pinned_version"] = json!("");
        let bytes = serde_json::to_vec(&value).unwrap();
        assert!(parse_catalog(&bytes).is_err());
    }

    #[test]
    fn toml_scanner_keeps_only_command_and_env_names() {
        let keys: BTreeSet<String> = ["ZOTERO_DB_PATH".to_owned()].into();
        let text = "[mcp_servers.zotero]\ncommand = \"/x/zotero-mcp\"\nargs = [\"serve\"]\n[mcp_servers.zotero.env]\nZOTERO_API_KEY = \"secret\"\nZOTERO_DB_PATH = \"/db/zotero.sqlite\"\n[other]\nk = 1\n";
        let parsed = parse_toml_servers(text, "mcp_servers", &keys).unwrap();
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].1, vec!["/x/zotero-mcp", "serve"]);
        assert!(parsed[0].2.contains("ZOTERO_API_KEY"));
        assert_eq!(parsed[0].3.len(), 1);
        assert!(!format!("{:?}", parsed[0].3).contains("secret"));
    }

    #[test]
    fn toml_scanner_fails_closed_and_ignores_disabled_or_empty_servers() {
        let keys = BTreeSet::new();
        assert!(
            parse_toml_servers(
                "[mcp_servers.arxiv\ncommand = \"uvx\"\n",
                "mcp_servers",
                &keys
            )
            .is_err()
        );
        assert!(
            parse_toml_servers(
                "[mcp_servers.arxiv]\ncommand = \"uvx\n",
                "mcp_servers",
                &keys
            )
            .is_err()
        );
        assert!(
            parse_toml_servers(
                "[mcp_servers]\narxiv.command = \"uvx\"\n",
                "mcp_servers",
                &keys
            )
            .is_err()
        );
        let disabled = "[mcp_servers.arxiv]\ncommand = \"uvx\" # launcher\nenabled = false # off\n";
        assert!(
            parse_toml_servers(disabled, "mcp_servers", &keys)
                .unwrap()
                .is_empty()
        );
        let empty = "[mcp_servers.arxiv]\nargs = [\"arxiv-mcp-server\"]\n";
        assert!(
            parse_toml_servers(empty, "mcp_servers", &keys)
                .unwrap()
                .is_empty()
        );
        let ok = "[mcp_servers.arxiv] # comment\ncommand = \"uvx\"\nargs = [\"arxiv-mcp-server@0.8.1\"]\nenabled = true\n";
        assert_eq!(
            parse_toml_servers(ok, "mcp_servers", &keys).unwrap().len(),
            1
        );
    }

    #[test]
    fn json_servers_require_object_with_command_or_url() {
        let keys = BTreeSet::new();
        let text = r#"{"servers":{"arxiv":null,"zotero":{"args":[]},"overleaf":{"command":"overleaf-mcp","disabled":true},"remote":{"url":"https://x"}}}"#;
        let parsed = parse_json_servers(text, "servers", &keys).unwrap();
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].0, "remote");
    }
}
