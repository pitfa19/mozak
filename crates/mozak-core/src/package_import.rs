use crate::kb::{KbPackageRegistration, KbRegistry, load_registry};
use crate::knowledge_package::load_knowledge_package;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PackageImportApproval {
    pub schema_version: u64,
    pub decision: bool,
    pub owner: String,
    pub approved_at: String,
    pub rationale: String,
    pub package_id: String,
    pub project_id: String,
    pub release_id: String,
    pub target_registry_sha256: String,
    pub output_root: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[allow(clippy::struct_excessive_bools)]
pub struct PackageImportReceipt {
    pub schema_version: u64,
    pub command: &'static str,
    pub authority: &'static str,
    pub authority_transferred: bool,
    pub package_selection_inferred: bool,
    pub network_used: bool,
    pub source_package_modified: bool,
    pub input_registry_modified: bool,
    pub package_id: String,
    pub project_id: String,
    pub release_id: String,
    pub approval_sha256: String,
    pub input_registry_sha256: String,
    pub output_registry_sha256: String,
    pub owned_package_path: String,
}

fn fail<T>(message: impl Into<String>) -> Result<T, String> {
    Err(message.into())
}
fn sha(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn canonical_utc_timestamp(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 20
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes[10] != b'T'
        || bytes[13] != b':'
        || bytes[16] != b':'
        || bytes[19] != b'Z'
        || bytes.iter().enumerate().any(|(index, byte)| {
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

fn read_regular(path: &Path, label: &str) -> Result<Vec<u8>, String> {
    let meta = fs::symlink_metadata(path).map_err(|e| format!("cannot read {label}: {e}"))?;
    if meta.file_type().is_symlink() || !meta.file_type().is_file() {
        return fail(format!("{label} must be a regular non-symlink file"));
    }
    fs::read(path).map_err(|e| format!("cannot read {label}: {e}"))
}

fn safe_output(path: &Path) -> Result<(), String> {
    if fs::symlink_metadata(path).is_ok() {
        return fail("output root already exists");
    }
    let name = path
        .file_name()
        .and_then(|v| v.to_str())
        .ok_or("output root needs a UTF-8 file name")?;
    if name.is_empty() || path.components().any(|c| matches!(c, Component::ParentDir)) {
        return fail("unsafe output root");
    }
    let parent = path
        .parent()
        .ok_or("output root needs a parent directory")?;
    let meta =
        fs::symlink_metadata(parent).map_err(|e| format!("cannot read output parent: {e}"))?;
    if meta.file_type().is_symlink() || !meta.is_dir() {
        return fail("output parent must be a non-symlink directory");
    }
    Ok(())
}

fn canonical_output(path: &Path) -> Result<PathBuf, String> {
    safe_output(path)?;
    let parent = path
        .parent()
        .expect("validated parent")
        .canonicalize()
        .map_err(|e| format!("cannot canonicalize output parent: {e}"))?;
    if parent.to_str().is_none() {
        return fail("canonical output parent must be UTF-8");
    }
    Ok(parent.join(path.file_name().expect("validated name")))
}

fn copy_closed(source: &Path, target: &Path) -> Result<(), String> {
    fn visit(source: &Path, target: &Path) -> Result<(), String> {
        let mut entries = fs::read_dir(source)
            .map_err(|e| format!("cannot read package directory: {e}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("cannot read package entry: {e}"))?;
        entries.sort_by_key(std::fs::DirEntry::file_name);
        for entry in entries {
            let meta = entry
                .file_type()
                .map_err(|e| format!("cannot inspect package entry: {e}"))?;
            let destination = target.join(entry.file_name());
            if meta.is_symlink() {
                return fail("source package contains a symlink");
            }
            if meta.is_dir() {
                fs::create_dir(&destination)
                    .map_err(|e| format!("cannot create staged directory: {e}"))?;
                visit(&entry.path(), &destination)?;
            } else if meta.is_file() {
                let bytes = fs::read(entry.path())
                    .map_err(|e| format!("cannot read source package bytes: {e}"))?;
                fs::write(&destination, bytes)
                    .map_err(|e| format!("cannot write staged package bytes: {e}"))?;
            } else {
                return fail("source package contains a special filesystem entry");
            }
        }
        Ok(())
    }
    fs::create_dir(target).map_err(|e| format!("cannot create staged package root: {e}"))?;
    visit(source, target)
}

/// Imports one exactly approved, already valid local package into a newly reconstructed KB root.
///
/// # Errors
/// Returns an error before final publication for any invalid package, registry, approval, path,
/// identity, history, copy, staging, validation, or atomic rename condition.
#[allow(clippy::too_many_lines)]
pub fn import_package(
    source_package: &Path,
    input_registry_root: &Path,
    approval_path: &Path,
    output_root: &Path,
) -> Result<PackageImportReceipt, String> {
    let output_root = canonical_output(output_root)?;
    let package = load_knowledge_package(source_package).map_err(|e| e.to_string())?;
    let kb = load_registry(input_registry_root).map_err(|e| e.to_string())?;
    if output_root.starts_with(&package.root) || output_root.starts_with(&kb.registry_root) {
        return fail("output root must not be inside the source package or input registry");
    }
    let approval_bytes = read_regular(approval_path, "approval artifact")?;
    let approval: PackageImportApproval = serde_json::from_slice(&approval_bytes)
        .map_err(|e| format!("invalid approval artifact: {e}"))?;
    if approval.schema_version != 1 {
        return fail("approval schema_version must be 1");
    }
    if !approval.decision {
        return fail("owner approval decision must be true");
    }
    if approval.owner.trim().is_empty() || approval.rationale.trim().is_empty() {
        return fail("approval owner and rationale must not be empty");
    }
    if !canonical_utc_timestamp(&approval.approved_at) {
        return fail("approval approved_at must be canonical UTC in YYYY-MM-DDTHH:MM:SSZ form");
    }
    if approval.output_root != output_root.to_string_lossy() {
        return fail("approval output_root does not exactly match canonical output root");
    }
    if approval.target_registry_sha256 != kb.registry_sha256 {
        return fail("stale target registry base");
    }
    if approval.package_id != package.manifest.package_id
        || approval.project_id != package.manifest.project_id
        || approval.release_id != package.manifest.release_id
    {
        return fail("approval package identity does not exactly match source package");
    }
    for existing in &kb.registry.packages {
        if existing.package_id == package.manifest.package_id {
            return fail("exact package duplicate is rejected");
        }
        if existing.project_id == package.manifest.project_id
            && existing.release_id == package.manifest.release_id
        {
            return fail("project release is already registered with another package identity");
        }
    }

    let digest = package
        .manifest
        .package_id
        .strip_prefix("sha256:")
        .ok_or("invalid package identity")?;
    let owned = format!("packages/sha256/{digest}");
    let mut registry: KbRegistry = kb.registry.clone();
    registry.schema_version = 2;
    registry.packages.push(KbPackageRegistration {
        package_id: package.manifest.package_id.clone(),
        project_id: package.manifest.project_id.clone(),
        release_id: package.manifest.release_id.clone(),
        path: owned.clone(),
    });
    registry.packages.sort_by(|a, b| {
        (&a.project_id, &a.release_id, &a.package_id).cmp(&(
            &b.project_id,
            &b.release_id,
            &b.package_id,
        ))
    });
    let registry_bytes = serde_json::to_vec_pretty(&registry)
        .map_err(|e| format!("cannot serialize output registry: {e}"))?;

    let parent = output_root
        .parent()
        .ok_or("canonical output root needs a parent")?;
    let name = output_root
        .file_name()
        .and_then(|v| v.to_str())
        .ok_or("canonical output root needs a UTF-8 name")?;
    let staging = parent.join(format!(
        ".{name}.mozak-import-staging-{}",
        std::process::id()
    ));
    if fs::symlink_metadata(&staging).is_ok() {
        return fail("staging target already exists");
    }
    let result: Result<(), String> = (|| {
        fs::create_dir(&staging).map_err(|e| format!("cannot create staging root: {e}"))?;
        fs::create_dir_all(staging.join("packages/sha256"))
            .map_err(|e| format!("cannot create package store: {e}"))?;
        for existing in &kb.packages {
            copy_closed(&existing.root, &staging.join(&existing.registration.path))?;
        }
        copy_closed(&package.root, &staging.join(&owned))?;
        fs::write(staging.join("kb.json"), &registry_bytes)
            .map_err(|e| format!("cannot write staged registry: {e}"))?;
        load_registry(&staging).map_err(|e| format!("staged KB validation failed: {e}"))?;
        fs::rename(&staging, &output_root)
            .map_err(|e| format!("cannot atomically publish output KB: {e}"))?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    result?;
    let output = load_registry(&output_root).map_err(|e| e.to_string())?;
    Ok(PackageImportReceipt {
        schema_version: 1,
        command: "kb import-package",
        authority: "owner_approved_local_copy",
        authority_transferred: false,
        package_selection_inferred: false,
        network_used: false,
        source_package_modified: false,
        input_registry_modified: false,
        package_id: package.manifest.package_id,
        project_id: package.manifest.project_id,
        release_id: package.manifest.release_id,
        approval_sha256: sha(&approval_bytes),
        input_registry_sha256: kb.registry_sha256,
        output_registry_sha256: output.registry_sha256,
        owned_package_path: owned,
    })
}
