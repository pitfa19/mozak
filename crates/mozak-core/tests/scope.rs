use mozak_core::scope::load_scopes;
use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};

static NEXT: AtomicU64 = AtomicU64::new(0);
struct Temp(PathBuf);
impl Temp {
    fn new() -> Self {
        let p = std::env::temp_dir().join(format!(
            "mozak-core-scope-{}-{}",
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

#[test]
fn direct_core_accepts_a_minimal_topic_snapshot() {
    let root = Temp::new();
    fs::write(root.0.join("scope.json"),r#"{"schema_version":2,"scopes":[{"id":"topic-one","kind":"topic","title":"One","intent":"Bounded","history":[{"id":"h-1","at":"2026-09-02T00:00:00Z","note":"Created"}]}],"promotions":[],"meta_goals":[],"inputs":[]}"#).unwrap();
    let validated = load_scopes(&root.0).unwrap();
    assert_eq!(validated.manifest.scopes.len(), 1);
}

#[test]
fn direct_core_rejects_empty_and_noncanonical_history() {
    for json in [
        r#"{"schema_version":2,"scopes":[],"promotions":[],"meta_goals":[],"inputs":[]}"#,
        r#"{"schema_version":2,"scopes":[{"id":"topic-one","kind":"topic","title":"One","intent":"Bounded","history":[{"id":"h-1","at":"2026-09-02","note":"Created"}]}],"promotions":[],"meta_goals":[],"inputs":[]}"#,
    ] {
        let root = Temp::new();
        fs::write(root.0.join("scope.json"), json).unwrap();
        assert!(load_scopes(&root.0).is_err());
    }
}

/// A scope may own Concepts, pinned by exact bytes.
#[test]
fn scope_owned_concepts_are_pinned_and_must_be_valid_concepts() {
    use sha2::Digest as _;
    let temp = std::env::temp_dir().join(format!("mozak-scope-concept-{}", std::process::id()));
    let root = temp.join("scope");
    fs::create_dir_all(root.join("concepts")).unwrap();
    let concept = include_str!("fixtures/concept/publish-as-commit.json");
    fs::write(root.join("concepts/c.json"), concept).unwrap();
    let digest = format!("{:x}", sha2::Sha256::digest(concept.as_bytes()));

    let manifest = serde_json::json!({
        "schema_version": 2,
        "scopes": [{
            "id": "example-gamma",
            "kind": "topic",
            "title": "Owner",
            "intent": "Own one concept.",
            "history": [{"id": "h-1", "at": "2026-09-04T00:00:00Z", "note": "Created"}]
        }],
        "promotions": [],
        "meta_goals": [],
        "inputs": [],
        "concepts": [{
            "id": "concept-publish-as-commit",
            "scope_id": "example-gamma",
            "path": "concepts/c.json",
            "sha256": digest
        }]
    });
    let path = root.join("scope.json");
    fs::write(&path, serde_json::to_vec_pretty(&manifest).unwrap()).unwrap();
    let loaded = load_scopes(&root).expect("a scope may own a concept");
    assert_eq!(loaded.manifest.concepts.len(), 1);

    // The declared owner must match the concept's own recorded origin, so a
    // scope cannot claim authorship of another owner's concept.
    let mut stolen = manifest.clone();
    stolen["concepts"][0]["scope_id"] = serde_json::json!("example-gamma");
    stolen["scopes"][0]["id"] = serde_json::json!("someone-else");
    stolen["concepts"][0]["scope_id"] = serde_json::json!("someone-else");
    fs::write(&path, serde_json::to_vec_pretty(&stolen).unwrap()).unwrap();
    let error = load_scopes(&root).unwrap_err().0;
    assert!(
        error.contains("origin scope does not match its owner"),
        "{error}"
    );

    std::fs::remove_dir_all(&temp).unwrap();
}
