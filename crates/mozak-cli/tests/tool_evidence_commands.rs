//! Real-CLI tests for `research record-tool` and `research verify-tool`.

use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Output},
    sync::atomic::{AtomicU64, Ordering},
};

static NEXT: AtomicU64 = AtomicU64::new(0);
const RESPONSE: &[u8] =
    b"{\"papers\":[{\"id\":\"2501.00001\",\"title\":\"Example paper title\"}]}\n";

struct Temp(PathBuf);
impl Temp {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "mozak-tool-evidence-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }
    fn path(&self, name: &str) -> PathBuf {
        self.0.join(name)
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn fixture() -> Value {
    json!({
        "schema": "mozak.tool-evidence.v1",
        "scope_id": "topic-agentic-systems",
        "question": "Which recent papers discuss agent memory?",
        "tool": {"tool_id": "arxiv-mcp", "kind": "mcp", "version": "0.8.1",
                 "operation": "search_papers", "server": "arxiv"},
        "call": {"arguments": {"query": "agent memory"},
                 "started_at": "2026-10-05T18:00:00Z", "finished_at": "2026-10-05T18:00:02Z"},
        "effects": {"network_used": true, "external_writes": [], "mutations_performed": "none",
                    "irreversible_effects": [], "dry_run_available": false,
                    "owner_approval_required": false},
        "response": {"sha256": format!("{:x}", Sha256::digest(RESPONSE)),
                     "byte_length": RESPONSE.len(), "media_type": "application/json"},
        "selections": [{"id": "sel-0001", "locator": "arxiv:2501.00001",
                        "response_byte_start": 39, "response_byte_end": 58,
                        "excerpt": "Example paper title"}],
        "total_results": 1, "truncated": false, "gaps": [],
        "accepted": false, "authority": "proposal_only"
    })
}

fn mozak(args: &[&Path]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_mozak"))
        .args(args)
        .output()
        .unwrap()
}

fn s(value: &str) -> &Path {
    Path::new(value)
}

fn inputs(temp: &Temp, fixture: &Value) -> (PathBuf, PathBuf) {
    let fixture_path = temp.path("fixture.json");
    let response_path = temp.path("response.json");
    fs::write(
        &fixture_path,
        serde_json::to_string_pretty(fixture).unwrap(),
    )
    .unwrap();
    fs::write(&response_path, RESPONSE).unwrap();
    (fixture_path, response_path)
}

fn record(fixture: &Path, response: &Path, output: &Path) -> Output {
    mozak(&[s("research"), s("record-tool"), fixture, response, output])
}

fn verify(fixture: &Path, response: &Path, run: &Path) -> Output {
    mozak(&[s("research"), s("verify-tool"), fixture, response, run])
}

fn assert_refused(output: &Output, needle: &str) {
    assert!(!output.status.success(), "expected refusal for {needle}");
    assert!(output.stdout.is_empty());
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.starts_with("error: "), "{stderr}");
    assert!(stderr.contains(needle), "expected {needle:?} in {stderr}");
}

#[test]
fn new_recordings_refuse_non_mcp_but_historical_runs_remain_readable() {
    for kind in ["cli", "api", "skill", "other"] {
        let temp = Temp::new();
        let mut value = fixture();
        value["tool"]["kind"] = json!(kind);
        value["tool"].as_object_mut().unwrap().remove("server");
        let (fixture_path, response_path) = inputs(&temp, &value);
        let new_path = temp.path("new-run.json");
        assert_refused(
            &record(&fixture_path, &response_path, &new_path),
            "MCP-only",
        );
        assert!(!new_path.exists());

        // Reconstruct a prior-schema artifact using the compatibility reader.
        // This is a fixture, not a claim that a real non-MCP tool was invoked.
        let old =
            mozak_core::tool_evidence::record_tool_evidence(&value.to_string(), RESPONSE).unwrap();
        let old_path = temp.path("historical-run.json");
        fs::write(&old_path, serde_json::to_string_pretty(&old).unwrap()).unwrap();
        let before = fs::read(&old_path).unwrap();
        assert!(
            verify(&fixture_path, &response_path, &old_path)
                .status
                .success()
        );
        assert!(
            mozak(&[s("research"), s("validate"), &old_path])
                .status
                .success()
        );
        assert_eq!(fs::read(&old_path).unwrap(), before);
    }
}

#[test]
fn new_recordings_require_a_catalog_mcp_id_without_restricting_old_verification() {
    for id in [
        "unknown-mcp",
        "adhd-skill",
        "adapter-arxiv",
        "arxiv-mcp-server",
    ] {
        let temp = Temp::new();
        let mut value = fixture();
        value["tool"]["tool_id"] = json!(id);
        let (fixture_path, response_path) = inputs(&temp, &value);
        let new_path = temp.path("new-run.json");
        assert_refused(&record(&fixture_path, &response_path, &new_path), "");
        assert!(!new_path.exists());

        let old =
            mozak_core::tool_evidence::record_tool_evidence(&value.to_string(), RESPONSE).unwrap();
        let old_path = temp.path("historical-run.json");
        fs::write(&old_path, serde_json::to_string_pretty(&old).unwrap()).unwrap();
        assert!(
            verify(&fixture_path, &response_path, &old_path)
                .status
                .success()
        );
    }
}

#[test]
fn record_validate_landmarks_and_verify_round_trip() {
    let temp = Temp::new();
    let (fixture_path, response_path) = inputs(&temp, &fixture());
    let run_path = temp.path("run.json");
    let output = record(&fixture_path, &response_path, &run_path);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let receipt: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(receipt["state"], "recorded");
    assert_eq!(receipt["accepted"], false);
    assert_eq!(receipt["authority"], "proposal_only");
    assert_eq!(receipt["overall_claim"], "qualified");
    assert_eq!(receipt["tool_id"], "arxiv-mcp");

    let validated = mozak(&[s("research"), s("validate"), &run_path]);
    assert!(validated.status.success());

    let run: Value = serde_json::from_slice(&fs::read(&run_path).unwrap()).unwrap();
    let evidence = &run["evidence"][0];
    let raw = run["raw_records"]
        .as_array()
        .unwrap()
        .iter()
        .find(|record| record["id"] == evidence["raw_record_id"])
        .unwrap();
    let index = temp.path("landmarks.json");
    fs::write(
        &index,
        json!({
            "contract_version": 1,
            "run_id": run["run_id"],
            "derived_artifact": "digest.md",
            "landmarks": [{"id": "landmark-001", "statement": "One paper title was returned.",
                           "evidence_id": evidence["id"], "raw_record_id": raw["id"],
                           "content_sha256": raw["content_sha256"]}]
        })
        .to_string(),
    )
    .unwrap();
    let landmarks = mozak(&[s("research"), s("landmarks"), &run_path, &index]);
    assert!(
        landmarks.status.success(),
        "{}",
        String::from_utf8_lossy(&landmarks.stderr)
    );

    let verified = verify(&fixture_path, &response_path, &run_path);
    assert!(
        verified.status.success(),
        "{}",
        String::from_utf8_lossy(&verified.stderr)
    );
    let verified: Value = serde_json::from_slice(&verified.stdout).unwrap();
    assert_eq!(verified["state"], "verified");
}

#[test]
fn overwrite_is_refused_and_existing_output_is_untouched() {
    let temp = Temp::new();
    let (fixture_path, response_path) = inputs(&temp, &fixture());
    let run_path = temp.path("run.json");
    fs::write(&run_path, "keep").unwrap();
    assert_refused(
        &record(&fixture_path, &response_path, &run_path),
        "refusing to overwrite",
    );
    assert_eq!(fs::read_to_string(&run_path).unwrap(), "keep");
}

#[cfg(unix)]
#[test]
fn symlinked_inputs_outputs_and_ancestors_are_refused() {
    use std::os::unix::fs::symlink;
    let temp = Temp::new();
    let (fixture_path, response_path) = inputs(&temp, &fixture());

    let fixture_link = temp.path("fixture-link.json");
    symlink(&fixture_path, &fixture_link).unwrap();
    assert_refused(
        &record(&fixture_link, &response_path, &temp.path("a.json")),
        "symlink",
    );
    let response_link = temp.path("response-link.json");
    symlink(&response_path, &response_link).unwrap();
    assert_refused(
        &record(&fixture_path, &response_link, &temp.path("b.json")),
        "symlink",
    );

    let dangling = temp.path("dangling.json");
    symlink(temp.path("nowhere.json"), &dangling).unwrap();
    assert_refused(
        &record(&fixture_path, &response_path, &dangling),
        "refusing to overwrite",
    );
    assert!(!temp.path("nowhere.json").exists());

    let real_dir = temp.path("real");
    fs::create_dir(&real_dir).unwrap();
    let dir_link = temp.path("linked-dir");
    symlink(&real_dir, &dir_link).unwrap();
    assert_refused(
        &record(&fixture_path, &response_path, &dir_link.join("run.json")),
        "symlink",
    );
    assert!(!real_dir.join("run.json").exists());
}

#[test]
fn response_drift_and_run_tampering_are_refused() {
    let temp = Temp::new();
    let (fixture_path, response_path) = inputs(&temp, &fixture());
    let run_path = temp.path("run.json");
    assert!(
        record(&fixture_path, &response_path, &run_path)
            .status
            .success()
    );

    let drifted = temp.path("drifted.json");
    let mut bytes = RESPONSE.to_vec();
    bytes[45] = b'X';
    fs::write(&drifted, bytes).unwrap();
    assert_refused(
        &verify(&fixture_path, &drifted, &run_path),
        "response bytes do not match",
    );
    assert_refused(
        &record(&fixture_path, &drifted, &temp.path("other.json")),
        "response bytes do not match",
    );

    let text = fs::read_to_string(&run_path).unwrap();
    let tampered = temp.path("tampered.json");
    fs::write(
        &tampered,
        text.replace("search_papers returned", "search_papers PROVED"),
    )
    .unwrap();
    assert_refused(&verify(&fixture_path, &response_path, &tampered), "");
    let tampered_validate = mozak(&[s("research"), s("validate"), &tampered]);
    assert!(!tampered_validate.status.success());
}

#[test]
fn unsafe_effects_false_acceptance_and_bad_timestamps_are_refused_by_the_cli() {
    let cases: [(&str, Value, &str); 4] = [
        ("accepted", json!(true), "must not claim acceptance"),
        ("authority", json!("accepted"), "proposal_only"),
        ("schema", json!("tool-evidence"), "schema"),
        ("safe_override", json!(true), "unknown field"),
    ];
    for (field, value, needle) in cases {
        let temp = Temp::new();
        let mut fixture = fixture();
        fixture[field] = value;
        let (fixture_path, response_path) = inputs(&temp, &fixture);
        let output_path = temp.path("run.json");
        assert_refused(&record(&fixture_path, &response_path, &output_path), needle);
        assert!(!output_path.exists());
    }
    let temp = Temp::new();
    let mut writes = fixture();
    writes["effects"]["external_writes"] = json!(["zotero:collection"]);
    let (fixture_path, response_path) = inputs(&temp, &writes);
    assert_refused(
        &record(&fixture_path, &response_path, &temp.path("run.json")),
        "external writes",
    );
    let temp = Temp::new();
    let mut time = fixture();
    time["call"]["finished_at"] = json!("2026-10-05T18:00:02.000Z");
    let (fixture_path, response_path) = inputs(&temp, &time);
    assert_refused(
        &record(&fixture_path, &response_path, &temp.path("run.json")),
        "finished_at",
    );
    let temp = Temp::new();
    let mut version = fixture();
    version["tool"]["version"] = json!("latest");
    let (fixture_path, response_path) = inputs(&temp, &version);
    assert_refused(
        &record(&fixture_path, &response_path, &temp.path("run.json")),
        "tool.version",
    );
}

#[test]
fn legacy_adapter_runs_still_validate() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../mozak-core/tests/fixtures");
    let output = mozak(&[
        s("research"),
        s("validate"),
        &root.join("research/valid-run.json"),
    ]);
    assert!(output.status.success());
}
