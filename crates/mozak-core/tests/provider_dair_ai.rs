use mozak_core::research::{RawTrust, normalize_provider_dair_ai};

const FIXTURE: &str = include_str!("fixtures/research/provider-dair-ai.json");

fn mutated(edit: impl FnOnce(&mut serde_json::Value)) -> String {
    let mut value: serde_json::Value = serde_json::from_str(FIXTURE).unwrap();
    edit(&mut value);
    serde_json::to_string(&value).unwrap()
}

#[test]
fn real_curated_retrieval_normalizes_without_copying_curator_prose() {
    let run = normalize_provider_dair_ai(FIXTURE).expect("recorded DAIR.AI fixture validates");
    assert_eq!(run.raw_records.len(), 20);
    assert!(run.raw_records.iter().all(|record| {
        record.trust == RawTrust::UntrustedData
            && record.source_uri.starts_with("recorded:dair-ai:")
            && record.content.lines().count() == 7
            && !record.content.contains("Why it matters")
    }));
}

#[test]
fn source_identity_revision_and_response_bytes_are_pinned() {
    for changed in [
        mutated(|value| value["repository"] = serde_json::json!("someone/fork")),
        mutated(|value| value["source_revision"] = serde_json::json!("main")),
        mutated(|value| value["response_files"] = serde_json::json!([])),
    ] {
        assert!(normalize_provider_dair_ai(&changed).is_err());
    }
}

#[test]
fn effects_counts_and_truncation_fail_closed() {
    let effect = mutated(|value| value["effects"]["external_writes"] = serde_json::json!(["POST"]));
    assert!(normalize_provider_dair_ai(&effect).is_err());
    let count = mutated(|value| value["records_kept"] = serde_json::json!(99));
    assert!(normalize_provider_dair_ai(&count).is_err());
    let hidden = mutated(|value| {
        value["total_curated"] = serde_json::json!(25);
        value["truncated"] = serde_json::json!(true);
    });
    assert!(normalize_provider_dair_ai(&hidden).is_err());
}

#[test]
fn copied_summary_or_unknown_contract_field_is_rejected() {
    let prose = mutated(|value| {
        let content = value["run"]["raw_records"][0]["content"].as_str().unwrap();
        value["run"]["raw_records"][0]["content"] =
            serde_json::json!(format!("{content}\nsummary: copied prose"));
    });
    assert!(normalize_provider_dair_ai(&prose).is_err());
    let extra = FIXTURE.replacen('{', "{\"surprise\":true,", 1);
    assert!(normalize_provider_dair_ai(&extra).is_err());
}
