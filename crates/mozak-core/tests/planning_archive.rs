use mozak_core::planning_archive::{
    PlanningCompactionApproval, apply_compaction_plan, archived_planning_artifacts,
    build_compaction_plan, compaction_recommendation, plan_sha256, restore_compaction,
};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

fn temp_root(name: &str) -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("mozak-{name}-{stamp}"));
    fs::create_dir_all(root.join(".mozak/planning/inputs")).expect("inputs dir");
    fs::create_dir_all(root.join(".mozak/planning/plans")).expect("plans dir");
    root
}

fn write_artifacts(root: &Path) {
    fs::write(
        root.join(".mozak/planning/inputs/accepted.json"),
        br#"{"contract_version":2,"id":"inputs","accepted_at":"2026-09-15T00:00:00Z","inputs":[{"id":"i1","text":"keep exact","retention":"constraint","provenance":{"kind":"human_decision","decision_id":"d1","actor":"owner"}}]}"#,
    )
    .expect("input");
    fs::write(
        root.join(".mozak/planning/plans/plan.json"),
        br#"{"contract_version":1,"id":"plan","version":1,"input_set_id":"inputs","goals":[{"id":"g1","version":1,"title":"Do it","status":"ready","priority":1,"input_ids":["i1"],"recovery_attempts":0}],"dependencies":[],"recovery":{"max_attempts_per_goal":1,"allowed_failed_transition":"blocked"}}"#,
    )
    .expect("plan");
    fs::write(
        root.join(".mozak/planning/notes.txt"),
        b"planning note" as &[u8],
    )
    .expect("note");
}

fn write_plan_and_approval(root: &Path) -> (PathBuf, PathBuf, String) {
    let plan = build_compaction_plan(root, "2026-09-15T00:00:00Z").expect("plan");
    let hash = plan_sha256(&plan).expect("hash");
    let plan_path = root.join("compact-plan.json");
    fs::write(
        &plan_path,
        serde_json::to_string_pretty(&plan).expect("json") + "\n",
    )
    .expect("write plan");
    let approval = PlanningCompactionApproval {
        schema_version: 1,
        decision: true,
        owner: "pitfa".into(),
        approved_at: "2026-09-15T00:00:01Z".into(),
        plan_sha256: hash.clone(),
        project_root: root
            .canonicalize()
            .expect("canonical")
            .to_string_lossy()
            .into_owned(),
        rationale: "owner-approved compaction test".into(),
    };
    let approval_path = root.join("approval.json");
    fs::write(
        &approval_path,
        serde_json::to_string_pretty(&approval).expect("json") + "\n",
    )
    .expect("write approval");
    (plan_path, approval_path, hash)
}

#[test]
fn compaction_archives_losslessly_and_restores_from_deterministic_index() {
    let root = temp_root("archive-roundtrip");
    write_artifacts(&root);
    let originals = planning_bytes(&root);
    let (plan_path, approval_path, hash) = write_plan_and_approval(&root);

    let receipt = apply_compaction_plan(&root, &plan_path, &approval_path).expect("apply");
    assert_eq!(receipt.plan_sha256, hash);
    assert_eq!(receipt.entries.len(), 3);
    let index = root.join(".mozak/planning/active-index.json");
    assert!(index.is_file());

    let restore = root.join("restored");
    let restored = restore_compaction(&root, &index, &approval_path, &restore).expect("restore");
    assert_eq!(restored.action, "restore");
    assert_eq!(planning_bytes(&restore), originals);
}

fn planning_bytes(root: &Path) -> Vec<(String, Vec<u8>)> {
    let mut bytes = files_under(&root.join(".mozak/planning"))
        .into_iter()
        .filter(|path| !path.to_string_lossy().contains("/archive/"))
        .map(|path| {
            let rel = path
                .strip_prefix(root)
                .expect("relative")
                .to_string_lossy()
                .replace('\\', "/");
            (rel, fs::read(path).expect("bytes"))
        })
        .collect::<Vec<_>>();
    bytes.sort_by(|a, b| a.0.cmp(&b.0));
    bytes
}

fn files_under(dir: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                files.extend(files_under(&path));
            } else if path.is_file() {
                files.push(path);
            }
        }
    }
    files
}

#[test]
fn stale_approval_changed_artifact_and_corrupt_archive_fail_closed() {
    let root = temp_root("archive-failures");
    write_artifacts(&root);
    let (plan_path, approval_path, _) = write_plan_and_approval(&root);

    fs::write(root.join(".mozak/planning/plans/plan.json"), b"{}" as &[u8]).expect("mutate");
    let err = apply_compaction_plan(&root, &plan_path, &approval_path).expect_err("changed source");
    assert!(
        err.to_string()
            .contains("active artifact changed since plan")
    );
    write_artifacts(&root);
    apply_compaction_plan(&root, &plan_path, &approval_path).expect("apply");

    let index = root.join(".mozak/planning/active-index.json");
    let mut plan: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&index).expect("index")).expect("json");
    let first_hash = plan["entries"][0]["sha256"]
        .as_str()
        .expect("hash")
        .to_owned();
    fs::write(
        root.join(".mozak/planning/archive/sha256")
            .join(&first_hash[..2])
            .join(format!("{first_hash}.json")),
        b"corrupt" as &[u8],
    )
    .expect("corrupt");
    let err = restore_compaction(&root, &index, &approval_path, &root.join("restore-corrupt"))
        .expect_err("corrupt archive");
    assert!(err.to_string().contains("archive blob corruption"));

    plan["entries"][0]["relative_path"] = serde_json::Value::String("../escape.json".into());
    fs::write(
        &index,
        serde_json::to_string_pretty(&plan).expect("json") + "\n",
    )
    .expect("tamper");
    let err = restore_compaction(
        &root,
        &index,
        &approval_path,
        &root.join("restore-traversal"),
    )
    .expect_err("path traversal");
    assert!(
        err.to_string().contains("stale approval") || err.to_string().contains("path traversal")
    );
}

