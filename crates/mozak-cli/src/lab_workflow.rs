//! Planning-only Self Improvement Lab commands.
//!
//! The Lab reads MOZAK's adapter registry, records an auditable improvement
//! run, and stops at owner review. It never edits MOZAK.

use mozak_core::lab::{
    CONTRACT_VERSION, Candidate, ImplementationPlans, ImproveRequest, LiteratureRun, MechanismMap,
    Module, Readings, RunLedger, RunState, Selection, advance, classify_candidates, render_review,
    validate_literature, validate_mechanisms, validate_plans, validate_readings, validate_request,
    validate_selection,
};
use serde::de::DeserializeOwned;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    env, fs,
    path::{Path, PathBuf},
    process::ExitCode,
};

const LEDGER_FILE: &str = "ledger.json";
const REQUEST_FILE: &str = "improve-request.json";
const LITERATURE_FILE: &str = "literature-run.json";
const SELECTION_FILE: &str = "selection.json";
const READINGS_FILE: &str = "paper-readings.json";
const MECHANISMS_FILE: &str = "mechanism-map.json";
const PLANS_FILE: &str = "implementation-plans.json";
const REVIEW_FILE: &str = "review.md";

pub fn run(args: &[String]) -> Result<ExitCode, String> {
    match args
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>()
        .as_slice()
    {
        ["modules"] => modules(),
        ["start", run_dir, scope_id, module, question, bindings @ ..] if !bindings.is_empty() => {
            start(
                Path::new(run_dir),
                scope_id,
                module,
                question,
                &bindings.iter().map(|b| (*b).to_owned()).collect::<Vec<_>>(),
            )
        }
        ["refresh", run_dir, adapter_run] => refresh(Path::new(run_dir), Path::new(adapter_run)),
        ["select", run_dir, selection] => select(Path::new(run_dir), Path::new(selection)),
        ["read", run_dir, readings] => read_papers(Path::new(run_dir), Path::new(readings)),
        ["mechanisms", run_dir, map] => mechanisms(Path::new(run_dir), Path::new(map)),
        ["plans", run_dir, plans] => plans_command(Path::new(run_dir), Path::new(plans)),
        ["review", run_dir] => review(Path::new(run_dir)),
        ["status", run_dir] => status(Path::new(run_dir)),
        _ => Err(crate::usage()),
    }
}

/// Lists the addressable improvement modules.
fn modules() -> Result<ExitCode, String> {
    let listed = Module::all()
        .iter()
        .map(|module| {
            json!({
                "id": module.as_str(),
                "summary": module.summary(),
                "source_areas": module.source_areas(),
            })
        })
        .collect::<Vec<_>>();
    print_json(&json!({
        "schema_version": 1,
        "command": "lab modules",
        "modules": listed,
    }))
}

