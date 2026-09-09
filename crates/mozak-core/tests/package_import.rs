use mozak_core::kb::{graph_source, load_registry, render_list, render_tree};
use mozak_core::package_import::import_package;
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

static NEXT: AtomicU64 = AtomicU64::new(0);
struct Temp(PathBuf);
impl Temp {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "mozak-package-import-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn sha(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn package() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../spec/project-framework/fixtures/pf-0015/canonical")
}
fn registry(temp: &Temp) -> (PathBuf, String) {
    let scope = temp.0.join("scope");
    fs::create_dir(&scope).unwrap();
    let scope_bytes = serde_json::to_vec_pretty(&serde_json::json!({
        "schema_version":2,"scopes":[{"id":"root","kind":"topic","title":"Root","intent":"Test","history":[{"id":"h-1","at":"2026-09-03T00:00:00Z","note":"Created"}]}],
        "promotions":[],"meta_goals":[],"inputs":[]
    })).unwrap();
    fs::write(scope.join("scope.json"), &scope_bytes).unwrap();
    let root = temp.0.join("registry");
    fs::create_dir(&root).unwrap();
    let bytes = serde_json::to_vec_pretty(&serde_json::json!({"schema_version":1,"registrations":[{
        "id":"root","path":scope.canonicalize().unwrap(),"scope_manifest_sha256":sha(&scope_bytes)
    }]})).unwrap();
    fs::write(root.join("kb.json"), &bytes).unwrap();
    (root, sha(&bytes))
}
fn approval(path: &Path, registry_hash: &str, decision: bool, output: &Path) {
    let manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(package().join("mozak-package.json")).unwrap()).unwrap();
    fs::write(
        path,
        serde_json::to_vec_pretty(&serde_json::json!({
            "schema_version":1,"decision":decision,"owner":"test-owner","approved_at":"2026-09-03T05:00:00Z","rationale":"Exact local import test","output_root":output,
            "package_id":manifest["package_id"],
            "project_id":manifest["project_id"],"release_id":manifest["release_id"],
            "target_registry_sha256":registry_hash
        }))
        .unwrap(),
    )
    .unwrap();
}
fn snapshot(root: &Path) -> Vec<(PathBuf, Vec<u8>)> {
    fn walk(base: &Path, path: &Path, out: &mut Vec<(PathBuf, Vec<u8>)>) {
        let mut entries = fs::read_dir(path)
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        entries.sort_by_key(std::fs::DirEntry::file_name);
        for entry in entries {
            if entry.file_type().unwrap().is_dir() {
                walk(base, &entry.path(), out);
            } else {
                out.push((
                    entry.path().strip_prefix(base).unwrap().to_owned(),
                    fs::read(entry.path()).unwrap(),
                ));
            }
        }
    }
    let mut out = Vec::new();
    walk(root, root, &mut out);
    out
}

#[test]
fn approved_import_reconstructs_owned_bytes_and_all_views() {
    let temp = Temp::new();
    let (registry, hash) = registry(&temp);
    let approval_path = temp.0.join("approval.json");
    let output = temp.0.join("output");
    approval(&approval_path, &hash, true, &output);
    let before_package = snapshot(&package());
    let before_registry = fs::read(registry.join("kb.json")).unwrap();
    let receipt = import_package(&package(), &registry, &approval_path, &output).unwrap();
    assert_eq!(receipt.authority, "owner_approved_local_copy");
    assert!(!receipt.network_used);
    assert!(!receipt.source_package_modified);
    assert!(!receipt.input_registry_modified);
    assert_eq!(snapshot(&package()), before_package);
    assert_eq!(fs::read(registry.join("kb.json")).unwrap(), before_registry);
    let kb = load_registry(&output).unwrap();
    assert_eq!(kb.packages.len(), 1);
    assert!(render_list(&kb).contains("Owned packages:"));
    assert!(render_tree(&kb).contains("Package:"));
    assert!(graph_source(&kb).contains("owns package bytes"));
    assert_eq!(
        snapshot(&package()),
        snapshot(&output.join(&receipt.owned_package_path))
    );
}

