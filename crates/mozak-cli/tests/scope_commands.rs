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
        let p = std::env::temp_dir().join(format!(
            "mozak-scope-{label}-{}-{}",
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
fn sha(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn project_yaml(revision: &str) -> String {
    format!(
        "version: 1\nframework_contract_version: 1\nproject:\n  id: project-alpha\n  name: Alpha Project\nrepository:\n  revision: {revision}\nowned_paths:\n  - src\n"
    )
}
fn fixture() -> (Temp, Temp) {
    let scope = Temp::new("root");
    let source = Temp::new("source");
    let revision = "a".repeat(40);
    let project = project_yaml(&revision);
    fs::create_dir_all(scope.0.join(".mozak")).unwrap();
    fs::write(scope.0.join(".mozak/project.yml"), &project).unwrap();
    fs::create_dir_all(source.0.join(".mozak")).unwrap();
    fs::write(source.0.join(".mozak/project.yml"), &project).unwrap();
    let note = b"# Source note\nSee [[Missing Note|label]] and ![[asset.png]].\n";
    fs::create_dir_all(source.0.join("notes")).unwrap();
    fs::write(source.0.join("notes/source.md"), note).unwrap();
    let digest = sha(note);
    fs::create_dir_all(scope.0.join("objects/sha256")).unwrap();
    fs::write(scope.0.join(format!("objects/sha256/{digest}")), note).unwrap();
    let topic = serde_json::json!({"id":"topic-alpha","kind":"topic","title":"Alpha * Topic","intent":"Explore [bounded] question","history":[{"id":"history-1","at":"2026-09-02T08:00:00Z","note":"Captured question"}]});
    let topic_hash = sha(&serde_json::to_vec(&topic).unwrap());
    let binding = serde_json::json!({"manifest_path":".mozak/project.yml","manifest_sha256":sha(project.as_bytes()),"project_id":"project-alpha","repository_revision":revision,"owned_paths":["src"]});
    let input = serde_json::json!({"id":"note-alpha","scope_id":"topic-alpha","kind":"note","path":format!("objects/sha256/{digest}"),"sha256":digest,"media_type":"text/markdown","source":{"path":"notes/source.md","revision":"a".repeat(40),"sha256":sha(note)},"note_validation":{"wikilinks":["Missing Note"],"embeds":["asset.png"],"unresolved":["Missing Note","asset.png"]}});
    let mut alias = input.clone();
    alias["id"] = serde_json::json!("note-alias");
    alias["scope_id"] = serde_json::json!("project-alpha");
    let manifest = serde_json::json!({"schema_version":2,"scopes":[{"id":"project-alpha","kind":"project","title":"Alpha Project","intent":"Deliver bounded work","history":[],"project":binding},topic],"promotions":[{"id":"promotion-alpha","source_topic_id":"topic-alpha","target_project_id":"project-alpha","source_topic_sha256":topic_hash}],"meta_goals":[{"id":"goal-a","title":"Coordinate context","authority":"advisory_only","scope_ids":["topic-alpha","project-alpha"],"relationships":[]}],"inputs":[input,alias]});
    fs::write(
        scope.0.join("scope.json"),
        serde_json::to_vec_pretty(&manifest).unwrap(),
    )
    .unwrap();
    (scope, source)
}
fn run(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_mozak"))
        .args(args)
        .output()
        .unwrap()
}

fn ingest_fixture(note: &[u8]) -> (Temp, Temp, Temp, String, PathBuf) {
    let scope = Temp::new("hold-ingest-root");
    let source = Temp::new("hold-ingest-source");
    let parent = Temp::new("hold-ingest-output");
    let revision = "c".repeat(40);
    let note_hash = sha(note);
    let (wikilinks, embeds, unresolved) = if note == b"[[Target]] ![[asset.png]]\n" {
        (
            serde_json::json!(["Target"]),
            serde_json::json!(["asset.png"]),
            serde_json::json!(["Target", "asset.png"]),
        )
    } else {
        (
            serde_json::json!([]),
            serde_json::json!(["asset.png"]),
            serde_json::json!(["asset.png"]),
        )
    };
    fs::create_dir_all(scope.0.join("objects/sha256")).unwrap();
    fs::write(scope.0.join(format!("objects/sha256/{note_hash}")), note).unwrap();
    fs::write(
        scope.0.join("scope.json"),
        serde_json::to_vec_pretty(&serde_json::json!({
            "schema_version":2,
            "scopes":[{"id":"topic-one","kind":"topic","title":"One","intent":"Bounded","history":[{"id":"h-1","at":"2026-09-02T00:00:00Z","note":"Created"}]}],
            "promotions":[],"meta_goals":[],
            "inputs":[{"id":"source-note","scope_id":"topic-one","kind":"note","path":format!("objects/sha256/{note_hash}"),"sha256":note_hash,"media_type":"text/markdown","source":{"path":"source.md","revision":revision,"sha256":sha(note)},"note_validation":{"wikilinks":wikilinks,"embeds":embeds,"unresolved":unresolved}}]
        })).unwrap(),
    ).unwrap();
    fs::write(source.0.join("source.md"), note).unwrap();
    fs::write(source.0.join("Target.md"), b"# Target\n").unwrap();
    fs::write(source.0.join("asset.png"), b"PNG").unwrap();
    let plan_path = parent.0.join("plan.json");
    fs::write(&plan_path, serde_json::to_vec_pretty(&serde_json::json!({
        "schema_version":1,
        "scope_manifest_sha256":sha(&fs::read(scope.0.join("scope.json")).unwrap()),
        "observed_revision":revision,
        "scope_id":"topic-one",
        "history_entry":{"id":"h-2","at":"2026-09-03T00:00:00Z","note":"Ingested links"},
        "existing_source_input_ids":["source-note"],
        "inclusions":[
            {"input_id":"target","kind":"note","source_path":"Target.md","source_sha256":sha(b"# Target\n"),"media_type":"text/markdown"},
            {"input_id":"asset","kind":"attachment","source_path":"asset.png","source_sha256":sha(b"PNG"),"media_type":"image/png"}
        ]
    })).unwrap()).unwrap();
    (scope, source, parent, revision, plan_path)
}

fn run_ingest(scope: &Path, source: &Path, revision: &str, plan: &Path, output: &Path) -> Output {
    run(&[
        "scope",
        "ingest-links",
        scope.to_str().unwrap(),
        source.to_str().unwrap(),
        revision,
        plan.to_str().unwrap(),
        output.to_str().unwrap(),
    ])
}

#[test]
fn public_ingest_links_route_reconstructs_scope_and_prints_authority_receipt() {
    let scope = Temp::new("ingest-root");
    let source = Temp::new("ingest-source");
    let parent = Temp::new("ingest-output");
    let revision = "b".repeat(40);
    let note = b"[[Target]] ![[asset.png]]\n";
    let note_hash = sha(note);
    fs::create_dir_all(scope.0.join("objects/sha256")).unwrap();
    fs::write(scope.0.join(format!("objects/sha256/{note_hash}")), note).unwrap();
    fs::write(
        scope.0.join("scope.json"),
        serde_json::to_vec_pretty(&serde_json::json!({
            "schema_version":2,
            "scopes":[{"id":"topic-one","kind":"topic","title":"One","intent":"Bounded","history":[{"id":"h-1","at":"2026-09-02T00:00:00Z","note":"Created"}]}],
            "promotions":[],"meta_goals":[],
            "inputs":[{"id":"source-note","scope_id":"topic-one","kind":"note","path":format!("objects/sha256/{note_hash}"),"sha256":note_hash,"media_type":"text/markdown","source":{"path":"source.md","revision":revision,"sha256":sha(note)},"note_validation":{"wikilinks":["Target"],"embeds":["asset.png"],"unresolved":["Target","asset.png"]}}]
        })).unwrap(),
    ).unwrap();
    fs::write(source.0.join("source.md"), note).unwrap();
    fs::write(source.0.join("Target.md"), b"# Target\n").unwrap();
    fs::write(source.0.join("asset.png"), b"PNG").unwrap();
    let plan_path = parent.0.join("plan.json");
    fs::write(&plan_path, serde_json::to_vec_pretty(&serde_json::json!({
        "schema_version":1,
        "scope_manifest_sha256":sha(&fs::read(scope.0.join("scope.json")).unwrap()),
        "observed_revision":revision,
        "scope_id":"topic-one",
        "history_entry":{"id":"h-2","at":"2026-09-03T00:00:00Z","note":"Ingested links"},
        "existing_source_input_ids":["source-note"],
        "inclusions":[
            {"input_id":"target","kind":"note","source_path":"Target.md","source_sha256":sha(b"# Target\n"),"media_type":"text/markdown"},
            {"input_id":"asset","kind":"attachment","source_path":"asset.png","source_sha256":sha(b"PNG"),"media_type":"image/png"}
        ]
    })).unwrap()).unwrap();
    let output = parent.0.join("result");
    let result = run(&[
        "scope",
        "ingest-links",
        scope.0.to_str().unwrap(),
        source.0.to_str().unwrap(),
        &revision,
        plan_path.to_str().unwrap(),
        output.to_str().unwrap(),
    ]);
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    let receipt: serde_json::Value = serde_json::from_slice(&result.stdout).unwrap();
    assert_eq!(receipt["auto_discovery"], false);
    assert_eq!(receipt["authority"], "source_vault_remains_authoritative");
    assert_eq!(
        receipt["added_input_ids"],
        serde_json::json!(["target", "asset"])
    );
    assert!(
        run(&["scope", "validate", output.to_str().unwrap()])
            .status
            .success()
    );
}

#[test]
fn public_ingest_links_rejects_hold_findings_without_writes() {
    for note in [
        b"[[]] ![[asset.png]]\n".as_slice(),
        b"[[   ]] ![[asset.png]]\n",
    ] {
        let (scope, source, parent, revision, plan) = ingest_fixture(note);
        let output = parent.0.join("result");
        assert!(
            !run_ingest(&scope.0, &source.0, &revision, &plan, &output)
                .status
                .success()
        );
        assert!(!output.exists());
    }

    let (scope, source, _parent, revision, plan) = ingest_fixture(b"[[Target]] ![[asset.png]]\n");
    for output in [scope.0.join("result"), source.0.join("result")] {
        assert!(
            !run_ingest(&scope.0, &source.0, &revision, &plan, &output)
                .status
                .success()
        );
        assert!(!output.exists());
    }

    let (scope, source, parent, revision, plan) = ingest_fixture(b"[[Target]] ![[asset.png]]\n");
    let mut value: serde_json::Value = serde_json::from_slice(&fs::read(&plan).unwrap()).unwrap();
    value["inclusions"][0]["source_path"] = serde_json::json!("Tárget.md");
    fs::write(&plan, serde_json::to_vec(&value).unwrap()).unwrap();
    let output = parent.0.join("result");
    assert!(
        !run_ingest(&scope.0, &source.0, &revision, &plan, &output)
            .status
            .success()
    );
    assert!(!output.exists());
}

#[cfg(unix)]
#[test]
fn public_ingest_links_treats_dangling_output_paths_as_existing() {
    use std::os::unix::fs::symlink;

    for target in ["output", "stage"] {
        let (scope, source, parent, revision, plan) =
            ingest_fixture(b"[[Target]] ![[asset.png]]\n");
        let output = parent.0.join("result");
        let occupied = if target == "output" {
            output.clone()
        } else {
            parent.0.join(".result.mozak-stage")
        };
        symlink(parent.0.join("missing"), &occupied).unwrap();
        assert!(
            !run_ingest(&scope.0, &source.0, &revision, &plan, &output)
                .status
                .success()
        );
        assert!(
            fs::symlink_metadata(occupied)
                .unwrap()
                .file_type()
                .is_symlink()
        );
    }
}
fn mutate(root: &Path, f: impl FnOnce(&mut serde_json::Value)) {
    let p = root.join("scope.json");
    let mut v: serde_json::Value = serde_json::from_slice(&fs::read(&p).unwrap()).unwrap();
    f(&mut v);
    fs::write(p, serde_json::to_vec(&v).unwrap()).unwrap();
}
fn promote_hash(v: &mut serde_json::Value) {
    v["promotions"][0]["source_topic_sha256"] =
        serde_json::json!(sha(&serde_json::to_vec(&v["scopes"][1]).unwrap()));
}

#[test]
fn public_routes_validate_snapshot_export_safely_and_check_freshness() {
    let (scope, source) = fixture();
    let before = fs::read(scope.0.join("scope.json")).unwrap();
    let root = scope.0.to_str().unwrap();
    let src = source.0.to_str().unwrap();
    let validate = run(&["scope", "validate", root]);
    assert!(
        validate.status.success(),
        "{}",
        String::from_utf8_lossy(&validate.stderr)
    );
    let value: serde_json::Value = serde_json::from_slice(&validate.stdout).unwrap();
    assert_eq!(value["validity"], "snapshot_valid");
    assert_eq!(value["freshness_checked"], false);
    assert_eq!(value["input_count"], 2);
    let list = run(&["scope", "list", root]);
    assert!(list.status.success());
    assert!(String::from_utf8_lossy(&list.stdout).contains("Alpha * Topic"));
    let graph = run(&["scope", "graph-source", root]);
    assert!(graph.status.success());
    assert!(!String::from_utf8_lossy(&graph.stdout).contains("Alpha * Topic"));
    let export = run(&["scope", "export", root]);
    let md = String::from_utf8(export.stdout).unwrap();
    assert!(md.contains("Alpha \\* Topic"));
    assert!(md.contains("unresolved: `Missing Note`, `asset.png`"));
    let fresh = run(&[
        "scope",
        "source-check",
        root,
        "note-alpha",
        src,
        &"a".repeat(40),
    ]);
    assert!(
        fresh.status.success(),
        "{}",
        String::from_utf8_lossy(&fresh.stderr)
    );
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&fresh.stdout).unwrap()["fresh"],
        true
    );
    fs::write(source.0.join("notes/source.md"), "drift").unwrap();
    let stale = run(&[
        "scope",
        "source-check",
        root,
        "note-alpha",
        src,
        &"a".repeat(40),
    ]);
    assert_eq!(stale.status.code(), Some(2));
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&stale.stdout).unwrap()["fresh"],
        false
    );
    assert_eq!(fs::read(scope.0.join("scope.json")).unwrap(), before);
}

