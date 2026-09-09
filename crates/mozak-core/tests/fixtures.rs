use mozak_core::{canonical_hash, parse_fixtures, replay, validate_fixture};

const FIXTURES: &str = include_str!("../../../spec/m0/fixtures/canonical-state.json");

#[test]
fn all_twelve_fixtures_match_expected_projection_and_hash() {
    let fixtures = parse_fixtures(FIXTURES).expect("fixtures deserialize");
    assert_eq!(fixtures.len(), 12);
    for fixture in fixtures {
        validate_fixture(&fixture).unwrap_or_else(|error| panic!("{}: {error}", fixture.id));
        let first = replay(&fixture.events).expect("first replay");
        let second = replay(&fixture.events).expect("second replay");
        assert_eq!(first, second, "{} is deterministic", fixture.id);
        assert_eq!(
            canonical_hash(&first).unwrap(),
            fixture.expected.canonical_hash
        );
    }
}

#[test]
fn duplicate_event_id_fails_closed() {
    let mut fixture = parse_fixtures(FIXTURES).unwrap().remove(0);
    fixture.events.push(fixture.events[0].clone());
    assert!(
        replay(&fixture.events)
            .unwrap_err()
            .to_string()
            .contains("duplicate event id")
    );
}

#[test]
fn non_increasing_generation_fails_closed() {
    let input = FIXTURES.replacen("\"generation\": 1", "\"generation\": 2", 1);
    let fixture = parse_fixtures(&input).unwrap().remove(0);
    assert!(
        replay(&fixture.events)
            .unwrap_err()
            .to_string()
            .contains("non-increasing generation")
    );
}

#[test]
fn stale_non_rejection_fails_closed() {
    let input = FIXTURES.replace("\"base_generation\": 1", "\"base_generation\": 0");
    let fixture = parse_fixtures(&input).unwrap().remove(0);
    assert!(
        replay(&fixture.events)
            .unwrap_err()
            .to_string()
            .contains("stale event was not rejected")
    );
}

#[test]
fn unknown_event_type_and_unknown_fields_are_rejected() {
    let unknown_type = FIXTURES.replacen("snapshot_created", "magic_event", 1);
    assert!(parse_fixtures(&unknown_type).is_err());
    let unknown_field = FIXTURES.replacen(
        "\"actor\": \"m0_fixture\"",
        "\"actor\": \"m0_fixture\", \"surprise\": true",
        1,
    );
    assert!(parse_fixtures(&unknown_field).is_err());
}

#[test]
fn canonical_json_is_compact_unicode_and_key_sorted() {
    let value = serde_json::json!({"z": "雪", "a": [2, 1]});
    assert_eq!(
        mozak_core::canonical_json(&value).unwrap(),
        "{\"a\":[2,1],\"z\":\"雪\"}"
    );
    assert_eq!(canonical_hash(&value).unwrap().len(), 64);
}
