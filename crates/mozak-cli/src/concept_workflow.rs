use mozak_core::concept::{
    Adoption, AssumptionOutcome, Concept, Translation, concept_hash, validate_concept_json,
    validate_translation_json,
};
use serde_json::json;
use std::{fmt::Write as _, fs, path::Path, process::ExitCode};

/// Validates one source-owned Concept.
pub fn validate(path: &Path) -> Result<ExitCode, String> {
    let concept = validate_concept_json(&read(path)?).map_err(|error| error.to_string())?;
    print(&json!({
        "schema_version": 1,
        "command": "concept validate",
        "path": display(path)?,
        "state": "valid",
        "concept_id": concept.id,
        "concept_version": concept.version,
        "concept_sha256": concept_hash(&concept).map_err(|error| error.to_string())?,
        "origin_scope_id": concept.origin.scope_id,
        "evidence_count": concept.evidence.len(),
        "assumption_count": concept.assumptions.len(),
        "load_bearing_assumptions": load_bearing(&concept),
        "authority": "advisory_only"
    }))
}

/// Validates one target-owned Translation against its exact source Concept.
pub fn translation_validate(
    concept_path: &Path,
    translation_path: &Path,
) -> Result<ExitCode, String> {
    let concept = validate_concept_json(&read(concept_path)?).map_err(|e| e.to_string())?;
    let translation = validate_translation_json(&read(translation_path)?, &concept)
        .map_err(|error| error.to_string())?;
    print(&json!({
        "schema_version": 1,
        "command": "concept translation validate",
        "concept": display(concept_path)?,
        "translation": display(translation_path)?,
        "state": "valid",
        "concept_id": concept.id,
        "concept_version": concept.version,
        "translation_id": translation.id,
        "target_scope_id": translation.target_scope_id,
        "adoption": adoption(translation.adoption),
        "assumptions_re_derived": translation.assumption_checks.len(),
        "outcomes": outcomes(&translation),
        "target_evidence_count": translation.target_evidence.len(),
        "authority": "advisory_only"
    }))
}

/// Reports one Concept and how one target re-derived each assumption.
pub fn list(concept_path: &Path, translation_path: Option<&Path>) -> Result<ExitCode, String> {
    let concept = validate_concept_json(&read(concept_path)?).map_err(|e| e.to_string())?;
    let mut out = String::new();
    let _ = writeln!(
        out,
        "Concept: {} v{} [advisory_only]",
        concept.id, concept.version
    );
    let _ = writeln!(out, "  {}", concept.title);
    let _ = writeln!(out, "  Invariant: {}", concept.invariant);
    let _ = writeln!(
        out,
        "  Origin: {} @ {}",
        concept.origin.scope_id, concept.origin.revision
    );
    let _ = writeln!(out, "  Evidence: {}", concept.evidence.len());

    let translation = match translation_path {
        Some(path) => {
            Some(validate_translation_json(&read(path)?, &concept).map_err(|e| e.to_string())?)
        }
        None => None,
    };
    out.push_str("  Assumptions:\n");
    for assumption in &concept.assumptions {
        let marker = if assumption.load_bearing {
            "load-bearing"
        } else {
            "supporting"
        };
        let _ = writeln!(
            out,
            "    {} [{}] {}",
            assumption.id, marker, assumption.statement
        );
        if let Some(translation) = &translation {
            if let Some(check) = translation
                .assumption_checks
                .iter()
                .find(|check| check.assumption_id == assumption.id)
            {
                let _ = writeln!(out, "      -> {}", describe(&check.outcome));
            }
        }
    }
    if let Some(translation) = &translation {
        let _ = writeln!(
            out,
            "  Translation: {} in {} [{}]",
            translation.id,
            translation.target_scope_id,
            adoption(translation.adoption)
        );
    }
    print!("{out}");
    Ok(ExitCode::SUCCESS)
}

fn describe(outcome: &AssumptionOutcome) -> String {
    match outcome {
        AssumptionOutcome::Holds { target_evidence_id } => {
            format!("holds, evidenced by {target_evidence_id}")
        }
        AssumptionOutcome::Replaced { substitution, .. } => format!("replaced: {substitution}"),
        AssumptionOutcome::Rejected { rationale } => format!("rejected: {rationale}"),
        AssumptionOutcome::CouldNotCheck { reason } => format!("could not check: {reason}"),
    }
}

fn outcomes(translation: &Translation) -> serde_json::Value {
    let mut holds = 0;
    let mut replaced = 0;
    let mut rejected = 0;
    let mut could_not_check = 0;
    for check in &translation.assumption_checks {
        match check.outcome {
            AssumptionOutcome::Holds { .. } => holds += 1,
            AssumptionOutcome::Replaced { .. } => replaced += 1,
            AssumptionOutcome::Rejected { .. } => rejected += 1,
            AssumptionOutcome::CouldNotCheck { .. } => could_not_check += 1,
        }
    }
    json!({
        "holds": holds,
        "replaced": replaced,
        "rejected": rejected,
        "could_not_check": could_not_check
    })
}

fn load_bearing(concept: &Concept) -> Vec<&str> {
    concept
        .assumptions
        .iter()
        .filter(|assumption| assumption.load_bearing)
        .map(|assumption| assumption.id.as_str())
        .collect()
}

fn adoption(adoption: Adoption) -> &'static str {
    match adoption {
        Adoption::Adopted => "adopted",
        Adoption::Qualified => "qualified",
        Adoption::Declined => "declined",
    }
}

fn read(path: &Path) -> Result<String, String> {
    fs::read_to_string(path).map_err(|error| format!("cannot read {}: {error}", path.display()))
}

fn display(path: &Path) -> Result<String, String> {
    path.canonicalize()
        .map(|path| path.to_string_lossy().into_owned())
        .map_err(|error| format!("cannot resolve {}: {error}", path.display()))
}

fn print(value: &serde_json::Value) -> Result<ExitCode, String> {
    println!(
        "{}",
        serde_json::to_string(value).map_err(|error| error.to_string())?
    );
    Ok(ExitCode::SUCCESS)
}
