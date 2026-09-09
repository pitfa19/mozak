use mozak_core::meta_kb::{MetaRelationshipKind, load_meta_kb, validate_meta_identifier};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
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
            "mozak-meta-core-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(p.join("releases")).unwrap();
        Self(p)
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn release(project: &str, id: &str) -> Vec<u8> {
    serde_json::to_vec(&json!({"schema_version":1,"release_id":id,"generated_at":"2026-09-02T00:00:00Z","accepted_state_version":1,"project":{"id":project,"name":project,"repository_revision":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"},"accepted_state_sha256":"abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789","accepted_findings":[],"decisions":[],"reusable_patterns":[],"open_gaps":[],"implementation_state":[]})).unwrap()
}
fn setup() -> (Temp, Value) {
    let t = Temp::new();
    let a = release("alpha", "r1");
    let b = release("beta", "r2");
    fs::write(t.0.join("releases/a.json"), &a).unwrap();
    fs::write(t.0.join("releases/b.json"), &b).unwrap();
    let m = json!({"schema_version":1,"projects":[{"project_id":"alpha","release_id":"r1","release_path":"releases/a.json","release_sha256":hash(&a)},{"project_id":"beta","release_id":"r2","release_path":"releases/b.json","release_sha256":hash(&b)}],"relationships":[{"from_project_id":"alpha","to_project_id":"beta","relationship":"uses"}]});
    (t, m)
}
fn write(t: &Temp, m: &Value) {
    fs::write(
        t.0.join("meta-kb.json"),
        serde_json::to_vec_pretty(m).unwrap(),
    )
    .unwrap();
}

#[test]
fn relationship_vocabulary_is_closed_and_canonical() {
    let kinds = [
        (MetaRelationshipKind::Informs, "informs"),
        (MetaRelationshipKind::DependsOn, "depends_on"),
        (MetaRelationshipKind::DerivedFrom, "derived_from"),
        (MetaRelationshipKind::RelatedTo, "related_to"),
        (MetaRelationshipKind::Validates, "validates"),
        (MetaRelationshipKind::ValidatedBy, "validated_by"),
        (MetaRelationshipKind::Uses, "uses"),
        (MetaRelationshipKind::Supersedes, "supersedes"),
    ];
    for (kind, label) in kinds {
        assert_eq!(kind.as_str(), label);
        assert_eq!(kind.to_string(), label);
        assert_eq!(
            serde_json::to_string(&kind).unwrap(),
            format!("\"{label}\"")
        );
        assert_eq!(
            serde_json::from_str::<MetaRelationshipKind>(&format!("\"{label}\"")).unwrap(),
            kind
        );
    }
    for invalid in ["unknown", "Uses", " uses", "uses ", "depends on", "uses\n"] {
        assert!(serde_json::from_str::<MetaRelationshipKind>(&format!("{invalid:?}")).is_err());
    }
}

#[test]
fn meta_identifiers_are_terminal_and_graph_safe() {
    for valid in ["a", "A1", "alpha-r1", "project.release_2", &"a".repeat(128)] {
        validate_meta_identifier(valid, "id").unwrap();
    }
    for invalid in [
        "",
        "-alpha",
        "_alpha",
        ".alpha",
        "alpha beta",
        "alpha\n",
        "alpha\r",
        "alpha\u{1b}",
        "alpha\"beta",
        "alpha|beta",
        "alpha[beta]",
        "alpha:beta",
        &"a".repeat(129),
    ] {
        assert!(
            validate_meta_identifier(invalid, "id").is_err(),
            "{invalid:?}"
        );
    }
}

#[test]
fn accepts_real_shaped_releases_and_rejects_adversarial_manifests() {
    let (t, m) = setup();
    write(&t, &m);
    assert_eq!(load_meta_kb(&t.0).unwrap().releases.len(), 2);
    let cases = [
        ("duplicate project", {
            let mut x = m.clone();
            let duplicate = x["projects"][0].clone();
            x["projects"].as_array_mut().unwrap().push(duplicate);
            x
        }),
        ("duplicate release identity", {
            let mut x = m.clone();
            x["projects"][1]["release_id"] = json!("r1");
            x
        }),
        ("unsafe path", {
            let mut x = m.clone();
            x["projects"][0]["release_path"] = json!("../a.json");
            x
        }),
        ("malformed hash", {
            let mut x = m.clone();
            x["projects"][0]["release_sha256"] = json!("ABC");
            x
        }),
        ("unknown endpoint", {
            let mut x = m.clone();
            x["relationships"][0]["to_project_id"] = json!("missing");
            x
        }),
        ("self relation", {
            let mut x = m.clone();
            x["relationships"][0]["to_project_id"] = json!("alpha");
            x
        }),
        ("duplicate relation", {
            let mut x = m.clone();
            let duplicate = x["relationships"][0].clone();
            x["relationships"].as_array_mut().unwrap().push(duplicate);
            x
        }),
        ("extra field", {
            let mut x = m.clone();
            x["extra"] = json!(true);
            x
        }),
        ("unknown relationship kind", {
            let mut x = m.clone();
            x["relationships"][0]["relationship"] = json!("consumes");
            x
        }),
        ("whitespace relationship kind", {
            let mut x = m.clone();
            x["relationships"][0]["relationship"] = json!(" uses");
            x
        }),
        ("project id control character", {
            let mut x = m.clone();
            x["projects"][0]["project_id"] = json!("alpha\nforged");
            x
        }),
        ("release id control character", {
            let mut x = m.clone();
            x["projects"][0]["release_id"] = json!("r1\u{1b}[31m");
            x
        }),
    ];
    for (name, case) in cases {
        write(&t, &case);
        assert!(load_meta_kb(&t.0).is_err(), "{name}");
    }
}

#[test]
fn rejects_unsafe_identifiers_inside_loaded_releases() {
    for (field, injected) in [("project", "alpha\rforged"), ("release", "r1\u{1b}[31m")] {
        let (t, mut m) = setup();
        let path = t.0.join("releases/a.json");
        let mut value: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        if field == "project" {
            value["project"]["id"] = json!(injected);
        } else {
            value["release_id"] = json!(injected);
        }
        let bytes = serde_json::to_vec(&value).unwrap();
        fs::write(&path, &bytes).unwrap();
        m["projects"][0]["release_sha256"] = json!(hash(&bytes));
        write(&t, &m);
        let error = load_meta_kb(&t.0).unwrap_err().to_string();
        assert!(
            error.contains("must be 1..=128 ASCII characters"),
            "{error}"
        );
    }
}

#[test]
fn rejects_tampering_and_release_identity_or_contract_mismatch() {
    let (t, m) = setup();
    write(&t, &m);
    fs::write(t.0.join("releases/a.json"), b"{}").unwrap();
    assert!(
        load_meta_kb(&t.0)
            .unwrap_err()
            .to_string()
            .contains("SHA-256 mismatch")
    );
    let (t, mut m) = setup();
    m["projects"][0]["project_id"] = json!("wrong");
    write(&t, &m);
    assert!(load_meta_kb(&t.0).is_err());
    let (t, mut m) = setup();
    let bad = br#"{"schema_version":1}"#;
    fs::write(t.0.join("releases/a.json"), bad).unwrap();
    m["projects"][0]["release_sha256"] = json!(hash(bad));
    write(&t, &m);
    assert!(
        load_meta_kb(&t.0)
            .unwrap_err()
            .to_string()
            .contains("project release contract")
    );
}
