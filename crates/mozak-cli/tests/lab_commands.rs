use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
};

fn binary() -> PathBuf {
    let mut path = env::current_exe().expect("test binary path");
    path.pop();
    if path.ends_with("deps") {
        path.pop();
    }
    path.join("mozak")
}

struct Workspace {
    root: PathBuf,
}

impl Workspace {
    fn new(name: &str) -> Self {
        let root = env::temp_dir().join(format!("mozak-lab-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("workspace");
        Self { root }
    }

    fn path(&self, name: &str) -> PathBuf {
        self.root.join(name)
    }

    fn write(&self, name: &str, contents: &str) -> PathBuf {
        let path = self.path(name);
        fs::write(&path, contents).expect("write fixture");
        path
    }

    fn run(&self, args: &[&str]) -> (bool, String, String) {
        let output = Command::new(binary())
            .args(args)
            .env("HOME", &self.root)
            .output()
            .expect("run mozak");
        (
            output.status.success(),
            String::from_utf8_lossy(&output.stdout).into_owned(),
            String::from_utf8_lossy(&output.stderr).into_owned(),
        )
    }
}

impl Drop for Workspace {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

/// The real DAIR.AI adapter run: 20 curated records with authentic hashes.
fn adapter_run(workspace: &Workspace) -> PathBuf {
    let fixture = include_str!("fixtures/lab_adapter_run.json");
    workspace.write("adapter-run.json", fixture)
}

/// Builds a selection covering every refreshed candidate.
fn selection_for(workspace: &Workspace, run_id: &str, included: &[&str]) -> PathBuf {
    let literature: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(workspace.path("run").join("literature-run.json")).expect("literature"),
    )
    .expect("json");
    let mut include = Vec::new();
    let mut exclude = Vec::new();
    for candidate in literature["candidates"].as_array().expect("candidates") {
        let id = candidate["paper_id"].as_str().expect("paper_id");
        if included.contains(&id) {
            include.push(format!(
                r#"{{"paper_id":"{id}","reason":"on topic for this run"}}"#
            ));
        } else {
            exclude.push(format!(
                r#"{{"paper_id":"{id}","reason":"not prioritized for this question"}}"#
            ));
        }
    }
    workspace.write(
        "selection.json",
        &format!(
            r#"{{"contract_version":1,"run_id":"{run_id}","included":[{}],"excluded":[{}]}}"#,
            include.join(","),
            exclude.join(",")
        ),
    )
}

fn start_run(workspace: &Workspace, binding: &str) -> String {
    let run_dir = workspace.path("run");
    let (ok, stdout, stderr) = workspace.run(&[
        "lab",
        "start",
        run_dir.to_str().expect("path"),
        "topic-agentic-systems",
        "plans",
        "How should planning represent budgets?",
        binding,
    ]);
    assert!(ok, "lab start failed: {stderr}");
    let value: serde_json::Value = serde_json::from_str(&stdout).expect("json");
    value["run_id"].as_str().expect("run_id").to_owned()
}

fn registry(workspace: &Workspace) {
    let dir = workspace.path(".config/mozak");
    fs::create_dir_all(&dir).expect("config dir");
    fs::write(
        dir.join("adapters.json"),
        r#"{"schema_version":1,"bindings":[{"id":"agentic-systems-dair-ai","adapter":"dair-ai","target_scope_id":"topic-agentic-systems","request_path":"/tmp/r.json","request_sha256":"x","runner_path":"/tmp/r.sh","runner_sha256":"y","runs_dir":"/tmp/runs"}]}"#,
    )
    .expect("registry");
}

#[test]
fn lists_the_improvement_modules() {
    let workspace = Workspace::new("modules");
    let (ok, stdout, stderr) = workspace.run(&["lab", "modules"]);
    assert!(ok, "{stderr}");
    let value: serde_json::Value = serde_json::from_str(&stdout).expect("json");
    let modules = value["modules"].as_array().expect("modules");

    let ids = modules
        .iter()
        .map(|module| module["id"].as_str().expect("id"))
        .collect::<Vec<_>>();
    assert_eq!(
        ids,
        vec![
            "scope",
            "research",
            "plans",
            "meta-kb",
            "improve-lab",
            "skill"
        ],
        "the six MOZAK modules are the six Lab targets, in this order"
    );

    assert!(
        modules
            .iter()
            .all(|module| !module["source_areas"].as_array().expect("areas").is_empty())
    );
    assert!(
        modules
            .iter()
            .all(|module| !module["summary"].as_str().expect("summary").is_empty())
    );
}

/// Every contract file in `mozak-core` belongs to exactly one module, so no
/// source area can be improved by two targets or by none.
#[test]
fn every_core_source_file_has_exactly_one_module() {
    let workspace = Workspace::new("coverage");
    let (ok, stdout, stderr) = workspace.run(&["lab", "modules"]);
    assert!(ok, "{stderr}");
    let value: serde_json::Value = serde_json::from_str(&stdout).expect("json");

    let mut claimed: Vec<String> = Vec::new();
    for module in value["modules"].as_array().expect("modules") {
        for area in module["source_areas"].as_array().expect("areas") {
            let area = area.as_str().expect("area").to_owned();
            assert!(
                !claimed.contains(&area),
                "{area} is claimed by more than one module"
            );
            claimed.push(area);
        }
    }

    let core = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("crates dir")
        .join("mozak-core/src");
    let mut unclaimed: Vec<String> = Vec::new();
    for entry in fs::read_dir(&core).expect("core src") {
        let name = entry
            .expect("entry")
            .file_name()
            .to_string_lossy()
            .to_string();
        if name == "lib.rs"
            || !std::path::Path::new(&name)
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("rs"))
        {
            continue;
        }
        if !claimed.contains(&name) {
            unclaimed.push(name);
        }
    }
    unclaimed.sort();
    assert!(
        unclaimed.is_empty(),
        "these core files belong to no module: {unclaimed:?}"
    );
}

#[test]
fn rejects_an_unregistered_adapter_binding() {
    let workspace = Workspace::new("binding");
    registry(&workspace);
    let run_dir = workspace.path("run");
    let (ok, _, stderr) = workspace.run(&[
        "lab",
        "start",
        run_dir.to_str().expect("path"),
        "topic-agentic-systems",
        "plans",
        "question",
        "not-registered",
    ]);
    assert!(!ok);
    assert!(stderr.contains("unknown adapter binding"));
}

#[test]
fn rejects_an_unknown_module() {
    let workspace = Workspace::new("module");
    registry(&workspace);
    let run_dir = workspace.path("run");
    let (ok, _, stderr) = workspace.run(&[
        "lab",
        "start",
        run_dir.to_str().expect("path"),
        "topic-agentic-systems",
        "not-a-module",
        "question",
        "agentic-systems-dair-ai",
    ]);
    assert!(!ok);
    assert!(stderr.contains("unknown module"));
}

#[test]
fn refuses_to_overwrite_an_existing_run() {
    let workspace = Workspace::new("overwrite");
    registry(&workspace);
    start_run(&workspace, "agentic-systems-dair-ai");
    let run_dir = workspace.path("run");
    let (ok, _, stderr) = workspace.run(&[
        "lab",
        "start",
        run_dir.to_str().expect("path"),
        "topic-agentic-systems",
        "plans",
        "question",
        "agentic-systems-dair-ai",
    ]);
    assert!(!ok);
    assert!(stderr.contains("refusing to overwrite"));
}

#[test]
fn runs_the_planning_pipeline_and_stops_at_review() {
    let workspace = Workspace::new("pipeline");
    registry(&workspace);
    let run_id = start_run(&workspace, "agentic-systems-dair-ai");
    let run_dir = workspace.path("run");
    let run_dir_str = run_dir.to_str().expect("path").to_owned();
    let adapter = adapter_run(&workspace);

    let (ok, stdout, stderr) = workspace.run(&[
        "lab",
        "refresh",
        &run_dir_str,
        adapter.to_str().expect("path"),
    ]);
    assert!(ok, "{stderr}");
    let value: serde_json::Value = serde_json::from_str(&stdout).expect("json");
    assert_eq!(value["candidates"], 20);
    assert_eq!(value["new"], 20);
    assert_eq!(value["unchanged"], 0);

    let selection = selection_for(&workspace, &run_id, &["paper-0000"]);
    let (ok, _, stderr) = workspace.run(&[
        "lab",
        "select",
        &run_dir_str,
        selection.to_str().expect("path"),
    ]);
    assert!(ok, "{stderr}");

    let readings = workspace.write(
        "readings.json",
        &format!(
            r#"{{"contract_version":1,"run_id":"{run_id}","readings":[{{"paper_id":"paper-0000","source_class":"preprint","source_uri":"https://example.org/a","content_sha256":"hash-a","read_depth":"full_text","claims":[{{"id":"c1","text":"budgets help","origin":"source_claim","locator":"s4"}}],"limitations":["one benchmark"],"retained_full_text":false}}]}}"#
        ),
    );
    let (ok, _, stderr) = workspace.run(&[
        "lab",
        "read",
        &run_dir_str,
        readings.to_str().expect("path"),
    ]);
    assert!(ok, "{stderr}");

    let mechanisms = workspace.write(
        "mechanisms.json",
        &format!(
            r#"{{"contract_version":1,"run_id":"{run_id}","mechanisms":[{{"id":"m1","proposed_mechanism":"declare budgets","affected_contract":"planning::Plan","expected_benefit":"comparable runs","risks":["drift"],"supporting_claim_ids":["c1"]}}]}}"#
        ),
    );
    let (ok, _, stderr) = workspace.run(&[
        "lab",
        "mechanisms",
        &run_dir_str,
        mechanisms.to_str().expect("path"),
    ]);
    assert!(ok, "{stderr}");

    let plans = workspace.write(
        "plans.json",
        &format!(
            r#"{{"contract_version":1,"run_id":"{run_id}","plans":[{{"id":"P1","title":"budgets","mechanism_ids":["m1"],"deliverables":["field"],"acceptance_checks":["valid plan passes","bad plan fails"],"dependencies":[]}}]}}"#
        ),
    );
    let (ok, _, stderr) =
        workspace.run(&["lab", "plans", &run_dir_str, plans.to_str().expect("path")]);
    assert!(ok, "{stderr}");

    let (ok, stdout, stderr) = workspace.run(&["lab", "review", &run_dir_str]);
    assert!(ok, "{stderr}");
    assert!(stdout.contains("owner decision required"));
    let packet = fs::read_to_string(run_dir.join("review.md")).expect("review");
    assert!(packet.contains("Planning only. No MOZAK code was changed."));
    assert!(packet.contains("one benchmark"));

    let (ok, stdout, stderr) = workspace.run(&["lab", "status", &run_dir_str]);
    assert!(ok, "{stderr}");
    let value: serde_json::Value = serde_json::from_str(&stdout).expect("json");
    assert_eq!(value["state"], "owner_reviewed");
    assert_eq!(value["terminal"], true);

    // The terminal gate must block any further step.
    let (ok, _, stderr) =
        workspace.run(&["lab", "plans", &run_dir_str, plans.to_str().expect("path")]);
    assert!(!ok);
    assert!(stderr.contains("separately authorized phase"));
}

/// A run may read only abstracts, but it may not turn them into mechanisms.
/// This is the defect that produced this rule: an earlier real run proposed
/// five mechanisms from four abstracts and nothing objected.
#[test]
fn an_abstract_only_run_is_refused_at_the_mechanism_step() {
    let workspace = Workspace::new("shallow");
    registry(&workspace);
    let run_id = start_run(&workspace, "agentic-systems-dair-ai");
    let run_dir = workspace.path("run");
    let run_dir_str = run_dir.to_str().expect("path").to_owned();
    let adapter = adapter_run(&workspace);
    let (ok, _, stderr) = workspace.run(&[
        "lab",
        "refresh",
        &run_dir_str,
        adapter.to_str().expect("path"),
    ]);
    assert!(ok, "{stderr}");

    let selection = selection_for(&workspace, &run_id, &["paper-0000"]);
    let (ok, _, stderr) = workspace.run(&[
        "lab",
        "select",
        &run_dir_str,
        selection.to_str().expect("path"),
    ]);
    assert!(ok, "{stderr}");

    let readings = workspace.write(
        "readings.json",
        &format!(
            r#"{{"contract_version":1,"run_id":"{run_id}","readings":[{{"paper_id":"paper-0000","source_class":"preprint","source_uri":"https://example.org/a","content_sha256":"hash-a","read_depth":"abstract_only","claims":[{{"id":"c1","text":"budgets help","origin":"source_claim","locator":"abstract"}}],"limitations":["abstract only"],"retained_full_text":false}}]}}"#
        ),
    );
    // Shallow reading is recorded honestly and is not itself an error.
    let (ok, stdout, stderr) = workspace.run(&[
        "lab",
        "read",
        &run_dir_str,
        readings.to_str().expect("path"),
    ]);
    assert!(ok, "{stderr}");
    let value: serde_json::Value = serde_json::from_str(&stdout).expect("json");
    assert_eq!(value["abstract_only_readings"], 1);
    assert_eq!(value["mechanism_ready_readings"], 0);

    // The mechanism built on it is refused, naming why.
    let mechanisms = workspace.write(
        "mechanisms.json",
        &format!(
            r#"{{"contract_version":1,"run_id":"{run_id}","mechanisms":[{{"id":"m1","proposed_mechanism":"declare budgets","affected_contract":"planning::Plan","expected_benefit":"comparable runs","risks":["drift"],"supporting_claim_ids":["c1"]}}]}}"#
        ),
    );
    let (ok, stdout, stderr) = workspace.run(&[
        "lab",
        "mechanisms",
        &run_dir_str,
        mechanisms.to_str().expect("path"),
    ]);
    assert!(!ok);
    assert!(stdout.is_empty(), "a refused step writes no receipt");
    assert!(
        stderr.contains("rests only on abstract-only reading"),
        "{stderr}"
    );

    // The run did not advance, so the owner can re-read and retry.
    let (ok, stdout, _) = workspace.run(&["lab", "status", &run_dir_str]);
    assert!(ok);
    let value: serde_json::Value = serde_json::from_str(&stdout).expect("json");
    assert_eq!(value["state"], "papers_read");
}

#[test]
fn second_refresh_marks_sources_unchanged() {
    let workspace = Workspace::new("dedup");
    registry(&workspace);
    start_run(&workspace, "agentic-systems-dair-ai");
    let run_dir = workspace.path("run");
    let run_dir_str = run_dir.to_str().expect("path").to_owned();
    let adapter = adapter_run(&workspace);

    let (ok, _, stderr) = workspace.run(&[
        "lab",
        "refresh",
        &run_dir_str,
        adapter.to_str().expect("path"),
    ]);
    assert!(ok, "{stderr}");

    // Rewind only the lifecycle position; the seen-source memory must persist.
    let ledger_path = run_dir.join("ledger.json");
    let mut ledger: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&ledger_path).expect("ledger")).expect("json");
    ledger["state"] = serde_json::Value::String("requested".to_owned());
    ledger["transitions"] = serde_json::Value::Array(vec![ledger["transitions"][0].clone()]);
    fs::write(&ledger_path, ledger.to_string()).expect("rewind");

    let (ok, stdout, stderr) = workspace.run(&[
        "lab",
        "refresh",
        &run_dir_str,
        adapter.to_str().expect("path"),
    ]);
    assert!(ok, "{stderr}");
    let value: serde_json::Value = serde_json::from_str(&stdout).expect("json");
    assert_eq!(value["new"], 0);
    assert_eq!(value["unchanged"], 20);
}