#[test]
fn adversarial_contracts_fail_closed() {
    type M = (&'static str, Box<dyn Fn(&mut serde_json::Value)>);
    let cases: Vec<M> = vec![
        (
            "empty scopes",
            Box::new(|v| v["scopes"] = serde_json::json!([])),
        ),
        (
            "empty goal",
            Box::new(|v| v["meta_goals"][0]["scope_ids"] = serde_json::json!([])),
        ),
        (
            "absolute source",
            Box::new(|v| v["inputs"][0]["source"]["path"] = serde_json::json!("/etc/passwd")),
        ),
        (
            "opaque source",
            Box::new(|v| {
                v["inputs"][0]["source"]["path"] = serde_json::json!("https://example.test/x");
            }),
        ),
        (
            "backslash",
            Box::new(|v| v["inputs"][0]["source"]["path"] = serde_json::json!("notes\\source.md")),
        ),
        (
            "nonsense timestamp",
            Box::new(|v| v["scopes"][1]["history"][0]["at"] = serde_json::json!("yesterday")),
        ),
        (
            "duplicate timestamps",
            Box::new(|v| {
                let h = v["scopes"][1]["history"][0].clone();
                v["scopes"][1]["history"].as_array_mut().unwrap().push(h);
                promote_hash(v);
            }),
        ),
        (
            "topic mutation",
            Box::new(|v| v["scopes"][1]["intent"] = serde_json::json!("mutated")),
        ),
        (
            "newline title",
            Box::new(|v| v["scopes"][1]["title"] = serde_json::json!("bad\nline")),
        ),
        (
            "ansi intent",
            Box::new(|v| v["scopes"][1]["intent"] = serde_json::json!("bad\u{1b}[31m")),
        ),
        (
            "mismatch binding",
            Box::new(|v| v["scopes"][0]["project"]["project_id"] = serde_json::json!("other")),
        ),
        (
            "non digest path",
            Box::new(|v| v["inputs"][0]["path"] = serde_json::json!("objects/SHA256/hash")),
        ),
        (
            "bad note metadata",
            Box::new(|v| v["inputs"][0]["note_validation"]["unresolved"] = serde_json::json!([])),
        ),
    ];
    for (label, change) in cases {
        let (scope, _source) = fixture();
        mutate(&scope.0, change);
        let out = run(&["scope", "validate", scope.0.to_str().unwrap()]);
        assert!(!out.status.success(), "accepted {label}");
        assert!(out.stdout.is_empty(), "stdout for {label}");
    }
}

#[test]
fn source_check_rejects_unsafe_source_and_revision_drift() {
    let (scope, source) = fixture();
    let root = scope.0.to_str().unwrap();
    let src = source.0.to_str().unwrap();
    let drift = run(&[
        "scope",
        "source-check",
        root,
        "note-alpha",
        src,
        &"b".repeat(40),
    ]);
    assert_eq!(drift.status.code(), Some(2));
    mutate(&scope.0, |v| {
        v["inputs"][0]["source"]["path"] = serde_json::json!("../secret");
    });
    let unsafe_out = run(&[
        "scope",
        "source-check",
        root,
        "note-alpha",
        src,
        &"a".repeat(40),
    ]);
    assert!(!unsafe_out.status.success());
    assert!(unsafe_out.stdout.is_empty());

    let (scope, source) = fixture();
    let invalid_revision = run(&[
        "scope",
        "source-check",
        scope.0.to_str().unwrap(),
        "note-alpha",
        source.0.to_str().unwrap(),
        "not-a-git-revision",
    ]);
    assert!(!invalid_revision.status.success());
    assert!(invalid_revision.stdout.is_empty());
}

#[test]
fn project_binding_supports_a_project_scoped_manifest_path() {
    let (scope, _source) = fixture();
    let old = scope.0.join(".mozak/project.yml");
    let new = scope.0.join("projects/project-alpha/.mozak/project.yml");
    fs::create_dir_all(new.parent().unwrap()).unwrap();
    fs::rename(old, &new).unwrap();
    mutate(&scope.0, |v| {
        v["scopes"][0]["project"]["manifest_path"] =
            serde_json::json!("projects/project-alpha/.mozak/project.yml");
    });

    let valid = run(&["scope", "validate", scope.0.to_str().unwrap()]);
    assert!(
        valid.status.success(),
        "{}",
        String::from_utf8_lossy(&valid.stderr)
    );

    mutate(&scope.0, |v| {
        v["scopes"][0]["project"]["manifest_path"] =
            serde_json::json!("projects/other/.mozak/project.yml");
    });
    let wrong_identity_path = run(&["scope", "validate", scope.0.to_str().unwrap()]);
    assert!(!wrong_identity_path.status.success());
    assert!(wrong_identity_path.stdout.is_empty());
}

/// Every scope view must report owned Concepts, not just the KB tree.
#[test]
fn scope_views_report_owned_concepts() {
    let temp = Temp::new("scope-concepts");
    let root = temp.0.join("scope");
    fs::create_dir_all(root.join("concepts")).unwrap();
    let concept = fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../mozak-core/tests/fixtures/concept/publish-as-commit.json"),
    )
    .unwrap();
    fs::write(root.join("concepts/c.json"), &concept).unwrap();
    let digest = format!("{:x}", Sha256::digest(concept.as_bytes()));
    fs::write(
        root.join("scope.json"),
        serde_json::to_vec_pretty(&serde_json::json!({
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
        }))
        .unwrap(),
    )
    .unwrap();

    let validated = run(&["scope", "validate", root.to_str().unwrap()]);
    assert!(validated.status.success());
    let value: serde_json::Value = serde_json::from_slice(&validated.stdout).unwrap();
    assert_eq!(value["concept_count"], 1);

    let listed = run(&["scope", "list", root.to_str().unwrap()]);
    let text = String::from_utf8_lossy(&listed.stdout);
    assert!(
        text.contains("concept-publish-as-commit [advisory] owned by example-gamma"),
        "{text}"
    );

    let source = run(&["scope", "graph-source", root.to_str().unwrap()]);
    let graph = String::from_utf8_lossy(&source.stdout);
    assert!(graph.contains("|authors|"), "{graph}");
}

