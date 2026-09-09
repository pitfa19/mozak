use mozak_core::knowledge_package::{
    ArtifactKind, KnowledgePackageManifest, PackageArtifact, PackageReference,
    ValidatedKnowledgePackage, canonical_manifest_bytes, load_knowledge_package, package_identity,
};
use mozak_core::project_release::ProjectRelease;
use sha2::{Digest, Sha256};
use std::fs;
use std::fs::File;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT: AtomicU64 = AtomicU64::new(0);
fn binary() -> &'static str {
    env!("CARGO_BIN_EXE_mozak")
}
fn fixture() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../spec/project-framework/fixtures/pf-0015/canonical")
}
fn snapshot(root: &Path) -> Vec<(String, Vec<u8>)> {
    let mut files = fs::read_dir(root)
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| p.is_file())
        .map(|p| {
            (
                p.file_name().unwrap().to_string_lossy().into_owned(),
                fs::read(p).unwrap(),
            )
        })
        .collect::<Vec<_>>();
    files.sort_by(|a, b| a.0.cmp(&b.0));
    files
}
fn copy_fixture() -> PathBuf {
    let root = std::env::temp_dir().join(format!(
        "mozak-cli-package-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir(&root).unwrap();
    for entry in fs::read_dir(fixture()).unwrap() {
        let entry = entry.unwrap();
        fs::copy(entry.path(), root.join(entry.file_name())).unwrap();
    }
    root
}

fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn build_package(
    root: &Path,
    project_id: &str,
    release_id: &str,
    version: u64,
    predecessor: Option<&ValidatedKnowledgePackage>,
    restores: Option<&ValidatedKnowledgePackage>,
) -> ValidatedKnowledgePackage {
    fs::create_dir_all(root).unwrap();
    let mut release: ProjectRelease = serde_json::from_str(include_str!(
        "../../../spec/project-framework/fixtures/pf-0007/canonical-release.json"
    ))
    .unwrap();
    release.project.id = project_id.into();
    release.release_id = release_id.into();
    release.accepted_state_version = version;
    if let Some(restored) = restores {
        release
            .accepted_state_sha256
            .clone_from(&restored.release.accepted_state_sha256);
    }
    let release_bytes = serde_json::to_vec(&release).unwrap();
    let overview = format!("# {release_id}\n\nPublic overview.\n").into_bytes();
    fs::write(root.join("release.json"), &release_bytes).unwrap();
    fs::write(root.join("overview.md"), &overview).unwrap();
    let reference = |package: &ValidatedKnowledgePackage| PackageReference {
        project_id: package.manifest.project_id.clone(),
        release_id: package.manifest.release_id.clone(),
        package_id: package.manifest.package_id.clone(),
    };
    let mut manifest = KnowledgePackageManifest {
        schema_version: 1,
        package_id: format!("sha256:{}", "0".repeat(64)),
        project_id: project_id.into(),
        release_id: release_id.into(),
        predecessor: predecessor.map(reference),
        restores: restores.map(reference),
        artifacts: vec![
            PackageArtifact {
                kind: ArtifactKind::HumanOverview,
                path: "overview.md".into(),
                media_type: "text/markdown; charset=utf-8".into(),
                sha256: hash(&overview),
                bytes: overview.len() as u64,
            },
            PackageArtifact {
                kind: ArtifactKind::ProjectRelease,
                path: "release.json".into(),
                media_type: "application/vnd.mozak.project-release+json".into(),
                sha256: hash(&release_bytes),
                bytes: release_bytes.len() as u64,
            },
        ],
    };
    manifest.package_id = package_identity(&manifest).unwrap();
    fs::write(
        root.join("mozak-package.json"),
        canonical_manifest_bytes(&manifest).unwrap(),
    )
    .unwrap();
    load_knowledge_package(root).unwrap()
}

fn rewrite_manifest(root: &Path, edit: impl FnOnce(&mut KnowledgePackageManifest)) {
    let path = root.join("mozak-package.json");
    let mut manifest: KnowledgePackageManifest =
        serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    edit(&mut manifest);
    manifest.package_id = package_identity(&manifest).unwrap();
    fs::write(path, canonical_manifest_bytes(&manifest).unwrap()).unwrap();
}

#[test]
fn validate_list_and_history_are_exact_deterministic_and_read_only() {
    let root = fixture();
    let before = snapshot(&root);
    for args in [
        ["package", "validate", root.to_str().unwrap()],
        ["package", "list", root.to_str().unwrap()],
    ] {
        let first = Command::new(binary()).args(args).output().unwrap();
        let second = Command::new(binary()).args(args).output().unwrap();
        assert!(first.status.success());
        assert_eq!(first.stdout, second.stdout);
        assert!(first.stderr.is_empty());
        let value: serde_json::Value = serde_json::from_slice(&first.stdout).unwrap();
        assert_eq!(value["schema_version"], 1);
    }
    let history = Command::new(binary())
        .args(["package", "history", "validate", root.to_str().unwrap()])
        .output()
        .unwrap();
    assert!(history.status.success());
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&history.stdout).unwrap()["package_count"],
        1
    );
    assert_eq!(before, snapshot(&root));
}

