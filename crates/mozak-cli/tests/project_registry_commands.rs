use mozak_core::research::{ResearchRun, run_artifact_hash};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Output, Stdio},
    sync::atomic::{AtomicU64, Ordering},
};

static NEXT: AtomicU64 = AtomicU64::new(0);
struct Temp(PathBuf);
impl Temp {
    fn new(label: &str) -> Self {
        let p = std::env::temp_dir().join(format!(
            "mozak-registry-{label}-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&p).unwrap();
        Self(p)
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}
fn sha(b: &[u8]) -> String {
    format!("{:x}", Sha256::digest(b))
}
fn run(args: &[&str], xdg: &Path) -> Output {
    Command::new(env!("CARGO_BIN_EXE_mozak"))
        .args(args)
        .env("XDG_CONFIG_HOME", xdg)
        .output()
        .unwrap()
}
fn valid_kb(base: &Path) -> PathBuf {
    let scope = base.join("scope");
    fs::create_dir_all(&scope).unwrap();
    let sb=serde_json::to_vec_pretty(&json!({"schema_version":2,"scopes":[{"id":"topic","kind":"topic","title":"Topic","intent":"Bounded","history":[{"id":"h-1","at":"2026-09-03T00:00:00Z","note":"Created"}]}],"promotions":[],"meta_goals":[],"inputs":[]})).unwrap();
    fs::write(scope.join("scope.json"), &sb).unwrap();
    let kb = base.join("kb");
    fs::create_dir_all(&kb).unwrap();
    let rb=serde_json::to_vec_pretty(&json!({"schema_version":1,"registrations":[{"id":"topic","path":scope,"scope_manifest_sha256":sha(&sb)}]})).unwrap();
    fs::write(kb.join("kb.json"), rb).unwrap();
    kb
}
fn linked_scope_kb(base: &Path) -> PathBuf {
    let scope = base.join("scope-linked");
    fs::create_dir_all(scope.join("projects/exact-project/.mozak")).unwrap();
    let manifest = b"version: 1\nframework_contract_version: 1\nproject:\n  id: exact-project\n  name: Test Project\nrepository:\n  revision: 0123456789abcdef0123456789abcdef01234567\nowned_paths:\n  - src\n";
    fs::write(
        scope.join("projects/exact-project/.mozak/project.yml"),
        manifest,
    )
    .unwrap();
    let promoted_topic = json!({"id":"promoted-topic","kind":"topic","title":"Promoted Topic","intent":"Promotion source","history":[]});
    let promoted_topic_hash = sha(&serde_json::to_vec(&promoted_topic).unwrap());
    let mb = serde_json::to_vec_pretty(&json!({
        "schema_version": 2,
        "scopes": [
            {"id":"exact-project","kind":"project","title":"Exact Project","intent":"Build exact project","history":[],"project":{"manifest_path":"projects/exact-project/.mozak/project.yml","manifest_sha256":sha(manifest),"project_id":"exact-project","repository_revision":"0123456789abcdef0123456789abcdef01234567","owned_paths":["src"]}},
            {"id":"shared-topic","kind":"topic","title":"Shared Topic","intent":"Shared meta-goal knowledge","history":[]},
            promoted_topic,
            {"id":"related-topic","kind":"topic","title":"Related Topic","intent":"Related goal target","history":[]}
        ],
        "promotions": [{"id":"promotion-1","source_topic_id":"promoted-topic","target_project_id":"exact-project","source_topic_sha256":promoted_topic_hash}],
        "meta_goals": [
            {"id":"goal-1","title":"Shared Goal","authority":"advisory_only","scope_ids":["exact-project","shared-topic"],"relationships":[{"to_goal_id":"goal-2","kind":"supports"}]},
            {"id":"goal-2","title":"Related Goal","authority":"advisory_only","scope_ids":["related-topic"],"relationships":[]}
        ],
        "inputs": []
    })).unwrap();
    fs::write(scope.join("scope.json"), &mb).unwrap();
    let kb = base.join("kb-linked");
    fs::create_dir_all(&kb).unwrap();
    let rb = serde_json::to_vec_pretty(&json!({"schema_version":1,"registrations":[{"id":"linked","path":scope,"scope_manifest_sha256":sha(&mb)}]})).unwrap();
    fs::write(kb.join("kb.json"), rb).unwrap();
    kb
}
fn project(root: &Path, id: &str) {
    fs::create_dir_all(root.join(".mozak")).unwrap();
    fs::write(root.join(".mozak/project.yml"),format!("version: 1\nframework_contract_version: 1\nproject:\n  id: {id}\n  name: Test Project\nrepository:\n  revision: 0123456789abcdef0123456789abcdef01234567\nowned_paths:\n  - src\n")).unwrap();
    fs::write(root.join(".mozak/idea.md"),"# Test Idea\n\n## Intent\n\nShip one bounded thing.\n\n## Desired outcomes\n\n- Works.\n\n## Boundaries\n\n- Local only.\n\n## Assumptions\n\n- Rust.\n\n## Open questions\n\n- None.\n").unwrap();
}
fn discover(kb: &Path, workspace: &Path, xdg: &Path) -> Value {
    let o = run(
        &[
            "project",
            "discover",
            kb.to_str().unwrap(),
            workspace.to_str().unwrap(),
        ],
        xdg,
    );
    assert!(o.status.success(), "{}", String::from_utf8_lossy(&o.stderr));
    serde_json::from_slice(&o.stdout).unwrap()
}
fn review(proposal: &Value, base: &Path, xdg: &Path) -> Output {
    let path = base.join("review-proposal.json");
    fs::write(&path, serde_json::to_vec(proposal).unwrap()).unwrap();
    run(&["project", "review", path.to_str().unwrap()], xdg)
}
fn approve(proposal: &Value, path: &Path) {
    fs::write(path,serde_json::to_vec(&json!({"schema_version":1,"decision":true,"proposal_digest":proposal["proposal_digest"],"target_config_path":proposal["target_config_path"],"owner":"test-owner","approved_at":"2026-09-03T07:21:10Z","rationale":"Explicit local registration for testing."})).unwrap()).unwrap();
}
fn approve_refresh(proposal: &Value, path: &Path, owner: &str) {
    fs::write(path, serde_json::to_vec(&json!({"schema_version":1,"decision":true,"intent":"project refresh","proposal_digest":proposal["proposal_digest"],"target_config_path":proposal["target_config_path"],"owner":owner,"approved_at":"2026-09-03T07:21:10Z","rationale":"Explicit exact local registry refresh for testing."})).unwrap()).unwrap();
}
fn register_initial(kb: &Path, ws: &Path, xdg: &Path, base: &Path) -> Value {
    let proposal = discover(kb, ws, xdg);
    let pp = base.join("initial-proposal.json");
    let ap = base.join("initial-approval.json");
    fs::write(&pp, serde_json::to_vec(&proposal).unwrap()).unwrap();
    approve(&proposal, &ap);
    let out = run(
        &[
            "project",
            "register",
            pp.to_str().unwrap(),
            ap.to_str().unwrap(),
        ],
        xdg,
    );
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    proposal
}

fn write_adapter_registry(xdg: &Path, runs_dir: &Path) {
    let dir = xdg.join("mozak");
    fs::create_dir_all(&dir).unwrap();
    let request = dir.join("request.json");
    let runner = dir.join("runner.sh");
    fs::write(&request, b"{\"scope_id\":\"topic\"}").unwrap();
    fs::write(&runner, b"#!/bin/sh\nexit 0\n").unwrap();
    fs::write(
        dir.join("adapters.json"),
        serde_json::to_vec(&json!({
            "schema_version": 1,
            "bindings": [{
                "id": "agentic-systems-dair",
                "adapter": "dair-ai",
                "target_scope_id": "topic",
                "request_path": request,
                "request_sha256": sha(b"{\"scope_id\":\"topic\"}"),
                "runner_path": runner,
                "runner_sha256": sha(b"#!/bin/sh\nexit 0\n"),
                "runs_dir": runs_dir
            }]
        }))
        .unwrap(),
    )
    .unwrap();
}

fn drift_adapter_request(xdg: &Path) {
    fs::write(
        xdg.join("mozak/request.json"),
        b"{\"scope_id\":\"topic\",\"changed\":true}",
    )
    .unwrap();
}

fn write_research_run(path: &Path) {
    fs::write(path, include_bytes!("fixtures/lab_adapter_run.json")).unwrap();
}

fn write_research_run_with_id(path: &Path, run_id: &str, created_at: &str) {
    let mut run: Value =
        serde_json::from_slice(include_bytes!("fixtures/lab_adapter_run.json")).unwrap();
    run["run_id"] = json!(run_id);
    run["receipt"]["run_id"] = json!(run_id);
    run["created_at"] = json!(created_at);
    let mut typed: ResearchRun = serde_json::from_value(run.clone()).unwrap();
    typed.receipt.artifact_hash = run_artifact_hash(&typed).unwrap();
    run["receipt"]["artifact_hash"] = json!(typed.receipt.artifact_hash);
    fs::write(path, serde_json::to_vec_pretty(&run).unwrap()).unwrap();
}

fn write_adapter_registry_for_scope(xdg: &Path, runs_dir: &Path, scope_id: &str) {
    let dir = xdg.join("mozak");
    fs::create_dir_all(&dir).unwrap();
    let request = dir.join("request.json");
    let runner = dir.join("runner.sh");
    let request_bytes = serde_json::to_vec(&json!({"scope_id": scope_id})).unwrap();
    fs::write(&request, &request_bytes).unwrap();
    fs::write(&runner, b"#!/bin/sh\nexit 0\n").unwrap();
    fs::write(
        dir.join("adapters.json"),
        serde_json::to_vec(&json!({
            "schema_version": 1,
            "bindings": [{
                "id": "agentic-systems-dair",
                "adapter": "dair-ai",
                "target_scope_id": scope_id,
                "request_path": request,
                "request_sha256": sha(&request_bytes),
                "runner_path": runner,
                "runner_sha256": sha(b"#!/bin/sh\nexit 0\n"),
                "runs_dir": runs_dir
            }]
        }))
        .unwrap(),
    )
    .unwrap();
}

#[test]
#[allow(clippy::too_many_lines)]
fn project_current_reports_bounded_state_and_marks_older_adapter_runs_stale() {
    let t = Temp::new("current-stale-runs");
    let kb = valid_kb(&t.0);
    let ws = t.0.join("workspace");
    project(&ws.join("current"), "current-project");
    let xdg = t.0.join("xdg");
    register_initial(&kb, &ws, &xdg, &t.0);
    let runs = t.0.join("runs");
    fs::create_dir_all(&runs).unwrap();
    write_research_run(&runs.join("old.json"));
    write_research_run(&runs.join("new.json"));
    write_adapter_registry(&xdg, &runs);

    let out = run(&["project", "current", "current-project"], &xdg);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let report: Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(report["command"], "project current");
    assert_eq!(report["mutation"], false);
    assert_eq!(report["trust_transfer"], false);
    assert_eq!(report["automatic_promotion"], false);
    assert_eq!(
        report["labels"]["accepted"],
        "owner-accepted planning state only"
    );
    assert_eq!(
        report["adapter_freshness"]["records"][0]["stale_run_count"],
        1
    );
    assert_eq!(report["adapter_freshness"]["truncated"], false);
    assert!(
        report["newest_proposal_only_research"]["run_id"]
            .as_str()
            .is_some()
    );
    assert_eq!(
        report["newest_proposal_only_research"]["authority"],
        "proposal_only"
    );
    assert_eq!(report["newest_proposal_only_research"]["accepted"], false);
    assert_eq!(
        report["newest_proposal_only_research"]["freshness"],
        "current"
    );
    assert_eq!(report["current_state_projection"]["bounded_summary"], true);
    assert!(
        report["current_state_projection"]
            .get("canonical_hash")
            .is_some()
    );
    assert!(report["current_state_projection"].get("sources").is_some());
    assert!(
        report["current_state_projection"]
            .get("project_id")
            .is_some()
    );
    assert!(
        report["current_state_projection"]
            .get("relationships")
            .is_some()
    );
    assert!(report["current_state_projection"].get("nodes").is_some());
    assert!(report["current_state_projection"].get("mutation").is_some());
    assert!(
        report["current_state_projection"]
            .get("automatic_promotion")
            .is_some()
    );
    assert!(
        report["current_state_projection"]
            .get("schema_version")
            .is_some()
    );
    assert!(report["current_state_projection"].get("counts").is_some());
    assert!(
        report["current_state_projection"]
            .get("observes_relationships")
            .is_some()
    );
    assert!(
        report["current_state_projection"]
            .get("full_projection")
            .is_none()
    );
    assert!(
        report["current_state_projection"]["nodes"]["returned_count"]
            .as_u64()
            .unwrap()
            <= 12
    );
    let observes = report["current_state_projection"]["observes_relationships"]["records"]
        .as_array()
        .unwrap();
    assert!(
        observes
            .iter()
            .all(|edge| edge["to"] != "project:current-project")
    );
    assert!(observes.iter().any(|edge| edge["to"] == "scope:topic"));
    let text = String::from_utf8(out.stdout).unwrap();
    assert!(!text.contains("automatic promotion"));
    assert!(!text.contains("trust transfer"));
}

#[test]
fn project_current_without_adapters_or_research_is_valid_and_bounded() {
    let t = Temp::new("current-empty");
    let kb = valid_kb(&t.0);
    let ws = t.0.join("workspace");
    project(&ws.join("empty"), "empty-current");
    let xdg = t.0.join("xdg");
    register_initial(&kb, &ws, &xdg, &t.0);

    let out = run(&["project", "current", "empty-current"], &xdg);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let report: Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(report["adapter_freshness"]["records"], json!([]));
    assert_eq!(report["newest_proposal_only_research"], Value::Null);
    assert_eq!(report["goal_state"]["ready_goals"], json!([]));
    assert_eq!(
        report["bounded_directories"]["project_root"],
        ws.join("empty").to_string_lossy().as_ref()
    );
    assert_eq!(report["current_state_projection"]["bounded_summary"], true);
    assert!(
        report["current_state_projection"]["nodes"]["returned_count"]
            .as_u64()
            .unwrap()
            >= 2
    );
    let browse = run(&["project", "browse", "empty-current"], &xdg);
    assert!(
        browse.status.success(),
        "{}",
        String::from_utf8_lossy(&browse.stderr)
    );
    let browse_report: Value = serde_json::from_slice(&browse.stdout).unwrap();
    assert_eq!(
        browse_report["records"]["adapter_freshness"]["records"],
        json!([])
    );
    assert_eq!(
        browse_report["records"]["proposal_only_research"]["records"],
        json!([])
    );
}

#[test]
fn project_current_marks_drifted_adapter_pins_needs_recheck_without_current_runs() {
    let t = Temp::new("current-drifted-adapter");
    let kb = valid_kb(&t.0);
    let ws = t.0.join("workspace");
    project(&ws.join("drifted"), "drifted-current");
    let xdg = t.0.join("xdg");
    register_initial(&kb, &ws, &xdg, &t.0);
    let runs = t.0.join("runs");
    fs::create_dir_all(&runs).unwrap();
    write_research_run(&runs.join("run.json"));
    write_adapter_registry(&xdg, &runs);
    drift_adapter_request(&xdg);

    let out = run(&["project", "current", "drifted-current"], &xdg);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let report: Value = serde_json::from_slice(&out.stdout).unwrap();
    let binding = &report["adapter_freshness"]["records"][0];
    assert_eq!(binding["freshness"], "needs_recheck");
    assert_eq!(binding["state"], "needs_recheck");
    assert_eq!(binding["callable"], false);
    assert_eq!(binding["authority"], "owner_configured_needs_recheck");
    assert_eq!(binding["latest_recorded"], Value::Null);
    assert_eq!(binding["drifted"][0]["pin"], "request");
    assert_eq!(report["newest_proposal_only_research"], Value::Null);
    assert_eq!(
        report["current_state_projection"]["observes_relationships"]["total_count"],
        0
    );
}

#[test]
fn project_browse_rejects_symlinked_adapter_runs_dir_children_without_records() {
    use std::os::unix::fs::symlink;

    let t = Temp::new("runs-symlink-escape");
    let kb = valid_kb(&t.0);
    let ws = t.0.join("workspace");
    project(&ws.join("nav"), "nav-current");
    let xdg = t.0.join("xdg");
    register_initial(&kb, &ws, &xdg, &t.0);

    let runs = t.0.join("runs");
    let outside = t.0.join("outside-runs");
    fs::create_dir_all(&runs).unwrap();
    fs::create_dir_all(&outside).unwrap();
    write_research_run(&outside.join("run.json"));
    symlink(&outside, runs.join("linked-outside")).unwrap();
    write_adapter_registry(&xdg, &runs);

    let browse = run(&["project", "browse", "nav-current"], &xdg);
    assert!(!browse.status.success());
    assert_eq!(browse.stdout, b"");
    let stderr = String::from_utf8_lossy(&browse.stderr);
    assert!(stderr.contains("symlinked entry"));
    assert!(!stderr.contains("run-10b5a0e19c4191556e69eb21"));
}

#[test]
#[allow(clippy::too_many_lines)]
fn project_browse_resolve_why_are_bounded_and_provenance_aware() {
    let t = Temp::new("browse-resolve-why");
    let kb = valid_kb(&t.0);
    let ws = t.0.join("workspace");
    project(&ws.join("nav"), "nav-current");
    let xdg = t.0.join("xdg");
    register_initial(&kb, &ws, &xdg, &t.0);
    let runs = t.0.join("runs");
    fs::create_dir_all(&runs).unwrap();
    write_research_run_with_id(
        &runs.join("yesterday.json"),
        "run-yesterday-10b5a0e19c4191556e69",
        "2026-09-05T22:17:35Z",
    );
    write_research_run_with_id(
        &runs.join("today.json"),
        "run-today-10b5a0e19c4191556e69eb",
        "2026-09-06T22:17:35Z",
    );
    write_adapter_registry(&xdg, &runs);

    let browse = run(&["project", "browse", "nav-current"], &xdg);
    assert!(
        browse.status.success(),
        "{}",
        String::from_utf8_lossy(&browse.stderr)
    );
    let browse_json: Value = serde_json::from_slice(&browse.stdout).unwrap();
    assert_eq!(browse_json["command"], "project browse");
    assert_eq!(browse_json["boundary"]["configured_records_only"], true);
    assert_eq!(
        browse_json["boundary"]["arbitrary_filesystem_scanning"],
        false
    );
    assert_eq!(browse_json["boundary"]["recommendation"], false);
    assert_eq!(browse_json["boundary"]["acceptance"], false);
    assert_eq!(browse_json["boundary"]["truth_claim"], false);
    assert_eq!(
        browse_json["records"]["proposal_only_research"]["total_count"],
        2
    );
    assert_eq!(
        browse_json["records"]["proposal_only_research"]["limit"],
        12
    );
    assert!(
        !String::from_utf8(browse.stdout)
            .unwrap()
            .contains("full_text")
    );

    let records = browse_json["records"]["proposal_only_research"]["records"]
        .as_array()
        .unwrap();
    let today = records
        .iter()
        .find(|r| r["freshness"] == "current")
        .unwrap();
    let yesterday = records.iter().find(|r| r["freshness"] == "stale").unwrap();
    assert_eq!(today["freshness"], "current");
    assert_eq!(yesterday["freshness"], "stale");
    let today_id = today["record_id"].as_str().unwrap();
    let yesterday_id = yesterday["record_id"].as_str().unwrap();

    let resolved = run(&["project", "resolve", "nav-current", today_id], &xdg);
    assert!(
        resolved.status.success(),
        "{}",
        String::from_utf8_lossy(&resolved.stderr)
    );
    let resolved_json: Value = serde_json::from_slice(&resolved.stdout).unwrap();
    assert_eq!(
        resolved_json["relationship_policy"],
        "only declared Stage 1 projection relationships are followed"
    );
    assert_eq!(resolved_json["undeclared_relationships_followed"], false);
    assert_eq!(resolved_json["record"]["research"]["accepted"], false);
    assert_eq!(
        resolved_json["record"]["source"]["id"],
        today["projection_source_id"]
    );
    assert_eq!(
        resolved_json["record"]["node"]["id"],
        format!("research:{}", today["run_id"].as_str().unwrap())
    );
    let edges = resolved_json["declared_relationships"]["records"]
        .as_array()
        .unwrap();
    assert!(edges.iter().any(|edge| edge["relation"] == "observes"
        && edge["from"] == resolved_json["record"]["node"]["id"]
        && edge["to"] == "scope:topic"));

    let stale = run(&["project", "resolve", "nav-current", yesterday_id], &xdg);
    assert!(!stale.status.success());
    assert!(String::from_utf8_lossy(&stale.stderr).contains("stale hash/freshness"));

    let undeclared = run(
        &[
            "project",
            "resolve",
            "nav-current",
            "research-run:not-declared",
        ],
        &xdg,
    );
    assert!(!undeclared.status.success());
    assert!(String::from_utf8_lossy(&undeclared.stderr).contains("not declared"));

    let why = run(&["project", "why", "nav-current", yesterday_id], &xdg);
    assert!(
        why.status.success(),
        "{}",
        String::from_utf8_lossy(&why.stderr)
    );
    let why_json: Value = serde_json::from_slice(&why.stdout).unwrap();
    assert_eq!(why_json["freshness"], "stale");
    assert_eq!(why_json["authority"], "proposal_only");
    assert!(
        why_json["supersession_explanation"]
            .as_str()
            .unwrap()
            .contains("does not accept either run")
    );
}

fn eval_observation(
    project_id: &str,
    failure_sha256: &str,
    command_hashes: &Value,
    label: &str,
    layer: &str,
    outcome: &str,
) -> Value {
    let expected_stdout_sha256 = if outcome == "pass" {
        command_hashes[0]["stdout_sha256"]
            .as_str()
            .unwrap()
            .to_owned()
    } else if outcome == "inconclusive" {
        "f".repeat(64)
    } else {
        "0".repeat(64)
    };
    json!({
        "contract_version": 1,
        "observation_source": "mozak lab evaluation observe",
        "project_id": project_id,
        "failure_sha256": failure_sha256,
        "observation_label": label,
        "fixed_inputs": ["project_id", "current", "browse", "why", "stale_dair_record_id"],
        "command_hashes": command_hashes,
        "expected_stdout_sha256": expected_stdout_sha256,
        "attributed_layer": layer,
        "dependency_justification": null,
        "outcome": outcome
    })
}

fn stale_dair_eval_fixture(t: &Temp, project_id: &str) -> (PathBuf, PathBuf, String) {
    let kb = valid_kb(&t.0);
    let ws = t.0.join("workspace");
    project(&ws.join("eval"), project_id);
    let xdg = t.0.join("xdg");
    register_initial(&kb, &ws, &xdg, &t.0);
    let runs = t.0.join("runs");
    fs::create_dir_all(&runs).unwrap();
    write_research_run_with_id(
        &runs.join("old.json"),
        "run-yesterday-eval",
        "2026-09-05T22:17:35Z",
    );
    write_research_run_with_id(
        &runs.join("new.json"),
        "run-today-eval",
        "2026-09-06T22:17:35Z",
    );
    write_adapter_registry(&xdg, &runs);
    let browse = run(&["project", "browse", project_id], &xdg);
    assert!(
        browse.status.success(),
        "{}",
        String::from_utf8_lossy(&browse.stderr)
    );
    let browse_json: Value = serde_json::from_slice(&browse.stdout).unwrap();
    let stale_id = browse_json["records"]["proposal_only_research"]["records"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["freshness"] == "stale")
        .unwrap()["record_id"]
        .as_str()
        .unwrap()
        .to_owned();
    (xdg, t.0.clone(), stale_id)
}

fn research_record_id(xdg: &Path, project_id: &str, freshness: &str) -> String {
    let browse = run(&["project", "browse", project_id], xdg);
    assert!(
        browse.status.success(),
        "{}",
        String::from_utf8_lossy(&browse.stderr)
    );
    let browse_json: Value = serde_json::from_slice(&browse.stdout).unwrap();
    browse_json["records"]["proposal_only_research"]["records"]
        .as_array()
        .unwrap()
        .iter()
        .find(|record| record["freshness"] == freshness)
        .unwrap()["record_id"]
        .as_str()
        .unwrap()
        .to_owned()
}

fn rewrite_adapter_name(xdg: &Path, adapter: &str) {
    let path = xdg.join("mozak/adapters.json");
    let mut value: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    value["bindings"][0]["adapter"] = json!(adapter);
    fs::write(path, serde_json::to_vec(&value).unwrap()).unwrap();
}

#[test]
#[allow(clippy::too_many_lines)]
fn lab_evaluation_reproduces_stale_dair_and_keeps_review_non_authoritative() {
    let t = Temp::new("lab-eval-pass");
    let (xdg, base, stale_id) = stale_dair_eval_fixture(&t, "eval-pass");
    let problem = base.join("problem.json");
    fs::write(&problem, serde_json::to_vec(&json!({"contract_version":1,"problem_class":"tool_behavior","observed_problem":"stale DAIR run looked current","stale_dair_record_id":stale_id,"expected_behavior":"why explains the stale run is superseded"})).unwrap()).unwrap();
    let failure = base.join("failure.json");
    let out = run(
        &[
            "lab",
            "evaluation",
            "failure",
            "eval-pass",
            problem.to_str().unwrap(),
            failure.to_str().unwrap(),
        ],
        &xdg,
    );
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let failure_json: Value = serde_json::from_slice(&fs::read(&failure).unwrap()).unwrap();
    let command_hashes = failure_json["reproduction"].clone();
    assert_eq!(failure_json["implementation_authorized"], false);
    assert_eq!(failure_json["reproduction"].as_array().unwrap().len(), 3);

    let before = base.join("before.json");
    let after = base.join("after.json");
    let out = run(
        &[
            "lab",
            "evaluation",
            "observe",
            failure.to_str().unwrap(),
            "before",
            "tool_behavior",
            "0".repeat(64).as_str(),
            before.to_str().unwrap(),
        ],
        &xdg,
    );
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let expected_after = command_hashes[0]["stdout_sha256"].as_str().unwrap();
    let out = run(
        &[
            "lab",
            "evaluation",
            "observe",
            failure.to_str().unwrap(),
            "after",
            "tool_behavior",
            expected_after,
            after.to_str().unwrap(),
        ],
        &xdg,
    );
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let comparison = base.join("comparison.json");
    let out = run(
        &[
            "lab",
            "evaluation",
            "compare",
            failure.to_str().unwrap(),
            before.to_str().unwrap(),
            after.to_str().unwrap(),
            comparison.to_str().unwrap(),
        ],
        &xdg,
    );
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let comparison_json: Value = serde_json::from_slice(&fs::read(&comparison).unwrap()).unwrap();
    assert_eq!(comparison_json["result"], "pass");
    assert_eq!(comparison_json["implementation_authorized"], false);
    assert_eq!(comparison_json["owner_approval_required"], true);
    let review = base.join("review.json");
    let out = run(
        &[
            "lab",
            "evaluation",
            "review",
            comparison.to_str().unwrap(),
            failure.to_str().unwrap(),
            before.to_str().unwrap(),
            after.to_str().unwrap(),
            review.to_str().unwrap(),
        ],
        &xdg,
    );
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let review_json: Value = serde_json::from_slice(&fs::read(&review).unwrap()).unwrap();
    assert_eq!(review_json["proposal_only"], true);
    assert_eq!(review_json["promotion_authorized"], false);

    let forged = base.join("forged-comparison.json");
    fs::write(
        &forged,
        serde_json::to_vec(&json!({
            "contract_version":1,
            "comparison_source":"mozak lab evaluation compare",
            "failure_sha256":"0".repeat(64),
            "before_sha256":"0".repeat(64),
            "after_sha256":"0".repeat(64),
            "result":"pass",
            "attributed_layer":"tool_behavior",
            "implementation_authorized":false,
            "promotion_authorized":false,
            "owner_approval_required":true,
            "reason":"forged caller-authored pass"
        }))
        .unwrap(),
    )
    .unwrap();
    let out = run(
        &[
            "lab",
            "evaluation",
            "review",
            forged.to_str().unwrap(),
            failure.to_str().unwrap(),
            before.to_str().unwrap(),
            after.to_str().unwrap(),
            base.join("forged-review.json").to_str().unwrap(),
        ],
        &xdg,
    );
    assert!(!out.status.success());
}

#[test]
#[allow(clippy::too_many_lines)]
fn lab_evaluation_fail_inconclusive_tamper_and_multiple_layer_refusals() {
    let t = Temp::new("lab-eval-refusals");
    let (xdg, base, stale_id) = stale_dair_eval_fixture(&t, "eval-refuse");
    let problem = base.join("problem.json");
    fs::write(&problem, serde_json::to_vec(&json!({"contract_version":1,"problem_class":"schema","observed_problem":"stale DAIR schema was ambiguous","stale_dair_record_id":stale_id,"expected_behavior":"comparison remains attributed"})).unwrap()).unwrap();
    let failure = base.join("failure.json");
    assert!(
        run(
            &[
                "lab",
                "evaluation",
                "failure",
                "eval-refuse",
                problem.to_str().unwrap(),
                failure.to_str().unwrap()
            ],
            &xdg
        )
        .status
        .success()
    );
    let failure_sha256 = sha(&fs::read(&failure).unwrap());
    let failure_json: Value = serde_json::from_slice(&fs::read(&failure).unwrap()).unwrap();
    let command_hashes = failure_json["reproduction"].clone();
    let before = base.join("before.json");
    let after_fail = base.join("after-fail.json");
    let after_inconclusive = base.join("after-inconclusive.json");
    fs::write(
        &before,
        serde_json::to_vec(&eval_observation(
            "eval-refuse",
            &failure_sha256,
            &command_hashes,
            "before",
            "schema",
            "fail",
        ))
        .unwrap(),
    )
    .unwrap();
    fs::write(
        &after_fail,
        serde_json::to_vec(&eval_observation(
            "eval-refuse",
            &failure_sha256,
            &command_hashes,
            "after",
            "schema",
            "fail",
        ))
        .unwrap(),
    )
    .unwrap();
    fs::write(
        &after_inconclusive,
        serde_json::to_vec(&eval_observation(
            "eval-refuse",
            &failure_sha256,
            &command_hashes,
            "after",
            "schema",
            "inconclusive",
        ))
        .unwrap(),
    )
    .unwrap();
    for (after, name, expected) in [
        (&after_fail, "cmp-fail.json", "fail"),
        (&after_inconclusive, "cmp-inc.json", "inconclusive"),
    ] {
        let cmp = base.join(name);
        let out = run(
            &[
                "lab",
                "evaluation",
                "compare",
                failure.to_str().unwrap(),
                before.to_str().unwrap(),
                after.to_str().unwrap(),
                cmp.to_str().unwrap(),
            ],
            &xdg,
        );
        assert!(
            out.status.success(),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
        let cmp_json: Value = serde_json::from_slice(&fs::read(cmp).unwrap()).unwrap();
        assert_eq!(cmp_json["result"], expected);
        assert_eq!(cmp_json["implementation_authorized"], false);
        assert_eq!(cmp_json["promotion_authorized"], false);
    }
    let mut tampered: Value = serde_json::from_slice(&fs::read(&failure).unwrap()).unwrap();
    tampered["implementation_authorized"] = json!(true);
    let tampered_path = base.join("tampered.json");
    fs::write(&tampered_path, serde_json::to_vec(&tampered).unwrap()).unwrap();
    let out = run(
        &[
            "lab",
            "evaluation",
            "compare",
            tampered_path.to_str().unwrap(),
            before.to_str().unwrap(),
            after_fail.to_str().unwrap(),
            base.join("tampered-cmp.json").to_str().unwrap(),
        ],
        &xdg,
    );
    assert!(!out.status.success());
    let mut fabricated: Value = serde_json::from_slice(&fs::read(&after_fail).unwrap()).unwrap();
    fabricated["outcome"] = json!("pass");
    let fabricated_path = base.join("fabricated-outcome.json");
    fs::write(&fabricated_path, serde_json::to_vec(&fabricated).unwrap()).unwrap();
    let out = run(
        &[
            "lab",
            "evaluation",
            "compare",
            failure.to_str().unwrap(),
            before.to_str().unwrap(),
            fabricated_path.to_str().unwrap(),
            base.join("fabricated-cmp.json").to_str().unwrap(),
        ],
        &xdg,
    );
    assert!(!out.status.success());
    let drifted = eval_observation(
        "eval-refuse",
        "0".repeat(64).as_str(),
        &command_hashes,
        "after",
        "schema",
        "pass",
    );
    let drifted_path = base.join("drifted.json");
    fs::write(&drifted_path, serde_json::to_vec(&drifted).unwrap()).unwrap();
    let out = run(
        &[
            "lab",
            "evaluation",
            "compare",
            failure.to_str().unwrap(),
            before.to_str().unwrap(),
            drifted_path.to_str().unwrap(),
            base.join("drifted-cmp.json").to_str().unwrap(),
        ],
        &xdg,
    );
    assert!(!out.status.success());
    let mut multi = eval_observation(
        "eval-refuse",
        &failure_sha256,
        &command_hashes,
        "after",
        "content",
        "pass",
    );
    multi["dependency_justification"] = json!("");
    let multi_path = base.join("multi.json");
    fs::write(&multi_path, serde_json::to_vec(&multi).unwrap()).unwrap();
    let out = run(
        &[
            "lab",
            "evaluation",
            "compare",
            failure.to_str().unwrap(),
            before.to_str().unwrap(),
            multi_path.to_str().unwrap(),
            base.join("multi-cmp.json").to_str().unwrap(),
        ],
        &xdg,
    );
    assert!(!out.status.success());
}

#[test]
fn lab_evaluation_failure_refuses_current_or_non_dair_records() {
    let t = Temp::new("lab-eval-stale-adversarial");
    let (xdg, base, stale_id) = stale_dair_eval_fixture(&t, "eval-adversarial");
    let current_id = research_record_id(&xdg, "eval-adversarial", "current");
    let current_problem = base.join("current-problem.json");
    fs::write(&current_problem, serde_json::to_vec(&json!({"contract_version":1,"problem_class":"tool_behavior","observed_problem":"current record must not be accepted as stale DAIR","stale_dair_record_id":current_id,"expected_behavior":"failure recording refuses non-stale record"})).unwrap()).unwrap();
    let out = run(
        &[
            "lab",
            "evaluation",
            "failure",
            "eval-adversarial",
            current_problem.to_str().unwrap(),
            base.join("current-failure.json").to_str().unwrap(),
        ],
        &xdg,
    );
    assert!(!out.status.success());

    rewrite_adapter_name(&xdg, "arxiv");
    let non_dair_problem = base.join("non-dair-problem.json");
    fs::write(&non_dair_problem, serde_json::to_vec(&json!({"contract_version":1,"problem_class":"tool_behavior","observed_problem":"non-DAIR record must not be accepted as stale DAIR","stale_dair_record_id":stale_id,"expected_behavior":"failure recording refuses non-DAIR binding"})).unwrap()).unwrap();
    let out = run(
        &[
            "lab",
            "evaluation",
            "failure",
            "eval-adversarial",
            non_dair_problem.to_str().unwrap(),
            base.join("non-dair-failure.json").to_str().unwrap(),
        ],
        &xdg,
    );
    assert!(!out.status.success());
}

#[test]
fn lab_evaluation_outputs_refuse_symlink_ancestors() {
    let t = Temp::new("lab-eval-symlink-output");
    let (xdg, base, stale_id) = stale_dair_eval_fixture(&t, "eval-symlink-output");
    let problem = base.join("problem.json");
    fs::write(&problem, serde_json::to_vec(&json!({"contract_version":1,"problem_class":"tool_behavior","observed_problem":"symlink ancestor output should fail closed","stale_dair_record_id":stale_id,"expected_behavior":"output path is rejected before writing"})).unwrap()).unwrap();
    let real = base.join("real-output-dir");
    fs::create_dir_all(&real).unwrap();
    let link = base.join("linked-output-dir");
    std::os::unix::fs::symlink(&real, &link).unwrap();
    let output = link.join("failure.json");
    let out = run(
        &[
            "lab",
            "evaluation",
            "failure",
            "eval-symlink-output",
            problem.to_str().unwrap(),
            output.to_str().unwrap(),
        ],
        &xdg,
    );
    assert!(!out.status.success());
    assert!(!output.exists());
}

#[test]
#[allow(clippy::too_many_lines)]
fn project_resolve_uses_full_projection_for_real_dair_composite_record() {
    let t = Temp::new("resolve-full-dair");
    let kb = valid_kb(&t.0);
    let ws = t.0.join("workspace");
    project(&ws.join("nav"), "nav-current");
    let xdg = t.0.join("xdg");
    register_initial(&kb, &ws, &xdg, &t.0);
    let runs = t.0.join("runs");
    fs::create_dir_all(&runs).unwrap();
    write_research_run_with_id(
        &runs.join("stale.json"),
        "run-stale-0588c54f53c95447f66923ff",
        "2026-09-05T22:17:35Z",
    );
    write_research_run_with_id(
        &runs.join("current.json"),
        "run-0588c54f53c95447f66923ff",
        "2026-09-06T22:17:35Z",
    );
    write_adapter_registry_for_scope(&xdg, &runs, "topic");

    let browse = run(&["project", "browse", "nav-current"], &xdg);
    assert!(
        browse.status.success(),
        "{}",
        String::from_utf8_lossy(&browse.stderr)
    );
    let browse_json: Value = serde_json::from_slice(&browse.stdout).unwrap();
    let records = browse_json["records"]["proposal_only_research"]["records"]
        .as_array()
        .unwrap();
    let current = records
        .iter()
        .find(|r| r["run_id"] == "run-0588c54f53c95447f66923ff")
        .unwrap();
    let stale = records.iter().find(|r| r["freshness"] == "stale").unwrap();

    let resolved = run(
        &[
            "project",
            "resolve",
            "nav-current",
            current["record_id"].as_str().unwrap(),
        ],
        &xdg,
    );
    assert!(
        resolved.status.success(),
        "{}",
        String::from_utf8_lossy(&resolved.stderr)
    );
    let resolved_json: Value = serde_json::from_slice(&resolved.stdout).unwrap();
    assert_eq!(
        resolved_json["record"]["research"]["authority"],
        "proposal_only"
    );
    assert_eq!(
        resolved_json["record"]["source"]["id"],
        current["projection_source_id"]
    );
    assert_eq!(
        resolved_json["record"]["node"]["id"],
        "research:run-0588c54f53c95447f66923ff"
    );
    assert!(
        resolved_json["declared_relationships"]["records"]
            .as_array()
            .unwrap()
            .iter()
            .any(|edge| edge["relation"] == "observes"
                && edge["from"] == "research:run-0588c54f53c95447f66923ff"
                && edge["to"] == "scope:topic")
    );

    let stale_resolve = run(
        &[
            "project",
            "resolve",
            "nav-current",
            stale["record_id"].as_str().unwrap(),
        ],
        &xdg,
    );
    assert!(!stale_resolve.status.success());
    assert!(String::from_utf8_lossy(&stale_resolve.stderr).contains("stale hash/freshness"));

    let why_stale = run(
        &[
            "project",
            "why",
            "nav-current",
            stale["record_id"].as_str().unwrap(),
        ],
        &xdg,
    );
    assert!(why_stale.status.success());
    let why_json: Value = serde_json::from_slice(&why_stale.stdout).unwrap();
    assert_eq!(why_json["freshness"], "stale");
    assert!(
        why_json["supersession_explanation"]
            .as_str()
            .unwrap()
            .contains("supersedes")
    );

    let forged = run(
        &["project", "resolve", "nav-current", "research-run:forged"],
        &xdg,
    );
    assert!(!forged.status.success());
    assert!(String::from_utf8_lossy(&forged.stderr).contains("not declared"));
}

#[test]
fn registrations_lists_exact_configured_ids_even_when_the_live_kb_drifted() {
    let t = Temp::new("registrations-during-kb-drift");
    let kb = valid_kb(&t.0);
    let ws = t.0.join("workspace");
    project(&ws.join("genome"), "genome-mcp");
    let xdg = t.0.join("xdg");
    register_initial(&kb, &ws, &xdg, &t.0);

    fs::write(kb.join("kb.json"), b"live KB changed after registration").unwrap();
    let out = run(&["project", "registrations"], &xdg);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let report: Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(report["command"], "project registrations");
    assert_eq!(report["live_kb_consulted"], false);
    assert_eq!(report["mutation"], false);
    assert_eq!(report["projects"][0]["id"], "genome-mcp");
    assert_eq!(report["projects"][0]["name"], "Test Project");
    assert_eq!(
        report["projects"][0]["root"],
        ws.join("genome").to_string_lossy().as_ref()
    );
}

#[test]
#[allow(clippy::too_many_lines)]
fn review_reports_exact_register_and_refresh_deltas_without_mutation() {
    let t = Temp::new("review-deltas");
    let kb = valid_kb(&t.0);
    let ws = t.0.join("workspace");
    project(&ws.join("keep"), "keep");
    project(&ws.join("change"), "change");
    project(&ws.join("remove"), "remove");
    let xdg = t.0.join("xdg");

    let initial = discover(&kb, &ws, &xdg);
    let target = PathBuf::from(initial["target_config_path"].as_str().unwrap());
    let before = review(&initial, &t.0, &xdg);
    assert!(
        before.status.success(),
        "{}",
        String::from_utf8_lossy(&before.stderr)
    );
    let register: Value = serde_json::from_slice(&before.stdout).unwrap();
    assert_eq!(register["action"], "register");
    assert_eq!(register["additions"], json!(["change", "keep", "remove"]));
    assert_eq!(register["removals"], json!([]));
    assert_eq!(register["changed_pins"], json!([]));
    assert_eq!(register["unchanged"], json!([]));
    assert_eq!(register["project_count"], 3);
    assert_eq!(register["proposal_digest"], initial["proposal_digest"]);
    assert_eq!(register["kb_root"], initial["kb_root"]);
    assert_eq!(register["kb_sha256"], initial["kb_sha256"]);
    assert_eq!(register["kb_changed"], false);
    assert_eq!(register["auto_discovery"], false);
    assert_eq!(register["trust_transfer"], false);
    assert_eq!(register["mutation"], false);
    assert!(!target.exists());

    register_initial(&kb, &ws, &xdg, &t.0);
    let config_before = fs::read(&target).unwrap();
    let current = discover(&kb, &ws, &xdg);
    let no_change = review(&current, &t.0, &xdg);
    assert!(no_change.status.success());
    let no_change: Value = serde_json::from_slice(&no_change.stdout).unwrap();
    assert_eq!(no_change["action"], "none");
    assert_eq!(no_change["additions"], json!([]));
    assert_eq!(no_change["removals"], json!([]));
    assert_eq!(no_change["changed_pins"], json!([]));
    assert_eq!(no_change["unchanged"], json!(["change", "keep", "remove"]));
    assert_eq!(no_change["kb_changed"], false);
    assert_eq!(fs::read(&target).unwrap(), config_before);

    let no_change_path = t.0.join("no-change-proposal.json");
    let no_change_approval = t.0.join("no-change-approval.json");
    fs::write(&no_change_path, serde_json::to_vec(&current).unwrap()).unwrap();
    approve_refresh(&current, &no_change_approval, "owner-a");
    let rejected = run(
        &[
            "project",
            "refresh",
            no_change_path.to_str().unwrap(),
            no_change_approval.to_str().unwrap(),
        ],
        &xdg,
    );
    assert!(!rejected.status.success());
    assert!(rejected.stdout.is_empty());
    assert!(String::from_utf8_lossy(&rejected.stderr).contains("no registry changes"));
    assert_eq!(fs::read(&target).unwrap(), config_before);

    fs::remove_dir_all(ws.join("remove")).unwrap();
    fs::write(ws.join("change/.mozak/idea.md"), "# Changed Idea\n\n## Intent\n\nChanged.\n\n## Desired outcomes\n\n- Works.\n\n## Boundaries\n\n- Local only.\n\n## Assumptions\n\n- Rust.\n\n## Open questions\n\n- None.\n").unwrap();
    project(&ws.join("add"), "add");
    let refreshed = discover(&kb, &ws, &xdg);
    let after = review(&refreshed, &t.0, &xdg);
    assert!(
        after.status.success(),
        "{}",
        String::from_utf8_lossy(&after.stderr)
    );
    let refresh: Value = serde_json::from_slice(&after.stdout).unwrap();
    assert_eq!(refresh["action"], "refresh");
    assert_eq!(refresh["additions"], json!(["add"]));
    assert_eq!(refresh["removals"], json!(["remove"]));
    assert_eq!(refresh["changed_pins"], json!(["change"]));
    assert_eq!(refresh["unchanged"], json!(["keep"]));
    assert_eq!(
        refresh["config_base_sha256"],
        refreshed["config_base_sha256"]
    );
    assert_eq!(fs::read(&target).unwrap(), config_before);

    let proposal_path = t.0.join("refresh-proposal.json");
    let approval_path = t.0.join("refresh-approval.json");
    fs::write(&proposal_path, serde_json::to_vec(&refreshed).unwrap()).unwrap();
    approve_refresh(&refreshed, &approval_path, "different-refresh-owner");
    let applied = run(
        &[
            "project",
            "refresh",
            proposal_path.to_str().unwrap(),
            approval_path.to_str().unwrap(),
        ],
        &xdg,
    );
    assert!(
        applied.status.success(),
        "{}",
        String::from_utf8_lossy(&applied.stderr)
    );
    let context = run(&["project", "context", "keep", "--json"], &xdg);
    assert!(context.status.success());
    let context: Value = serde_json::from_slice(&context.stdout).unwrap();
    assert_eq!(context["configured_owner"], "test-owner");
}

#[test]
fn review_fails_closed_with_zero_stdout_for_malformed_stale_and_drifted_inputs() {
    let t = Temp::new("review-failures");
    let kb = valid_kb(&t.0);
    let ws = t.0.join("workspace");
    let root = ws.join("project");
    project(&root, "reviewed");
    let xdg = t.0.join("xdg");
    let proposal = discover(&kb, &ws, &xdg);

    let mut malformed = proposal.clone();
    malformed["unknown"] = json!(true);
    let out = review(&malformed, &t.0, &xdg);
    assert!(!out.status.success());
    assert!(out.stdout.is_empty());

    register_initial(&kb, &ws, &xdg, &t.0);
    let stale = review(&proposal, &t.0, &xdg);
    assert!(!stale.status.success());
    assert!(stale.stdout.is_empty());

    let current = discover(&kb, &ws, &xdg);
    fs::write(root.join(".mozak/idea.md"), "drift").unwrap();
    let drifted = review(&current, &t.0, &xdg);
    assert!(!drifted.status.success());
    assert!(drifted.stdout.is_empty());
}

#[test]
fn discover_register_context_happy_path_is_bounded_and_reports_no_ready_goal() {
    let t = Temp::new("happy");
    let kb = valid_kb(&t.0);
    let ws = t.0.join("workspace");
    let p = ws.join("nested/project");
    project(&p, "exact-project");
    project(&ws.join("node_modules/ignored"), "ignored-project");
    let xdg = t.0.join("xdg");
    let proposal = discover(&kb, &ws, &xdg);
    assert_eq!(proposal["projects"].as_array().unwrap().len(), 1);
    assert_eq!(proposal["projects"][0]["id"], "exact-project");
    assert_eq!(proposal["config_base_sha256"], Value::Null);
    let proposal_path = t.0.join("proposal.json");
    fs::write(&proposal_path, serde_json::to_vec(&proposal).unwrap()).unwrap();
    let approval = t.0.join("approval.json");
    approve(&proposal, &approval);
    let registered = run(
        &[
            "project",
            "register",
            proposal_path.to_str().unwrap(),
            approval.to_str().unwrap(),
        ],
        &xdg,
    );
    assert!(
        registered.status.success(),
        "{}",
        String::from_utf8_lossy(&registered.stderr)
    );
    let context = run(&["project", "context", "exact-project"], &xdg);
    assert!(
        context.status.success(),
        "{}",
        String::from_utf8_lossy(&context.stderr)
    );
    let c: Value = serde_json::from_slice(&context.stdout).unwrap();
    assert_eq!(c["configured_owner"], "test-owner");
    assert_eq!(c["idea"]["title"], "Test Idea");
    assert_eq!(c["workflow"]["ready_goals"], json!([]));
    assert_eq!(c["trust_transfer"], false);
    let explicit_json = run(&["project", "context", "exact-project", "--json"], &xdg);
    assert!(explicit_json.status.success());
    let cj: Value = serde_json::from_slice(&explicit_json.stdout).unwrap();
    assert_eq!(cj, c);
    let human = run(&["project", "context", "exact-project", "--human"], &xdg);
    assert!(human.status.success());
    let human_text = String::from_utf8(human.stdout).unwrap();
    assert!(human_text.contains("MOZAK project context"), "{human_text}");
    assert!(
        human_text.contains("configured owner: test-owner"),
        "{human_text}"
    );
    let wrong = run(&["project", "context", "exact"], &xdg);
    assert!(!wrong.status.success());
}

#[test]
fn project_context_reports_linked_scopes_for_shared_meta_goal_and_promotion() {
    let t = Temp::new("context-linked-scopes");
    let kb = linked_scope_kb(&t.0);
    let ws = t.0.join("workspace");
    project(&ws.join("project"), "exact-project");
    let xdg = t.0.join("xdg");
    register_initial(&kb, &ws, &xdg, &t.0);

    let out = run(&["project", "context", "exact-project"], &xdg);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let c: Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(
        c["knowledge"]["scope_matches"][0]["scope_id"],
        "exact-project"
    );
    assert_eq!(c["knowledge"]["package_matches"], json!([]));
    let links = c["knowledge"]["linked_scopes"].as_array().unwrap();
    assert_eq!(
        links.len(),
        3,
        "{}",
        serde_json::to_string_pretty(links).unwrap()
    );
    assert!(links.iter().any(|link| link["scope_id"] == "shared-topic"
        && link["relationship"] == "shared_meta_goal"
        && link["via"] == json!({"type":"meta_goal","id":"goal-1"})));
    assert!(links.iter().any(|link| link["scope_id"] == "promoted-topic"
        && link["relationship"] == "promotion_source"
        && link["via"] == json!({"type":"promotion","id":"promotion-1"})));
    assert!(links.iter().any(|link| link["scope_id"] == "related-topic"
        && link["relationship"] == "meta_goal_supports"
        && link["via"] == json!({"type":"meta_goal_relationship","id":"goal-1->goal-2"})));
    for link in links {
        assert_eq!(link["registration_id"], "linked");
        assert_eq!(link["kind"], "topic");
        assert_eq!(link["authority"], "advisory_only");
        assert_eq!(link["accepted"], false);
        assert_eq!(link["trust_transfer"], false);
        assert!(link["title"].as_str().is_some());
        assert_eq!(link["root"], t.0.join("scope-linked").to_str().unwrap());
    }
}

#[test]
fn project_context_reports_empty_linked_scopes_when_kb_has_no_links() {
    let t = Temp::new("context-empty-links");
    let kb = valid_kb(&t.0);
    let ws = t.0.join("workspace");
    project(&ws.join("project"), "exact-project");
    let xdg = t.0.join("xdg");
    register_initial(&kb, &ws, &xdg, &t.0);

    let out = run(&["project", "context", "exact-project"], &xdg);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let c: Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(c["knowledge"]["linked_scopes"], json!([]));
}

#[test]
fn project_context_fails_closed_for_drifted_configured_kb_links() {
    let t = Temp::new("context-drifted-kb-links");
    let kb = linked_scope_kb(&t.0);
    let ws = t.0.join("workspace");
    project(&ws.join("project"), "exact-project");
    let xdg = t.0.join("xdg");
    register_initial(&kb, &ws, &xdg, &t.0);
    fs::write(
        kb.join("kb.json"),
        b"{\"schema_version\":1,\"registrations\":[]}",
    )
    .unwrap();

    let out = run(&["project", "context", "exact-project"], &xdg);
    assert_eq!(
        out.status.code(),
        Some(3),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let c: Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(c["kb"]["drift"], true);
    assert_eq!(c["knowledge"]["linked_scopes"], json!([]));
}

#[test]
fn discovery_rejects_duplicates_invalid_projects_and_symlink_roots() {
    let t = Temp::new("bad");
    let kb = valid_kb(&t.0);
    let ws = t.0.join("ws");
    project(&ws.join("a"), "duplicate");
    project(&ws.join("b"), "duplicate");
    let xdg = t.0.join("xdg");
    let dup = run(
        &[
            "project",
            "discover",
            kb.to_str().unwrap(),
            ws.to_str().unwrap(),
        ],
        &xdg,
    );
    assert!(!dup.status.success());
    fs::remove_dir_all(ws.join("b")).unwrap();
    fs::write(ws.join("a/.mozak/idea.md"), "invalid").unwrap();
    let invalid = run(
        &[
            "project",
            "discover",
            kb.to_str().unwrap(),
            ws.to_str().unwrap(),
        ],
        &xdg,
    );
    assert!(!invalid.status.success());
    #[cfg(unix)]
    {
        use std::os::unix::fs::symlink;
        let link = t.0.join("link");
        symlink(&ws, &link).unwrap();
        let out = run(
            &[
                "project",
                "discover",
                kb.to_str().unwrap(),
                link.to_str().unwrap(),
            ],
            &xdg,
        );
        assert!(!out.status.success());

        let real_parent = t.0.join("real-parent");
        let nested = real_parent.join("nested");
        fs::create_dir_all(&nested).unwrap();
        let parent_link = t.0.join("parent-link");
        symlink(&real_parent, &parent_link).unwrap();
        let out = run(
            &[
                "project",
                "discover",
                kb.to_str().unwrap(),
                parent_link.join("nested").to_str().unwrap(),
            ],
            &xdg,
        );
        assert!(!out.status.success());
    }
}

#[test]
fn discovery_scans_duplicate_and_overlapping_roots_once() {
    let t = Temp::new("overlapping-roots");
    let kb = valid_kb(&t.0);
    let ws = t.0.join("ws");
    let nested = ws.join("nested/project");
    project(&nested, "only-once");
    let xdg = t.0.join("xdg");

    let out = run(
        &[
            "project",
            "discover",
            kb.to_str().unwrap(),
            ws.to_str().unwrap(),
            ws.to_str().unwrap(),
            nested.to_str().unwrap(),
        ],
        &xdg,
    );
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let proposal: Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(proposal["workspace_roots"], json!([ws]));
    assert_eq!(proposal["projects"].as_array().unwrap().len(), 1);
    assert_eq!(proposal["projects"][0]["id"], "only-once");
}

#[test]
fn register_rejects_bad_digest_stale_base_and_output_symlink_without_overwrite() {
    let t = Temp::new("hazards");
    let kb = valid_kb(&t.0);
    let ws = t.0.join("ws");
    project(&ws.join("p"), "safe-project");
    let xdg = t.0.join("xdg");
    let proposal = discover(&kb, &ws, &xdg);
    let pp = t.0.join("proposal.json");
    let mut bad = proposal.clone();
    bad["proposal_digest"] = json!("00");
    fs::write(&pp, serde_json::to_vec(&bad).unwrap()).unwrap();
    let approval = t.0.join("approval.json");
    approve(&bad, &approval);
    assert!(
        !run(
            &[
                "project",
                "register",
                pp.to_str().unwrap(),
                approval.to_str().unwrap()
            ],
            &xdg
        )
        .status
        .success()
    );
    fs::write(&pp, serde_json::to_vec(&proposal).unwrap()).unwrap();
    approve(&proposal, &approval);
    let mut invalid_approval: Value =
        serde_json::from_slice(&fs::read(&approval).unwrap()).unwrap();
    invalid_approval["approved_at"] = json!("2026-99-99T99:99:99Z");
    fs::write(&approval, serde_json::to_vec(&invalid_approval).unwrap()).unwrap();
    assert!(
        !run(
            &[
                "project",
                "register",
                pp.to_str().unwrap(),
                approval.to_str().unwrap()
            ],
            &xdg
        )
        .status
        .success()
    );
    approve(&proposal, &approval);
    fs::create_dir_all(xdg.join("mozak")).unwrap();
    fs::write(xdg.join("mozak/config.json"), b"owner bytes").unwrap();
    assert!(
        !run(
            &[
                "project",
                "register",
                pp.to_str().unwrap(),
                approval.to_str().unwrap()
            ],
            &xdg
        )
        .status
        .success()
    );
    assert_eq!(
        fs::read(xdg.join("mozak/config.json")).unwrap(),
        b"owner bytes"
    );
}

#[test]
fn context_reconciles_valid_idea_drift_and_still_fails_closed_for_invalid_files() {
    let t = Temp::new("drift");
    let kb = valid_kb(&t.0);
    let ws = t.0.join("ws");
    let p = ws.join("p");
    project(&p, "drift-project");
    let xdg = t.0.join("xdg");
    let proposal = discover(&kb, &ws, &xdg);
    let pp = t.0.join("proposal.json");
    fs::write(&pp, serde_json::to_vec(&proposal).unwrap()).unwrap();
    let ap = t.0.join("approval.json");
    approve(&proposal, &ap);
    assert!(
        run(
            &[
                "project",
                "register",
                pp.to_str().unwrap(),
                ap.to_str().unwrap()
            ],
            &xdg
        )
        .status
        .success()
    );
    let mut idea = fs::read_to_string(p.join(".mozak/idea.md")).unwrap();
    idea.push('\n');
    fs::write(p.join(".mozak/idea.md"), idea).unwrap();
    let out = run(&["project", "context", "drift-project"], &xdg);
    assert!(out.status.success());
    let value: Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(value["foundation"]["idea"]["drift"], false);
    assert_eq!(value["foundation"]["project_drift"], false);
    assert_eq!(value["reconciliation"]["performed"], true);

    fs::write(p.join(".mozak/idea.md"), "invalid").unwrap();
    let invalid = run(&["project", "context", "drift-project"], &xdg);
    assert_eq!(invalid.status.code(), Some(3));
    let report: Value = serde_json::from_slice(&invalid.stdout).unwrap();
    assert_eq!(report["state"], "invalid");
    assert_eq!(report["foundation"]["valid"], false);
}

#[test]
#[allow(clippy::too_many_lines)]
fn context_refresh_history_and_rollback_are_atomic_bounded_and_concurrent() {
    let t = Temp::new("context-refresh-history");
    let kb = valid_kb(&t.0);
    let ws = t.0.join("ws");
    let p = ws.join("p");
    project(&p, "context-refresh");
    let xdg = t.0.join("xdg");
    register_initial(&kb, &ws, &xdg, &t.0);

    // A first 0.3.1 context call upgrades a legacy registration in place by
    // recording its exact generation and manifest baseline without scanning.
    let baseline = run(&["project", "context", "context-refresh"], &xdg);
    assert!(
        baseline.status.success(),
        "{}",
        String::from_utf8_lossy(&baseline.stderr)
    );
    let baseline_json: Value = serde_json::from_slice(&baseline.stdout).unwrap();
    assert_eq!(baseline_json["reconciliation"]["performed"], false);
    let baseline_digest = baseline_json["config"]["sha256"]
        .as_str()
        .unwrap()
        .to_owned();

    let manifest_path = p.join(".mozak/project.yml");
    let old_manifest = fs::read_to_string(&manifest_path).unwrap();
    fs::write(
        &manifest_path,
        old_manifest.replace(
            "0123456789abcdef0123456789abcdef01234567",
            "1123456789abcdef0123456789abcdef01234567",
        ),
    )
    .unwrap();

    let children = (0..6)
        .map(|_| {
            Command::new(env!("CARGO_BIN_EXE_mozak"))
                .args(["project", "context", "context-refresh"])
                .env("XDG_CONFIG_HOME", &xdg)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .unwrap()
        })
        .collect::<Vec<_>>();
    let outputs = children
        .into_iter()
        .map(|child| child.wait_with_output().unwrap())
        .collect::<Vec<_>>();
    assert!(outputs.iter().all(|output| output.status.success()));
    assert_eq!(
        outputs
            .iter()
            .filter(|output| {
                serde_json::from_slice::<Value>(&output.stdout).unwrap()["reconciliation"]
                    ["performed"]
                    == true
            })
            .count(),
        1
    );

    let history = run(&["project", "refresh", "history"], &xdg);
    assert!(
        history.status.success(),
        "{}",
        String::from_utf8_lossy(&history.stderr)
    );
    let history_json: Value = serde_json::from_slice(&history.stdout).unwrap();
    assert_eq!(history_json["entries"].as_array().unwrap().len(), 1);
    assert_eq!(history_json["entries"][0]["actor"], "test-owner");
    assert_eq!(
        history_json["entries"][0]["old_config_sha256"],
        baseline_digest
    );
    let refreshed_digest = history_json["entries"][0]["new_config_sha256"]
        .as_str()
        .unwrap()
        .to_owned();
    let entry_digest = history_json["entries"][0]["entry_sha256"].as_str().unwrap();
    let entry_path = xdg
        .join("mozak/refresh-history/entries")
        .join(format!("{entry_digest}.json"));
    let entry_bytes = fs::read(&entry_path).unwrap();
    let mut tampered: Value = serde_json::from_slice(&entry_bytes).unwrap();
    tampered["actor"] = json!("attacker");
    fs::write(&entry_path, serde_json::to_vec(&tampered).unwrap()).unwrap();
    let rejected = run(&["project", "refresh", "history"], &xdg);
    assert!(!rejected.status.success());
    assert!(String::from_utf8_lossy(&rejected.stderr).contains("tampered"));
    fs::write(&entry_path, entry_bytes).unwrap();

    let rollback = run(&["project", "refresh", "rollback", &baseline_digest], &xdg);
    assert!(
        rollback.status.success(),
        "{}",
        String::from_utf8_lossy(&rollback.stderr)
    );
    let rollback_json: Value = serde_json::from_slice(&rollback.stdout).unwrap();
    assert_eq!(rollback_json["previous_config_sha256"], refreshed_digest);
    assert_eq!(rollback_json["config_sha256"], baseline_digest);

    let history = run(&["project", "refresh", "history"], &xdg);
    let history_json: Value = serde_json::from_slice(&history.stdout).unwrap();
    assert_eq!(history_json["entries"].as_array().unwrap().len(), 2);

    // An authority change remains drift and requires the explicit review and
    // approval path. Context must not mutate the config digest.
    fs::write(
        &manifest_path,
        old_manifest.replace("  - src", "  - crates"),
    )
    .unwrap();
    let before = fs::read(xdg.join("mozak/config.json")).unwrap();
    let authority = run(&["project", "context", "context-refresh"], &xdg);
    assert!(authority.status.success());
    let authority_json: Value = serde_json::from_slice(&authority.stdout).unwrap();
    assert_eq!(authority_json["reconciliation"]["performed"], false);
    assert_eq!(authority_json["foundation"]["project_drift"], true);
    assert_eq!(fs::read(xdg.join("mozak/config.json")).unwrap(), before);
}

#[test]
fn context_rejects_project_map_key_and_record_id_mismatch() {
    let t = Temp::new("config-key-mismatch");
    let kb = valid_kb(&t.0);
    let ws = t.0.join("ws");
    project(&ws.join("p"), "actual-project");
    let xdg = t.0.join("xdg");
    let proposal = discover(&kb, &ws, &xdg);
    let pp = t.0.join("proposal.json");
    fs::write(&pp, serde_json::to_vec(&proposal).unwrap()).unwrap();
    let ap = t.0.join("approval.json");
    approve(&proposal, &ap);
    assert!(
        run(
            &[
                "project",
                "register",
                pp.to_str().unwrap(),
                ap.to_str().unwrap()
            ],
            &xdg
        )
        .status
        .success()
    );
    let config_path = xdg.join("mozak/config.json");
    let mut config: Value = serde_json::from_slice(&fs::read(&config_path).unwrap()).unwrap();
    let record = config["projects"]
        .as_object_mut()
        .unwrap()
        .remove("actual-project")
        .unwrap();
    config["projects"]
        .as_object_mut()
        .unwrap()
        .insert("alias-project".into(), record);
    fs::write(&config_path, serde_json::to_vec(&config).unwrap()).unwrap();

    let out = run(&["project", "context", "alias-project"], &xdg);
    assert!(!out.status.success());
    assert!(out.stdout.is_empty());
    assert!(String::from_utf8_lossy(&out.stderr).contains("does not match record id"));
}

#[test]
fn registration_refuses_to_replace_an_unchanged_existing_config() {
    let t = Temp::new("create-only");
    let kb = valid_kb(&t.0);
    let ws = t.0.join("ws");
    project(&ws.join("p"), "create-only-project");
    let xdg = t.0.join("xdg");

    let first = discover(&kb, &ws, &xdg);
    let first_proposal = t.0.join("first-proposal.json");
    let first_approval = t.0.join("first-approval.json");
    fs::write(&first_proposal, serde_json::to_vec(&first).unwrap()).unwrap();
    approve(&first, &first_approval);
    assert!(
        run(
            &[
                "project",
                "register",
                first_proposal.to_str().unwrap(),
                first_approval.to_str().unwrap()
            ],
            &xdg
        )
        .status
        .success()
    );
    let config_path = xdg.join("mozak/config.json");
    let owner_bytes = fs::read(&config_path).unwrap();

    let second = discover(&kb, &ws, &xdg);
    assert!(second["config_base_sha256"].is_string());
    let second_proposal = t.0.join("second-proposal.json");
    let second_approval = t.0.join("second-approval.json");
    fs::write(&second_proposal, serde_json::to_vec(&second).unwrap()).unwrap();
    approve(&second, &second_approval);
    let out = run(
        &[
            "project",
            "register",
            second_proposal.to_str().unwrap(),
            second_approval.to_str().unwrap(),
        ],
        &xdg,
    );
    assert!(!out.status.success());
    assert!(String::from_utf8_lossy(&out.stderr).contains("create-only"));
    assert_eq!(fs::read(config_path).unwrap(), owner_bytes);
}

#[test]
fn refresh_applies_only_reviewed_additions_removals_and_changed_pins() {
    let t = Temp::new("refresh-happy");
    let kb = valid_kb(&t.0);
    let ws = t.0.join("ws");
    let first = ws.join("first");
    project(&first, "first-project");
    let removed = ws.join("removed");
    project(&removed, "removed-project");
    let xdg = t.0.join("xdg");
    register_initial(&kb, &ws, &xdg, &t.0);

    fs::remove_dir_all(&removed).unwrap();
    fs::write(first.join(".mozak/idea.md"), "# Test Idea\n\n## Intent\n\nChanged pin.\n\n## Desired outcomes\n\n- Works.\n\n## Boundaries\n\n- Local only.\n\n## Assumptions\n\n- Rust.\n\n## Open questions\n\n- None.\n").unwrap();
    project(&ws.join("added"), "added-project");
    let proposal = discover(&kb, &ws, &xdg);
    let pp = t.0.join("refresh-proposal.json");
    let ap = t.0.join("refresh-approval.json");
    fs::write(&pp, serde_json::to_vec(&proposal).unwrap()).unwrap();
    approve_refresh(&proposal, &ap, "owner-a");
    let out = run(
        &[
            "project",
            "refresh",
            pp.to_str().unwrap(),
            ap.to_str().unwrap(),
        ],
        &xdg,
    );
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let receipt: Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(receipt["additions"], 1);
    assert_eq!(receipt["removals"], 1);
    assert_eq!(receipt["changed_pins"], 1);
    assert_eq!(receipt["trust_transfer"], false);
    assert_eq!(receipt["auto_discovery"], false);
    let config: Value =
        serde_json::from_slice(&fs::read(xdg.join("mozak/config.json")).unwrap()).unwrap();
    assert!(config["projects"].get("added-project").is_some());
    assert!(config["projects"].get("removed-project").is_none());
}

#[test]
fn refresh_fails_closed_for_missing_intent_stale_base_and_live_drift() {
    let t = Temp::new("refresh-failures");
    let kb = valid_kb(&t.0);
    let ws = t.0.join("ws");
    let p = ws.join("p");
    project(&p, "safe-project");
    let xdg = t.0.join("xdg");
    register_initial(&kb, &ws, &xdg, &t.0);
    let proposal = discover(&kb, &ws, &xdg);
    let pp = t.0.join("proposal.json");
    let ap = t.0.join("approval.json");
    fs::write(&pp, serde_json::to_vec(&proposal).unwrap()).unwrap();
    approve_refresh(&proposal, &ap, "owner-a");
    let original = fs::read(xdg.join("mozak/config.json")).unwrap();
    let mut approval: Value = serde_json::from_slice(&fs::read(&ap).unwrap()).unwrap();
    approval.as_object_mut().unwrap().remove("intent");
    fs::write(&ap, serde_json::to_vec(&approval).unwrap()).unwrap();
    assert!(
        !run(
            &[
                "project",
                "refresh",
                pp.to_str().unwrap(),
                ap.to_str().unwrap()
            ],
            &xdg
        )
        .status
        .success()
    );
    assert_eq!(fs::read(xdg.join("mozak/config.json")).unwrap(), original);
    approve_refresh(&proposal, &ap, "owner-a");
    fs::write(p.join(".mozak/idea.md"), "invalid").unwrap();
    assert!(
        !run(
            &[
                "project",
                "refresh",
                pp.to_str().unwrap(),
                ap.to_str().unwrap()
            ],
            &xdg
        )
        .status
        .success()
    );
    assert_eq!(fs::read(xdg.join("mozak/config.json")).unwrap(), original);
    fs::write(xdg.join("mozak/config.json"), b"owner replacement").unwrap();
    assert!(
        !run(
            &[
                "project",
                "refresh",
                pp.to_str().unwrap(),
                ap.to_str().unwrap()
            ],
            &xdg
        )
        .status
        .success()
    );
    assert_eq!(
        fs::read(xdg.join("mozak/config.json")).unwrap(),
        b"owner replacement"
    );
}

#[test]
fn refresh_rejects_semantically_malformed_existing_config_without_output_or_overwrite() {
    let t = Temp::new("refresh-malformed-existing");
    let kb = valid_kb(&t.0);
    let ws = t.0.join("ws");
    project(&ws.join("p"), "safe-project");
    let xdg = t.0.join("xdg");
    register_initial(&kb, &ws, &xdg, &t.0);
    let config_path = xdg.join("mozak/config.json");
    let valid: Value = serde_json::from_slice(&fs::read(&config_path).unwrap()).unwrap();

    for case in [
        "blank-owner",
        "invalid-project-id",
        "bad-kb-pin",
        "relative-kb-path",
        "traversing-root",
        "wrong-manifest-relationship",
        "bad-manifest-pin",
        "bad-idea-pin",
        "bad-revision",
        "bad-observed-head",
        "bad-approval-digest",
        "bad-approval-time",
        "blank-rationale",
    ] {
        let mut malformed = valid.clone();
        match case {
            "blank-owner" => malformed["approval"]["owner"] = json!(""),
            "invalid-project-id" => {
                let mut record = malformed["projects"]
                    .as_object_mut()
                    .unwrap()
                    .remove("safe-project")
                    .unwrap();
                record["id"] = json!("INVALID_ID");
                malformed["projects"]
                    .as_object_mut()
                    .unwrap()
                    .insert("INVALID_ID".into(), record);
            }
            "bad-kb-pin" => malformed["kb_sha256"] = json!("A".repeat(64)),
            "relative-kb-path" => malformed["kb_root"] = json!("relative/kb"),
            "traversing-root" => {
                malformed["projects"]["safe-project"]["root"] = json!("/safe/../escape");
            }
            "wrong-manifest-relationship" => {
                malformed["projects"]["safe-project"]["manifest_path"] =
                    json!(ws.join("p/.mozak/other.yml"));
            }
            "bad-manifest-pin" => {
                malformed["projects"]["safe-project"]["manifest_sha256"] = json!("0".repeat(63));
            }
            "bad-idea-pin" => {
                malformed["projects"]["safe-project"]["idea_sha256"] = json!("g".repeat(64));
            }
            "bad-revision" => {
                malformed["projects"]["safe-project"]["manifest_revision"] = json!("F".repeat(40));
            }
            "bad-observed-head" => {
                malformed["projects"]["safe-project"]["observed_git_head"] = json!("0".repeat(39));
            }
            "bad-approval-digest" => {
                malformed["approval"]["proposal_digest"] = json!("not-a-sha256");
            }
            "bad-approval-time" => {
                malformed["approval"]["approved_at"] = json!("2026-02-30T00:00:00Z");
            }
            "blank-rationale" => malformed["approval"]["rationale"] = json!("  "),
            _ => unreachable!(),
        }
        let malformed_bytes = serde_json::to_vec_pretty(&malformed).unwrap();
        fs::write(&config_path, &malformed_bytes).unwrap();

        let proposal = discover(&kb, &ws, &xdg);
        let pp = t.0.join(format!("{case}-proposal.json"));
        let ap = t.0.join(format!("{case}-approval.json"));
        fs::write(&pp, serde_json::to_vec(&proposal).unwrap()).unwrap();
        approve_refresh(&proposal, &ap, "owner-a");
        let out = run(
            &[
                "project",
                "refresh",
                pp.to_str().unwrap(),
                ap.to_str().unwrap(),
            ],
            &xdg,
        );

        assert!(!out.status.success(), "case {case} unexpectedly succeeded");
        assert!(out.stdout.is_empty(), "case {case} wrote stdout");
        assert_eq!(
            fs::read(&config_path).unwrap(),
            malformed_bytes,
            "case {case} changed the existing config"
        );
    }
}

#[cfg(unix)]
#[test]
fn refresh_rejects_symlinked_paths_in_existing_config_without_overwrite() {
    use std::os::unix::fs::symlink;

    let t = Temp::new("refresh-existing-symlink");
    let kb = valid_kb(&t.0);
    let ws = t.0.join("ws");
    project(&ws.join("p"), "safe-project");
    let xdg = t.0.join("xdg");
    register_initial(&kb, &ws, &xdg, &t.0);
    let config_path = xdg.join("mozak/config.json");
    let mut malformed: Value = serde_json::from_slice(&fs::read(&config_path).unwrap()).unwrap();
    let kb_link = t.0.join("kb-link");
    symlink(&kb, &kb_link).unwrap();
    malformed["kb_root"] = json!(kb_link);
    let malformed_bytes = serde_json::to_vec_pretty(&malformed).unwrap();
    fs::write(&config_path, &malformed_bytes).unwrap();

    let proposal = discover(&kb, &ws, &xdg);
    let pp = t.0.join("symlink-proposal.json");
    let ap = t.0.join("symlink-approval.json");
    fs::write(&pp, serde_json::to_vec(&proposal).unwrap()).unwrap();
    approve_refresh(&proposal, &ap, "owner-a");
    let out = run(
        &[
            "project",
            "refresh",
            pp.to_str().unwrap(),
            ap.to_str().unwrap(),
        ],
        &xdg,
    );

    assert!(!out.status.success());
    assert!(out.stdout.is_empty());
    assert!(String::from_utf8_lossy(&out.stderr).contains("symlink component"));
    assert_eq!(fs::read(config_path).unwrap(), malformed_bytes);
}

#[test]
fn concurrent_owner_refreshes_have_one_winner_and_no_lost_update() {
    let t = Temp::new("refresh-concurrent");
    let kb = valid_kb(&t.0);
    let ws = t.0.join("ws");
    project(&ws.join("p"), "safe-project");
    let xdg = t.0.join("xdg");
    register_initial(&kb, &ws, &xdg, &t.0);
    project(&ws.join("added"), "added-project");
    let proposal = discover(&kb, &ws, &xdg);
    let pp = t.0.join("proposal.json");
    let a = t.0.join("a.json");
    let b = t.0.join("b.json");
    fs::write(&pp, serde_json::to_vec(&proposal).unwrap()).unwrap();
    approve_refresh(&proposal, &a, "owner-a");
    approve_refresh(&proposal, &b, "owner-b");
    let bin = env!("CARGO_BIN_EXE_mozak").to_owned();
    let spawn = |approval: PathBuf| {
        Command::new(&bin)
            .args([
                "project",
                "refresh",
                pp.to_str().unwrap(),
                approval.to_str().unwrap(),
            ])
            .env("XDG_CONFIG_HOME", &xdg)
            .spawn()
            .unwrap()
    };
    let mut one = spawn(a);
    let mut two = spawn(b);
    let s1 = one.wait().unwrap();
    let s2 = two.wait().unwrap();
    assert_ne!(s1.success(), s2.success());
    let config: Value =
        serde_json::from_slice(&fs::read(xdg.join("mozak/config.json")).unwrap()).unwrap();
    assert!(matches!(
        config["approval"]["owner"].as_str(),
        Some("owner-a" | "owner-b")
    ));
    assert!(config["projects"].get("added-project").is_some());
}

/// Two commands in one tool must not disagree about whether one file is valid.
/// The stricter route was previously hit later, on a fresh machine, during
/// registration, and its error named no file.
#[test]
fn validate_and_discover_agree_about_a_hard_wrapped_idea_intent() {
    let temp = Temp::new("wrapped-intent");
    let xdg = temp.0.join("xdg");
    fs::create_dir_all(&xdg).unwrap();
    let kb = valid_kb(&temp.0);
    let workspace = temp.0.join("workspace");
    let root = workspace.join("wrapped");
    fs::create_dir_all(&root).unwrap();
    project(&root, "wrapped");
    fs::write(
        root.join(".mozak/idea.md"),
        "# Test Idea\n\n## Intent\n\nThis intent paragraph is deliberately hard wrapped\nacross two lines like ordinary Markdown prose.\n\n## Desired outcomes\n\n- Works.\n\n## Boundaries\n\n- Local only.\n\n## Assumptions\n\n- Rust.\n\n## Open questions\n\n- None.\n",
    )
    .unwrap();

    let validated = run(&["project", "validate", root.to_str().unwrap()], &xdg);
    let discovered = run(
        &[
            "project",
            "discover",
            kb.to_str().unwrap(),
            workspace.to_str().unwrap(),
        ],
        &xdg,
    );
    assert_eq!(
        validated.status.success(),
        discovered.status.success(),
        "validate said {:?} while discover said {:?}",
        String::from_utf8_lossy(&validated.stderr),
        String::from_utf8_lossy(&discovered.stderr)
    );
    assert!(
        discovered.status.success(),
        "a hard-wrapped Intent is ordinary Markdown: {}",
        String::from_utf8_lossy(&discovered.stderr)
    );

    // A genuinely unprintable control character is still refused, and the
    // message now names the offending file instead of failing the whole
    // workspace anonymously.
    fs::write(
        root.join(".mozak/idea.md"),
        "# Test Idea\n\n## Intent\n\nThis intent has a bell\u{7}character.\n\n## Desired outcomes\n\n- Works.\n\n## Boundaries\n\n- Local only.\n\n## Assumptions\n\n- Rust.\n\n## Open questions\n\n- None.\n",
    )
    .unwrap();
    let refused = run(
        &[
            "project",
            "discover",
            kb.to_str().unwrap(),
            workspace.to_str().unwrap(),
        ],
        &xdg,
    );
    assert!(!refused.status.success());
    let message = String::from_utf8_lossy(&refused.stderr);
    assert!(message.contains("idea.md"), "{message}");
}