#[test]
fn scope_init_creates_a_valid_topic_and_never_overwrites() {
    let home = Temp::new("init");
    let root = home.0.join("topic");
    let out = run(&[
        "scope",
        "init",
        root.to_str().unwrap(),
        "topic-rust-async",
        "Rust async runtimes",
        "Track how async runtimes trade off latency and complexity.",
    ]);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let value: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(value["state"], "valid");
    assert_eq!(value["scope_id"], "topic-rust-async");
    assert_eq!(value["kind"], "topic");

    // The freshly created Scope must pass the ordinary validator.
    let validated = run(&["scope", "validate", root.to_str().unwrap()]);
    assert!(validated.status.success());
    let report: serde_json::Value = serde_json::from_slice(&validated.stdout).unwrap();
    assert_eq!(report["scope_count"], 1);

    // A new Topic carries no accepted evidence.
    let manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(root.join("scope.json")).unwrap()).unwrap();
    assert_eq!(manifest["schema_version"], 2);
    assert!(manifest["inputs"].as_array().unwrap().is_empty());
    assert!(manifest["promotions"].as_array().unwrap().is_empty());
    assert_eq!(
        manifest["scopes"][0]["history"].as_array().unwrap().len(),
        1
    );

    // Create-only: a second init must refuse rather than clobber.
    let again = run(&[
        "scope",
        "init",
        root.to_str().unwrap(),
        "topic-other",
        "Other",
        "Other intent.",
    ]);
    assert!(!again.status.success());
    assert!(
        String::from_utf8_lossy(&again.stderr).contains("refusing to overwrite"),
        "{}",
        String::from_utf8_lossy(&again.stderr)
    );
}

