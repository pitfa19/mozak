use sha2::{Digest, Sha256};
use std::{
    fs,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    process::{Command, Output},
    sync::atomic::{AtomicU64, Ordering},
};

static NEXT: AtomicU64 = AtomicU64::new(0);

struct Temp(PathBuf);

impl Temp {
    fn new(label: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "mozak-cli-kb-{label}-{}-{}",
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

fn write_scope(root: &Path, id: &str, title: &str) -> String {
    fs::create_dir_all(root).unwrap();
    let bytes = serde_json::to_vec_pretty(&serde_json::json!({
        "schema_version":2,
        "scopes":[{"id":id,"kind":"topic","title":title,"intent":"Bounded inspection","history":[{"id":"h-1","at":"2026-09-02T00:00:00Z","note":"Created"}]}],
        "promotions":[],
        "meta_goals":[],
        "inputs":[]
    }))
    .unwrap();
    fs::write(root.join("scope.json"), &bytes).unwrap();
    sha(&bytes)
}

struct Fixture {
    _temp: Temp,
    registry: PathBuf,
    parent: PathBuf,
    child: PathBuf,
    parent_hash: String,
    child_hash: String,
    registry_hash: String,
}

fn fixture() -> Fixture {
    let temp = Temp::new("fixture");
    let parent = temp.0.join("personal");
    let child = parent.join("scopes/example-alpha");
    let parent_hash = write_scope(&parent, "topic-root", "Root Topic");
    let child_hash = write_scope(&child, "example-alpha", "Example Alpha MCP");
    let ignored = parent.join("scopes/ignored");
    fs::create_dir_all(&ignored).unwrap();
    fs::write(ignored.join("scope.json"), b"invalid and unregistered").unwrap();
    let registry = temp.0.join("registry");
    fs::create_dir_all(&registry).unwrap();
    let bytes = serde_json::to_vec_pretty(&serde_json::json!({
        "schema_version":1,
        "registrations":[
            {"id":"personal","path":parent.to_string_lossy(),"scope_manifest_sha256":parent_hash},
            {"id":"example-alpha","path":child.to_string_lossy(),"scope_manifest_sha256":child_hash}
        ]
    }))
    .unwrap();
    fs::write(registry.join("kb.json"), &bytes).unwrap();
    Fixture {
        _temp: temp,
        registry,
        parent,
        child,
        parent_hash,
        child_hash,
        registry_hash: sha(&bytes),
    }
}

fn run(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_mozak"))
        .args(args)
        .output()
        .unwrap()
}

fn run_current(args: &[&str], config_home: &Path) -> Output {
    Command::new(env!("CARGO_BIN_EXE_mozak"))
        .args(args)
        .env("XDG_CONFIG_HOME", config_home)
        .output()
        .unwrap()
}

fn write_current_config(config_home: &Path, fixture: &Fixture, kb_sha256: &str) {
    let path = config_home.join("mozak/config.json");
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(
        path,
        serde_json::to_vec(&serde_json::json!({
            "schema_version":1,
            "kb_root":fixture.registry.to_string_lossy(),
            "kb_sha256":kb_sha256,
            "projects":{},
            "approval":{
                "proposal_digest":"a".repeat(64),
                "owner":"Test Owner",
                "approved_at":"2026-09-03T10:07:57Z",
                "rationale":"Test configured KB routing"
            }
        }))
        .unwrap(),
    )
    .unwrap();
}

#[test]
fn public_routes_are_exact_deterministic_read_only_and_ignore_unregistered_roots() {
    let fixture = fixture();
    let root = fixture.registry.to_str().unwrap();
    let before = fs::read(fixture.registry.join("kb.json")).unwrap();

    let validation = run(&["kb", "validate", root]);
    assert!(validation.status.success());
    let value: serde_json::Value = serde_json::from_slice(&validation.stdout).unwrap();
    assert_eq!(value["validity"], "registry_valid");
    assert_eq!(
        value["authority"],
        "registered_sources_remain_authoritative"
    );
    assert_eq!(value["auto_discovery"], false);
    assert_eq!(value["registration_count"], 2);
    assert_eq!(value["scope_count"], 2);

    let list = run(&["kb", "list", root]);
    assert!(list.status.success());
    assert_eq!(
        String::from_utf8(list.stdout).unwrap(),
        format!(
            "Knowledge base registry: {}/kb.json\nRegistered roots:\n  example-alpha {} {}\n    example-alpha [topic] Example Alpha MCP (0 inputs)\n  personal {} {}\n    topic-root [topic] Root Topic (0 inputs)\n",
            fixture.registry.display(),
            fixture.child_hash,
            fixture.child.display(),
            fixture.parent_hash,
            fixture.parent.display()
        )
    );

    let tree = run(&["kb", "tree", root]);
    assert!(tree.status.success());
    assert_eq!(
        String::from_utf8(tree.stdout).unwrap(),
        format!(
            "Knowledge Base\n└── Root: personal {}\n    ├── Scope: topic-root [topic] Root Topic (0 inputs)\n    └── Root: example-alpha {}\n        └── Scope: example-alpha [topic] Example Alpha MCP (0 inputs)\n",
            fixture.parent.display(),
            fixture.child.display()
        )
    );

    let graph = run(&["kb", "graph-source", root]);
    assert!(graph.status.success());
    let expected_graph = format!(
        "flowchart LR\n  kb[\"Knowledge Base\\n{}/kb.json\"]\n  r0[\"example-alpha\\n{}\"]\n  r1 -->|registered| r0\n  s0_0[\"example-alpha\\ntopic\\n0 inputs\"]\n  r0 -->|contains| s0_0\n  r1[\"personal\\n{}\"]\n  kb -->|registered| r1\n  s1_0[\"topic-root\\ntopic\\n0 inputs\"]\n  r1 -->|contains| s1_0\n",
        fixture.registry.display(),
        fixture.child.display(),
        fixture.parent.display()
    );
    assert_eq!(String::from_utf8(graph.stdout).unwrap(), expected_graph);
    assert_eq!(fs::read(fixture.registry.join("kb.json")).unwrap(), before);
    assert!(!String::from_utf8_lossy(&tree.stderr).contains("ignored"));
}

#[test]
fn rootless_routes_resolve_the_exact_configured_kb_without_searching() {
    let fixture = fixture();
    let config_home = Temp::new("current-config");
    write_current_config(&config_home.0, &fixture, &fixture.registry_hash);

    for command in ["validate", "list", "tree", "graph-source"] {
        let implicit = run_current(&["kb", command], &config_home.0);
        let explicit = run(&["kb", command, fixture.registry.to_str().unwrap()]);
        assert!(
            implicit.status.success(),
            "{}",
            String::from_utf8_lossy(&implicit.stderr)
        );
        assert_eq!(implicit.stdout, explicit.stdout);
    }
}

#[test]
fn rootless_routes_fail_closed_on_missing_config_or_kb_drift() {
    let fixture = fixture();
    let missing = Temp::new("missing-config");
    let output = run_current(&["kb", "tree"], &missing.0);
    assert!(!output.status.success());
    assert!(output.stdout.is_empty());
    assert!(String::from_utf8_lossy(&output.stderr).contains("local config does not exist"));

    let drifted = Temp::new("drifted-config");
    write_current_config(&drifted.0, &fixture, &"0".repeat(64));
    let output = run_current(&["kb", "list"], &drifted.0);
    assert!(!output.status.success());
    assert!(output.stdout.is_empty());
    assert!(String::from_utf8_lossy(&output.stderr).contains("configured KB drifted"));
}

#[test]
fn graph_sends_exact_source_to_termaid_stdin() {
    let fixture = fixture();
    let root = fixture.registry.to_str().unwrap();
    let source = run(&["kb", "graph-source", root]).stdout;
    let tools = Temp::new("tools");
    let capture = tools.0.join("captured");
    let fake = tools.0.join("termaid");
    fs::write(
        &fake,
        "#!/bin/sh\ncat > \"$MOZAK_CAPTURE\"\nprintf 'rendered\\n'\n",
    )
    .unwrap();
    fs::set_permissions(&fake, fs::Permissions::from_mode(0o755)).unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_mozak"))
        .args(["kb", "graph", root])
        .env("MOZAK_TERMAID", &fake)
        .env("MOZAK_CAPTURE", &capture)
        .output()
        .unwrap();
    assert!(output.status.success());
    assert_eq!(output.stdout, b"rendered\n");
    assert_eq!(fs::read(capture).unwrap(), source);
}

#[test]
fn parity_reports_every_gate_and_exits_nonzero_without_claiming_parity() {
    let fixture = fixture();
    let observations = fixture.registry.join("observations.json");
    fs::write(
        &observations,
        serde_json::to_vec(&serde_json::json!({
            "schema_version":1,
            "registry_sha256":fixture.registry_hash,
            "source_files":[]
        }))
        .unwrap(),
    )
    .unwrap();
    let output = run(&[
        "kb",
        "parity",
        fixture.registry.to_str().unwrap(),
        observations.to_str().unwrap(),
    ]);
    assert_eq!(output.status.code(), Some(2));
    let value: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(value["parity"], false);
    assert_eq!(value["gates"].as_array().unwrap().len(), 12);
    assert_eq!(value["gates"][7]["status"], "unsupported");
    assert_eq!(value["gates"][10]["status"], "blocked");
    assert_eq!(value["gates"][11]["status"], "passed");
}

#[test]
fn invalid_registered_hash_fails_without_success_stdout() {
    let fixture = fixture();
    let path = fixture.registry.join("kb.json");
    let mut value: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    value["registrations"][0]["scope_manifest_sha256"] = serde_json::json!("0".repeat(64));
    fs::write(path, serde_json::to_vec(&value).unwrap()).unwrap();
    let output = run(&["kb", "validate", fixture.registry.to_str().unwrap()]);
    assert!(!output.status.success());
    assert!(output.stdout.is_empty());
    assert!(String::from_utf8_lossy(&output.stderr).contains("hash mismatch"));
}

/// The KB tree and graph must show scope-owned Concepts, including the
/// invariant they teach and the scope that authored them.
#[test]
fn kb_views_show_scope_owned_concepts() {
    let temp = Temp::new("kb-concepts");
    let scope = temp.0.join("scope");
    fs::create_dir_all(scope.join("concepts")).unwrap();
    let concept = fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../mozak-core/tests/fixtures/concept/publish-as-commit.json"),
    )
    .unwrap();
    fs::write(scope.join("concepts/c.json"), &concept).unwrap();
    let manifest = serde_json::to_vec_pretty(&serde_json::json!({
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
            "sha256": sha(concept.as_bytes())
        }]
    }))
    .unwrap();
    fs::write(scope.join("scope.json"), &manifest).unwrap();

    let registry = temp.0.join("kb");
    fs::create_dir_all(&registry).unwrap();
    fs::write(
        registry.join("kb.json"),
        serde_json::to_vec_pretty(&serde_json::json!({
            "schema_version": 1,
            "registrations": [{
                "id": "owner",
                "path": scope,
                "scope_manifest_sha256": sha(&manifest)
            }]
        }))
        .unwrap(),
    )
    .unwrap();

    let tree = run(&["kb", "tree", registry.to_str().unwrap()]);
    assert!(
        tree.status.success(),
        "{}",
        String::from_utf8_lossy(&tree.stderr)
    );
    let text = String::from_utf8_lossy(&tree.stdout);
    assert!(
        text.contains("concept-publish-as-commit [concept]"),
        "{text}"
    );
    assert!(
        text.contains("Publish as a validated single commit"),
        "the tree shows what the concept teaches: {text}"
    );
    assert!(text.contains("<- example-gamma"), "{text}");

    // kb list nests the concept under the scope that authored it.
    let listed = run(&["kb", "list", registry.to_str().unwrap()]);
    let listing = String::from_utf8_lossy(&listed.stdout);
    assert!(
        listing.contains("      concept: concept-publish-as-commit [advisory]"),
        "{listing}"
    );
    assert!(
        listing.contains("Publish as a validated single commit"),
        "{listing}"
    );

    let source = run(&["kb", "graph-source", registry.to_str().unwrap()]);
    let graph = String::from_utf8_lossy(&source.stdout);
    assert!(graph.contains("|authors|"), "{graph}");
    assert!(graph.contains("advisory concept"), "{graph}");
    // A concept node must stay on one line: a raw newline inside the label
    // breaks every downstream Mermaid renderer.
    assert!(
        graph.contains(r#"[/"concept-publish-as-commit\nadvisory concept"/]"#),
        "{graph}"
    );
    for line in graph.lines() {
        let quotes = line.matches('"').count();
        assert!(
            quotes % 2 == 0,
            "unbalanced label quotes on line {line:?} in {graph}"
        );
    }
}

