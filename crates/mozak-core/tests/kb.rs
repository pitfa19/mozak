use mozak_core::kb::{
    GateStatus, assess_parity, load_parity_observations, load_registry, render_tree,
};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

static NEXT: AtomicU64 = AtomicU64::new(0);

struct Temp(PathBuf);

impl Temp {
    fn new(label: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "mozak-core-kb-{label}-{}-{}",
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

fn write_minimal_scope(root: &Path, id: &str) -> String {
    fs::create_dir_all(root).unwrap();
    let manifest = serde_json::json!({
        "schema_version": 2,
        "scopes": [{
            "id": id,
            "kind": "topic",
            "title": format!("Topic {id}"),
            "intent": "Bounded inspection",
            "history": [{"id":"h-1","at":"2026-09-02T00:00:00Z","note":"Created"}]
        }],
        "promotions": [],
        "meta_goals": [],
        "inputs": []
    });
    let bytes = serde_json::to_vec_pretty(&manifest).unwrap();
    fs::write(root.join("scope.json"), &bytes).unwrap();
    sha(&bytes)
}

fn write_registry(root: &Path, registrations: &[serde_json::Value]) -> String {
    fs::create_dir_all(root).unwrap();
    let bytes = serde_json::to_vec_pretty(&serde_json::json!({
        "schema_version": 1,
        "registrations": registrations
    }))
    .unwrap();
    fs::write(root.join("kb.json"), &bytes).unwrap();
    sha(&bytes)
}

struct ParityFixture {
    _temp: Temp,
    registry: PathBuf,
    observations: PathBuf,
    source_a: PathBuf,
}

fn parity_fixture() -> ParityFixture {
    let temp = Temp::new("parity");
    let scope = temp.0.join("scope");
    let registry = temp.0.join("registry");
    let sources = temp.0.join("sources");
    fs::create_dir_all(scope.join("objects/sha256")).unwrap();
    fs::create_dir_all(sources.join("notes")).unwrap();
    fs::create_dir_all(sources.join("assets")).unwrap();

    let note_a = b"# A\n\nSee [[B]] and ![[asset.png]].\n";
    let note_b = b"# B\n\nResolved target.\n";
    let attachment = b"\x89PNG\r\nreal fixture bytes";
    let hash_a = sha(note_a);
    let hash_b = sha(note_b);
    let hash_attachment = sha(attachment);
    for (hash, bytes) in [
        (&hash_a, note_a.as_slice()),
        (&hash_b, note_b.as_slice()),
        (&hash_attachment, attachment.as_slice()),
    ] {
        fs::write(scope.join(format!("objects/sha256/{hash}")), bytes).unwrap();
    }
    let source_a = sources.join("notes/A.md");
    let source_b = sources.join("notes/B.md");
    let source_attachment = sources.join("assets/asset.png");
    fs::write(&source_a, note_a).unwrap();
    fs::write(&source_b, note_b).unwrap();
    fs::write(&source_attachment, attachment).unwrap();

    let revision = "a".repeat(40);
    let input = |id: &str,
                 kind: &str,
                 source_path: &str,
                 hash: &str,
                 media_type: &str,
                 validation: Option<serde_json::Value>| {
        let mut value = serde_json::json!({
            "id": id,
            "scope_id": "topic-parity",
            "kind": kind,
            "path": format!("objects/sha256/{hash}"),
            "sha256": hash,
            "media_type": media_type,
            "source": {"path":source_path,"revision":revision,"sha256":hash}
        });
        if let Some(validation) = validation {
            value["note_validation"] = validation;
        }
        value
    };
    let manifest = serde_json::json!({
        "schema_version": 2,
        "scopes": [{
            "id":"topic-parity",
            "kind":"topic",
            "title":"Parity corpus",
            "intent":"Observe real Markdown and attachment behavior",
            "history":[{"id":"h-1","at":"2026-09-02T00:00:00Z","note":"Created"}]
        }],
        "promotions": [],
        "meta_goals": [],
        "inputs": [
            input("note-a", "note", "notes/A.md", &hash_a, "text/markdown", Some(serde_json::json!({"wikilinks":["B"],"embeds":["asset.png"],"unresolved":["B","asset.png"]}))),
            input("note-b", "note", "notes/B.md", &hash_b, "text/markdown", Some(serde_json::json!({"wikilinks":[],"embeds":[],"unresolved":[]}))),
            input("asset", "attachment", "assets/asset.png", &hash_attachment, "image/png", None)
        ]
    });
    let scope_bytes = serde_json::to_vec_pretty(&manifest).unwrap();
    fs::write(scope.join("scope.json"), &scope_bytes).unwrap();
    let registry_hash = write_registry(
        &registry,
        &[serde_json::json!({
            "id":"parity",
            "path":scope.to_string_lossy(),
            "scope_manifest_sha256":sha(&scope_bytes)
        })],
    );
    let observations = temp.0.join("observations.json");
    fs::write(
        &observations,
        serde_json::to_vec_pretty(&serde_json::json!({
            "schema_version":1,
            "registry_sha256":registry_hash,
            "source_files":[
                {"registration_id":"parity","input_id":"note-a","path":source_a.to_string_lossy(),"observed_revision":revision},
                {"registration_id":"parity","input_id":"note-b","path":source_b.to_string_lossy(),"observed_revision":revision},
                {"registration_id":"parity","input_id":"asset","path":source_attachment.to_string_lossy(),"observed_revision":revision}
            ]
        }))
        .unwrap(),
    )
    .unwrap();
    ParityFixture {
        _temp: temp,
        registry,
        observations,
        source_a,
    }
}

#[test]
fn registry_loads_only_explicit_hashed_roots_and_renders_nested_tree() {
    let temp = Temp::new("registry");
    let parent = temp.0.join("personal");
    let child = parent.join("scopes/example-alpha");
    let ignored = parent.join("scopes/not-registered");
    let parent_hash = write_minimal_scope(&parent, "topic-root");
    let child_hash = write_minimal_scope(&child, "example-alpha");
    fs::create_dir_all(&ignored).unwrap();
    fs::write(ignored.join("scope.json"), b"not valid JSON").unwrap();
    let registry = temp.0.join("index");
    write_registry(
        &registry,
        &[
            serde_json::json!({"id":"personal","path":parent.to_string_lossy(),"scope_manifest_sha256":parent_hash}),
            serde_json::json!({"id":"example-alpha","path":child.to_string_lossy(),"scope_manifest_sha256":child_hash}),
        ],
    );

    let kb = load_registry(&registry).unwrap();
    assert_eq!(kb.entries.len(), 2);
    let tree = render_tree(&kb);
    assert!(tree.contains("Root: personal"));
    assert!(tree.contains("Root: example-alpha"));
    assert!(tree.contains("Scope: example-alpha"));
    assert!(!tree.contains("not-registered"));

    fs::write(child.join("scope.json"), b"{}").unwrap();
    assert!(
        load_registry(&registry)
            .unwrap_err()
            .to_string()
            .contains("hash mismatch")
    );
}

#[test]
fn registry_rejects_relative_paths_unknown_fields_and_duplicate_roots() {
    let temp = Temp::new("invalid");
    let scope = temp.0.join("scope");
    let digest = write_minimal_scope(&scope, "topic-one");
    let registry = temp.0.join("registry");

    for registrations in [
        vec![serde_json::json!({"id":"one","path":"relative","scope_manifest_sha256":digest})],
        vec![
            serde_json::json!({"id":"one","path":scope.to_string_lossy(),"scope_manifest_sha256":digest,"extra":true}),
        ],
        vec![
            serde_json::json!({"id":"one","path":scope.to_string_lossy(),"scope_manifest_sha256":digest}),
            serde_json::json!({"id":"two","path":scope.to_string_lossy(),"scope_manifest_sha256":digest}),
        ],
    ] {
        write_registry(&registry, &registrations);
        assert!(load_registry(&registry).is_err());
    }
}

#[test]
fn parity_observes_real_links_embeds_attachments_and_never_infers_full_parity() {
    let fixture = parity_fixture();
    let kb = load_registry(&fixture.registry).unwrap();
    let observations = load_parity_observations(&fixture.observations, &kb).unwrap();
    let assessment = assess_parity(&kb, &observations);
    let status = |id: &str| {
        assessment
            .gates
            .iter()
            .find(|gate| gate.id == id)
            .unwrap()
            .status
    };
    for id in [
        "markdown_wikilink_preservation",
        "markdown_embed_preservation",
        "wikilink_resolution",
        "embed_resolution",
        "attachments",
        "content_hashes",
        "deterministic_export",
        "agent_discovery",
    ] {
        assert_eq!(status(id), GateStatus::Passed, "{id}");
    }
    for id in [
        "import_export_round_trip",
        "version_history",
        "rollback_recovery",
    ] {
        assert_eq!(status(id), GateStatus::Unsupported, "{id}");
    }
    assert_eq!(status("human_editability"), GateStatus::Blocked);
    assert!(!assessment.parity);
}

#[test]
fn parity_marks_observed_source_drift_failed_and_rejects_unpinned_receipts() {
    let fixture = parity_fixture();
    fs::write(&fixture.source_a, b"changed").unwrap();
    let kb = load_registry(&fixture.registry).unwrap();
    let observations = load_parity_observations(&fixture.observations, &kb).unwrap();
    let assessment = assess_parity(&kb, &observations);
    assert_eq!(
        assessment
            .gates
            .iter()
            .find(|gate| gate.id == "markdown_wikilink_preservation")
            .unwrap()
            .status,
        GateStatus::Failed
    );

    let mut receipt: serde_json::Value =
        serde_json::from_slice(&fs::read(&fixture.observations).unwrap()).unwrap();
    receipt["registry_sha256"] = serde_json::json!("0".repeat(64));
    fs::write(&fixture.observations, serde_json::to_vec(&receipt).unwrap()).unwrap();
    assert!(load_parity_observations(&fixture.observations, &kb).is_err());
}