#[test]
fn scope_init_rejects_invalid_identity_and_text() {
    let home = Temp::new("init-bad");
    for (id, title, intent) in [
        ("-leading-dash", "Title", "Intent."),
        ("has space", "Title", "Intent."),
        ("topic-ok", "", "Intent."),
        ("topic-ok", "Title", "  "),
    ] {
        let root = home.0.join(format!("s{id}{title}"));
        let out = run(&["scope", "init", root.to_str().unwrap(), id, title, intent]);
        assert!(
            !out.status.success(),
            "accepted invalid input: {id:?} {title:?}"
        );
    }
}

/// Builds a real repository carrying a valid MOZAK project.
fn project_repo(root: &Path) {
    fs::create_dir_all(root).unwrap();
    let status = Command::new("git")
        .args(["init", "-q", "."])
        .current_dir(root)
        .status()
        .unwrap();
    assert!(status.success());
    fs::write(root.join("README.md"), b"demo\n").unwrap();
    for args in [
        vec!["config", "user.email", "test@example.com"],
        vec!["config", "user.name", "Test"],
        vec!["add", "-A"],
        vec!["commit", "-qm", "init"],
    ] {
        Command::new("git")
            .args(&args)
            .current_dir(root)
            .status()
            .unwrap();
    }
    let out = Command::new(env!("CARGO_BIN_EXE_mozak"))
        .args(["project", "init", "."])
        .current_dir(root)
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
}