#[test]
#[allow(clippy::too_many_lines)]
fn kb_tree_filters_are_combinable_rootless_and_fail_closed() {
    let temp = Temp::new("kb-tree-filters");
    let scope = temp.0.join("scope");
    fs::create_dir_all(scope.join("concepts")).unwrap();
    let concept = fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../mozak-core/tests/fixtures/concept/publish-as-commit.json"),
    )
    .unwrap();
    fs::write(scope.join("concepts/c.json"), &concept).unwrap();
    let revision = "a".repeat(40);
    let project = format!(
        "version: 1\nframework_contract_version: 1\nproject:\n  id: project-tool\n  name: Tool Project\nrepository:\n  revision: {revision}\nowned_paths:\n  - src\n"
    );
    fs::create_dir_all(scope.join(".mozak")).unwrap();
    fs::write(scope.join(".mozak/project.yml"), &project).unwrap();
    let manifest = serde_json::to_vec_pretty(&serde_json::json!({
        "schema_version": 2,
        "scopes": [
            {
                "id": "example-gamma",
                "kind": "topic",
                "title": "Research topic",
                "intent": "Own one concept.",
                "history": [{"id": "h-1", "at": "2026-09-04T00:00:00Z", "note": "Created"}]
            },
            {
                "id": "project-tool",
                "kind": "project",
                "title": "Tool project",
                "intent": "Apply the research.",
                "history": [{"id": "h-2", "at": "2026-09-04T00:00:00Z", "note": "Created"}],
                "project": {
                    "manifest_path": ".mozak/project.yml",
                    "manifest_sha256": sha(project.as_bytes()),
                    "project_id": "project-tool",
                    "repository_revision": revision,
                    "owned_paths": ["src"]
                }
            }
        ],
        "promotions": [],
        "meta_goals": [{
            "id": "goal-coordinate",
            "title": "Coordinate both scopes",
            "authority": "advisory_only",
            "scope_ids": ["example-gamma", "project-tool"],
            "relationships": []
        }],
        "inputs": [],
        "concepts": [{
            "id": "concept-publish-as-commit",
            "scope_id": "example-gamma",
            "path": "concepts/c.json",
            "sha256": sha(concept.as_bytes())
        }]
    }))
    .unwrap();
    fs::write(scope.join("scope.json"), &manifest).unwrap();

    let registry = temp.0.join("kb");
    fs::create_dir_all(&registry).unwrap();
    let registry_bytes = serde_json::to_vec_pretty(&serde_json::json!({
        "schema_version": 1,
        "registrations": [{
            "id": "owner",
            "path": scope,
            "scope_manifest_sha256": sha(&manifest)
        }]
    }))
    .unwrap();
    fs::write(registry.join("kb.json"), &registry_bytes).unwrap();
    let root = registry.to_str().unwrap();

    let concept_only = run(&["kb", "tree", "--concept", root]);
    assert!(concept_only.status.success());
    let concept_text = String::from_utf8_lossy(&concept_only.stdout);
    assert!(concept_text.contains("concept-publish-as-commit [concept]"));
    assert!(!concept_text.contains("Scope:"));
    assert!(!concept_text.contains("Meta Goal:"));

    let project_only = run(&["kb", "tree", root, "--project"]);
    assert!(project_only.status.success());
    let project_text = String::from_utf8_lossy(&project_only.stdout);
    assert!(project_text.contains("Scope: project-tool [project]"));
    assert!(!project_text.contains("Scope: example-gamma [topic]"));
    assert!(!project_text.contains("[concept]"));

    let topic_only = run(&["kb", "tree", "--topic", root]);
    assert!(topic_only.status.success());
    let topic_text = String::from_utf8_lossy(&topic_only.stdout);
    assert!(topic_text.contains("Scope: example-gamma [topic]"));
    assert!(!topic_text.contains("Scope: project-tool [project]"));
    assert!(!topic_text.contains("[concept]"));

    let combined = run(&["kb", "tree", "--concept", root, "--project"]);
    assert!(combined.status.success());
    let combined_text = String::from_utf8_lossy(&combined.stdout);
    assert!(combined_text.contains("concept-publish-as-commit [concept]"));
    assert!(combined_text.contains("Scope: project-tool [project]"));
    assert!(!combined_text.contains("Scope: example-gamma [topic]"));
    assert!(!combined_text.contains("Meta Goal:"));

    let duplicate = run(&["kb", "tree", root, "--concept", "--concept"]);
    assert!(duplicate.status.success());
    assert_eq!(duplicate.stdout, concept_only.stdout);

    let config_home = Temp::new("kb-tree-filter-config");
    let config_path = config_home.0.join("mozak/config.json");
    fs::create_dir_all(config_path.parent().unwrap()).unwrap();
    fs::write(
        config_path,
        serde_json::to_vec(&serde_json::json!({
            "schema_version": 1,
            "kb_root": registry,
            "kb_sha256": sha(&registry_bytes),
            "projects": {},
            "approval": {
                "proposal_digest": "a".repeat(64),
                "owner": "Test Owner",
                "approved_at": "2026-09-03T10:07:57Z",
                "rationale": "Test filtered configured KB routing"
            }
        }))
        .unwrap(),
    )
    .unwrap();
    let rootless = run_current(&["kb", "tree", "--topic", "--project"], &config_home.0);
    assert!(rootless.status.success());
    let rootless_text = String::from_utf8_lossy(&rootless.stdout);
    assert!(rootless_text.contains("Scope: example-gamma [topic]"));
    assert!(rootless_text.contains("Scope: project-tool [project]"));
    assert!(!rootless_text.contains("[concept]"));

    let empty = fixture();
    let no_projects = run(&["kb", "tree", empty.registry.to_str().unwrap(), "--project"]);
    assert!(no_projects.status.success());
    assert_eq!(
        String::from_utf8(no_projects.stdout).unwrap(),
        "Knowledge Base\n└── (no matching items)\n"
    );

    let unknown = run(&["kb", "tree", root, "--package"]);
    assert!(!unknown.status.success());
    assert!(unknown.stdout.is_empty());
    assert!(String::from_utf8_lossy(&unknown.stderr).contains("unknown kb tree filter: --package"));

    let two_roots = run(&["kb", "tree", root, root]);
    assert!(!two_roots.status.success());
    assert!(two_roots.stdout.is_empty());
    assert!(String::from_utf8_lossy(&two_roots.stderr).contains("usage:"));
}