#[test]
fn rejects_readings_that_retain_full_text() {
    let workspace = Workspace::new("fulltext");
    registry(&workspace);
    let run_id = start_run(&workspace, "agentic-systems-dair-ai");
    let run_dir_str = workspace.path("run").to_str().expect("path").to_owned();
    let adapter = adapter_run(&workspace);
    workspace.run(&[
        "lab",
        "refresh",
        &run_dir_str,
        adapter.to_str().expect("path"),
    ]);
    let selection = selection_for(&workspace, &run_id, &["paper-0000"]);
    workspace.run(&[
        "lab",
        "select",
        &run_dir_str,
        selection.to_str().expect("path"),
    ]);
    let readings = workspace.write(
        "readings.json",
        &format!(
            r#"{{"contract_version":1,"run_id":"{run_id}","readings":[{{"paper_id":"paper-0000","source_class":"preprint","source_uri":"https://example.org/a","content_sha256":"hash-a","claims":[{{"id":"c1","text":"t","origin":"source_claim","locator":"s4"}}],"limitations":[],"retained_full_text":true}}]}}"#
        ),
    );
    let (ok, _, stderr) = workspace.run(&[
        "lab",
        "read",
        &run_dir_str,
        readings.to_str().expect("path"),
    ]);
    assert!(!ok);
    assert!(stderr.contains("full text must not be retained"));
}

