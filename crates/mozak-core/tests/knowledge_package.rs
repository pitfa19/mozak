use mozak_core::knowledge_package::{
    ArtifactKind, KnowledgePackageManifest, MAX_ARTIFACT_BYTES, MAX_ARTIFACTS, PackageArtifact,
    PackageReference, ValidatedKnowledgePackage, canonical_manifest_bytes, load_knowledge_package,
    package_identity, validate_package_history,
};
use mozak_core::project_release::ProjectRelease;
use sha2::{Digest, Sha256};
use std::fs;
use std::fs::File;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT: AtomicU64 = AtomicU64::new(0);
struct Temp(PathBuf);
impl Temp {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "mozak-package-{}-{}",
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

fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn base_release() -> ProjectRelease {
    serde_json::from_str(include_str!(
        "../../../spec/project-framework/fixtures/pf-0007/canonical-release.json"
    ))
    .unwrap()
}
fn build(
    root: &Path,
    release_id: &str,
    version: u64,
    predecessor: Option<&ValidatedKnowledgePackage>,
    restores: Option<&ValidatedKnowledgePackage>,
    state_hash: Option<String>,
) -> ValidatedKnowledgePackage {
    fs::create_dir_all(root).unwrap();
    let mut release = base_release();
    release.release_id = release_id.into();
    release.accepted_state_version = version;
    if let Some(value) = state_hash {
        release.accepted_state_sha256 = value;
    }
    let release_bytes = serde_json::to_vec(&release).unwrap();
    let overview = format!("# {release_id}\n\nPublic overview.\n").into_bytes();
    fs::write(root.join("release.json"), &release_bytes).unwrap();
    fs::write(root.join("overview.md"), &overview).unwrap();
    let reference = |p: &ValidatedKnowledgePackage| PackageReference {
        project_id: p.manifest.project_id.clone(),
        release_id: p.manifest.release_id.clone(),
        package_id: p.manifest.package_id.clone(),
    };
    let mut manifest = KnowledgePackageManifest {
        schema_version: 1,
        package_id: format!("sha256:{}", "0".repeat(64)),
        project_id: release.project.id.clone(),
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
fn rewrite_manifest(root: &Path, edit: impl FnOnce(&mut serde_json::Value), recompute: bool) {
    let path = root.join("mozak-package.json");
    let mut value: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    edit(&mut value);
    if recompute {
        let mut manifest: KnowledgePackageManifest = serde_json::from_value(value.clone()).unwrap();
        manifest.package_id = package_identity(&manifest).unwrap();
        fs::write(path, canonical_manifest_bytes(&manifest).unwrap()).unwrap();
        return;
    }
    fs::write(path, serde_json::to_vec_pretty(&value).unwrap()).unwrap();
}

#[test]
fn canonical_package_validates_and_identity_is_deterministic() {
    let temp = Temp::new();
    let package = build(&temp.0, "release-1", 1, None, None, None);
    assert_eq!(
        package.manifest.package_id,
        package_identity(&package.manifest).unwrap()
    );
    let first = package.canonical_manifest_bytes;
    let second = load_knowledge_package(&temp.0)
        .unwrap()
        .canonical_manifest_bytes;
    assert_eq!(first, second);
}

#[test]
#[allow(clippy::too_many_lines, clippy::type_complexity)]
fn rejects_unknowns_identity_hash_media_binary_paths_duplicates_and_bounds() {
    let cases: Vec<(&str, Box<dyn Fn(&Temp)>)> = vec![
        (
            "unknown",
            Box::new(|t| {
                build(&t.0, "r", 1, None, None, None);
                rewrite_manifest(&t.0, |v| v["unknown"] = 1.into(), false);
            }),
        ),
        (
            "identity",
            Box::new(|t| {
                build(&t.0, "r", 1, None, None, None);
                rewrite_manifest(&t.0, |v| v["release_id"] = "other".into(), true);
            }),
        ),
        (
            "hash",
            Box::new(|t| {
                build(&t.0, "r", 1, None, None, None);
                fs::write(t.0.join("overview.md"), "tampered").unwrap();
            }),
        ),
        (
            "media",
            Box::new(|t| {
                build(&t.0, "r", 1, None, None, None);
                rewrite_manifest(
                    &t.0,
                    |v| v["artifacts"][0]["media_type"] = "text/plain".into(),
                    true,
                );
            }),
        ),
        (
            "binary",
            Box::new(|t| {
                build(&t.0, "r", 1, None, None, None);
                let bytes = [0xff, 0xfe];
                fs::write(t.0.join("overview.md"), bytes).unwrap();
                rewrite_manifest(
                    &t.0,
                    |v| {
                        v["artifacts"][0]["sha256"] = hash(&bytes).into();
                        v["artifacts"][0]["bytes"] = 2.into();
                    },
                    true,
                );
            }),
        ),
        (
            "unsafe",
            Box::new(|t| {
                build(&t.0, "r", 1, None, None, None);
                rewrite_manifest(
                    &t.0,
                    |v| v["artifacts"][0]["path"] = "../overview.md".into(),
                    true,
                );
            }),
        ),
        (
            "duplicate",
            Box::new(|t| {
                build(&t.0, "r", 1, None, None, None);
                rewrite_manifest(
                    &t.0,
                    |v| {
                        let item = v["artifacts"][0].clone();
                        v["artifacts"].as_array_mut().unwrap().push(item);
                    },
                    true,
                );
            }),
        ),
        (
            "count",
            Box::new(|t| {
                build(&t.0, "r", 1, None, None, None);
                rewrite_manifest(
                    &t.0,
                    |v| {
                        let item = v["artifacts"][0].clone();
                        while v["artifacts"].as_array().unwrap().len() <= MAX_ARTIFACTS {
                            v["artifacts"].as_array_mut().unwrap().push(item.clone());
                        }
                    },
                    true,
                );
            }),
        ),
        (
            "size",
            Box::new(|t| {
                build(&t.0, "r", 1, None, None, None);
                rewrite_manifest(
                    &t.0,
                    |v| v["artifacts"][0]["bytes"] = (MAX_ARTIFACT_BYTES + 1).into(),
                    true,
                );
            }),
        ),
    ];
    for (name, setup) in cases {
        let temp = Temp::new();
        setup(&temp);
        assert!(load_knowledge_package(&temp.0).is_err(), "{name}");
    }
}

#[cfg(unix)]
#[test]
fn rejects_symlink_artifact_and_casefold_collision() {
    use std::os::unix::fs::symlink;
    let temp = Temp::new();
    build(&temp.0, "r", 1, None, None, None);
    fs::rename(temp.0.join("overview.md"), temp.0.join("real.md")).unwrap();
    symlink("real.md", temp.0.join("overview.md")).unwrap();
    assert!(load_knowledge_package(&temp.0).is_err());
    let temp = Temp::new();
    build(&temp.0, "r", 1, None, None, None);
    fs::write(temp.0.join("Overview.md"), "x").unwrap();
    rewrite_manifest(
        &temp.0,
        |v| {
            let mut item = v["artifacts"][0].clone();
            item["path"] = "Overview.md".into();
            item["sha256"] = hash(b"x").into();
            item["bytes"] = 1.into();
            item["kind"] = "research_markdown".into();
            v["artifacts"].as_array_mut().unwrap().push(item);
        },
        true,
    );
    assert!(load_knowledge_package(&temp.0).is_err());
}

#[test]
fn rejects_unlisted_small_large_nested_and_empty_directory_entries() {
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
        |root: &Path| fs::create_dir(root.join("empty")).unwrap(),
    ] {
        let temp = Temp::new();
        build(&temp.0, "r", 1, None, None, None);
        setup(&temp.0);
        assert!(load_knowledge_package(&temp.0).is_err());
    }
}

#[test]
fn rejects_declared_files_exceeding_manifest_inclusive_package_limit() {
    let temp = Temp::new();
    build(&temp.0, "r", 1, None, None, None);
    let bytes = vec![0_u8; usize::try_from(MAX_ARTIFACT_BYTES).unwrap()];
    let digest = hash(&bytes);
    for index in 0..4 {
        fs::write(temp.0.join(format!("research-{index}.md")), &bytes).unwrap();
    }
    rewrite_manifest(
        &temp.0,
        |value| {
            for index in 0..4 {
                value["artifacts"]
                    .as_array_mut()
                    .unwrap()
                    .push(serde_json::json!({
                        "kind": "research_markdown",
                        "path": format!("research-{index}.md"),
                        "media_type": "text/markdown; charset=utf-8",
                        "sha256": digest.clone(),
                        "bytes": MAX_ARTIFACT_BYTES
                    }));
            }
        },
        true,
    );
    assert!(load_knowledge_package(&temp.0).is_err());
}

#[cfg(unix)]
#[test]
fn rejects_unlisted_symlink_entry_anywhere_in_package() {
    use std::os::unix::fs::symlink;
    let temp = Temp::new();
    build(&temp.0, "r", 1, None, None, None);
    symlink("overview.md", temp.0.join("extra-link")).unwrap();
    assert!(load_knowledge_package(&temp.0).is_err());
}

#[test]
fn validates_linear_branch_and_rollback_without_selecting_a_head() {
    let temp = Temp::new();
    let root = build(&temp.0.join("root"), "r1", 1, None, None, None);
    let a = build(&temp.0.join("a"), "r2-a", 2, Some(&root), None, None);
    let b = build(&temp.0.join("b"), "r2-b", 2, Some(&root), None, None);
    let rollback = build(
        &temp.0.join("rollback"),
        "r3",
        3,
        Some(&a),
        Some(&root),
        Some(root.release.accepted_state_sha256.clone()),
    );
    validate_package_history(&[rollback, b, root, a]).unwrap();
}

#[test]
fn history_rejects_missing_links_cross_project_cycles_duplicates_gaps_regressions_and_bad_restore()
{
    let temp = Temp::new();
    let root = build(&temp.0.join("root"), "r1", 1, None, None, None);
    let gap = build(&temp.0.join("gap"), "r3", 3, Some(&root), None, None);
    assert!(validate_package_history(&[root.clone(), gap]).is_err());
    let duplicate = build(&temp.0.join("dup"), "r1", 1, None, None, None);
    assert!(validate_package_history(&[root.clone(), duplicate]).is_err());
    let missing = build(&temp.0.join("missing"), "r2", 2, Some(&root), None, None);
    assert!(validate_package_history(&[missing]).is_err());
    let branch = build(&temp.0.join("branch"), "r2b", 2, Some(&root), None, None);
    let unrelated = build(&temp.0.join("unrelated"), "rx", 1, None, None, None);
    let bad_restore = build(
        &temp.0.join("bad-restore"),
        "r3b",
        3,
        Some(&branch),
        Some(&unrelated),
        Some(unrelated.release.accepted_state_sha256.clone()),
    );
    assert!(validate_package_history(&[root, branch, unrelated, bad_restore]).is_err());
}

#[test]
fn history_rejects_cross_project_exact_reference_mismatches_cycles_and_self_restore() {
    let temp = Temp::new();
    let root = build(&temp.0.join("root"), "r1", 1, None, None, None);
    let successor = build(&temp.0.join("successor"), "r2", 2, Some(&root), None, None);

    let mut cross_project = successor.clone();
    cross_project.manifest.project_id = "other-project".into();
    assert!(validate_package_history(&[root.clone(), cross_project]).is_err());

    let mut tuple_mismatch = successor.clone();
    tuple_mismatch
        .manifest
        .predecessor
        .as_mut()
        .unwrap()
        .release_id = "wrong-release".into();
    assert!(validate_package_history(&[root.clone(), tuple_mismatch]).is_err());

    let mut hash_mismatch = successor.clone();
    hash_mismatch
        .manifest
        .predecessor
        .as_mut()
        .unwrap()
        .package_id = format!("sha256:{}", "f".repeat(64));
    assert!(validate_package_history(&[root.clone(), hash_mismatch]).is_err());

    let mut cyclic_root = root.clone();
    cyclic_root.manifest.predecessor = Some(PackageReference {
        project_id: successor.manifest.project_id.clone(),
        release_id: successor.manifest.release_id.clone(),
        package_id: successor.manifest.package_id.clone(),
    });
    assert!(validate_package_history(&[cyclic_root, successor.clone()]).is_err());

    let mut self_restore = successor.clone();
    self_restore.manifest.restores = self_restore.manifest.predecessor.clone();
    self_restore.release.accepted_state_sha256 = root.release.accepted_state_sha256.clone();
    assert!(validate_package_history(&[root, self_restore]).is_err());
}
