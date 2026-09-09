//! Contract tests for the GitHub tooling adapter's two modes.
//!
//! Both fixtures are real retrievals. The discover fixture is trimmed to three
//! records; the watch fixture tracks two repositories the owner named, one of
//! which publishes no releases at all.
//!
//! The tests that matter most are the boundary ones. Discovery exists to
//! surface tooling nobody asked for, which is exactly why it must not be able
//! to promote anything: a run that could quietly carry a watchlist, or claim
//! watch mode's settled authority, would turn a search result into an adoption.

use mozak_core::research::normalize_provider_github_tooling as normalize;
use serde_json::{Value, json};
use std::{fs, path::Path};

fn load(name: &str) -> Value {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/research")
        .join(name);
    serde_json::from_str(&fs::read_to_string(path).expect("fixture")).expect("json")
}

fn discover() -> Value {
    load("provider-github-tooling-discover.json")
}

fn watch() -> Value {
    load("provider-github-tooling-watch.json")
}

fn error_of(value: &Value) -> String {
    normalize(&value.to_string())
        .expect_err("must be refused")
        .0
}

#[test]
fn both_modes_normalize_into_valid_runs() {
    let discovered = normalize(&discover().to_string()).expect("discover must normalize");
    assert_eq!(discovered.receipt.adapter_id, "adapter-github-tooling-v1");
    assert!(!discovered.raw_records.is_empty());

    let watched = normalize(&watch().to_string()).expect("watch must normalize");
    assert!(!watched.raw_records.is_empty());
    for record in watched
        .raw_records
        .iter()
        .chain(discovered.raw_records.iter())
    {
        assert!(
            record.source_uri.starts_with("recorded:github-tooling:"),
            "{}",
            record.source_uri
        );
        assert!(record.immutable);
    }
}

#[test]
fn discovery_cannot_promote_or_claim_watch_authority() {
    // A watchlist in a discovery run is the exact shape of an accidental
    // promotion, so it is refused rather than ignored.
    let mut with_watchlist = discover();
    with_watchlist["watchlist"] = json!(["someone/somewhere"]);
    assert!(
        error_of(&with_watchlist).contains("discovery does not promote"),
        "{}",
        error_of(&with_watchlist)
    );

    let mut relabelled = discover();
    relabelled["mode"] = json!("watch");
    assert!(error_of(&relabelled).contains("must record the repositories it watched"));

    let mut unknown = discover();
    unknown["mode"] = json!("whatever");
    assert!(error_of(&unknown).contains("mode must be discover or watch"));
}

#[test]
fn watch_cannot_claim_discovery_queries() {
    let mut value = watch();
    value["queries"] = json!([{"name": "invented", "terms": ["topic:x"], "records_matched": 1}]);
    assert!(error_of(&value).contains("must not claim discovery queries"));

    let mut empty = watch();
    empty["watchlist"] = json!([]);
    assert!(error_of(&empty).contains("must record the repositories it watched"));
}

#[test]
fn each_mode_must_disclose_what_it_cannot_see() {
    for (fixture, gap, expected) in [
        (
            discover(),
            "gap-discovery-is-proposal-only",
            "proposes rather than promotes",
        ),
        (
            discover(),
            "gap-topic-dependent",
            "undeclared topics are invisible",
        ),
        (watch(), "gap-watchlist-is-closed", "performs no discovery"),
    ] {
        let mut value = fixture;
        let gaps = value["run"]["gaps"]
            .as_array()
            .expect("gaps")
            .iter()
            .filter(|entry| entry["id"] != gap)
            .cloned()
            .collect::<Vec<_>>();
        value["run"]["gaps"] = Value::Array(gaps);
        assert!(
            error_of(&value).contains(expected),
            "removing {gap} must be refused"
        );
    }
}

#[test]
fn popularity_must_not_read_as_an_assessment() {
    for (label, expected) in [
        ("gap-stars-are-attention", "stars are not quality"),
        ("gap-license-varies", "licence boundary"),
    ] {
        let mut value = discover();
        let gaps = value["run"]["gaps"]
            .as_array()
            .expect("gaps")
            .iter()
            .filter(|entry| entry["id"] != label)
            .cloned()
            .collect::<Vec<_>>();
        value["run"]["gaps"] = Value::Array(gaps);
        assert!(error_of(&value).contains(expected), "removing {label}");
    }
}

#[test]
fn a_repository_without_releases_is_tracked_by_its_head_commit() {
    // deeplethe/utopia publishes no releases but is pushed daily. A
    // release-only watcher would report it as dormant.
    let run = normalize(&watch().to_string()).expect("watch");
    let commits = run
        .raw_records
        .iter()
        .filter(|record| record.content.contains("latest_commit: "))
        .count();
    assert!(
        commits >= 1,
        "a release-less repository must still be tracked"
    );

    let mut missing = watch();
    let content = missing["run"]["raw_records"][0]["content"]
        .as_str()
        .expect("content")
        .lines()
        .enumerate()
        .map(|(index, line)| {
            if index == 2 {
                "surprise: nothing".to_owned()
            } else {
                line.to_owned()
            }
        })
        .collect::<Vec<_>>()
        .join("\n");
    missing["run"]["raw_records"][0]["content"] = Value::String(content);
    assert!(error_of(&missing).contains("latest release or commit"));
}

#[test]
fn repository_prose_must_not_be_retained() {
    let mut value = discover();
    let content = value["run"]["raw_records"][0]["content"]
        .as_str()
        .expect("content")
        .replace(
            "retention: identity",
            "description: the only framework you need\nretention: identity",
        );
    value["run"]["raw_records"][0]["content"] = Value::String(content);
    let error = error_of(&value);
    assert!(
        error.contains("retained metadata lines") || error.contains("repository prose"),
        "{error}"
    );
}

#[test]
fn dishonest_counts_truncation_and_effects_fail_closed() {
    let mut lied = discover();
    lied["records_kept"] = json!(1);
    assert!(error_of(&lied).contains("records_kept disagrees"));

    let mut inflated = discover();
    inflated["total_found"] = json!(1);
    assert!(error_of(&inflated).contains("exceeds the total found"));

    let mut overclaim = discover();
    overclaim["run"]["synthesis"]["overall_claim"] = json!("supported");
    assert!(error_of(&overclaim).contains("must not claim full support"));

    let mut mutating = discover();
    mutating["effects"]["mutations_performed"] = json!("accepted_state");
    assert!(error_of(&mutating).contains("mutations"));

    let mut unpinned = discover();
    unpinned["response_files"] = json!([]);
    assert!(error_of(&unpinned).contains("must pin at least one response body"));
}