#[test]
fn kb_register_indexes_a_valid_scope_and_stays_create_only() {
    let temp = Temp::new("register");
    let registry = temp.0.join("kb");
    fs::create_dir_all(&registry).unwrap();
    let scope = temp.0.join("topics/rust");
    let expected = write_scope(&scope, "topic-rust", "Rust");

    let out = run(&[
        "kb",
        "register",
        registry.to_str().unwrap(),
        "topic-rust",
        scope.to_str().unwrap(),
    ]);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let value: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(value["state"], "valid");
    assert_eq!(value["registration_count"], 1);
    // The pinned hash must be the manifest actually observed.
    assert_eq!(value["scope_manifest_sha256"], expected);
    // Registration must not claim authority.
    assert!(
        value["authority"]
            .as_str()
            .unwrap()
            .contains("transfers no trust")
    );

    // A second Scope is additive.
    let other = temp.0.join("topics/go");
    write_scope(&other, "topic-go", "Go");
    let out = run(&[
        "kb",
        "register",
        registry.to_str().unwrap(),
        "topic-go",
        other.to_str().unwrap(),
    ]);
    assert!(out.status.success());
    let value: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(value["registration_count"], 2);

    // Duplicate id and duplicate root are both refused.
    for (id, root) in [("topic-rust", &scope), ("fresh-id", &scope)] {
        let out = run(&[
            "kb",
            "register",
            registry.to_str().unwrap(),
            id,
            root.to_str().unwrap(),
        ]);
        assert!(!out.status.success(), "accepted a duplicate registration");
    }

    // The registry still validates after every operation.
    let validated = run(&["kb", "validate", registry.to_str().unwrap()]);
    assert!(validated.status.success());
    let report: serde_json::Value = serde_json::from_slice(&validated.stdout).unwrap();
    assert_eq!(report["registration_count"], 2);
}

