//! A network-sourced research run must declare what the network access did.
//!
//! MOZAK performs no networking, so the adapter fetches and MOZAK validates the
//! recorded snapshot. The fixture is a real arXiv retrieval, trimmed.

use mozak_core::research::{
    OverallClaim, ProviderArxivFixture, RawTrust, normalize_provider_arxiv,
};

const FIXTURE: &str = include_str!("fixtures/research/provider-arxiv.json");

fn fixture() -> ProviderArxivFixture {
    serde_json::from_str(FIXTURE).expect("recorded arXiv fixture parses")
}

fn mutated(edit: impl FnOnce(&mut serde_json::Value)) -> String {
    let mut value: serde_json::Value = serde_json::from_str(FIXTURE).unwrap();
    edit(&mut value);
    serde_json::to_string(&value).unwrap()
}

#[test]
fn a_real_arxiv_retrieval_normalizes_into_a_validated_run() {
    let run = normalize_provider_arxiv(FIXTURE).expect("recorded retrieval is valid");
    assert_eq!(run.raw_records.len(), 4);
    assert_eq!(run.evidence.len(), 4);
    // Retrieved content is never trusted, whatever the source said.
    assert!(
        run.raw_records
            .iter()
            .all(|record| record.trust == RawTrust::UntrustedData)
    );
    // A live URL never enters as a source scheme; only a recorded snapshot does.
    assert!(
        run.raw_records
            .iter()
            .all(|record| record.source_uri.starts_with("recorded:")),
        "network sources enter as recorded snapshots"
    );
    assert_eq!(run.source_profile.allowed_schemes, vec!["recorded"]);
}

#[test]
fn a_truncated_retrieval_cannot_claim_full_support() {
    let recorded = fixture();
    assert!(
        !recorded.truncated,
        "the recorded clustered run examined every distinct match"
    );
    assert_eq!(
        recorded.run.synthesis.overall_claim,
        OverallClaim::Supported
    );

    // A run keeping fewer than it matched must not claim full support.
    let claimed = mutated(|value| {
        value["total_matched"] = serde_json::json!(500);
        value["truncated"] = serde_json::json!(true);
    });
    assert_eq!(
        normalize_provider_arxiv(&claimed).unwrap_err().0,
        "a truncated retrieval must not claim full support"
    );

    // Truncation must be visible as a high-impact gap rather than implied.
    let hidden = mutated(|value| {
        value["total_matched"] = serde_json::json!(500);
        value["truncated"] = serde_json::json!(true);
        value["run"]["synthesis"]["claims"][0]["status"] = serde_json::json!("qualified");
        value["run"]["synthesis"]["overall_claim"] = serde_json::json!("qualified");
        value["run"]["receipt"]["status"] = serde_json::json!("qualified");
        let gaps = value["run"]["gaps"].as_array_mut().unwrap();
        gaps.retain(|gap| gap["impact"] != "high");
        // Replace clusters with a flat term list, so the run-level rule is the
        // one under test rather than the cluster-level rule.
        value["clusters"] = serde_json::json!([]);
        value["request"]["terms"] = serde_json::json!(["agentic"]);
    });
    assert_eq!(
        normalize_provider_arxiv(&hidden).unwrap_err().0,
        "a truncated retrieval must record a high-impact gap"
    );
}

#[test]
fn declared_counts_must_agree_with_the_recorded_records() {
    let inflated = mutated(|value| value["records_kept"] = serde_json::json!(99));
    assert_eq!(
        normalize_provider_arxiv(&inflated).unwrap_err().0,
        "records_kept disagrees with the recorded raw records"
    );

    let impossible = mutated(|value| {
        value["records_kept"] = serde_json::json!(4);
        value["total_matched"] = serde_json::json!(1);
        value["truncated"] = serde_json::json!(false);
    });
    assert_eq!(
        normalize_provider_arxiv(&impossible).unwrap_err().0,
        "records_kept exceeds the reported total"
    );

    let dishonest = mutated(|value| {
        value["total_matched"] = serde_json::json!(500);
        value["truncated"] = serde_json::json!(false);
    });
    assert_eq!(
        normalize_provider_arxiv(&dishonest).unwrap_err().0,
        "truncated does not reflect the recorded counts"
    );
}