#[test]
fn scope_authoring_builds_a_multi_scope_root_with_a_meta_goal() {
    let temp = Temp::new("authoring");
    let root = temp.0.join("family");
    let repo = temp.0.join("repos/app-one");
    project_repo(&repo);

    let out = run(&[
        "scope",
        "init",
        root.to_str().unwrap(),
        "topic-family",
        "Family research",
        "Shared research for the app family.",
    ]);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );

    // A second entry joins the same root.
    let out = run(&[
        "scope",
        "add-topic",
        root.to_str().unwrap(),
        "topic-shared-ui",
        "Shared UI",
        "Track reused UI patterns.",
    ]);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let value: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(value["scope_count"], 2);
    // Changing scope.json must tell the owner to re-pin a registered KB.
    assert!(value["next"].as_str().unwrap().contains("project refresh"));

    // A project entry binds a real repository.
    let out = run(&[
        "scope",
        "add-project",
        root.to_str().unwrap(),
        "app-one",
        "App One",
        "First app.",
        repo.to_str().unwrap(),
    ]);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let value: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(value["scope_count"], 3);
    assert_eq!(
        value["bound_manifest"],
        "projects/app-one/.mozak/project.yml"
    );

    // The Scope keeps a byte-identical copy, so it verifies on its own.
    let copied = root.join("projects/app-one/.mozak/project.yml");
    assert_eq!(
        fs::read(&copied).unwrap(),
        fs::read(repo.join(".mozak/project.yml")).unwrap()
    );

    // A Meta Goal groups them and stays advisory.
    let out = run(&[
        "scope",
        "add-goal",
        root.to_str().unwrap(),
        "meta-goal-family",
        "Coordinate the app family",
        "app-one",
        "topic-shared-ui",
    ]);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let value: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(value["authority"], "advisory_only");
    assert_eq!(value["meta_goal_count"], 1);

    let validated = run(&["scope", "validate", root.to_str().unwrap()]);
    assert!(validated.status.success());
    let report: serde_json::Value = serde_json::from_slice(&validated.stdout).unwrap();
    assert_eq!(report["scope_count"], 3);
    assert_eq!(report["meta_goal_count"], 1);

    // The bound manifest is hash-pinned: drift must fail closed.
    let mut drifted = fs::read(&copied).unwrap();
    drifted.extend_from_slice(b"\n# drift\n");
    fs::write(&copied, drifted).unwrap();
    let out = run(&["scope", "validate", root.to_str().unwrap()]);
    assert!(!out.status.success());
    assert!(
        String::from_utf8_lossy(&out.stderr).contains("project manifest hash mismatch"),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
}