#[test]
fn rejects_an_out_of_order_step() {
    let workspace = Workspace::new("order");
    registry(&workspace);
    let run_id = start_run(&workspace, "agentic-systems-dair-ai");
    let run_dir_str = workspace.path("run").to_str().expect("path").to_owned();
    let selection = workspace.write(
        "selection.json",
        &format!(
            r#"{{"contract_version":1,"run_id":"{run_id}","included":[{{"paper_id":"paper-0000","reason":"on topic"}}],"excluded":[]}}"#
        ),
    );
    let (ok, _, stderr) = workspace.run(&[
        "lab",
        "select",
        &run_dir_str,
        selection.to_str().expect("path"),
    ]);
    assert!(!ok);
    // Previously this surfaced the absent literature-run.json, which described
    // the symptom rather than the rule that was violated.
    assert!(
        stderr.contains("cannot move to papers_selected from requested"),
        "{stderr}"
    );
    assert!(!stderr.contains("No such file or directory"), "{stderr}");
}

#[test]
fn a_skipped_step_reports_the_ordering_rule_not_a_missing_file() {
    let workspace = Workspace::new("lab-ordering");
    registry(&workspace);
    let run_dir = workspace.path("run");
    start_run(&workspace, "agentic-systems-dair-ai");
    let run = run_dir.to_str().expect("path");

    // Every step that depends on a predecessor must name the ordering rule
    // rather than surfacing the predecessor artifact's absence.
    for (args, expected) in [
        (
            vec!["lab", "select", run, "/dev/null"],
            "expected literature_refreshed first",
        ),
        (
            vec!["lab", "read", run, "/dev/null"],
            "expected papers_selected first",
        ),
        (
            vec!["lab", "mechanisms", run, "/dev/null"],
            "expected papers_read first",
        ),
        (
            vec!["lab", "plans", run, "/dev/null"],
            "expected mechanisms_extracted first",
        ),
        (
            vec!["lab", "review", run],
            "expected implementation_plans_proposed first",
        ),
    ] {
        let (ok, _stdout, stderr) = workspace.run(&args);
        assert!(!ok, "{args:?} unexpectedly succeeded");
        assert!(
            stderr.contains(expected),
            "{args:?} reported {stderr:?}, expected {expected:?}"
        );
        assert!(
            !stderr.contains("No such file or directory"),
            "{args:?} leaked a missing-file error: {stderr}"
        );
    }
}

