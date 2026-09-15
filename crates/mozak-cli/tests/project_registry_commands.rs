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
