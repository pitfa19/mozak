use mozak_core::concept::{concept_hash, validate_concept_json};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Output},
    sync::atomic::{AtomicU64, Ordering},
};

static NEXT: AtomicU64 = AtomicU64::new(0);

struct Temp(PathBuf);

impl Temp {
    fn new(label: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "mozak-meta-transfer-{label}-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }
}

impl Drop for Temp {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

fn sha(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

struct Fixture {
    _temp: Temp,
    config_home: PathBuf,
    concept_hash: String,
    source_file_hash: String,
    research_run: PathBuf,
}

fn fixture() -> Fixture {
    let temp = Temp::new("fixture");
    let scope = temp.0.join("scope");
    fs::create_dir_all(scope.join("concepts")).unwrap();
    let concept = fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../mozak-core/tests/fixtures/concept/publish-as-commit.json"),
    )
    .unwrap();
    let source_file_hash = sha(concept.as_bytes());
    let concept_hash = concept_hash(&validate_concept_json(&concept).unwrap()).unwrap();
    fs::write(scope.join("concepts/publish.json"), &concept).unwrap();
    let scope_manifest = serde_json::to_vec_pretty(&serde_json::json!({
        "schema_version": 2,
        "scopes": [
            {
                "id": "example-gamma",
                "kind": "topic",
                "title": "Source topic",
                "intent": "Own transferable knowledge.",
                "history": [{"id":"h-source","at":"2026-09-01T00:00:00Z","note":"Created"}]
            },
            {
                "id": "genome-mcp",
                "kind": "topic",
                "title": "Genome MCP",
                "intent": "Evaluate Concepts for Genome.",
                "history": [{"id":"h-target","at":"2026-09-01T00:00:00Z","note":"Created"}]
            }
        ],
        "promotions": [],
        "meta_goals": [{
            "id": "goal-transfer",
            "title": "Evaluate transferable mechanisms",
            "scope_ids": ["example-gamma", "genome-mcp"],
            "authority": "advisory_only",
            "relationships": []
        }],
        "inputs": [],
        "concepts": [{
            "id": "concept-publish-as-commit",
            "scope_id": "example-gamma",
            "path": "concepts/publish.json",
            "sha256": source_file_hash
        }]
    }))
    .unwrap();
    fs::write(scope.join("scope.json"), &scope_manifest).unwrap();

    let registry = temp.0.join("registry");
    fs::create_dir_all(&registry).unwrap();
    let registry_manifest = serde_json::to_vec_pretty(&serde_json::json!({
        "schema_version": 1,
        "registrations": [{
            "id": "shared",
            "path": scope,
            "scope_manifest_sha256": sha(&scope_manifest)
        }]
    }))
    .unwrap();
    fs::write(registry.join("kb.json"), &registry_manifest).unwrap();

    let config_home = temp.0.join("config");
    let config = config_home.join("mozak/config.json");
    fs::create_dir_all(config.parent().unwrap()).unwrap();
    fs::write(
        config,
        serde_json::to_vec(&serde_json::json!({
            "schema_version": 1,
            "configured_owner": "pitfa",
            "kb_root": registry,
            "kb_sha256": sha(&registry_manifest),
            "projects": {},
            "approval": {
                "proposal_digest": "a".repeat(64),
                "owner": "pitfa",
                "approved_at": "2026-09-16T00:00:00Z",
                "rationale": "Test Meta KB transfer"
            }
        }))
        .unwrap(),
    )
    .unwrap();

    Fixture {
        research_run: Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../mozak-core/tests/fixtures/research/valid-run.json"),
        _temp: temp,
        config_home,
        concept_hash,
        source_file_hash,
    }
}

fn run(fixture: &Fixture, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_mozak"))
        .args(args)
        .env("XDG_CONFIG_HOME", &fixture.config_home)
        .output()
        .unwrap()
}

#[test]
fn candidates_are_deterministic_advisory_and_keep_research_proposal_only() {
    let fixture = fixture();
    let run_path = fixture.research_run.to_str().unwrap();
    let first = run(
        &fixture,
        &["kb", "concept", "candidates", "genome-mcp", run_path],
    );
    let second = run(
        &fixture,
        &["kb", "concept", "candidates", "genome-mcp", run_path],
    );
    assert!(
        first.status.success(),
        "{}",
        String::from_utf8_lossy(&first.stderr)
    );
    assert_eq!(first.stdout, second.stdout);
    let value: serde_json::Value = serde_json::from_slice(&first.stdout).unwrap();
    assert_eq!(value["command"], "kb concept candidates");
    assert_eq!(value["target"]["scope_id"], "genome-mcp");
    assert_eq!(value["ranking"], "none_deterministic_inventory_only");
    assert_eq!(value["mutation"], false);
    assert_eq!(value["concepts"].as_array().unwrap().len(), 1);
    assert_eq!(value["concepts"][0]["concept_sha256"], fixture.concept_hash);
    assert_eq!(
        value["concepts"][0]["source_file_sha256"],
        fixture.source_file_hash
    );
    assert_eq!(
        value["concepts"][0]["relationship"],
        "shared_advisory_meta_goal"
    );
    assert_eq!(value["research"].as_array().unwrap().len(), 1);
    assert_eq!(value["research"][0]["authority"], "proposal_only");
    assert_eq!(value["research"][0]["accepted"], false);
}

#[test]
fn translation_packet_is_hash_pinned_and_not_a_translation() {
    let fixture = fixture();
    let output = run(
        &fixture,
        &[
            "kb",
            "concept",
            "translation-packet",
            "genome-mcp",
            "concept-publish-as-commit",
            &fixture.concept_hash,
        ],
    );
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let value: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(value["command"], "kb concept translation-packet");
    assert_eq!(value["concept_sha256"], fixture.concept_hash);
    assert_eq!(value["target"]["scope_id"], "genome-mcp");
    assert_eq!(value["mutation"], false);
    assert!(
        value["authority"]
            .as_str()
            .unwrap()
            .contains("target must author")
    );
    assert_eq!(value["assumption_prompts"].as_array().unwrap().len(), 5);
    assert!(value.get("adoption").is_none());

    let mismatch = run(
        &fixture,
        &[
            "kb",
            "concept",
            "translation-packet",
            "genome-mcp",
            "concept-publish-as-commit",
            &"0".repeat(64),
        ],
    );
    assert!(!mismatch.status.success());
    assert!(mismatch.stdout.is_empty());
    assert!(
        String::from_utf8_lossy(&mismatch.stderr).contains("does not match any registered pin")
    );
}

#[test]
fn transfer_routes_fail_closed_on_unknown_target_invalid_research_and_self_translation() {
    let fixture = fixture();
    let unknown = run(&fixture, &["kb", "concept", "candidates", "missing-target"]);
    assert!(!unknown.status.success());
    assert!(unknown.stdout.is_empty());
    assert!(String::from_utf8_lossy(&unknown.stderr).contains("unknown registered target"));

    let invalid = fixture.config_home.join("invalid-run.json");
    fs::write(&invalid, "{}").unwrap();
    let invalid_run = run(
        &fixture,
        &[
            "kb",
            "concept",
            "candidates",
            "genome-mcp",
            invalid.to_str().unwrap(),
        ],
    );
    assert!(!invalid_run.status.success());
    assert!(invalid_run.stdout.is_empty());
    assert!(String::from_utf8_lossy(&invalid_run.stderr).contains("invalid supplied research"));

    let own = run(
        &fixture,
        &[
            "kb",
            "concept",
            "translation-packet",
            "example-gamma",
            "concept-publish-as-commit",
            &fixture.concept_hash,
        ],
    );
    assert!(!own.status.success());
    assert!(own.stdout.is_empty());
    assert!(String::from_utf8_lossy(&own.stderr).contains("cannot translate its own Concept"));
}