#[test]
fn refresh_is_the_first_step_after_start() {
    let workspace = Workspace::new("lab-refresh-first");
    registry(&workspace);
    let run_dir = workspace.path("run");
    start_run(&workspace, "agentic-systems-dair-ai");
    let adapter = adapter_run(&workspace);
    let (ok, stdout, stderr) = workspace.run(&[
        "lab",
        "refresh",
        run_dir.to_str().expect("path"),
        adapter.to_str().expect("path"),
    ]);
    assert!(ok, "refresh must succeed directly after start: {stderr}");
    let value: serde_json::Value = serde_json::from_str(&stdout).expect("json");
    assert_eq!(value["state"], "literature_refreshed");
}

/// D2: acceptance must be recorded automatically and honestly.
///
/// An owner will not hand-write who reviewed a run, so if the CLI does not
/// record it the field stays empty and the packet keeps reading as though
/// someone had checked the work. These tests pin the default and the override.
#[test]
fn a_run_records_self_review_by_default_and_says_so_in_the_packet() {
    let workspace = Workspace::new("acceptance-default");
    registry(&workspace);
    let run_id = start_run(&workspace, "agentic-systems-dair-ai");
    let run_dir = workspace.path("run");
    let run_dir_str = run_dir.to_str().expect("path").to_owned();

    let request: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(run_dir.join("improve-request.json")).expect("request"),
    )
    .expect("json");
    assert_eq!(
        request["acceptance"], "self_review",
        "one actor performing and accepting is a self-review"
    );
    assert_eq!(request["performed_by"], request["evaluated_by"]);

    let adapter = adapter_run(&workspace);
    workspace.run(&[
        "lab",
        "refresh",
        &run_dir_str,
        adapter.to_str().expect("path"),
    ]);
    let selection = selection_for(&workspace, &run_id, &["paper-0000"]);
    workspace.run(&[
        "lab",
        "select",
        &run_dir_str,
        selection.to_str().expect("path"),
    ]);
    let readings = workspace.write(
        "readings.json",
        &format!(
            r#"{{"contract_version":1,"run_id":"{run_id}","readings":[{{"paper_id":"paper-0000","source_class":"preprint","source_uri":"https://example.org/a","content_sha256":"hash-a","read_depth":"full_text","claims":[{{"id":"c1","text":"budgets help","origin":"source_claim","locator":"s4"}}],"limitations":["one benchmark"],"retained_full_text":false}}]}}"#
        ),
    );
    workspace.run(&[
        "lab",
        "read",
        &run_dir_str,
        readings.to_str().expect("path"),
    ]);
    let mechanisms = workspace.write(
        "mechanisms.json",
        &format!(
            r#"{{"contract_version":1,"run_id":"{run_id}","mechanisms":[{{"id":"m1","proposed_mechanism":"declare budgets","affected_contract":"planning::Plan","expected_benefit":"comparable runs","risks":["drift"],"supporting_claim_ids":["c1"]}}]}}"#
        ),
    );
    workspace.run(&[
        "lab",
        "mechanisms",
        &run_dir_str,
        mechanisms.to_str().expect("path"),
    ]);
    let plans = workspace.write(
        "plans.json",
        &format!(
            r#"{{"contract_version":1,"run_id":"{run_id}","plans":[{{"id":"P1","title":"budgets","mechanism_ids":["m1"],"deliverables":["field"],"acceptance_checks":["valid plan passes","bad plan fails"],"dependencies":[]}}]}}"#
        ),
    );
    workspace.run(&["lab", "plans", &run_dir_str, plans.to_str().expect("path")]);

    let (ok, stdout, stderr) = workspace.run(&["lab", "review", &run_dir_str]);
    assert!(ok, "{stderr}");
    let receipt: serde_json::Value = serde_json::from_str(&stdout).expect("json");
    assert_eq!(receipt["acceptance"], "self_review");
    assert!(
        receipt["validation_boundary"]
            .as_str()
            .expect("boundary")
            .contains("structural"),
        "a receipt must name what its validity covers"
    );

    let packet = fs::read_to_string(run_dir.join("review.md")).expect("review");
    assert!(packet.contains("self-review"), "{packet}");
    assert!(packet.contains("structural conformance"));

    let (ok, stdout, stderr) = workspace.run(&["lab", "status", &run_dir_str]);
    assert!(ok, "{stderr}");
    let status: serde_json::Value = serde_json::from_str(&stdout).expect("json");
    assert_eq!(status["acceptance"], "self_review");
}

#[test]
fn naming_a_second_reviewer_makes_the_run_independent() {
    let workspace = Workspace::new("acceptance-independent");
    registry(&workspace);
    let run_dir = workspace.path("run");
    let output = std::process::Command::new(binary())
        .args([
            "lab",
            "start",
            run_dir.to_str().expect("path"),
            "topic-agentic-systems",
            "plans",
            "How should planning represent budgets?",
            "agentic-systems-dair-ai",
        ])
        .env("HOME", &workspace.root)
        .env("MOZAK_EVALUATED_BY", "an independent reviewer")
        .output()
        .expect("run mozak");
    assert!(output.status.success());
    let receipt: serde_json::Value = serde_json::from_slice(&output.stdout).expect("json");
    assert_eq!(receipt["acceptance"], "independent");
    assert_eq!(receipt["evaluated_by"], "an independent reviewer");
    assert_ne!(receipt["performed_by"], receipt["evaluated_by"]);
}
