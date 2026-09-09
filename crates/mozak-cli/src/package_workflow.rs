use mozak_core::knowledge_package::{load_knowledge_package, validate_package_history};
use serde_json::json;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

pub fn validate(root: &Path) -> Result<ExitCode, String> {
    let package = load_knowledge_package(root).map_err(|e| e.to_string())?;
    print_json(&json!({
        "schema_version": 1,
        "command": "package validate",
        "state": "valid",
        "project_id": package.manifest.project_id,
        "release_id": package.manifest.release_id,
        "package_id": package.manifest.package_id,
        "artifact_count": package.manifest.artifacts.len()
    }))?;
    Ok(ExitCode::SUCCESS)
}

/// Emits an in-toto v1 Statement for a sealed package, without storing it.
///
/// The statement is derived from the validated package every time, so the
/// package stays the single source of truth and there is no second copy to
/// drift. It attests to identity and derivation only.
pub fn attest(root: &Path) -> Result<ExitCode, String> {
    let package = load_knowledge_package(root).map_err(|e| e.to_string())?;
    let statement =
        mozak_core::attestation::project_statement(&package).map_err(|e| e.to_string())?;
    let text = mozak_core::attestation::statement_json(&statement).map_err(|e| e.to_string())?;
    // The statement goes to stdout rather than to a file beside the package:
    // whether to persist it is the caller's decision, not this route's.
    print!("{text}");
    Ok(ExitCode::SUCCESS)
}

pub fn list(root: &Path) -> Result<ExitCode, String> {
    let package = load_knowledge_package(root).map_err(|e| e.to_string())?;
    let artifacts = package
        .manifest
        .artifacts
        .iter()
        .map(|artifact| {
            json!({
                "kind": artifact.kind,
                "path": artifact.path,
                "media_type": artifact.media_type,
                "sha256": artifact.sha256,
                "bytes": artifact.bytes
            })
        })
        .collect::<Vec<_>>();
    print_json(&json!({
        "schema_version": 1,
        "command": "package list",
        "project_id": package.manifest.project_id,
        "release_id": package.manifest.release_id,
        "package_id": package.manifest.package_id,
        "predecessor": package.manifest.predecessor,
        "restores": package.manifest.restores,
        "artifacts": artifacts
    }))?;
    Ok(ExitCode::SUCCESS)
}

pub fn history_validate(roots: &[PathBuf]) -> Result<ExitCode, String> {
    let mut packages = roots
        .iter()
        .map(|root| load_knowledge_package(root).map_err(|e| e.to_string()))
        .collect::<Result<Vec<_>, _>>()?;
    validate_package_history(&packages).map_err(|e| e.to_string())?;
    packages.sort_by(|a, b| a.manifest.package_id.cmp(&b.manifest.package_id));
    let identities = packages
        .iter()
        .map(|package| {
            json!({
                "project_id": package.manifest.project_id,
                "release_id": package.manifest.release_id,
                "package_id": package.manifest.package_id,
                "accepted_state_version": package.release.accepted_state_version
            })
        })
        .collect::<Vec<_>>();
    print_json(&json!({
        "schema_version": 1,
        "command": "package history validate",
        "state": "valid",
        "package_count": identities.len(),
        "packages": identities
    }))?;
    Ok(ExitCode::SUCCESS)
}

fn print_json(value: &serde_json::Value) -> Result<(), String> {
    println!(
        "{}",
        serde_json::to_string(&value).map_err(|e| e.to_string())?
    );
    Ok(())
}
