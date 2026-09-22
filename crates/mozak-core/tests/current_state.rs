use mozak_core::{
    canonical_hash,
    current_state::{
        CurrentStateInput, Freshness, ProjectionSource, StateNode, StateRelationship,
        project_current_state,
    },
};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

const PROJECT: &str = "version: 1\nframework_contract_version: 1\nproject:\n  id: mozak\n  name: MOZAK\nrepository:\n  revision: 0123456789abcdef0123456789abcdef01234567\nowned_paths:\n  - crates\n";
const RESEARCH: &str = include_str!("../../mozak-cli/tests/fixtures/lab_adapter_run.json");
const HASH: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
static NEXT: AtomicU64 = AtomicU64::new(0);

struct Temp(PathBuf);

impl Temp {
    fn new(label: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "mozak-current-state-{label}-{}-{}",
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

fn write_scope(root: &Path, id: &str) -> String {
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

fn write_kb(root: &Path, scope: &Path, scope_hash: &str) {
    fs::create_dir_all(root).unwrap();
    let registry = serde_json::json!({
        "schema_version": 1,
        "registrations": [{
            "id": "topic-agentic",
            "path": scope.to_str().unwrap(),
            "scope_manifest_sha256": scope_hash
        }]
    });
    fs::write(
        root.join("kb.json"),
        serde_json::to_vec_pretty(&registry).unwrap(),
    )
    .unwrap();
}

fn adapter_registry() -> String {
    format!(
        "{{\"schema_version\":1,\"bindings\":[{{\"id\":\"agentic-arxiv\",\"adapter\":\"arxiv\",\"target_scope_id\":\"topic-agentic\",\"request_path\":\"/tmp/request.json\",\"request_sha256\":\"{HASH}\",\"runner_path\":\"/tmp/runner.sh\",\"runner_sha256\":\"{HASH}\",\"runs_dir\":\"/tmp/runs\"}}]}}"
    )
}

fn input() -> CurrentStateInput {
    let (project_source, manifest) = ProjectionSource::project_manifest(
        ".mozak/project.yml",
        PROJECT.as_bytes(),
        Freshness::Current,
    )
    .unwrap();
    let adapter_json = adapter_registry();
    let (adapter_source, registry) = ProjectionSource::adapter_registry(
        "/tmp/adapters.json",
        adapter_json.as_bytes(),
        Freshness::Current,
    )
    .unwrap();
    let (research_source, run) =
        ProjectionSource::research_run("/tmp/run.json", RESEARCH.as_bytes(), Freshness::Current)
            .unwrap();

    let project = StateNode::project(&project_source, &manifest).unwrap();
    let adapter = StateNode::adapter_binding(&adapter_source, &registry.bindings[0]).unwrap();
    let research = StateNode::research_run(&research_source, &run).unwrap();
    let observes = StateRelationship::observes(&research, &project, &research_source).unwrap();

    CurrentStateInput::new(
        "mozak",
        vec![research_source, project_source, adapter_source],
        vec![research, project, adapter],
        vec![observes],
    )
    .unwrap()
}

#[test]
fn real_validators_produce_a_deterministic_read_only_projection() {
    let first = project_current_state(input()).unwrap();
    let second = project_current_state(input()).unwrap();
    assert_eq!(first, second);
    assert_eq!(
        canonical_hash(&first).unwrap(),
        canonical_hash(&second).unwrap()
    );
    assert!(!first.mutation);
    assert!(!first.automatic_promotion);
}

#[test]
fn invalid_domain_artifacts_cannot_become_sources() {
    assert!(
        ProjectionSource::project_manifest(".mozak/project.yml", b"not yaml", Freshness::Current)
            .is_err()
    );
    assert!(
        ProjectionSource::adapter_registry(
            "/tmp/adapters.json",
            b"{\"schema_version\":1,\"bindings\":[{\"id\":\"x\"}]}",
            Freshness::Current
        )
        .is_err()
    );
    assert!(ProjectionSource::research_run("/tmp/run.json", b"{}", Freshness::Current).is_err());
}

#[test]
fn authority_is_derived_and_serialized_without_a_promotion_path() {
    let projection = project_current_state(input()).unwrap();
    let value = serde_json::to_value(projection).unwrap();
    let authorities = value["sources"]
        .as_array()
        .unwrap()
        .iter()
        .map(|source| source["authority"].as_str().unwrap())
        .collect::<Vec<_>>();
    assert!(authorities.contains(&"authoritative"));
    assert!(authorities.contains(&"proposal_only"));
    assert_eq!(value["automatic_promotion"], false);
}

#[test]
fn relationship_constructors_enforce_semantic_endpoints_and_provenance() {
    let (project_source, manifest) = ProjectionSource::project_manifest(
        ".mozak/project.yml",
        PROJECT.as_bytes(),
        Freshness::Current,
    )
    .unwrap();
    let adapter_json = adapter_registry();
    let (adapter_source, registry) = ProjectionSource::adapter_registry(
        "/tmp/adapters.json",
        adapter_json.as_bytes(),
        Freshness::Current,
    )
    .unwrap();
    let project = StateNode::project(&project_source, &manifest).unwrap();
    let adapter = StateNode::adapter_binding(&adapter_source, &registry.bindings[0]).unwrap();

    assert_eq!(
        StateRelationship::observes(&adapter, &project, &adapter_source)
            .unwrap_err()
            .0,
        "observes source must be a research run"
    );
    assert_eq!(
        StateRelationship::targets(&adapter, &registry.bindings[0], &project, &adapter_source)
            .unwrap_err()
            .0,
        "targets target must be a scope"
    );
}

#[test]
fn knowledge_base_source_must_load_registry_from_root_path() {
    let temp = Temp::new("kb-source");
    let scope_root = temp.0.join("scope");
    let registry = temp.0.join("registry");
    let scope_hash = write_scope(&scope_root, "topic-agentic");
    write_kb(&registry, &scope_root, &scope_hash);

    let (source, kb) = ProjectionSource::knowledge_base(&registry, Freshness::Current).unwrap();
    let kb_node = StateNode::knowledge_base(&source, "fixture KB").unwrap();
    let scope = &kb.entries[0].scopes.manifest.scopes[0];
    let scope_node = StateNode::scope(&source, &scope.id, &scope.title).unwrap();
    StateRelationship::registered_in(&scope_node, &kb_node, &source).unwrap();

    fs::write(scope_root.join("scope.json"), b"{}").unwrap();
    assert_eq!(
        ProjectionSource::knowledge_base(&registry, Freshness::Current)
            .unwrap_err()
            .0,
        "Scope manifest hash mismatch for registration topic-agentic"
    );
}

#[test]
fn adapter_targets_are_derived_from_validated_binding_target_scope_id() {
    let adapter_json = adapter_registry();
    let (adapter_source, registry) = ProjectionSource::adapter_registry(
        "/tmp/adapters.json",
        adapter_json.as_bytes(),
        Freshness::Current,
    )
    .unwrap();
    let temp = Temp::new("adapter-target");
    let scope = temp.0.join("scope");
    let registry_root = temp.0.join("registry");
    let scope_hash = write_scope(&scope, "topic-agentic");
    write_kb(&registry_root, &scope, &scope_hash);
    let (kb_source, kb) =
        ProjectionSource::knowledge_base(&registry_root, Freshness::Current).unwrap();

    let adapter = StateNode::adapter_binding(&adapter_source, &registry.bindings[0]).unwrap();
    let scope = &kb.entries[0].scopes.manifest.scopes[0];
    let matching_scope = StateNode::scope(&kb_source, &scope.id, &scope.title).unwrap();
    StateRelationship::targets(
        &adapter,
        &registry.bindings[0],
        &matching_scope,
        &adapter_source,
    )
    .unwrap();

    let unrelated_scope = StateNode::scope(&kb_source, "topic-unrelated", "Other");
    assert_eq!(
        unrelated_scope.unwrap_err().0,
        "scope node must match a Scope loaded by the validated KB source"
    );
    let unrelated_scope = StateNode::scope(&kb_source, &scope.id, &scope.title).unwrap();
    let mut forged_binding = registry.bindings[0].clone();
    forged_binding.target_scope_id = "topic-unrelated".into();
    assert_eq!(
        StateRelationship::targets(&adapter, &forged_binding, &unrelated_scope, &adapter_source)
            .unwrap_err()
            .0,
        "targets binding must come from the validated adapter source"
    );
}

#[test]
fn mutated_public_domain_objects_cannot_rebind_sealed_sources() {
    let (project_source, mut manifest) = ProjectionSource::project_manifest(
        ".mozak/project.yml",
        PROJECT.as_bytes(),
        Freshness::Current,
    )
    .unwrap();
    manifest.project.id = "forged-project".into();
    assert_eq!(
        StateNode::project(&project_source, &manifest)
            .unwrap_err()
            .0,
        "project node manifest must match the validated project source"
    );

    let adapter_json = adapter_registry();
    let (adapter_source, mut registry) = ProjectionSource::adapter_registry(
        "/tmp/adapters.json",
        adapter_json.as_bytes(),
        Freshness::Current,
    )
    .unwrap();
    registry.bindings[0].target_scope_id = "topic-forged".into();
    assert_eq!(
        StateNode::adapter_binding(&adapter_source, &registry.bindings[0])
            .unwrap_err()
            .0,
        "adapter binding must match the validated adapter source"
    );

    let (research_source, mut run) =
        ProjectionSource::research_run("/tmp/run.json", RESEARCH.as_bytes(), Freshness::Current)
            .unwrap();
    run.run_id = "forged-run".into();
    assert_eq!(
        StateNode::research_run(&research_source, &run)
            .unwrap_err()
            .0,
        "research run must match the validated research source"
    );
}

#[test]
fn mutated_kb_and_adapter_target_objects_cannot_forge_edges() {
    let adapter_json = adapter_registry();
    let (adapter_source, mut registry) = ProjectionSource::adapter_registry(
        "/tmp/adapters.json",
        adapter_json.as_bytes(),
        Freshness::Current,
    )
    .unwrap();
    let temp = Temp::new("forged-edge");
    let scope = temp.0.join("scope");
    let registry_root = temp.0.join("registry");
    let scope_hash = write_scope(&scope, "topic-agentic");
    write_kb(&registry_root, &scope, &scope_hash);
    let (kb_source, kb) =
        ProjectionSource::knowledge_base(&registry_root, Freshness::Current).unwrap();
    let loaded_scope = &kb.entries[0].scopes.manifest.scopes[0];

    assert_eq!(
        StateNode::scope(&kb_source, &loaded_scope.id, "Forged title")
            .unwrap_err()
            .0,
        "scope node must match a Scope loaded by the validated KB source"
    );

    let adapter = StateNode::adapter_binding(&adapter_source, &registry.bindings[0]).unwrap();
    let matching_scope =
        StateNode::scope(&kb_source, &loaded_scope.id, &loaded_scope.title).unwrap();
    registry.bindings[0].target_scope_id = "topic-forged".into();
    assert_eq!(
        StateRelationship::targets(
            &adapter,
            &registry.bindings[0],
            &matching_scope,
            &adapter_source
        )
        .unwrap_err()
        .0,
        "targets binding must come from the validated adapter source"
    );
}

#[test]
fn unsafe_paths_and_duplicate_inputs_fail_closed() {
    assert_eq!(
        ProjectionSource::project_manifest(
            "../project.yml",
            PROJECT.as_bytes(),
            Freshness::Current
        )
        .unwrap_err()
        .0,
        "source path contains unsafe components"
    );

    let (source, manifest) = ProjectionSource::project_manifest(
        ".mozak/project.yml",
        PROJECT.as_bytes(),
        Freshness::Current,
    )
    .unwrap();
    let node = StateNode::project(&source, &manifest).unwrap();
    assert_eq!(
        CurrentStateInput::new("mozak", vec![source.clone(), source], vec![node], vec![])
            .unwrap_err()
            .0,
        "duplicate source id"
    );
}