#[test]
fn contract_failures_are_nonzero_with_no_success_stdout_and_no_mutation() {
    let root = copy_fixture();
    fs::write(root.join("overview.md"), "tampered").unwrap();
    let before = snapshot(&root);
    for args in [["package", "validate"], ["package", "list"]] {
        let output = Command::new(binary())
            .args(args)
            .arg(&root)
            .output()
            .unwrap();
        assert!(!output.status.success());
        assert!(output.stdout.is_empty());
        assert!(!output.stderr.is_empty());
    }
    let history = Command::new(binary())
        .args(["package", "history", "validate"])
        .arg(&root)
        .output()
        .unwrap();
    assert!(!history.status.success());
    assert!(history.stdout.is_empty());
    assert_eq!(before, snapshot(&root));
    let _ = fs::remove_dir_all(root);
}

#[cfg(unix)]
#[test]
fn public_cli_rejects_symlinks_and_unsafe_manifest_paths() {
    use std::os::unix::fs::symlink;
    let root = copy_fixture();
    fs::rename(root.join("overview.md"), root.join("real.md")).unwrap();
    symlink("real.md", root.join("overview.md")).unwrap();
    let output = Command::new(binary())
        .args(["package", "validate"])
        .arg(&root)
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(output.stdout.is_empty());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn public_cli_rejects_unlisted_small_large_and_nested_files() {
    for setup in [
        |root: &Path| fs::write(root.join("unlisted.txt"), b"small").unwrap(),
        |root: &Path| {
            let file = File::create(root.join("unlisted.bin")).unwrap();
            file.set_len(40 * 1024 * 1024).unwrap();
        },
        |root: &Path| {
            fs::create_dir(root.join("nested")).unwrap();
            fs::write(root.join("nested/unlisted.txt"), b"small").unwrap();
        },
    ] {
        let root = copy_fixture();
        setup(&root);
        let output = Command::new(binary())
            .args(["package", "validate"])
            .arg(&root)
            .output()
            .unwrap();
        assert!(!output.status.success());
        assert!(output.stdout.is_empty());
        let _ = fs::remove_dir_all(root);
    }
}

#[cfg(unix)]
#[test]
fn public_cli_rejects_unlisted_symlink_entries() {
    use std::os::unix::fs::symlink;
    let root = copy_fixture();
    symlink("overview.md", root.join("extra-link")).unwrap();
    let output = Command::new(binary())
        .args(["package", "validate"])
        .arg(&root)
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(output.stdout.is_empty());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn public_history_rejects_cross_project_tuple_hash_and_no_op_restore() {
    let root = std::env::temp_dir().join(format!(
        "mozak-cli-history-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let first = build_package(&root.join("first"), "project-a", "r1", 1, None, None);
    let second = build_package(
        &root.join("second"),
        "project-a",
        "r2",
        2,
        Some(&first),
        None,
    );
    let other = build_package(&root.join("other"), "project-b", "x1", 1, None, None);
    let run = |paths: &[&Path]| {
        Command::new(binary())
            .args(["package", "history", "validate"])
            .args(paths)
            .output()
            .unwrap()
    };
    assert!(!run(&[&first.root, &other.root]).status.success());

    rewrite_manifest(&second.root, |manifest| {
        manifest.predecessor.as_mut().unwrap().release_id = "wrong-release".into();
    });
    assert!(!run(&[&first.root, &second.root]).status.success());
    rewrite_manifest(&second.root, |manifest| {
        let predecessor = manifest.predecessor.as_mut().unwrap();
        predecessor.release_id = first.manifest.release_id.clone();
        predecessor.package_id = format!("sha256:{}", "f".repeat(64));
    });
    assert!(!run(&[&first.root, &second.root]).status.success());

    let no_op = build_package(
        &root.join("no-op"),
        "project-a",
        "r2-no-op",
        2,
        Some(&first),
        Some(&first),
    );
    assert!(!run(&[&first.root, &no_op.root]).status.success());
    let _ = fs::remove_dir_all(root);
}