#[test]
fn stale_staging_is_refused_before_apply() {
    let root = temp_root("archive-staging");
    write_artifacts(&root);
    let staging = root.join(".mozak/planning/.compact-staging/archive/junk");
    fs::create_dir_all(&staging).expect("staging");
    fs::write(staging.join("leftover"), b"partial" as &[u8]).expect("leftover");
    let (plan_path, approval_path, _) = write_plan_and_approval(&root);
    let err = apply_compaction_plan(&root, &plan_path, &approval_path).expect_err("stale staging");
    assert!(err.to_string().contains("staging already exists"));
}

#[test]
fn compaction_keeps_inputs_for_active_plan_families_only() {
    let root = temp_root("archive-families");
    write_input(&root, "inputs-a1", "a1");
    write_input(&root, "inputs-a2", "a2");
    write_input(&root, "inputs-b1", "b1");
    write_family_plan(&root, "alpha-v1", "alpha", 1, "inputs-a1", None);
    write_family_plan(&root, "alpha-v2", "alpha", 2, "inputs-a2", Some(1));
    write_family_plan(&root, "beta-v1", "beta", 1, "inputs-b1", None);

    let recommendation =
        compaction_recommendation(&root, "2026-09-15T00:00:00Z").expect("recommendation");
    assert!(recommendation.recommended);
    assert!(recommendation.compactable_count >= 2);
    assert!(recommendation.apply_requires_approval);

    let (plan_path, approval_path, _) = write_plan_and_approval(&root);
    apply_compaction_plan(&root, &plan_path, &approval_path).expect("apply");

    assert!(!root.join(".mozak/planning/plans/alpha-v1.json").exists());
    assert!(!root.join(".mozak/planning/inputs/inputs-a1.json").exists());
    assert!(root.join(".mozak/planning/plans/alpha-v2.json").is_file());
    assert!(root.join(".mozak/planning/inputs/inputs-a2.json").is_file());
    assert!(root.join(".mozak/planning/plans/beta-v1.json").is_file());
    assert!(root.join(".mozak/planning/inputs/inputs-b1.json").is_file());

    let (archived_inputs, archived_plans) =
        archived_planning_artifacts(&root).expect("archive read");
    assert_eq!(archived_inputs.len(), 1);
    assert_eq!(archived_inputs[0].1.id, "inputs-a1");
    assert_eq!(archived_plans.len(), 1);
    assert_eq!(archived_plans[0].1.id, "alpha");
    assert_eq!(archived_plans[0].1.version, 1);
}

#[test]
fn incomplete_supersession_history_keeps_observed_tip_active() {
    let root = temp_root("archive-incomplete-history");
    write_input(&root, "inputs-a2", "a2");
    write_family_plan(&root, "alpha-v2", "alpha", 2, "inputs-a2", Some(1));

    let recommendation =
        compaction_recommendation(&root, "2026-09-15T00:00:00Z").expect("recommendation");
    assert!(!recommendation.recommended);
    let (plan_path, approval_path, _) = write_plan_and_approval(&root);
    apply_compaction_plan(&root, &plan_path, &approval_path).expect("apply");

    assert!(root.join(".mozak/planning/plans/alpha-v2.json").is_file());
    assert!(root.join(".mozak/planning/inputs/inputs-a2.json").is_file());
    let (archived_inputs, archived_plans) =
        archived_planning_artifacts(&root).expect("archive read");
    assert!(archived_inputs.is_empty());
    assert!(archived_plans.is_empty());
}

fn write_input(root: &Path, id: &str, input_id: &str) {
    fs::write(
        root.join(format!(".mozak/planning/inputs/{id}.json")),
        format!(r#"{{"contract_version":2,"id":"{id}","accepted_at":"2026-09-15T00:00:00Z","inputs":[{{"id":"{input_id}","text":"{input_id} exact","retention":"constraint","provenance":{{"kind":"human_decision","decision_id":"d-{input_id}","actor":"owner"}}}}]}}"#),
    )
    .expect("input");
}

fn write_family_plan(
    root: &Path,
    file_stem: &str,
    id: &str,
    version: u64,
    input_set_id: &str,
    supersedes_version: Option<u64>,
) {
    let supersedes = supersedes_version.map_or_else(String::new, |previous| {
        format!(r#","supersedes":{{"id":"{id}","version":{previous}}}"#)
    });
    let input_id = input_set_id.strip_prefix("inputs-").unwrap_or(input_set_id);
    fs::write(
        root.join(format!(".mozak/planning/plans/{file_stem}.json")),
        format!(r#"{{"contract_version":1,"id":"{id}","version":{version},"input_set_id":"{input_set_id}"{supersedes},"goals":[{{"id":"g-{id}-{version}","version":1,"title":"Do {id} {version}","status":"ready","priority":1,"input_ids":["{input_id}"],"recovery_attempts":0}}],"dependencies":[],"recovery":{{"max_attempts_per_goal":1,"allowed_failed_transition":"blocked"}}}}"#),
    )
    .expect("plan");
}