#[test]
fn scope_authoring_fails_closed_without_partial_state() {
    let temp = Temp::new("authoring-bad");
    let root = temp.0.join("family");
    let repo = temp.0.join("repos/app-one");
    project_repo(&repo);
    run(&[
        "scope",
        "init",
        root.to_str().unwrap(),
        "topic-family",
        "Family",
        "Family intent.",
    ]);
    let before = fs::read(root.join("scope.json")).unwrap();

    // Duplicate entry, unknown goal target, and identity mismatch are refused.
    for args in [
        vec![
            "scope",
            "add-topic",
            root.to_str().unwrap(),
            "topic-family",
            "Dup",
            "Dup.",
        ],
        vec![
            "scope",
            "add-goal",
            root.to_str().unwrap(),
            "goal-x",
            "X",
            "not-present",
        ],
        vec![
            "scope",
            "add-project",
            root.to_str().unwrap(),
            "wrong-id",
            "W",
            "W.",
            repo.to_str().unwrap(),
        ],
    ] {
        let out = run(&args);
        assert!(!out.status.success(), "accepted invalid input: {args:?}");
    }

    // Nothing was written by any failed route.
    assert_eq!(before, fs::read(root.join("scope.json")).unwrap());
    assert!(
        !root.join("projects/wrong-id").exists(),
        "a failed add-project left a manifest copy behind"
    );
}

