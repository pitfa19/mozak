use mozak_core::{
    kb::load_registry,
    meta_transfer::{
        candidates as project_candidates, translation_packet as project_translation_packet,
    },
};
use std::{path::PathBuf, process::ExitCode};

/// Lists deterministic cross-project knowledge candidates for one registered target.
///
/// Concepts come only from the configured, validated KB. Research appears only
/// when the caller supplies exact validated run paths and always remains
/// proposal-only.
pub fn candidates(target_scope_id: &str, research_runs: &[String]) -> Result<ExitCode, String> {
    let root = crate::project_registry::configured_kb_root()?;
    let kb = load_registry(&root).map_err(|error| error.to_string())?;
    let paths = research_runs.iter().map(PathBuf::from).collect::<Vec<_>>();
    let output =
        project_candidates(&kb, target_scope_id, &paths).map_err(|error| error.to_string())?;
    println!(
        "{}",
        serde_json::to_string(&output).map_err(|error| error.to_string())?
    );
    Ok(ExitCode::SUCCESS)
}

/// Emits a read-only re-derivation packet for one exact registered Concept.
pub fn translation_packet(
    target_scope_id: &str,
    concept_id: &str,
    concept_sha256: &str,
) -> Result<ExitCode, String> {
    let root = crate::project_registry::configured_kb_root()?;
    let kb = load_registry(&root).map_err(|error| error.to_string())?;
    let output = project_translation_packet(&kb, target_scope_id, concept_id, concept_sha256)
        .map_err(|error| error.to_string())?;
    println!(
        "{}",
        serde_json::to_string(&output).map_err(|error| error.to_string())?
    );
    Ok(ExitCode::SUCCESS)
}
