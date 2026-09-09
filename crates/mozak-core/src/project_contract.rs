//! Provider-neutral contracts for `.mozak/project.yml` and `.mozak/idea.md`.

use serde::{Deserialize, Serialize};
use serde_yaml::{Mapping, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt::{Display, Formatter};

const IDEA_SECTIONS: [&str; 5] = [
    "Intent",
    "Desired outcomes",
    "Boundaries",
    "Assumptions",
    "Open questions",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContractError(pub String);

impl Display for ContractError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for ContractError {}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ProjectManifest {
    pub version: u64,
    pub framework_contract_version: u64,
    pub project: ProjectIdentity,
    pub repository: RepositoryIdentity,
    pub owned_paths: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ProjectIdentity {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RepositoryIdentity {
    pub revision: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IdeaDocument {
    pub title: String,
    pub sections: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BootstrapMigrationFixture {
    pub version: u64,
    pub decision: String,
    pub source: BootstrapReferences,
    pub migrated: BootstrapReferences,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BootstrapReferences {
    pub packet_ids: Vec<String>,
    pub goal_refs: BTreeMap<String, String>,
}

/// Parses and semantically validates a version 1 project manifest.
///
/// # Errors
///
/// Returns [`ContractError`] when YAML is malformed, the closed shape differs,
/// a version is unsupported, or identity, revision, and path rules are violated.
pub fn validate_project_yaml(input: &str) -> Result<ProjectManifest, ContractError> {
    let value: Value = serde_yaml::from_str(input)
        .map_err(|error| ContractError(format!("invalid YAML: {error}")))?;
    let root = mapping(&value, "document")?;
    exact_fields(
        root,
        &[
            "version",
            "framework_contract_version",
            "project",
            "repository",
            "owned_paths",
        ],
        "",
    )?;

    let version = supported_version(root, "version", "version")?;
    let framework_contract_version = supported_version(
        root,
        "framework_contract_version",
        "framework_contract_version",
    )?;

    let project_value = required(root, "project", "project")?;
    let project = mapping(project_value, "project")?;
    exact_fields(project, &["id", "name"], "project")?;
    let id = nonempty_string(project, "id", "project.id")?;
    if !valid_project_id(&id) {
        return Err(ContractError(
            "project.id must use lowercase ASCII letters, digits, and single hyphens".into(),
        ));
    }
    let name = nonempty_string(project, "name", "project.name")?;

    let repository_value = required(root, "repository", "repository")?;
    let repository = mapping(repository_value, "repository")?;
    exact_fields(repository, &["revision"], "repository")?;
    let revision = nonempty_string(repository, "revision", "repository.revision")?;
    if revision.len() != 40
        || !revision
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err(ContractError(
            "repository.revision must be exactly 40 lowercase hexadecimal characters".into(),
        ));
    }

    let paths_value = required(root, "owned_paths", "owned_paths")?;
    let paths = paths_value
        .as_sequence()
        .ok_or_else(|| ContractError("owned_paths must be a non-empty sequence".into()))?;
    if paths.is_empty() {
        return Err(ContractError(
            "owned_paths must be a non-empty sequence".into(),
        ));
    }
    let mut owned_paths = Vec::with_capacity(paths.len());
    let mut seen = BTreeSet::new();
    for (index, value) in paths.iter().enumerate() {
        let path = value
            .as_str()
            .ok_or_else(|| ContractError(format!("owned_paths[{index}] must be a string")))?;
        validate_owned_path(path, index)?;
        if !seen.insert(path.to_owned()) {
            return Err(ContractError(format!("duplicate owned path: {path}")));
        }
        if let Some(other) = owned_paths
            .iter()
            .find(|other: &&String| path_is_ancestor(other, path) || path_is_ancestor(path, other))
        {
            return Err(ContractError(format!(
                "owned paths must not overlap: {other} and {path}"
            )));
        }
        owned_paths.push(path.to_owned());
    }

    Ok(ProjectManifest {
        version,
        framework_contract_version,
        project: ProjectIdentity { id, name },
        repository: RepositoryIdentity { revision },
        owned_paths,
    })
}

/// Parses and semantically validates a version 1 idea document.
///
/// # Errors
///
/// Returns [`ContractError`] when the title or required sections are missing,
/// duplicated, empty, unknown, or claim executable authority.
pub fn validate_idea_markdown(input: &str) -> Result<IdeaDocument, ContractError> {
    let mut title = None;
    let mut sections = BTreeMap::new();
    let mut current: Option<String> = None;
    let mut body = Vec::new();

    for line in input.lines() {
        if let Some(text) = line.strip_prefix("# ") {
            if title.is_some() || current.is_some() || text.trim().is_empty() {
                return Err(ContractError(
                    "idea document must begin with exactly one non-empty level-one title".into(),
                ));
            }
            title = Some(text.trim().to_owned());
        } else if let Some(heading) = line.strip_prefix("## ") {
            if title.is_none() {
                return Err(ContractError(
                    "idea document must begin with exactly one non-empty level-one title".into(),
                ));
            }
            finish_section(&mut sections, current.take(), &mut body)?;
            let heading = heading.trim();
            if !IDEA_SECTIONS.contains(&heading) {
                return Err(ContractError(format!(
                    "unknown required semantics: section {heading}"
                )));
            }
            if sections.contains_key(heading) {
                return Err(ContractError(format!(
                    "duplicate required section: {heading}"
                )));
            }
            current = Some(heading.to_owned());
        } else if line.starts_with('#') {
            return Err(ContractError(
                "only level-one title and level-two contract sections are allowed".into(),
            ));
        } else if title.is_none() && !line.trim().is_empty() {
            return Err(ContractError(
                "idea document must begin with exactly one non-empty level-one title".into(),
            ));
        } else if current.is_some() {
            body.push(line);
        } else if title.is_some() && !line.trim().is_empty() {
            return Err(ContractError(
                "content before first required section is not allowed".into(),
            ));
        }
    }
    finish_section(&mut sections, current, &mut body)?;
    let title = title.ok_or_else(|| {
        ContractError("idea document must begin with exactly one non-empty level-one title".into())
    })?;
    for required_section in IDEA_SECTIONS {
        if !sections.contains_key(required_section) {
            return Err(ContractError(format!(
                "missing required section: {required_section}"
            )));
        }
    }
    let normalized = sections
        .values()
        .cloned()
        .collect::<Vec<_>>()
        .join("\n")
        .to_ascii_lowercase();
    let authority_phrases = [
        "directly authorize",
        "executable authority",
        "authorize tools to execute",
        "trusted executable",
    ];
    if authority_phrases
        .iter()
        .any(|phrase| normalized.contains(phrase))
    {
        return Err(ContractError(
            "idea document must not claim executable authority".into(),
        ));
    }
    Ok(IdeaDocument { title, sections })
}

/// Validates the explicit non-destructive bootstrap migration fixture.
///
/// # Errors
///
/// Returns [`ContractError`] when the fixture shape or decision is invalid, or
/// when migrated packet IDs and goal references differ from their sources.
pub fn validate_bootstrap_migration_json(
    input: &str,
) -> Result<BootstrapMigrationFixture, ContractError> {
    let fixture: BootstrapMigrationFixture = serde_json::from_str(input)
        .map_err(|error| ContractError(format!("invalid bootstrap migration fixture: {error}")))?;
    if fixture.version != 1 {
        return Err(ContractError(
            "bootstrap migration fixture version must be 1".into(),
        ));
    }
    if fixture.decision != "copy_json_into_canonical_history_without_rewriting_source" {
        return Err(ContractError(
            "bootstrap migration must be explicitly non-destructive".into(),
        ));
    }
    if fixture.source.packet_ids != fixture.migrated.packet_ids {
        return Err(ContractError(
            "bootstrap migration must preserve packet IDs".into(),
        ));
    }
    if fixture.source.goal_refs != fixture.migrated.goal_refs {
        return Err(ContractError(
            "bootstrap migration must preserve goal references".into(),
        ));
    }
    if fixture.source.packet_ids.is_empty() || fixture.source.goal_refs.is_empty() {
        return Err(ContractError(
            "bootstrap migration references must not be empty".into(),
        ));
    }
    Ok(fixture)
}

fn finish_section(
    sections: &mut BTreeMap<String, String>,
    current: Option<String>,
    body: &mut Vec<&str>,
) -> Result<(), ContractError> {
    if let Some(heading) = current {
        let content = body.join("\n").trim().to_owned();
        body.clear();
        if !substantive(&content) {
            return Err(ContractError(format!(
                "required section {heading} must contain substantive content"
            )));
        }
        if sections.insert(heading.clone(), content).is_some() {
            return Err(ContractError(format!(
                "duplicate required section: {heading}"
            )));
        }
    }
    Ok(())
}

fn substantive(content: &str) -> bool {
    let without_comments = remove_html_comments(content);
    let text = without_comments
        .trim()
        .trim_start_matches(['-', '*'])
        .trim()
        .to_ascii_lowercase();
    !text.is_empty()
        && !matches!(
            text.as_str(),
            "todo" | "tbd" | "n/a" | "none" | "placeholder" | "to be determined"
        )
}

fn remove_html_comments(content: &str) -> String {
    let mut remaining = content;
    let mut visible = String::new();
    while let Some(start) = remaining.find("<!--") {
        visible.push_str(&remaining[..start]);
        let after_start = &remaining[start + 4..];
        let Some(end) = after_start.find("-->") else {
            return visible;
        };
        remaining = &after_start[end + 3..];
    }
    visible.push_str(remaining);
    visible
}

fn mapping<'a>(value: &'a Value, location: &str) -> Result<&'a Mapping, ContractError> {
    value
        .as_mapping()
        .ok_or_else(|| ContractError(format!("{location} must be a mapping")))
}

fn required<'a>(
    mapping: &'a Mapping,
    key: &str,
    location: &str,
) -> Result<&'a Value, ContractError> {
    mapping
        .get(Value::String(key.to_owned()))
        .ok_or_else(|| ContractError(format!("missing required field: {location}")))
}

fn exact_fields(mapping: &Mapping, allowed: &[&str], prefix: &str) -> Result<(), ContractError> {
    for key in mapping.keys() {
        let key = key
            .as_str()
            .ok_or_else(|| ContractError("mapping keys must be strings".into()))?;
        if !allowed.contains(&key) {
            let location = if prefix.is_empty() {
                key.to_owned()
            } else {
                format!("{prefix}.{key}")
            };
            return Err(ContractError(format!("unknown field at {location}")));
        }
    }
    for key in allowed {
        let location = if prefix.is_empty() {
            (*key).to_owned()
        } else {
            format!("{prefix}.{key}")
        };
        required(mapping, key, &location)?;
    }
    Ok(())
}

fn supported_version(mapping: &Mapping, key: &str, location: &str) -> Result<u64, ContractError> {
    let version = required(mapping, key, location)?
        .as_u64()
        .ok_or_else(|| ContractError(format!("{location} must be integer 1")))?;
    if version != 1 {
        return Err(ContractError(format!(
            "unknown required semantics: {location} {version}"
        )));
    }
    Ok(version)
}

fn nonempty_string(mapping: &Mapping, key: &str, location: &str) -> Result<String, ContractError> {
    let value = required(mapping, key, location)?
        .as_str()
        .ok_or_else(|| ContractError(format!("{location} must be a non-empty string")))?
        .trim();
    if value.is_empty() {
        return Err(ContractError(format!(
            "{location} must be a non-empty string"
        )));
    }
    Ok(value.to_owned())
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

fn validate_owned_path(path: &str, index: usize) -> Result<(), ContractError> {
    if path.is_empty()
        || path.starts_with('/')
        || path.ends_with('/')
        || path.contains('\\')
        || path
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err(ContractError(format!(
            "owned_paths[{index}] must be a normalized repository-relative path without escape"
        )));
    }
    Ok(())
}

fn path_is_ancestor(parent: &str, child: &str) -> bool {
    child
        .strip_prefix(parent)
        .is_some_and(|rest| rest.starts_with('/'))
}
