use sha2::{Digest, Sha256};
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

fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
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
    selection_for_dir(workspace, &workspace.path("run"), run_id, included)
}

fn selection_for_dir(
    workspace: &Workspace,
    run_dir: &Path,
    run_id: &str,
    included: &[&str],
) -> PathBuf {
    let literature: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(run_dir.join("literature-run.json")).expect("literature"),
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
        &format!("selection-{run_id}.json"),
        &format!(
            r#"{{"contract_version":1,"run_id":"{run_id}","included":[{}],"excluded":[{}]}}"#,
            include.join(","),
            exclude.join(",")
        ),
    )
}

fn start_run(workspace: &Workspace, binding: &str) -> String {
    start_run_at(workspace, &workspace.path("run"), binding)
}

fn start_run_at(workspace: &Workspace, run_dir: &Path, binding: &str) -> String {
    start_run_at_with_question(
        workspace,
        run_dir,
        binding,
        "How should planning represent budgets?",
    )
}

fn start_run_at_with_question(
    workspace: &Workspace,
    run_dir: &Path,
    binding: &str,
    question: &str,
) -> String {
    let (ok, stdout, stderr) = workspace.run(&[
        "lab",
        "start",
        run_dir.to_str().expect("path"),
        "topic-agentic-systems",
        "plans",
        question,
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
        r#"{"schema_version":1,"bindings":[{"id":"topic-agentic-systems","adapter":"dair-ai","target_scope_id":"topic-agentic-systems","request_path":"/tmp/r.json","request_sha256":"x","runner_path":"/tmp/r.sh","runner_sha256":"y","runs_dir":"/tmp/runs"}]}"#,
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
        "topic-agentic-systems",
    ]);
    assert!(!ok);
    assert!(stderr.contains("unknown module"));
}

#[test]
fn refuses_to_overwrite_an_existing_run() {
    let workspace = Workspace::new("overwrite");
    registry(&workspace);
    start_run(&workspace, "topic-agentic-systems");
    let run_dir = workspace.path("run");
    let (ok, _, stderr) = workspace.run(&[
        "lab",
        "start",
        run_dir.to_str().expect("path"),
        "topic-agentic-systems",
        "plans",
        "question",
        "topic-agentic-systems",
    ]);
    assert!(!ok);
    assert!(stderr.contains("refusing to overwrite"));
}