/// Opens a run directory and records the improvement request.
fn start(
    run_dir: &Path,
    scope_id: &str,
    module: &str,
    question: &str,
    bindings: &[String],
) -> Result<ExitCode, String> {
    let module = Module::parse(module).map_err(|error| error.to_string())?;
    if run_dir.join(LEDGER_FILE).exists() {
        return Err(format!(
            "refusing to overwrite an existing run: {}",
            display(run_dir)
        ));
    }
    let registry = registry_bindings()?;
    for binding in bindings {
        if !registry.contains(binding) {
            return Err(format!(
                "unknown adapter binding '{binding}'; run `mozak adapter list`"
            ));
        }
    }
    let created_at = timestamp();
    let run_id = run_id(scope_id, module.as_str(), question, &created_at);
    let request = ImproveRequest {
        contract_version: CONTRACT_VERSION,
        run_id: run_id.clone(),
        scope_id: scope_id.to_owned(),
        module,
        question: question.to_owned(),
        constraints: vec![
            "planning only; no MOZAK code changes".to_owned(),
            "full text is temporary; retain hashes and claims only".to_owned(),
        ],
        adapter_bindings: bindings.to_vec(),
        stop_at: RunState::OwnerReviewed,
        created_at: created_at.clone(),
        // The actor that runs the CLI authors the run. Absent a second actor,
        // the honest label is self-review, and recording it here is what stops
        // the packet from reading as though someone else had checked the work.
        // MOZAK_EVALUATED_BY names a real second reviewer when there is one.
        performed_by: Some(actor()),
        evaluated_by: Some(env::var("MOZAK_EVALUATED_BY").unwrap_or_else(|_| actor())),
        acceptance: None,
    };
    let request = ImproveRequest {
        acceptance: request.derived_acceptance(),
        ..request
    };
    validate_request(&request).map_err(|error| error.to_string())?;

    let ledger = RunLedger {
        contract_version: CONTRACT_VERSION,
        run_id: run_id.clone(),
        scope_id: scope_id.to_owned(),
        module,
        state: RunState::Requested,
        stop_at: RunState::OwnerReviewed,
        transitions: vec![mozak_core::lab::Transition {
            state: RunState::Requested,
            actor: actor(),
            at: created_at,
            input_hash: mozak_core::canonical_hash(&request).map_err(|error| error.to_string())?,
        }],
        seen_sources: std::collections::BTreeMap::new(),
    };

    fs::create_dir_all(run_dir)
        .map_err(|error| format!("cannot create {}: {error}", run_dir.display()))?;
    write_json(&run_dir.join(REQUEST_FILE), &request)?;
    write_json(&run_dir.join(LEDGER_FILE), &ledger)?;

    print_json(&json!({
        "schema_version": 1,
        "command": "lab start",
        "run_id": run_id,
        "run_dir": display(run_dir),
        "scope_id": scope_id,
        "module": module.as_str(),
        "state": ledger.state.as_str(),
        "stop_at": ledger.stop_at.as_str(),
        "adapter_bindings": bindings,
        "performed_by": request.performed_by,
        "evaluated_by": request.evaluated_by,
        "acceptance": request.acceptance.map(mozak_core::lab::AcceptanceKind::as_str),
        "validation_boundary": "structural conformance to the Lab contract only; it asserts nothing about whether the work is sound",
    }))
}