#[test]
fn scope_authoring_rolls_back_when_core_validation_rejects_the_result() {
    // An empty title passes the authoring guards but fails the manifest
    // validator, so this exercises the rollback path specifically.
    let temp = Temp::new("authoring-rollback");
    let root = temp.0.join("family");
    run(&[
        "scope",
        "init",
        root.to_str().unwrap(),
        "topic-family",
        "Family",
        "Family intent.",
    ]);
    let before = fs::read(root.join("scope.json")).unwrap();

    let out = run(&[
        "scope",
        "add-topic",
        root.to_str().unwrap(),
        "topic-empty",
        "",
        "Intent.",
    ]);
    assert!(!out.status.success());
    assert!(
        String::from_utf8_lossy(&out.stderr).contains("invalid scope title"),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert_eq!(
        before,
        fs::read(root.join("scope.json")).unwrap(),
        "a rejected manifest was not rolled back"
    );

    // The root must still be usable.
    let validated = run(&["scope", "validate", root.to_str().unwrap()]);
    assert!(validated.status.success());
}

#[test]
fn scope_init_rolls_back_and_leaves_no_file_when_validation_fails() {
    let temp = Temp::new("init-rollback");
    let root = temp.0.join("fresh");
    let out = run(&[
        "scope",
        "init",
        root.to_str().unwrap(),
        "topic-ok",
        "Title",
        "",
    ]);
    assert!(!out.status.success());
    assert!(
        !root.join("scope.json").exists(),
        "a failed init left a partial manifest behind"
    );
}

#[test]
fn failed_add_project_leaves_no_copied_manifest_or_empty_directories() {
    let temp = Temp::new("authoring-orphan");
    let root = temp.0.join("family");
    let repo = temp.0.join("repos/app");
    project_repo(&repo);
    run(&[
        "scope",
        "init",
        root.to_str().unwrap(),
        "topic-family",
        "Family",
        "Family intent.",
    ]);

    // An empty title passes every authoring guard and fails in validation,
    // which is the only path that can orphan the copied manifest.
    let out = run(&[
        "scope",
        "add-project",
        root.to_str().unwrap(),
        "app",
        "",
        "Intent.",
        repo.to_str().unwrap(),
    ]);
    assert!(!out.status.success());

    assert!(
        !root.join("projects").exists(),
        "a failed add-project left directories behind: {:?}",
        fs::read_dir(root.join("projects"))
            .map(|entries| entries.flatten().map(|e| e.path()).collect::<Vec<_>>())
    );
    let validated = run(&["scope", "validate", root.to_str().unwrap()]);
    assert!(validated.status.success());
    let report: serde_json::Value = serde_json::from_slice(&validated.stdout).unwrap();
    assert_eq!(report["scope_count"], 1);
}

#[test]
fn authoring_receipts_name_the_command_that_actually_recovers_a_registration() {
    // The guidance must be actionable: `kb repin` is what fixes a stale Scope
    // pin, and the config route is what fixes a stale configured-KB pin.
    let temp = Temp::new("authoring-guidance");
    let root = temp.0.join("family");
    let out = run(&[
        "scope",
        "init",
        root.to_str().unwrap(),
        "topic-family",
        "Family",
        "Family intent.",
    ]);
    assert!(out.status.success());
    let value: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    let next = value["next"].as_str().unwrap();
    assert!(next.contains("kb repin"), "{next}");
    assert!(next.contains("project refresh"), "{next}");
}
