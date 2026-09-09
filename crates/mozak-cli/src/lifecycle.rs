use mozak_core::{
    execution::validate_bundle_json,
    planning::{
        Plan, next_ready_goals, superseded_by, validate_input_set_json, validate_plan_json,
    },
    research::{normalize_provider_arxiv, normalize_provider_dair_ai, validate_run_json},
};
use serde_json::json;
use std::{fs, path::Path};

pub fn research_validate(path: &Path) -> Result<(), String> {
    let input = read(path)?;
    let run = validate_run_json(&input).map_err(|error| error.to_string())?;
    print_json(&json!({
        "schema_version": 1,
        "command": "research validate",
        "path": display(path)?,
        "state": "valid",
        "run_id": run.run_id,
        "evidence_count": run.evidence.len()
    }))
}

/// Validates that a condensation stays addressable back to exact evidence.
///
/// A digest or Scope input derived from a run is read instead of the run once
/// it exists. This route checks that each condensed statement still names
/// evidence that exists and pins the recorded bytes it was drawn from, so
/// altered evidence fails closed rather than silently repointing a statement.
pub fn landmarks_validate(run_path: &Path, index_path: &Path) -> Result<(), String> {
    let run = validate_run_json(&read(run_path)?).map_err(|error| error.to_string())?;
    let index = mozak_core::landmark::validate_landmarks_json(&read(index_path)?, &run)
        .map_err(|error| error.to_string())?;
    print_json(&json!({
        "schema_version": 1,
        "command": "research landmarks",
        "run": display(run_path)?,
        "index": display(index_path)?,
        "state": "valid",
        "run_id": run.run_id,
        "derived_artifact": index.derived_artifact,
        "landmarks": index.landmarks.len(),
        "authority": "addressing_only",
        "note": "landmarks record where a statement came from; they accept and promote nothing"
    }))
}

/// Normalizes an external adapter fixture into a validated research run.
///
/// The adapter performs any network access; MOZAK validates what it returned
/// and writes the run only when the contract holds.
pub fn research_normalize(
    adapter: &str,
    fixture_path: &Path,
    output_path: &Path,
) -> Result<(), String> {
    if output_path.exists() {
        return Err(format!(
            "refusing to overwrite existing output: {}",
            output_path.display()
        ));
    }
    let input = read(fixture_path)?;
    let run = match adapter {
        "arxiv" => normalize_provider_arxiv(&input),
        "dair-ai" => normalize_provider_dair_ai(&input),
        "mcp-registry" => mozak_core::research::normalize_provider_mcp_registry(&input),
        "github-tooling" => mozak_core::research::normalize_provider_github_tooling(&input),
        _ => return Err(format!("unknown research adapter: {adapter}")),
    }
    .map_err(|error| error.to_string())?;
    let serialized = serde_json::to_string_pretty(&run).map_err(|error| error.to_string())?;
    fs::write(output_path, serialized + "\n")
        .map_err(|error| format!("cannot write {}: {error}", output_path.display()))?;
    print_json(&json!({
        "schema_version": 1,
        "command": "research normalize",
        "adapter": adapter,
        "fixture": display(fixture_path)?,
        "run": display(output_path)?,
        "state": "valid",
        "run_id": run.run_id,
        "record_count": run.raw_records.len(),
        "evidence_count": run.evidence.len(),
        "gap_count": run.gaps.len(),
        "overall_claim": match run.synthesis.overall_claim {
            mozak_core::research::OverallClaim::Supported => "supported",
            mozak_core::research::OverallClaim::Qualified => "qualified",
            mozak_core::research::OverallClaim::Failed => "failed",
        },
        "authority": "proposal_only"
    }))
}

pub fn planning_next(inputs_path: &Path, plan_path: &Path) -> Result<(), String> {
    let inputs = validate_input_set_json(&read(inputs_path)?).map_err(|error| error.to_string())?;
    let plan = validate_plan_json(&read(plan_path)?, &inputs).map_err(|error| error.to_string())?;
    let siblings = sibling_plans(plan_path, &plan);
    if let Some(successor) = superseded_by(&siblings, &plan) {
        return Err(format!(
            "plan {} version {} is superseded by version {}; \
             read the superseding plan instead of acting on this one",
            plan.id, plan.version, successor.version
        ));
    }
    let ready = next_ready_goals(&plan, &inputs).map_err(|error| error.to_string())?;
    print_json(&json!({
        "schema_version": 1,
        "command": "planning next",
        "accepted_inputs": display(inputs_path)?,
        "plan": display(plan_path)?,
        "state": "valid",
        "plan_id": plan.id,
        "plan_version": plan.version,
        "superseded": false,
        "ready_goals": ready.iter().map(|goal_id| {
            let goal = plan.goals.iter().find(|goal| &goal.id == goal_id).expect("validated ready goal");
            json!({
                "id": goal.id,
                "version": goal.version,
                "title": goal.title,
                "priority": goal.priority
            })
        }).collect::<Vec<_>>()
    }))
}

/// Loads sibling plan files that declare supersession of the selected plan.
///
/// Parsing is deliberately lenient: an unreadable or unrelated sibling simply
/// cannot supersede, so freshness enforcement never depends on validating every
/// other file in the directory.
fn sibling_plans(plan_path: &Path, plan: &Plan) -> Vec<Plan> {
    let Some(directory) = plan_path.parent() else {
        return Vec::new();
    };
    let Ok(entries) = fs::read_dir(directory) else {
        return Vec::new();
    };
    let mut plans = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path == plan_path || path.extension().is_none_or(|value| value != "json") {
            continue;
        }
        let Ok(text) = fs::read_to_string(&path) else {
            continue;
        };
        if let Ok(candidate) = serde_json::from_str::<Plan>(&text) {
            if candidate.id == plan.id {
                plans.push(candidate);
            }
        }
    }
    plans
}

pub fn execution_validate(
    bundle_path: &Path,
    observed_revision: &str,
    observed_at: &str,
) -> Result<(), String> {
    let bundle = validate_bundle_json(&read(bundle_path)?, observed_revision, observed_at)
        .map_err(|error| error.to_string())?;
    print_json(&json!({
        "schema_version": 1,
        "command": "execution validate",
        "path": display(bundle_path)?,
        "state": "valid",
        "packet_id": bundle.packet.id,
        "packet_version": bundle.packet.version,
        "result_id": bundle.result.id,
        "evaluation_id": bundle.evaluation.id,
        "observed_revision": observed_revision,
        "observed_at": observed_at
    }))
}

fn read(path: &Path) -> Result<String, String> {
    fs::read_to_string(path).map_err(|error| format!("cannot read {}: {error}", path.display()))
}

fn display(path: &Path) -> Result<String, String> {
    path.canonicalize()
        .map(|path| path.to_string_lossy().into_owned())
        .map_err(|error| format!("cannot resolve {}: {error}", path.display()))
}

fn print_json(value: &serde_json::Value) -> Result<(), String> {
    println!(
        "{}",
        serde_json::to_string(value).map_err(|error| error.to_string())?
    );
    Ok(())
}