/// Ingests a validated adapter run as this run's literature refresh.
fn refresh(run_dir: &Path, adapter_run: &Path) -> Result<ExitCode, String> {
    let mut ledger: RunLedger = read_json(&run_dir.join(LEDGER_FILE))?;
    require_state(&ledger, RunState::LiteratureRefreshed)?;
    let request: ImproveRequest = read_json(&run_dir.join(REQUEST_FILE))?;
    let raw = read(adapter_run)?;
    let research = mozak_core::research::validate_run_json(&raw)
        .map_err(|error| format!("adapter run is not a valid research run: {error}"))?;

    let candidates = research
        .raw_records
        .iter()
        .enumerate()
        .map(|(index, record)| Candidate {
            paper_id: format!("paper-{index:04}"),
            title: first_line(&record.content),
            source_uri: record.source_uri.clone(),
            content_sha256: record.content_sha256.clone(),
            clusters: field(&record.content, "clusters"),
        })
        .collect::<Vec<_>>();

    let (new_candidates, unchanged_candidates) = classify_candidates(&mut ledger, &candidates);
    let literature = LiteratureRun {
        contract_version: CONTRACT_VERSION,
        run_id: request.run_id.clone(),
        adapter_runs: vec![mozak_core::lab::AdapterRunRef {
            binding_id: request
                .adapter_bindings
                .first()
                .cloned()
                .unwrap_or_default(),
            adapter_id: research.receipt.adapter_id.clone(),
            adapter_run_id: research.run_id.clone(),
            artifact_hash: research.receipt.artifact_hash.clone(),
            source_revision: source_revision(&research),
        }],
        candidates,
        new_candidates,
        unchanged_candidates,
    };
    validate_literature(&literature).map_err(|error| error.to_string())?;
    advance(
        &mut ledger,
        RunState::LiteratureRefreshed,
        &actor(),
        &timestamp(),
        &serde_json::to_value(&literature).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;

    write_json(&run_dir.join(LITERATURE_FILE), &literature)?;
    write_json(&run_dir.join(LEDGER_FILE), &ledger)?;
    print_json(&json!({
        "schema_version": 1,
        "command": "lab refresh",
        "run_id": literature.run_id,
        "state": ledger.state.as_str(),
        "candidates": literature.candidates.len(),
        "new": literature.new_candidates.len(),
        "unchanged": literature.unchanged_candidates.len(),
    }))
}

/// Records which candidates will be read, with reasons for both sides.
fn select(run_dir: &Path, selection_path: &Path) -> Result<ExitCode, String> {
    let mut ledger: RunLedger = read_json(&run_dir.join(LEDGER_FILE))?;
    require_state(&ledger, RunState::PapersSelected)?;
    let literature: LiteratureRun = read_json(&run_dir.join(LITERATURE_FILE))?;
    let selection: Selection = read_json(selection_path)?;
    validate_selection(&selection, &literature).map_err(|error| error.to_string())?;
    advance(
        &mut ledger,
        RunState::PapersSelected,
        &actor(),
        &timestamp(),
        &serde_json::to_value(&selection).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    write_json(&run_dir.join(SELECTION_FILE), &selection)?;
    write_json(&run_dir.join(LEDGER_FILE), &ledger)?;
    print_json(&json!({
        "schema_version": 1,
        "command": "lab select",
        "run_id": selection.run_id,
        "state": ledger.state.as_str(),
        "included": selection.included.len(),
        "excluded": selection.excluded.len(),
    }))
}

/// Rejects a skipped or out-of-order step before reading prior artifacts.
///
/// The state machine already refuses an out-of-order transition, but each step
/// loads its predecessor's artifact first. Without this check a skipped step
/// surfaces as a missing-file error, which reads like a corrupt run rather
/// than the ordering rule doing its job.
fn require_state(ledger: &RunLedger, next: RunState) -> Result<(), String> {
    // A finished run is refused because implementation is a separate phase,
    // not because a step was skipped. Say that, rather than reporting an
    // ordering expectation the owner cannot satisfy.
    if ledger.state.is_terminal() {
        return Err(
            "run reached owner_reviewed; implementation requires a separately authorized phase"
                .to_owned(),
        );
    }
    let expected = next
        .predecessor()
        .ok_or_else(|| "requested is only recorded when the run is created".to_owned())?;
    if ledger.state == expected {
        return Ok(());
    }
    Err(format!(
        "cannot move to {} from {}; expected {} first",
        next.as_str(),
        ledger.state.as_str(),
        expected.as_str()
    ))
}

/// Records claim-level readings and enforces temporary full text.
fn read_papers(run_dir: &Path, readings_path: &Path) -> Result<ExitCode, String> {
    let mut ledger: RunLedger = read_json(&run_dir.join(LEDGER_FILE))?;
    require_state(&ledger, RunState::PapersRead)?;
    let selection: Selection = read_json(&run_dir.join(SELECTION_FILE))?;
    let readings: Readings = read_json(readings_path)?;
    validate_readings(&readings, &selection).map_err(|error| error.to_string())?;
    advance(
        &mut ledger,
        RunState::PapersRead,
        &actor(),
        &timestamp(),
        &serde_json::to_value(&readings).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    write_json(&run_dir.join(READINGS_FILE), &readings)?;
    write_json(&run_dir.join(LEDGER_FILE), &ledger)?;
    let claims: usize = readings
        .readings
        .iter()
        .map(|reading| reading.claims.len())
        .sum();
    // Depth is reported next to the count so a shallow run is visible in the
    // receipt rather than only when a mechanism is later refused.
    let abstract_only = readings
        .readings
        .iter()
        .filter(|reading| !reading.read_depth.supports_mechanism())
        .count();
    print_json(&json!({
        "schema_version": 1,
        "command": "lab read",
        "run_id": readings.run_id,
        "state": ledger.state.as_str(),
        "papers_read": readings.readings.len(),
        "claims": claims,
        "abstract_only_readings": abstract_only,
        "mechanism_ready_readings": readings.readings.len() - abstract_only,
    }))
}

/// Records proposed MOZAK mechanisms anchored in source claims.
fn mechanisms(run_dir: &Path, map_path: &Path) -> Result<ExitCode, String> {
    let mut ledger: RunLedger = read_json(&run_dir.join(LEDGER_FILE))?;
    require_state(&ledger, RunState::MechanismsExtracted)?;
    let readings: Readings = read_json(&run_dir.join(READINGS_FILE))?;
    let map: MechanismMap = read_json(map_path)?;
    validate_mechanisms(&map, &readings).map_err(|error| error.to_string())?;
    advance(
        &mut ledger,
        RunState::MechanismsExtracted,
        &actor(),
        &timestamp(),
        &serde_json::to_value(&map).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    write_json(&run_dir.join(MECHANISMS_FILE), &map)?;
    write_json(&run_dir.join(LEDGER_FILE), &ledger)?;
    print_json(&json!({
        "schema_version": 1,
        "command": "lab mechanisms",
        "run_id": map.run_id,
        "state": ledger.state.as_str(),
        "mechanisms": map.mechanisms.len(),
    }))
}

/// Records bounded implementation plans for owner review.
fn plans_command(run_dir: &Path, plans_path: &Path) -> Result<ExitCode, String> {
    let mut ledger: RunLedger = read_json(&run_dir.join(LEDGER_FILE))?;
    require_state(&ledger, RunState::ImplementationPlansProposed)?;
    let map: MechanismMap = read_json(&run_dir.join(MECHANISMS_FILE))?;
    let plans: ImplementationPlans = read_json(plans_path)?;
    validate_plans(&plans, &map).map_err(|error| error.to_string())?;
    advance(
        &mut ledger,
        RunState::ImplementationPlansProposed,
        &actor(),
        &timestamp(),
        &serde_json::to_value(&plans).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    write_json(&run_dir.join(PLANS_FILE), &plans)?;
    write_json(&run_dir.join(LEDGER_FILE), &ledger)?;
    print_json(&json!({
        "schema_version": 1,
        "command": "lab plans",
        "run_id": plans.run_id,
        "state": ledger.state.as_str(),
        "plans": plans.plans.len(),
    }))
}

/// Renders the owner review packet and closes the planning-only run.
fn review(run_dir: &Path) -> Result<ExitCode, String> {
    let mut ledger: RunLedger = read_json(&run_dir.join(LEDGER_FILE))?;
    require_state(&ledger, RunState::OwnerReviewed)?;
    let request: ImproveRequest = read_json(&run_dir.join(REQUEST_FILE))?;
    let literature: LiteratureRun = read_json(&run_dir.join(LITERATURE_FILE))?;
    let selection: Selection = read_json(&run_dir.join(SELECTION_FILE))?;
    let readings: Readings = read_json(&run_dir.join(READINGS_FILE))?;
    let map: MechanismMap = read_json(&run_dir.join(MECHANISMS_FILE))?;
    let plans: ImplementationPlans = read_json(&run_dir.join(PLANS_FILE))?;

    let packet = render_review(&request, &literature, &selection, &readings, &map, &plans);
    advance(
        &mut ledger,
        RunState::OwnerReviewed,
        &actor(),
        &timestamp(),
        &json!({ "review_sha256": hash(packet.as_bytes()) }),
    )
    .map_err(|error| error.to_string())?;
    let review_path = run_dir.join(REVIEW_FILE);
    fs::write(&review_path, &packet)
        .map_err(|error| format!("cannot write {}: {error}", review_path.display()))?;
    write_json(&run_dir.join(LEDGER_FILE), &ledger)?;
    print_json(&json!({
        "schema_version": 1,
        "command": "lab review",
        "run_id": request.run_id,
        "state": ledger.state.as_str(),
        "review": display(&review_path),
        "acceptance": request.acceptance.map(mozak_core::lab::AcceptanceKind::as_str),
        "validation_boundary": "structural conformance to the Lab contract only; it asserts nothing about whether the mechanisms are sound",
        "next": "owner decision required; implementation is not authorized by this run",
    }))
}

/// Reports the current position of a run.
fn status(run_dir: &Path) -> Result<ExitCode, String> {
    let ledger: RunLedger = read_json(&run_dir.join(LEDGER_FILE))?;
    // Status reads the request when it can, so acceptance is visible without
    // opening the packet. A run recorded before acceptance existed reports
    // null rather than a guess.
    let acceptance = read_json::<ImproveRequest>(&run_dir.join(REQUEST_FILE))
        .ok()
        .and_then(|request| request.acceptance);
    print_json(&json!({
        "schema_version": 1,
        "command": "lab status",
        "run_id": ledger.run_id,
        "scope_id": ledger.scope_id,
        "module": ledger.module.as_str(),
        "state": ledger.state.as_str(),
        "stop_at": ledger.stop_at.as_str(),
        "terminal": ledger.state.is_terminal(),
        "transitions": ledger.transitions.len(),
        "tracked_sources": ledger.seen_sources.len(),
        "acceptance": acceptance.map(mozak_core::lab::AcceptanceKind::as_str),
    }))
}

fn registry_bindings() -> Result<Vec<String>, String> {
    let path = registry_path()?;
    let Ok(raw) = fs::read_to_string(&path) else {
        return Ok(Vec::new());
    };
    let value: serde_json::Value =
        serde_json::from_str(&raw).map_err(|error| format!("invalid adapter registry: {error}"))?;
    Ok(value
        .get("bindings")
        .and_then(serde_json::Value::as_array)
        .map(|bindings| {
            bindings
                .iter()
                .filter_map(|binding| {
                    binding
                        .get("id")
                        .and_then(serde_json::Value::as_str)
                        .map(ToOwned::to_owned)
                })
                .collect()
        })
        .unwrap_or_default())
}

fn registry_path() -> Result<PathBuf, String> {
    let home = env::var("HOME").map_err(|_| "HOME is not set".to_owned())?;
    Ok(PathBuf::from(home).join(".config/mozak/adapters.json"))
}

fn source_revision(run: &mozak_core::research::ResearchRun) -> String {
    run.raw_records
        .first()
        .and_then(|record| field(&record.content, "source_revision").first().cloned())
        .unwrap_or_else(|| "unrecorded".to_owned())
}

fn first_line(content: &str) -> String {
    content.lines().next().unwrap_or_default().trim().to_owned()
}

fn field(content: &str, key: &str) -> Vec<String> {
    let prefix = format!("{key}:");
    content
        .lines()
        .find(|line| line.starts_with(&prefix))
        .map(|line| {
            line[prefix.len()..]
                .split(',')
                .map(|value| value.trim().to_owned())
                .filter(|value| !value.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

fn run_id(scope_id: &str, module: &str, question: &str, created_at: &str) -> String {
    let digest = hash(format!("{scope_id}|{module}|{question}|{created_at}").as_bytes());
    format!("improve-{}", &digest[..24])
}

fn actor() -> String {
    env::var("USER").unwrap_or_else(|_| "unknown".to_owned())
}

/// Canonical UTC timestamp shared by the workflows that record history.
pub fn now() -> String {
    timestamp()
}

/// Canonical UTC date, used for human-readable history identifiers.
pub fn today() -> String {
    timestamp()[..10].to_owned()
}

fn timestamp() -> String {
    let seconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs());
    let days = seconds / 86_400;
    let time = seconds % 86_400;
    let (year, month, day) = civil_from_days(i64::try_from(days).unwrap_or(0));
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        time / 3600,
        (time % 3600) / 60,
        time % 60
    )
}

#[allow(clippy::many_single_char_names)]
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (
        if m <= 2 { y + 1 } else { y },
        u32::try_from(m).unwrap_or(1),
        u32::try_from(d).unwrap_or(1),
    )
}

fn hash(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    format!("{digest:x}")
}

fn read(path: &Path) -> Result<String, String> {
    fs::read_to_string(path).map_err(|error| format!("cannot read {}: {error}", path.display()))
}

fn read_json<T: DeserializeOwned>(path: &Path) -> Result<T, String> {
    let raw = read(path)?;
    serde_json::from_str(&raw).map_err(|error| format!("invalid {}: {error}", path.display()))
}

fn write_json<T: serde::Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let serialized = serde_json::to_string_pretty(value).map_err(|error| error.to_string())?;
    fs::write(path, serialized + "\n")
        .map_err(|error| format!("cannot write {}: {error}", path.display()))
}

fn display(path: &Path) -> String {
    path.display().to_string()
}

fn print_json(value: &serde_json::Value) -> Result<ExitCode, String> {
    let rendered = serde_json::to_string(value).map_err(|error| error.to_string())?;
    println!("{rendered}");
    Ok(ExitCode::SUCCESS)
}
