use mozak_core::case_study::{
    CaseStudy, FindingState, case_hash, open_findings, proposals_by_priority, reproduction_packet,
    validate_case_json,
};
use serde_json::json;
use std::{fmt::Write as _, fs, path::Path, process::ExitCode};

/// What validation checked, and what it did not.
///
/// A valid case record reads as an endorsement to anyone who has not read the
/// contract. Kevin et al. (arXiv:2608.20614) §6.6 measured document-scan
/// scores against live outcome at Spearman -0.0181 and -0.0266 over 62 skills,
/// statistically indistinguishable from zero. MOZAK's case validation is
/// structurally that same scan tier, so the boundary belongs in the output a
/// reader actually sees rather than in prose elsewhere.
const VALIDATION_BOUNDARY: &str =
    "structure_and_internal_consistency_only: no outcome was measured and no quality is asserted";

/// Validates one pinned case record.
pub fn validate(path: &Path) -> Result<ExitCode, String> {
    let case = validate_case_json(&read(path)?).map_err(|error| error.to_string())?;
    let measured = case
        .observations
        .iter()
        .filter(|observation| observation.measured)
        .count();
    print(&json!({
        "schema_version": 1,
        "command": "case validate",
        "path": display(path)?,
        "state": "valid",
        "case_id": case.id,
        "evaluation_id": case.evaluation_id,
        "case_sha256": case_hash(&case).map_err(|error| error.to_string())?,
        "subject_scope_id": case.subject.scope_id,
        "contract_version": case.contract_version,
        "generality": generality(&case),
        "observation_count": case.observations.len(),
        "measured_observations": measured,
        "qualitative_observations": case.observations.len() - measured,
        "inconclusive_claims": case.calibration.inconclusive_claims.len(),
        "open_findings": open_findings(&case).len(),
        "derived_proposals": case.derived_proposals.len(),
        "validation_boundary": VALIDATION_BOUNDARY,
        "authority": "proposal_only"
    }))
}

/// Emits the derived reproduction packet for one case.
///
/// The packet is printed, never written beside the case, so the record stays
/// the single source of truth and no second representation can drift from it.
pub fn reproduce_packet(path: &Path) -> Result<ExitCode, String> {
    let case = validate_case_json(&read(path)?).map_err(|error| error.to_string())?;
    let packet = reproduction_packet(&case).map_err(|error| error.to_string())?;
    let mut value = serde_json::to_value(&packet).map_err(|error| error.to_string())?;
    if let Some(object) = value.as_object_mut() {
        object.insert("schema_version".to_owned(), json!(1));
        object.insert("command".to_owned(), json!("case reproduce-packet"));
        object.insert("derived".to_owned(), json!("on_demand_never_stored"));
        object.insert("validation_boundary".to_owned(), json!(VALIDATION_BOUNDARY));
    }
    print(&value)
}

/// Reports one case record, its open findings, and its derived proposals.
pub fn list(path: &Path) -> Result<ExitCode, String> {
    let case = validate_case_json(&read(path)?).map_err(|error| error.to_string())?;
    let mut out = String::new();
    let _ = writeln!(out, "Case: {} [{}]", case.id, case.evaluation_id);
    let _ = writeln!(
        out,
        "  Subject: {} {} -> {}{}",
        case.subject.scope_id,
        case.subject.baseline_revision,
        case.subject.final_revision,
        if case.subject.mozak_was_used {
            ", MOZAK used"
        } else {
            ", MOZAK not used"
        }
    );
    let _ = writeln!(out, "  Generality: {} [proposal_only]", generality(&case));
    if let (Some(performed), Some(evaluated)) =
        (&case.method.performed_by, &case.method.evaluated_by)
    {
        let _ = writeln!(out, "  Performed by {performed}, evaluated by {evaluated}");
    }
    if let Some(control) = &case.subject.control {
        let _ = writeln!(
            out,
            "  Control: {} ({})",
            control.kind,
            if control.comparable {
                "comparable"
            } else {
                "not comparable"
            }
        );
    }
    let measured = case
        .observations
        .iter()
        .filter(|observation| observation.measured)
        .count();
    let _ = writeln!(
        out,
        "  Observations: {} ({measured} measured, {} qualitative)",
        case.observations.len(),
        case.observations.len() - measured
    );

    out.push_str("  Findings:\n");
    for finding in &case.findings {
        let _ = writeln!(
            out,
            "    {} [{}] [{}] {}",
            finding.id,
            severity(finding.severity),
            state(finding.state),
            finding.summary
        );
    }
    out.push_str("  Derived proposals (proposal_only):\n");
    for proposal in proposals_by_priority(&case) {
        let _ = writeln!(
            out,
            "    {} (priority {}) {}",
            proposal.id, proposal.priority, proposal.text
        );
        let _ = writeln!(out, "      from {}", proposal.observation_ids.join(", "));
    }
    out.push_str("  Limitations:\n");
    for limitation in &case.calibration.limitations {
        let _ = writeln!(out, "    - {limitation}");
    }
    if !case.calibration.inconclusive_claims.is_empty() {
        out.push_str("  Checked but inconclusive:\n");
        for claim in &case.calibration.inconclusive_claims {
            let _ = writeln!(out, "    - {}", claim.claim);
            let _ = writeln!(out, "      missing: {}", claim.missing_evidence);
        }
    }
    let _ = writeln!(out, "  Validation checked: {VALIDATION_BOUNDARY}");
    print!("{out}");
    Ok(ExitCode::SUCCESS)
}

fn generality(case: &CaseStudy) -> &'static str {
    use mozak_core::case_study::Generality;
    match case.calibration.generality {
        Generality::SingleCase => "single_case",
        Generality::MultiCase => "multi_case",
        Generality::Comparative => "comparative",
    }
}

fn severity(severity: mozak_core::case_study::FindingSeverity) -> &'static str {
    use mozak_core::case_study::FindingSeverity;
    match severity {
        FindingSeverity::Informational => "informational",
        FindingSeverity::Low => "low",
        FindingSeverity::Medium => "medium",
        FindingSeverity::High => "high",
    }
}

fn state(state: FindingState) -> &'static str {
    match state {
        FindingState::Open => "open",
        FindingState::Closed => "closed",
        FindingState::Accepted => "accepted",
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