#[test]
fn kb_register_refuses_an_invalid_scope_without_touching_the_registry() {
    let temp = Temp::new("register-bad");
    let registry = temp.0.join("kb");
    fs::create_dir_all(&registry).unwrap();
    let good = temp.0.join("topics/good");
    write_scope(&good, "topic-good", "Good");
    run(&[
        "kb",
        "register",
        registry.to_str().unwrap(),
        "topic-good",
        good.to_str().unwrap(),
    ]);
    let before = fs::read(registry.join("kb.json")).unwrap();

    let broken = temp.0.join("topics/broken");
    fs::create_dir_all(&broken).unwrap();
    fs::write(broken.join("scope.json"), b"{}").unwrap();
    let out = run(&[
        "kb",
        "register",
        registry.to_str().unwrap(),
        "topic-broken",
        broken.to_str().unwrap(),
    ]);
    assert!(!out.status.success());
    assert!(
        String::from_utf8_lossy(&out.stderr).contains("refusing to register an invalid Scope"),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert_eq!(
        before,
        fs::read(registry.join("kb.json")).unwrap(),
        "registry was modified by a failed registration"
    );
}

#[test]
fn kb_repin_recovers_a_registration_after_a_legitimate_scope_edit() {
    let temp = Temp::new("repin");
    let registry = temp.0.join("kb");
    fs::create_dir_all(&registry).unwrap();
    let scope = temp.0.join("topics/rust");
    let first = write_scope(&scope, "topic-rust", "Rust");
    run(&[
        "kb",
        "register",
        registry.to_str().unwrap(),
        "topic-rust",
        scope.to_str().unwrap(),
    ]);

    // Editing a registered Scope is legitimate and invalidates the pin.
    let second = write_scope(&scope, "topic-rust", "Rust, revised");
    assert_ne!(first, second);
    let out = run(&["kb", "validate", registry.to_str().unwrap()]);
    assert!(!out.status.success(), "a stale pin must fail closed");

    // Re-pinning restores it, and reports both hashes.
    let out = run(&[
        "kb",
        "repin",
        registry.to_str().unwrap(),
        "topic-rust",
        scope.to_str().unwrap(),
    ]);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let value: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(value["previous_sha256"], first);
    assert_eq!(value["scope_manifest_sha256"], second);
    assert!(
        value["authority"]
            .as_str()
            .unwrap()
            .contains("accepts no content")
    );

    let validated = run(&["kb", "validate", registry.to_str().unwrap()]);
    assert!(validated.status.success(), "registry did not recover");
}

#[test]
fn kb_repin_refuses_unknown_current_mismatched_and_invalid_inputs() {
    let temp = Temp::new("repin-bad");
    let registry = temp.0.join("kb");
    fs::create_dir_all(&registry).unwrap();
    let scope = temp.0.join("topics/rust");
    write_scope(&scope, "topic-rust", "Rust");
    let other = temp.0.join("topics/go");
    write_scope(&other, "topic-go", "Go");
    run(&[
        "kb",
        "register",
        registry.to_str().unwrap(),
        "topic-rust",
        scope.to_str().unwrap(),
    ]);
    let before = fs::read(registry.join("kb.json")).unwrap();

    // Unknown registration, an already-current pin, and a different root.
    for (args, expected) in [
        (
            vec![
                "kb",
                "repin",
                registry.to_str().unwrap(),
                "nope",
                scope.to_str().unwrap(),
            ],
            "unknown registration",
        ),
        (
            vec![
                "kb",
                "repin",
                registry.to_str().unwrap(),
                "topic-rust",
                scope.to_str().unwrap(),
            ],
            "already current",
        ),
        (
            vec![
                "kb",
                "repin",
                registry.to_str().unwrap(),
                "topic-rust",
                other.to_str().unwrap(),
            ],
            "different Scope root",
        ),
    ] {
        let out = run(&args);
        assert!(!out.status.success(), "accepted {args:?}");
        assert!(
            String::from_utf8_lossy(&out.stderr).contains(expected),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
    }

    // An invalid Scope must never have its hash pinned.
    fs::write(scope.join("scope.json"), b"{}").unwrap();
    let out = run(&[
        "kb",
        "repin",
        registry.to_str().unwrap(),
        "topic-rust",
        scope.to_str().unwrap(),
    ]);
    assert!(!out.status.success());
    assert!(
        String::from_utf8_lossy(&out.stderr).contains("refusing to pin an invalid Scope"),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert_eq!(
        before,
        fs::read(registry.join("kb.json")).unwrap(),
        "registry was modified by a failed repin"
    );
}
