use mozak_core::scope::{ingest_links, load_scopes};
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
            "mozak-ingest-{label}-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        if self.0.exists() {
            fs::remove_dir_all(&self.0).unwrap();
        }
    }
}
fn sha(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn fixture(note: &[u8]) -> (Temp, Temp, Temp, String) {
    let scope = Temp::new("scope");
    let source = Temp::new("source");
    let output = Temp::new("output-parent");
    let revision = "a".repeat(40);
    fs::create_dir_all(source.0.join("notes")).unwrap();
    fs::create_dir_all(source.0.join("assets")).unwrap();
    fs::write(source.0.join("notes/source.md"), note).unwrap();
    fs::write(source.0.join("notes/Target.md"), b"# Target\n").unwrap();
    fs::write(source.0.join("assets/pic.png"), b"PNG").unwrap();
    let digest = sha(note);
    fs::create_dir_all(scope.0.join("objects/sha256")).unwrap();
    fs::write(scope.0.join(format!("objects/sha256/{digest}")), note).unwrap();
    let manifest = serde_json::json!({
        "schema_version": 2,
        "scopes": [{"id":"topic-one","kind":"topic","title":"One","intent":"Bounded","history":[{"id":"h-1","at":"2026-09-02T00:00:00Z","note":"Created"}]}],
        "promotions": [], "meta_goals": [],
        "inputs": [{
            "id":"source-note","scope_id":"topic-one","kind":"note",
            "path":format!("objects/sha256/{digest}"),"sha256":digest,"media_type":"text/markdown",
            "source":{"path":"notes/source.md","revision":revision,"sha256":sha(note)},
            "note_validation":{"wikilinks":["Target"],"embeds":["assets/pic.png"],"unresolved":["Target","assets/pic.png"]}
        }]
    });
    fs::write(
        scope.0.join("scope.json"),
        serde_json::to_vec_pretty(&manifest).unwrap(),
    )
    .unwrap();
    (scope, source, output, revision)
}
fn plan(scope: &Path, source: &Path, revision: &str) -> serde_json::Value {
    serde_json::json!({
        "schema_version":1,
        "scope_manifest_sha256":sha(&fs::read(scope.join("scope.json")).unwrap()),
        "observed_revision":revision,
        "scope_id":"topic-one",
        "history_entry":{"id":"h-2","at":"2026-09-03T00:00:00Z","note":"Ingested declared links"},
        "existing_source_input_ids":["source-note"],
        "inclusions":[
            {"input_id":"target-note","kind":"note","source_path":"notes/Target.md","source_sha256":sha(&fs::read(source.join("notes/Target.md")).unwrap()),"media_type":"text/markdown"},
            {"input_id":"picture","kind":"attachment","source_path":"assets/pic.png","source_sha256":sha(&fs::read(source.join("assets/pic.png")).unwrap()),"media_type":"image/png"}
        ]
    })
}
fn write_plan(parent: &Path, value: &serde_json::Value) -> PathBuf {
    let path = parent.join("plan.json");
    fs::write(&path, serde_json::to_vec_pretty(value).unwrap()).unwrap();
    path
}

#[test]
fn ingests_only_declared_links_and_emits_deterministic_receipt() {
    let (scope, source, output_parent, revision) = fixture(b"[[Target]] ![[assets/pic.png]]\n");
    fs::write(source.0.join("unrelated.md"), b"must not be copied").unwrap();
    let plan = write_plan(&output_parent.0, &plan(&scope.0, &source.0, &revision));
    let output = output_parent.0.join("new-scope");
    let receipt = ingest_links(&scope.0, &source.0, &revision, &plan, &output).unwrap();
    assert!(!receipt.auto_discovery);
    assert_eq!(receipt.authority, "source_vault_remains_authoritative");
    assert_eq!(receipt.added_input_ids, ["target-note", "picture"]);
    assert!(!output.join("unrelated.md").exists());
    let loaded = load_scopes(&output).unwrap();
    assert_eq!(loaded.manifest.inputs.len(), 3);
    assert_eq!(loaded.manifest.scopes[0].history.len(), 2);
}

#[test]
fn rejects_pin_drift_changed_bytes_unsafe_or_unsupported_references_and_existing_output() {
    for case in ["pin", "bytes", "unsafe", "alias", "unused", "existing"] {
        let note: &[u8] = if case == "alias" {
            b"[[Target|label]] ![[assets/pic.png]]\n"
        } else if case == "unsafe" {
            b"[[../Target]] ![[assets/pic.png]]\n"
        } else {
            b"[[Target]] ![[assets/pic.png]]\n"
        };
        let (scope, source, output_parent, revision) = fixture(note);
        let mut value = plan(&scope.0, &source.0, &revision);
        if case == "pin" {
            value["scope_manifest_sha256"] = serde_json::json!("0".repeat(64));
        } else if case == "bytes" {
            fs::write(source.0.join("notes/Target.md"), b"changed").unwrap();
        } else if case == "unused" {
            value["inclusions"]
                .as_array_mut()
                .unwrap()
                .push(serde_json::json!({
                    "input_id":"unused","kind":"note","source_path":"unreferenced.md",
                    "source_sha256":sha(b"unused"),"media_type":"text/markdown"
                }));
            fs::write(source.0.join("unreferenced.md"), b"unused").unwrap();
        }
        let plan = write_plan(&output_parent.0, &value);
        let output = output_parent.0.join("new-scope");
        if case == "existing" {
            fs::create_dir(&output).unwrap();
        }
        assert!(
            ingest_links(&scope.0, &source.0, &revision, &plan, &output).is_err(),
            "{case}"
        );
        if case != "existing" {
            assert!(!output.exists(), "{case} wrote output before validation");
        }
    }
}

#[test]
fn scope_validation_rejects_casefold_source_path_collisions() {
    let (scope, _source, _output, _revision) = fixture(b"[[Target]] ![[assets/pic.png]]\n");
    let path = scope.0.join("scope.json");
    let mut manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    let mut duplicate = manifest["inputs"][0].clone();
    duplicate["id"] = serde_json::json!("other");
    duplicate["source"]["path"] = serde_json::json!("NOTES/SOURCE.MD");
    manifest["inputs"].as_array_mut().unwrap().push(duplicate);
    fs::write(path, serde_json::to_vec(&manifest).unwrap()).unwrap();
    assert!(load_scopes(&scope.0).is_err());
}

#[test]
fn rejects_output_and_staging_locations_within_input_roots() {
    let (scope, source, output_parent, revision) = fixture(b"[[Target]] ![[assets/pic.png]]\n");
    let value = plan(&scope.0, &source.0, &revision);
    let plan_path = write_plan(&output_parent.0, &value);

    for output in [
        scope.0.join("nested-output"),
        source.0.join("nested-output"),
    ] {
        assert!(ingest_links(&scope.0, &source.0, &revision, &plan_path, &output).is_err());
        assert!(!output.exists());
    }
}

#[test]
fn rejects_non_ascii_source_paths_and_empty_wikilinks_before_writes() {
    for note in [
        b"[[]] ![[assets/pic.png]]\n".as_slice(),
        b"[[   ]] ![[assets/pic.png]]\n",
    ] {
        let (scope, source, output_parent, revision) = fixture(note);
        let plan_path = write_plan(&output_parent.0, &plan(&scope.0, &source.0, &revision));
        let output = output_parent.0.join("new-scope");
        assert!(ingest_links(&scope.0, &source.0, &revision, &plan_path, &output).is_err());
        assert!(!output.exists());
    }

    let (scope, _source, _output_parent, _revision) = fixture(b"[[Target]] ![[assets/pic.png]]\n");
    let path = scope.0.join("scope.json");
    let mut manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    manifest["inputs"][0]["source"]["path"] = serde_json::json!("notes/straße.md");
    fs::write(&path, serde_json::to_vec(&manifest).unwrap()).unwrap();
    assert!(load_scopes(&scope.0).is_err());

    let (scope, source, output_parent, revision) = fixture(b"[[Target]] ![[assets/pic.png]]\n");
    let mut value = plan(&scope.0, &source.0, &revision);
    value["inclusions"][0]["source_path"] = serde_json::json!("notes/Tárget.md");
    let plan_path = write_plan(&output_parent.0, &value);
    let output = output_parent.0.join("new-scope");
    assert!(ingest_links(&scope.0, &source.0, &revision, &plan_path, &output).is_err());
    assert!(!output.exists());
}

#[cfg(unix)]
#[test]
fn rejects_dangling_output_and_staging_symlinks_as_existing() {
    use std::os::unix::fs::symlink;

    for target in ["output", "stage"] {
        let (scope, source, output_parent, revision) = fixture(b"[[Target]] ![[assets/pic.png]]\n");
        let plan_path = write_plan(&output_parent.0, &plan(&scope.0, &source.0, &revision));
        let output = output_parent.0.join("new-scope");
        let occupied = if target == "output" {
            output.clone()
        } else {
            output_parent.0.join(".new-scope.mozak-stage")
        };
        symlink(output_parent.0.join("missing-target"), &occupied).unwrap();
        assert!(ingest_links(&scope.0, &source.0, &revision, &plan_path, &output).is_err());
        assert!(
            fs::symlink_metadata(&occupied)
                .unwrap()
                .file_type()
                .is_symlink()
        );
    }
}

#[cfg(unix)]
#[test]
fn rejects_symlinked_source_path_chain_before_writing() {
    use std::os::unix::fs::symlink;

    let (scope, source, output_parent, revision) =
        fixture(b"[[linked/Target]] ![[assets/pic.png]]\n");
    symlink(source.0.join("notes"), source.0.join("linked")).unwrap();
    let mut value = plan(&scope.0, &source.0, &revision);
    value["inclusions"][0]["source_path"] = serde_json::json!("linked/Target.md");
    let plan = write_plan(&output_parent.0, &value);
    let output = output_parent.0.join("new-scope");
    assert!(ingest_links(&scope.0, &source.0, &revision, &plan, &output).is_err());
    assert!(!output.exists());
}
