use mozak_core::{
    canonical_hash,
    current_state::{
        Authority, CurrentStateInput, Freshness, NodeKind, ProjectionSource, RelationshipKind,
        SourceKind, StateNode, StateRelationship, project_current_state,
    },
};

const EMPTY_HASH: &str = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

fn source(id: &str, authority: Authority) -> ProjectionSource {
    ProjectionSource::observe(
        id,
        SourceKind::ProjectOverview,
        format!(".mozak/state/{id}.json"),
        EMPTY_HASH,
        b"",
        authority,
        Freshness::Current,
    )
    .unwrap()
}

fn node(id: &str, source_id: &str, authority: Authority) -> StateNode {
    StateNode {
        id: id.into(),
        kind: NodeKind::Goal,
        label: id.into(),
        status: "ready".into(),
        source_id: source_id.into(),
        authority,
    }
}

fn input() -> CurrentStateInput {
    CurrentStateInput {
        contract_version: 1,
        project_id: "mozak".into(),
        sources: vec![
            source("source-research", Authority::ProposalOnly),
            source("source-project", Authority::Authoritative),
        ],
        nodes: vec![
            node("research:today", "source-research", Authority::ProposalOnly),
            node("project:mozak", "source-project", Authority::Authoritative),
        ],
        relationships: vec![StateRelationship {
            from: "research:today".into(),
            relation: RelationshipKind::Observes,
            to: "project:mozak".into(),
            source_id: "source-research".into(),
            authority: Authority::ProposalOnly,
        }],
    }
}

#[test]
fn projection_is_deterministic_and_explicitly_read_only() {
    let first = project_current_state(input()).unwrap();
    let mut reordered = input();
    reordered.sources.reverse();
    reordered.nodes.reverse();
    let second = project_current_state(reordered).unwrap();

    assert_eq!(first, second);
    assert_eq!(
        canonical_hash(&first).unwrap(),
        canonical_hash(&second).unwrap()
    );
    assert!(!first.mutation);
    assert!(!first.automatic_promotion);
}

#[test]
fn source_hash_drift_fails_closed() {
    let error = ProjectionSource::observe(
        "source-research",
        SourceKind::ResearchRun,
        ".mozak/research/run.json",
        EMPTY_HASH,
        b"changed",
        Authority::ProposalOnly,
        Freshness::Current,
    )
    .unwrap_err();
    assert_eq!(error.0, "source source-research hash drifted");
}

#[test]
fn missing_provenance_fails_closed() {
    let mut value = input();
    value
        .sources
        .retain(|source| source.id() != "source-research");
    let error = project_current_state(value).unwrap_err();
    assert_eq!(error.0, "node source is unknown");
}

#[test]
fn authority_cannot_be_upgraded_by_a_node_or_relationship() {
    let mut node_upgrade = input();
    node_upgrade.nodes[0].authority = Authority::Authoritative;
    assert_eq!(
        project_current_state(node_upgrade).unwrap_err().0,
        "node authority differs from its source"
    );

    let mut relationship_upgrade = input();
    relationship_upgrade.relationships[0].authority = Authority::Accepted;
    assert_eq!(
        project_current_state(relationship_upgrade).unwrap_err().0,
        "relationship authority differs from its source"
    );
}

#[test]
fn unsafe_paths_and_dangling_relationships_are_rejected() {
    let unsafe_path = ProjectionSource::observe(
        "source-project",
        SourceKind::ProjectOverview,
        "../outside.json",
        EMPTY_HASH,
        b"",
        Authority::Authoritative,
        Freshness::Current,
    )
    .unwrap_err();
    assert_eq!(unsafe_path.0, "source path contains unsafe components");

    let mut dangling = input();
    dangling.relationships[0].to = "project:missing".into();
    assert_eq!(
        project_current_state(dangling).unwrap_err().0,
        "relationship target node is unknown"
    );
}