#[test]
fn every_rejection_is_prewrite_and_duplicate_is_explicit() {
    let temp = Temp::new();
    let (registry, hash) = registry(&temp);
    let approval_path = temp.0.join("approval.json");
    for (label, approved, pin) in [
        ("denied", false, hash.clone()),
        ("stale", true, "0".repeat(64)),
    ] {
        let output = temp.0.join(label);
        approval(&approval_path, &pin, approved, &output);
        assert!(import_package(&package(), &registry, &approval_path, &output).is_err());
        assert!(!output.exists());
    }
    let first = temp.0.join("first");
    approval(&approval_path, &hash, true, &first);
    import_package(&package(), &registry, &approval_path, &first).unwrap();
    let first_hash = sha(&fs::read(first.join("kb.json")).unwrap());
    let duplicate = temp.0.join("duplicate");
    approval(&approval_path, &first_hash, true, &duplicate);
    let error = import_package(&package(), &first, &approval_path, &duplicate).unwrap_err();
    assert!(error.contains("exact package duplicate"));
    assert!(!duplicate.exists());
    let existing = temp.0.join("existing");
    fs::create_dir(&existing).unwrap();
    approval(&approval_path, &hash, true, &existing);
    let error = import_package(&package(), &registry, &approval_path, &existing).unwrap_err();
    assert!(error.contains("already exists"));
    let nested = registry.join("nested-output");
    approval(&approval_path, &hash, true, &nested);
    let error = import_package(&package(), &registry, &approval_path, &nested).unwrap_err();
    assert!(error.contains("must not be inside"));
    assert!(!nested.exists());
}

#[test]
fn malformed_or_noncanonical_approval_timestamps_are_rejected_before_writes() {
    let temp = Temp::new();
    let (registry, hash) = registry(&temp);
    let approval_path = temp.0.join("approval.json");
    for (index, timestamp) in [
        "garbageTZ",
        "2026-9-03T05:00:00Z",
        "2026-09-03T05:00:00+00:00",
        "2026-02-29T05:00:00Z",
        "2026-09-03T24:00:00Z",
    ]
    .into_iter()
    .enumerate()
    {
        let output = temp.0.join(format!("invalid-time-{index}"));
        approval(&approval_path, &hash, true, &output);
        let mut manifest: serde_json::Value =
            serde_json::from_slice(&fs::read(&approval_path).unwrap()).unwrap();
        manifest["approved_at"] = timestamp.into();
        fs::write(&approval_path, serde_json::to_vec(&manifest).unwrap()).unwrap();
        let error = import_package(&package(), &registry, &approval_path, &output).unwrap_err();
        assert!(error.contains("canonical UTC"));
        assert!(!output.exists());
    }
}

#[cfg(unix)]
#[test]
fn symlink_approval_and_tampered_package_are_rejected_without_output() {
    use std::os::unix::fs::symlink;
    let temp = Temp::new();
    let (registry, hash) = registry(&temp);
    let real = temp.0.join("approval.json");
    let output = temp.0.join("linked");
    approval(&real, &hash, true, &output);
    let link = temp.0.join("approval-link.json");
    symlink(&real, &link).unwrap();
    assert!(
        import_package(&package(), &registry, &link, &output)
            .unwrap_err()
            .contains("non-symlink")
    );
    assert!(!output.exists());
    let damaged = temp.0.join("damaged");
    fs::create_dir(&damaged).unwrap();
    for entry in fs::read_dir(package()).unwrap() {
        let entry = entry.unwrap();
        fs::copy(entry.path(), damaged.join(entry.file_name())).unwrap();
    }
    fs::write(damaged.join("overview.md"), b"tampered").unwrap();
    let output = temp.0.join("tampered");
    approval(&real, &hash, true, &output);
    assert!(import_package(&damaged, &registry, &real, &output).is_err());
    assert!(!output.exists());
}