/// The `EmailJS` lesson: a research probe that causes an external effect must not
/// pass as read-only retrieval.
#[test]
fn an_adapter_declaring_an_external_effect_is_refused() {
    let writes = mutated(|value| {
        value["effects"]["external_writes"] = serde_json::json!(["POST /api/send"]);
    });
    assert_eq!(
        normalize_provider_arxiv(&writes).unwrap_err().0,
        "a research adapter must not declare external writes"
    );

    let irreversible = mutated(|value| {
        value["effects"]["irreversible_effects"] = serde_json::json!(["delivered an email"]);
    });
    assert_eq!(
        normalize_provider_arxiv(&irreversible).unwrap_err().0,
        "a research adapter must not declare irreversible effects"
    );

    let mutating = mutated(|value| {
        value["effects"]["mutations_performed"] = serde_json::json!("created a remote record");
    });
    assert_eq!(
        normalize_provider_arxiv(&mutating).unwrap_err().0,
        "a research adapter must not declare mutations"
    );

    let gated = mutated(|value| {
        value["effects"]["owner_approval_required"] = serde_json::json!(true);
    });
    assert_eq!(
        normalize_provider_arxiv(&gated).unwrap_err().0,
        "an adapter needing owner approval must not be normalized automatically"
    );
}

#[test]
fn a_network_adapter_must_admit_its_network_use_and_offer_a_dry_run() {
    let hidden = mutated(|value| value["effects"]["network_used"] = serde_json::json!(false));
    assert_eq!(
        normalize_provider_arxiv(&hidden).unwrap_err().0,
        "the arXiv adapter reaches a network source and must declare it"
    );

    let unrehearsable =
        mutated(|value| value["effects"]["dry_run_available"] = serde_json::json!(false));
    assert_eq!(
        normalize_provider_arxiv(&unrehearsable).unwrap_err().0,
        "a network adapter must offer a dry run"
    );
}

#[test]
fn the_exact_request_and_response_bodies_are_pinned() {
    let recorded = fixture();
    assert_eq!(recorded.request.mode, "query");
    assert_eq!(recorded.request.categories.len(), 5);
    assert!(recorded.request.window.start < recorded.request.window.end);
    assert!(
        !recorded.response_pages.is_empty(),
        "each response body is pinned so a claim can be rechecked"
    );

    let unpinned = mutated(|value| value["response_pages"] = serde_json::json!([]));
    assert_eq!(
        normalize_provider_arxiv(&unpinned).unwrap_err().0,
        "arXiv fixture must pin its response bodies"
    );

    let reversed = mutated(|value| {
        let start = value["request"]["window"]["start"].clone();
        value["request"]["window"]["start"] = value["request"]["window"]["end"].clone();
        value["request"]["window"]["end"] = start;
    });
    assert_eq!(
        normalize_provider_arxiv(&reversed).unwrap_err().0,
        "arXiv window start must precede its end"
    );
}

#[test]
fn the_adapter_identity_must_match_the_run_receipt() {
    let swapped = mutated(|value| value["adapter"] = serde_json::json!("adapter-someone-else"));
    assert_eq!(
        normalize_provider_arxiv(&swapped).unwrap_err().0,
        "provider-arxiv adapter mismatch"
    );
}

#[test]
fn contracts_are_closed_shape() {
    let extra = FIXTURE.replacen('{', "{\"surprise\": true,", 1);
    assert!(normalize_provider_arxiv(&extra).is_err());
}

/// Interest clusters make retrieval small by filtering at the source, and each
/// cluster must report its own result including zero.
#[test]
fn cluster_reports_must_be_internally_honest() {
    let recorded = fixture();
    if recorded.clusters.is_empty() {
        return; // the recorded fixture predates clustering
    }
    for cluster in &recorded.clusters {
        assert!(cluster.records_kept <= cluster.total_matched);
        assert!(!cluster.terms.is_empty());
    }

    let inflated = mutated(|value| {
        if let Some(cluster) = value["clusters"].get_mut(0) {
            cluster["records_kept"] = serde_json::json!(9999);
        }
    });
    if !recorded.clusters.is_empty() {
        assert_eq!(
            normalize_provider_arxiv(&inflated).unwrap_err().0,
            "cluster kept more records than it matched"
        );
    }
}

#[test]
fn a_cluster_matching_nothing_must_record_a_gap() {
    let recorded = fixture();
    if recorded.clusters.is_empty() {
        return;
    }
    // Zeroing a cluster without adding its gap hides that an interest returned
    // nothing, which is exactly the silence this rule prevents.
    let silent = mutated(|value| {
        if let Some(cluster) = value["clusters"].get_mut(0) {
            cluster["total_matched"] = serde_json::json!(0);
            cluster["records_kept"] = serde_json::json!(0);
            cluster["truncated"] = serde_json::json!(false);
        }
    });
    assert_eq!(
        normalize_provider_arxiv(&silent).unwrap_err().0,
        "a cluster that matched nothing must record a gap"
    );
}

#[test]
fn duplicate_cluster_names_are_refused() {
    let recorded = fixture();
    if recorded.clusters.len() < 2 {
        return;
    }
    let duplicated = mutated(|value| {
        let name = value["clusters"][0]["name"].clone();
        value["clusters"][1]["name"] = name;
    });
    assert_eq!(
        normalize_provider_arxiv(&duplicated).unwrap_err().0,
        "duplicate cluster name"
    );
}