#[test]
#[allow(clippy::too_many_lines)]
fn runs_the_planning_pipeline_and_stops_at_review() {
    let workspace = Workspace::new("pipeline");
    registry(&workspace);
    let run_id = start_run(&workspace, "topic-agentic-systems");
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

    let inventory = workspace.write(
        "source-inventory.json",
        &format!(
            r#"{{"contract_version":1,"run_id":"{run_id}","sources":[{{"paper_id":"paper-0000","source_uri":"https://example.org/a","content_sha256":"hash-a","repository":{{"url":"https://github.com/example/repo","revision":"abc123","content_sha256":"repo-hash"}}}}]}}"#
        ),
    );
    let groups = workspace.write(
        "groups.json",
        &format!(
            r#"{{"contract_version":1,"run_id":"{run_id}","groups":[{{"id":"group-budget","title":"Budget approaches","purpose":"compare budget designs","paper_ids":["paper-0000"]}}]}}"#
        ),
    );
    let (ok, stdout, stderr) = workspace.run(&[
        "lab",
        "group",
        "define",
        &run_dir_str,
        inventory.to_str().expect("path"),
        groups.to_str().expect("path"),
    ]);
    assert!(ok, "{stderr}");
    assert!(stdout.contains("sources_tracked"));

    let bad_synthesis = workspace.write(
        "bad-synthesis.json",
        &format!(
            r#"{{"contract_version":1,"run_id":"{run_id}","syntheses":[{{"group_id":"group-budget","compared_approaches":["one"],"synthesis":"too narrow","cited_claim_ids":["c1"],"limitations":[]}}]}}"#
        ),
    );
    let (ok, _, stderr) = workspace.run(&[
        "lab",
        "group",
        "synthesize",
        &run_dir_str,
        bad_synthesis.to_str().expect("path"),
    ]);
    assert!(!ok);
    assert!(stderr.contains("compare at least two approaches"));

    let synthesis = workspace.write(
        "group-synthesis-input.json",
        &format!(
            r#"{{"contract_version":1,"run_id":"{run_id}","syntheses":[{{"group_id":"group-budget","compared_approaches":["static","adaptive"],"synthesis":"compare both designs","cited_claim_ids":["c1"],"limitations":[]}}]}}"#
        ),
    );
    let (ok, _, stderr) = workspace.run(&[
        "lab",
        "group",
        "synthesize",
        &run_dir_str,
        synthesis.to_str().expect("path"),
    ]);
    assert!(ok, "{stderr}");

    let skill = workspace.write(
        "group-skill-input.json",
        &format!(
            r#"{{"contract_version":1,"run_id":"{run_id}","scope_id":"topic-agentic-systems","topic_id":"topic-agentic-systems","skill_id":"budget-skill","revision":"r1","summary":"compare budget approaches","group_ids":["group-budget"],"comparison_guidance":["compare static","compare adaptive"],"cited_claim_ids":["c1"],"concept_candidates":[{{"id":"concept-budget","group_id":"group-budget","title":"Budget concept","invariant":"budgets bound work","applicability_limits":["planning only"],"cited_claim_ids":["c1"],"proposal_only":true,"accepted":false}}],"retains_full_text":false}}"#
        ),
    );
    let (ok, stdout, stderr) = workspace.run(&[
        "lab",
        "group",
        "skill",
        &run_dir_str,
        skill.to_str().expect("path"),
    ]);
    assert!(ok, "{stderr}");
    assert!(stdout.contains("proposal_only_owner_review_required"));

    let (ok, _, stderr) = workspace.run(&[
        "lab",
        "group",
        "skill",
        &run_dir_str,
        skill.to_str().expect("path"),
    ]);
    assert!(!ok);
    assert!(stderr.contains("refusing to overwrite"));

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

    let materialized = workspace.path("budget-skill-r1");
    let materialized_str = materialized.display().to_string();
    let skill_hash = hash(&fs::read(run_dir.join("group-skill.json")).expect("skill proposal"));
    let approval = workspace.write(
        "approval.json",
        &format!(
            r#"{{"contract_version":1,"decision":true,"run_id":"{run_id}","scope_id":"topic-agentic-systems","topic_id":"topic-agentic-systems","skill_id":"budget-skill","revision":"r1","group_skill_sha256":"{skill_hash}","output_dir":"{materialized_str}","predecessor_manifest_sha256":null,"approved_by":"owner","approved_at":"2026-09-21T00:00:00Z","rationale":"publish first explanatory skill revision"}}"#
        ),
    );
    let false_output = workspace.path("budget-skill-false");
    let false_output_str = false_output.display().to_string();
    let false_approval = workspace.write(
        "approval-false.json",
        &format!(
            r#"{{"contract_version":1,"decision":false,"run_id":"{run_id}","scope_id":"topic-agentic-systems","topic_id":"topic-agentic-systems","skill_id":"budget-skill","revision":"r1","group_skill_sha256":"{skill_hash}","output_dir":"{false_output_str}","predecessor_manifest_sha256":null,"approved_by":"owner","approved_at":"2026-09-21T00:00:00Z","rationale":"negative test"}}"#
        ),
    );
    let (ok, _, stderr) = workspace.run(&[
        "lab",
        "group",
        "materialize",
        &run_dir_str,
        false_approval.to_str().expect("path"),
        &false_output_str,
        "none",
    ]);
    assert!(!ok);
    assert!(stderr.contains("decision must be true"));
    assert!(
        !false_output.exists(),
        "failed approval left partial output"
    );

    let bad_time_output = workspace.path("budget-skill-bad-time");
    let bad_time_output_str = bad_time_output.display().to_string();
    let bad_time_approval = workspace.write(
        "approval-bad-time.json",
        &format!(
            r#"{{"contract_version":1,"decision":true,"run_id":"{run_id}","scope_id":"topic-agentic-systems","topic_id":"topic-agentic-systems","skill_id":"budget-skill","revision":"r1","group_skill_sha256":"{skill_hash}","output_dir":"{bad_time_output_str}","predecessor_manifest_sha256":null,"approved_by":"owner","approved_at":"2026-99-99T00:00:00Z","rationale":"negative test"}}"#
        ),
    );
    let (ok, _, stderr) = workspace.run(&[
        "lab",
        "group",
        "materialize",
        &run_dir_str,
        bad_time_approval.to_str().expect("path"),
        &bad_time_output_str,
        "none",
    ]);
    assert!(!ok);
    assert!(stderr.contains("canonical valid UTC timestamp"));
    assert!(
        !bad_time_output.exists(),
        "bad timestamp left partial output"
    );

    let mismatch_output = workspace.path("budget-skill-hash-mismatch");
    let mismatch_output_str = mismatch_output.display().to_string();
    let mismatch_approval = workspace.write(
        "approval-hash-mismatch.json",
        &format!(
            r#"{{"contract_version":1,"decision":true,"run_id":"{run_id}","scope_id":"topic-agentic-systems","topic_id":"topic-agentic-systems","skill_id":"budget-skill","revision":"r1","group_skill_sha256":"0000","output_dir":"{mismatch_output_str}","predecessor_manifest_sha256":null,"approved_by":"owner","approved_at":"2026-09-21T00:00:00Z","rationale":"negative test"}}"#
        ),
    );
    let (ok, _, stderr) = workspace.run(&[
        "lab",
        "group",
        "materialize",
        &run_dir_str,
        mismatch_approval.to_str().expect("path"),
        &mismatch_output_str,
        "none",
    ]);
    assert!(!ok);
    assert!(stderr.contains("exact group skill hash"));
    assert!(
        !mismatch_output.exists(),
        "hash mismatch left partial output"
    );

    let (ok, stdout, stderr) = workspace.run(&[
        "lab",
        "group",
        "materialize",
        &run_dir_str,
        approval.to_str().expect("path"),
        &materialized_str,
        "none",
    ]);
    assert!(ok, "{stderr}");
    assert!(stdout.contains("owner_approved_create_only"));
    let rendered = fs::read_to_string(materialized.join("SKILL.md")).expect("skill md");
    assert!(rendered.starts_with("---\nname: budget-skill\ndescription:"));
    assert!(rendered.contains("Budget approaches"));
    assert!(rendered.contains("Content sha256"));
    assert!(rendered.contains("does not accept Concepts"));
    let manifest = fs::read_to_string(materialized.join("manifest.json")).expect("manifest");
    assert!(manifest.contains(r#""predecessor_manifest_sha256": null"#));
    let (ok, _, stderr) = workspace.run(&[
        "lab",
        "group",
        "materialize",
        &run_dir_str,
        approval.to_str().expect("path"),
        &materialized_str,
        "none",
    ]);
    assert!(!ok);
    assert!(stderr.contains("refusing to overwrite"));

    #[cfg(unix)]
    {
        let symlink_output = workspace.path("budget-skill-symlink");
        std::os::unix::fs::symlink(&materialized, &symlink_output).expect("symlink");
        let symlink_output_str = symlink_output.display().to_string();
        let symlink_approval = workspace.write(
            "approval-symlink.json",
            &format!(
                r#"{{"contract_version":1,"decision":true,"run_id":"{run_id}","scope_id":"topic-agentic-systems","topic_id":"topic-agentic-systems","skill_id":"budget-skill","revision":"r1","group_skill_sha256":"{skill_hash}","output_dir":"{symlink_output_str}","predecessor_manifest_sha256":null,"approved_by":"owner","approved_at":"2026-09-21T00:00:00Z","rationale":"negative test"}}"#
            ),
        );
        let (ok, _, stderr) = workspace.run(&[
            "lab",
            "group",
            "materialize",
            &run_dir_str,
            symlink_approval.to_str().expect("path"),
            &symlink_output_str,
            "none",
        ]);
        assert!(!ok);
        assert!(stderr.contains("refusing to overwrite"));
    }

    let second_run_dir = workspace.path("run-r2");
    let second_run_id = start_run_at_with_question(
        &workspace,
        &second_run_dir,
        "topic-agentic-systems",
        "How should planning represent budget skill revisions?",
    );
    let second_run_dir_str = second_run_dir.to_str().expect("path").to_owned();
    let adapter = adapter_run(&workspace);
    let (ok, _, stderr) = workspace.run(&[
        "lab",
        "refresh",
        &second_run_dir_str,
        adapter.to_str().expect("path"),
    ]);
    assert!(ok, "{stderr}");
    let selection = selection_for_dir(&workspace, &second_run_dir, &second_run_id, &["paper-0000"]);
    let (ok, _, stderr) = workspace.run(&[
        "lab",
        "select",
        &second_run_dir_str,
        selection.to_str().expect("path"),
    ]);
    assert!(ok, "{stderr}");
    let readings = workspace.write(
        "readings-r2.json",
        &format!(
            r#"{{"contract_version":1,"run_id":"{second_run_id}","readings":[{{"paper_id":"paper-0000","source_class":"preprint","source_uri":"https://example.org/a","content_sha256":"hash-a","read_depth":"full_text","claims":[{{"id":"c1","text":"budgets help","origin":"source_claim","locator":"s4"}}],"limitations":["one benchmark"],"retained_full_text":false}}]}}"#
        ),
    );
    let (ok, _, stderr) = workspace.run(&[
        "lab",
        "read",
        &second_run_dir_str,
        readings.to_str().expect("path"),
    ]);
    assert!(ok, "{stderr}");
    let inventory = workspace.write(
        "source-inventory-r2.json",
        &format!(
            r#"{{"contract_version":1,"run_id":"{second_run_id}","sources":[{{"paper_id":"paper-0000","source_uri":"https://example.org/a","content_sha256":"hash-a","repository":{{"url":"https://github.com/example/repo","revision":"abc123","content_sha256":"repo-hash"}}}}]}}"#
        ),
    );
    let groups = workspace.write(
        "groups-r2.json",
        &format!(
            r#"{{"contract_version":1,"run_id":"{second_run_id}","groups":[{{"id":"group-budget","title":"Budget approaches","purpose":"compare budget designs","paper_ids":["paper-0000"]}}]}}"#
        ),
    );
    let (ok, _, stderr) = workspace.run(&[
        "lab",
        "group",
        "define",
        &second_run_dir_str,
        inventory.to_str().expect("path"),
        groups.to_str().expect("path"),
    ]);
    assert!(ok, "{stderr}");
    let synthesis = workspace.write(
        "group-synthesis-r2.json",
        &format!(
            r#"{{"contract_version":1,"run_id":"{second_run_id}","syntheses":[{{"group_id":"group-budget","compared_approaches":["static","adaptive"],"synthesis":"compare both designs","cited_claim_ids":["c1"],"limitations":[]}}]}}"#
        ),
    );
    let (ok, _, stderr) = workspace.run(&[
        "lab",
        "group",
        "synthesize",
        &second_run_dir_str,
        synthesis.to_str().expect("path"),
    ]);
    assert!(ok, "{stderr}");
    let revision_two = workspace.write(
        "group-skill-r2.json",
        &format!(
            r#"{{"contract_version":1,"run_id":"{second_run_id}","scope_id":"topic-agentic-systems","topic_id":"topic-agentic-systems","skill_id":"budget-skill","revision":"r2","summary":"compare budget approaches v2","group_ids":["group-budget"],"comparison_guidance":["compare static","compare adaptive"],"cited_claim_ids":["c1"],"concept_candidates":[],"retains_full_text":false}}"#
        ),
    );
    let (ok, _, stderr) = workspace.run(&[
        "lab",
        "group",
        "skill",
        &second_run_dir_str,
        revision_two.to_str().expect("path"),
    ]);
    assert!(ok, "{stderr}");
    let mechanisms = workspace.write(
        "mechanisms-r2.json",
        &format!(
            r#"{{"contract_version":1,"run_id":"{second_run_id}","mechanisms":[{{"id":"m1","proposed_mechanism":"declare budgets","affected_contract":"planning::Plan","expected_benefit":"comparable runs","risks":["drift"],"supporting_claim_ids":["c1"]}}]}}"#
        ),
    );
    let (ok, _, stderr) = workspace.run(&[
        "lab",
        "mechanisms",
        &second_run_dir_str,
        mechanisms.to_str().expect("path"),
    ]);
    assert!(ok, "{stderr}");
    let plans = workspace.write(
        "plans-r2.json",
        &format!(
            r#"{{"contract_version":1,"run_id":"{second_run_id}","plans":[{{"id":"P1","title":"budgets","mechanism_ids":["m1"],"deliverables":["field"],"acceptance_checks":["valid plan passes","bad plan fails"],"dependencies":[]}}]}}"#
        ),
    );
    let (ok, _, stderr) = workspace.run(&[
        "lab",
        "plans",
        &second_run_dir_str,
        plans.to_str().expect("path"),
    ]);
    assert!(ok, "{stderr}");
    let (ok, _, stderr) = workspace.run(&["lab", "review", &second_run_dir_str]);
    assert!(ok, "{stderr}");

    let second = workspace.path("budget-skill-r2");
    let second_str = second.display().to_string();
    let predecessor_hash =
        hash(&fs::read(materialized.join("manifest.json")).expect("manifest bytes"));
    let skill_hash =
        hash(&fs::read(second_run_dir.join("group-skill.json")).expect("skill proposal"));
    let unrelated_predecessor = workspace.write(
        "unrelated-manifest.json",
        r#"{"contract_version":1,"run_id":"improve-other-run","scope_id":"topic-agentic-systems","topic_id":"topic-agentic-systems","skill_id":"other-skill","revision":"r1","group_skill_sha256":"hash","predecessor_manifest_sha256":null,"materialized_by":"owner","materialized_at":"2026-09-21T00:00:00Z","approval_sha256":"approval","retains_full_text":false}"#,
    );
    let unrelated_hash = hash(&fs::read(&unrelated_predecessor).expect("unrelated predecessor"));
    let unrelated_output = workspace.path("budget-skill-unrelated-predecessor");
    let unrelated_output_str = unrelated_output.display().to_string();
    let unrelated_approval = workspace.write(
        "approval-unrelated-predecessor.json",
        &format!(
            r#"{{"contract_version":1,"decision":true,"run_id":"{second_run_id}","scope_id":"topic-agentic-systems","topic_id":"topic-agentic-systems","skill_id":"budget-skill","revision":"r2","group_skill_sha256":"{skill_hash}","output_dir":"{unrelated_output_str}","predecessor_manifest_sha256":"{unrelated_hash}","approved_by":"owner","approved_at":"2026-09-21T00:01:00Z","rationale":"negative test"}}"#
        ),
    );
    let (ok, _, stderr) = workspace.run(&[
        "lab",
        "group",
        "materialize",
        &second_run_dir_str,
        unrelated_approval.to_str().expect("path"),
        &unrelated_output_str,
        unrelated_predecessor.to_str().expect("path"),
    ]);
    assert!(!ok);
    assert!(stderr.contains("must match scope_id, topic_id, and skill_id"));
    assert!(
        !unrelated_output.exists(),
        "unrelated predecessor left partial output"
    );
    let approval_two = workspace.write(
        "approval-r2.json",
        &format!(
            r#"{{"contract_version":1,"decision":true,"run_id":"{second_run_id}","scope_id":"topic-agentic-systems","topic_id":"topic-agentic-systems","skill_id":"budget-skill","revision":"r2","group_skill_sha256":"{skill_hash}","output_dir":"{second_str}","predecessor_manifest_sha256":"{predecessor_hash}","approved_by":"owner","approved_at":"2026-09-21T00:01:00Z","rationale":"publish second explanatory skill revision"}}"#
        ),
    );
    let (ok, _, stderr) = workspace.run(&[
        "lab",
        "group",
        "materialize",
        &second_run_dir_str,
        approval_two.to_str().expect("path"),
        &second_str,
        materialized.join("manifest.json").to_str().expect("path"),
    ]);
    assert!(ok, "{stderr}");
    let manifest_two = fs::read_to_string(second.join("manifest.json")).expect("manifest two");
    assert!(manifest_two.contains(&predecessor_hash));

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
    let run_id = start_run(&workspace, "topic-agentic-systems");
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
    start_run(&workspace, "topic-agentic-systems");
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
    let run_id = start_run(&workspace, "topic-agentic-systems");
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
    let run_id = start_run(&workspace, "topic-agentic-systems");
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
    start_run(&workspace, "topic-agentic-systems");
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
    start_run(&workspace, "topic-agentic-systems");
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
    let run_id = start_run(&workspace, "topic-agentic-systems");
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
            "topic-agentic-systems",
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

/// Drives a complete run to `owner_reviewed`, so a second run has something to
/// inherit. Everything before this test asserted one run in isolation, which is
/// exactly the blind spot D1 exists to close.
fn complete_run(workspace: &Workspace, dir: &str, claim_text: &str) -> String {
    let run_dir = workspace.path(dir);
    let run_dir_str = run_dir.to_str().expect("path").to_owned();
    let (ok, stdout, stderr) = workspace.run(&[
        "lab",
        "start",
        &run_dir_str,
        "topic-agentic-systems",
        "improve-lab",
        "carry evidence forward",
        "topic-agentic-systems",
    ]);
    assert!(ok, "lab start failed: {stderr}");
    let run_id = serde_json::from_str::<serde_json::Value>(&stdout).expect("json")["run_id"]
        .as_str()
        .expect("run_id")
        .to_owned();

    let adapter = adapter_run(workspace);
    workspace.run(&[
        "lab",
        "refresh",
        &run_dir_str,
        adapter.to_str().expect("path"),
    ]);

    let literature: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(run_dir.join("literature-run.json")).expect("literature"),
    )
    .expect("json");
    let mut include = Vec::new();
    let mut exclude = Vec::new();
    for candidate in literature["candidates"].as_array().expect("candidates") {
        let id = candidate["paper_id"].as_str().expect("paper_id");
        if id == "paper-0000" {
            include.push(format!(r#"{{"paper_id":"{id}","reason":"on topic"}}"#));
        } else {
            exclude.push(format!(
                r#"{{"paper_id":"{id}","reason":"not prioritized"}}"#
            ));
        }
    }
    let selection = workspace.write(
        &format!("{dir}-selection.json"),
        &format!(
            r#"{{"contract_version":1,"run_id":"{run_id}","included":[{}],"excluded":[{}]}}"#,
            include.join(","),
            exclude.join(",")
        ),
    );
    workspace.run(&[
        "lab",
        "select",
        &run_dir_str,
        selection.to_str().expect("path"),
    ]);

    let readings = workspace.write(
        &format!("{dir}-readings.json"),
        &format!(
            r#"{{"contract_version":1,"run_id":"{run_id}","readings":[{{"paper_id":"paper-0000","source_class":"preprint","source_uri":"https://example.org/a","content_sha256":"{}","read_depth":"full_text","claims":[{{"id":"c1","text":"{claim_text}","origin":"source_claim","locator":"s4"}},{{"id":"c2","text":"this probably transfers","origin":"lab_inference","locator":"lab reasoning"}}],"limitations":["one benchmark"],"retained_full_text":false}}]}}"#,
            "a".repeat(64)
        ),
    );
    workspace.run(&[
        "lab",
        "read",
        &run_dir_str,
        readings.to_str().expect("path"),
    ]);

    let mechanisms = workspace.write(
        &format!("{dir}-mechanisms.json"),
        &format!(
            r#"{{"contract_version":1,"run_id":"{run_id}","mechanisms":[{{"id":"m1","proposed_mechanism":"do the thing","affected_contract":"lab::Run","expected_benefit":"clarity","risks":["drift"],"supporting_claim_ids":["c1"]}}]}}"#
        ),
    );
    workspace.run(&[
        "lab",
        "mechanisms",
        &run_dir_str,
        mechanisms.to_str().expect("path"),
    ]);

    let plans = workspace.write(
        &format!("{dir}-plans.json"),
        &format!(
            r#"{{"contract_version":1,"run_id":"{run_id}","plans":[{{"id":"P1","title":"do it","mechanism_ids":["m1"],"deliverables":["field"],"acceptance_checks":["valid passes","bad fails"],"dependencies":[]}}]}}"#
        ),
    );
    workspace.run(&["lab", "plans", &run_dir_str, plans.to_str().expect("path")]);

    let (ok, _, stderr) = workspace.run(&["lab", "review", &run_dir_str]);
    assert!(ok, "lab review failed: {stderr}");
    run_id
}

/// D1: the whole point. A second run must not start blind.
#[test]
fn a_second_run_inherits_what_the_first_established() {
    let workspace = Workspace::new("evidence-carry");
    registry(&workspace);
    complete_run(&workspace, "run-one", "budgets reduce wasted rollouts");

    let second = workspace.path("run-two");
    let (ok, stdout, stderr) = workspace.run(&[
        "lab",
        "start",
        second.to_str().expect("path"),
        "topic-agentic-systems",
        "improve-lab",
        "a later question",
        "topic-agentic-systems",
    ]);
    assert!(ok, "{stderr}");
    let receipt: serde_json::Value = serde_json::from_str(&stdout).expect("json");

    assert_eq!(
        receipt["inherited_evidence"], 1,
        "the second run must see the first run's source claim"
    );
    let requirements = receipt["preservation_requirements"]
        .as_array()
        .expect("requirements");
    assert_eq!(requirements.len(), 1);
    assert_eq!(requirements[0]["claim_id"], "paper-0000::c1");
    assert!(
        receipt["evidence_authority"]
            .as_str()
            .expect("authority")
            .starts_with("proposal_only"),
        "carried evidence must state that it authorizes nothing"
    );
}

/// A lab inference is this run's reasoning, not the Scope's knowledge.
#[test]
fn only_source_claims_are_carried_forward() {
    let workspace = Workspace::new("evidence-origin");
    registry(&workspace);
    complete_run(&workspace, "run-one", "a source said this");

    let evidence: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(
            workspace
                .root
                .join("topic-agentic-systems-scope-evidence.json"),
        )
        .expect("evidence"),
    )
    .expect("json");
    let entries = evidence["entries"].as_array().expect("entries");
    assert_eq!(entries.len(), 1, "the lab inference must not be carried");
    assert_eq!(entries[0]["claim_id"], "paper-0000::c1");
    assert_eq!(entries[0]["standing"], "held");
}

/// D1 check 2, end to end: the inherited requirement must reach the packet.
#[test]
fn the_second_packet_shows_what_it_inherited() {
    let workspace = Workspace::new("evidence-packet");
    registry(&workspace);
    complete_run(&workspace, "run-one", "budgets reduce wasted rollouts");
    complete_run(&workspace, "run-two", "budgets reduce wasted rollouts");

    let packet = fs::read_to_string(workspace.path("run-two").join("review.md")).expect("review");
    assert!(packet.contains("## Carried from earlier runs"), "{packet}");
    assert!(packet.contains("Preservation requirements"));
    assert!(packet.contains("paper-0000::c1"));
    assert!(
        packet.contains("proposal_only"),
        "the packet must carry the authority boundary"
    );

    let carried = packet.find("Carried from earlier runs").expect("section");
    let mechanisms = packet.find("## Proposed mechanisms").expect("mechanisms");
    assert!(
        carried < mechanisms,
        "inherited constraints must arrive before the plans they constrain"
    );
}

/// The first run has nothing to inherit, and must not pretend otherwise.
#[test]
fn a_first_run_reports_no_inherited_evidence() {
    let workspace = Workspace::new("evidence-first");
    registry(&workspace);
    let run_dir = workspace.path("run");
    let (ok, stdout, stderr) = workspace.run(&[
        "lab",
        "start",
        run_dir.to_str().expect("path"),
        "topic-agentic-systems",
        "improve-lab",
        "the first question",
        "topic-agentic-systems",
    ]);
    assert!(ok, "{stderr}");
    let receipt: serde_json::Value = serde_json::from_str(&stdout).expect("json");
    assert_eq!(receipt["inherited_evidence"], 0);
    assert!(
        receipt["preservation_requirements"]
            .as_array()
            .expect("array")
            .is_empty()
    );

    let packet_exists = workspace.path("run").join("review.md").exists();
    assert!(!packet_exists, "no packet before review");
}

/// D3: a boundary declared after the run chose what to read is a description,
/// not a bound.
#[test]
fn an_objective_must_be_declared_before_selection() {
    let workspace = Workspace::new("objective-order");
    registry(&workspace);
    let run_id = start_run(&workspace, "topic-agentic-systems");
    let run_dir = workspace.path("run");
    let run_dir_str = run_dir.to_str().expect("path").to_owned();

    let objective = workspace.write(
        "objective.json",
        r#"{"objective":"decide how the Lab bounds itself","completion_conditions":["a plan card exists"],"excludes":["runtime enforcement"]}"#,
    );

    let (ok, stdout, stderr) = workspace.run(&[
        "lab",
        "objective",
        &run_dir_str,
        objective.to_str().expect("path"),
    ]);
    assert!(ok, "before selection it is accepted: {stderr}");
    let receipt: serde_json::Value = serde_json::from_str(&stdout).expect("json");
    assert_eq!(receipt["completion_conditions"], 1);
    assert_eq!(receipt["excludes"], 1);

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

    let (ok, _, stderr) = workspace.run(&[
        "lab",
        "objective",
        &run_dir_str,
        objective.to_str().expect("path"),
    ]);
    assert!(!ok, "after selection it must be refused");
    assert!(stderr.contains("before selection"), "{stderr}");
}

#[test]
fn an_objective_without_a_completion_condition_is_refused() {
    let workspace = Workspace::new("objective-unbounded");
    registry(&workspace);
    start_run(&workspace, "topic-agentic-systems");
    let run_dir = workspace.path("run");
    let unbounded = workspace.write(
        "unbounded.json",
        r#"{"objective":"make the Lab better","completion_conditions":[]}"#,
    );
    let (ok, _, stderr) = workspace.run(&[
        "lab",
        "objective",
        run_dir.to_str().expect("path"),
        unbounded.to_str().expect("path"),
    ]);
    assert!(!ok);
    assert!(stderr.contains("completion condition"), "{stderr}");
}

/// D4: evidence for a mechanism, and the honesty of its absence.
#[test]
fn mechanism_evidence_is_recorded_and_gaps_are_named() {
    let workspace = Workspace::new("mechanism-evidence");
    registry(&workspace);
    let run_id = start_run(&workspace, "topic-agentic-systems");
    let run_dir = workspace.path("run");
    let run_dir_str = run_dir.to_str().expect("path").to_owned();

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
            r#"{{"contract_version":1,"run_id":"{run_id}","mechanisms":[{{"id":"m1","proposed_mechanism":"declare budgets","affected_contract":"planning::Plan","expected_benefit":"comparable runs","risks":["drift"],"supporting_claim_ids":["c1"]}},{{"id":"m2","proposed_mechanism":"defend an invariant","affected_contract":"lab::RunState","expected_benefit":"stability","risks":["rigidity"],"supporting_claim_ids":["c1"]}}]}}"#
        ),
    );
    workspace.run(&[
        "lab",
        "mechanisms",
        &run_dir_str,
        mechanisms.to_str().expect("path"),
    ]);

    let evidence = workspace.write(
        "evidence.json",
        &format!(
            r#"{{"contract_version":1,"run_id":"{run_id}","paired":[{{"contract_version":1,"mechanism_id":"m1","task":"plan a budgeted goal","baseline":{{"observed":"no budget field","locator":"a"}},"treatment":{{"observed":"budget field present","locator":"b"}},"fixed_conditions":[{{"kind":"agent","baseline":"claude","treatment":"claude"}}],"difference":"one field added","limitations":["one task"]}}]}}"#
        ),
    );
    let (ok, stdout, stderr) = workspace.run(&[
        "lab",
        "evidence",
        &run_dir_str,
        evidence.to_str().expect("path"),
    ]);
    assert!(ok, "{stderr}");
    let receipt: serde_json::Value = serde_json::from_str(&stdout).expect("json");
    assert_eq!(receipt["paired"], 1);
    let unaccounted = receipt["unaccounted_mechanisms"]
        .as_array()
        .expect("unaccounted");
    assert_eq!(unaccounted, &[serde_json::json!("m2")]);
    assert!(
        receipt["authority"]
            .as_str()
            .expect("authority")
            .starts_with("difference_under_stated_conditions")
    );

    let plans = workspace.write(
        "plans.json",
        &format!(
            r#"{{"contract_version":1,"run_id":"{run_id}","plans":[{{"id":"P1","title":"budgets","mechanism_ids":["m1","m2"],"deliverables":["field"],"acceptance_checks":["valid passes","bad fails"],"dependencies":[]}}]}}"#
        ),
    );
    workspace.run(&["lab", "plans", &run_dir_str, plans.to_str().expect("path")]);
    let (ok, _, stderr) = workspace.run(&["lab", "review", &run_dir_str]);
    assert!(ok, "{stderr}");

    let packet = fs::read_to_string(run_dir.join("review.md")).expect("review");
    assert!(
        packet.contains("## Evidence for these mechanisms"),
        "{packet}"
    );
    assert!(packet.contains("Difference: one field added"));
    assert!(packet.contains("Held fixed: agent"));
    assert!(
        packet.contains("**Unaccounted.**") && packet.contains("m2"),
        "a mechanism with no evidence must be named, not omitted"
    );
    assert!(packet.contains("difference_under_stated_conditions"));
}

/// A pair whose conditions moved is refused at the CLI boundary too.
#[test]
fn the_cli_refuses_an_uncontrolled_pair() {
    let workspace = Workspace::new("uncontrolled-pair");
    registry(&workspace);
    let run_id = start_run(&workspace, "topic-agentic-systems");
    let run_dir = workspace.path("run");
    let run_dir_str = run_dir.to_str().expect("path").to_owned();

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
            r#"{{"contract_version":1,"run_id":"{run_id}","mechanisms":[{{"id":"m1","proposed_mechanism":"x","affected_contract":"y","expected_benefit":"z","risks":["r"],"supporting_claim_ids":["c1"]}}]}}"#
        ),
    );
    workspace.run(&[
        "lab",
        "mechanisms",
        &run_dir_str,
        mechanisms.to_str().expect("path"),
    ]);

    let bad = workspace.write(
        "bad-evidence.json",
        &format!(
            r#"{{"contract_version":1,"run_id":"{run_id}","paired":[{{"contract_version":1,"mechanism_id":"m1","task":"t","baseline":{{"observed":"a","locator":"a"}},"treatment":{{"observed":"b","locator":"b"}},"fixed_conditions":[{{"kind":"agent","baseline":"claude","treatment":"another model"}}],"difference":"d","limitations":["one task"]}}]}}"#
        ),
    );
    let (ok, stdout, stderr) =
        workspace.run(&["lab", "evidence", &run_dir_str, bad.to_str().expect("path")]);
    assert!(!ok);
    assert!(stdout.is_empty(), "a refused pair writes no receipt");
    assert!(stderr.contains("was not held fixed"), "{stderr}");
    assert!(
        !run_dir.join("mechanism-evidence.json").exists(),
        "a refused pair must not persist"
    );
}
