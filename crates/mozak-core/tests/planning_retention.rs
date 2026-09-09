use mozak_core::planning::{
    INPUT_SET_CONTRACT_VERSION, InputRetention, effective_retention, validate_input_set_json,
    verify_condensation,
};

fn input_set(version: u64, retention: Option<&str>) -> String {
    let field = retention.map_or(String::new(), |value| format!(r#""retention":"{value}","#));
    format!(
        r#"{{"contract_version":{version},"id":"inputs-test","accepted_at":"2026-09-06T00:00:00Z",
        "inputs":[{{"id":"input-one","text":"Exact binding wording.",{field}
        "provenance":{{"kind":"human_decision","decision_id":"d-1","actor":"owner"}}}}]}}"#
    )
}

#[test]
fn v2_requires_retention_and_names_the_offending_input() {
    let missing = validate_input_set_json(&input_set(2, None)).unwrap_err();
    assert!(missing.0.contains("input-one"), "{}", missing.0);
    assert!(missing.0.contains("retention"), "{}", missing.0);

    let unknown = validate_input_set_json(&input_set(2, Some("whatever"))).unwrap_err();
    assert!(
        unknown.0.contains("unknown variant") && unknown.0.contains("constraint"),
        "{}",
        unknown.0
    );

    for declared in ["constraint", "observation"] {
        let set = validate_input_set_json(&input_set(2, Some(declared))).expect(declared);
        assert_eq!(set.inputs[0].retention.unwrap().as_str(), declared);
    }
}

#[test]
fn v1_input_sets_remain_readable_so_sealed_releases_stay_valid() {
    // A release pins the exact bytes of the input set it came from. Requiring
    // the new field at v1 would have invalidated published state.
    let set = validate_input_set_json(&input_set(1, None)).expect("v1 must still validate");
    assert!(set.inputs[0].retention.is_none());
    // An undeclared input is treated as binding, because it cannot be known
    // safe to condense.
    assert_eq!(
        effective_retention(&set.inputs[0]),
        InputRetention::Constraint
    );
    assert!(validate_input_set_json(&input_set(3, Some("constraint"))).is_err());
    assert_eq!(INPUT_SET_CONTRACT_VERSION, 2);
}

#[test]
fn condensation_must_preserve_constraint_text_verbatim() {
    let set = validate_input_set_json(&input_set(2, Some("constraint"))).unwrap();
    verify_condensation(&set, "Preamble. Exact binding wording. Trailer.").expect("verbatim");

    let paraphrased = verify_condensation(&set, "Roughly: exact binding wording").unwrap_err();
    assert!(paraphrased.0.contains("input-one"), "{}", paraphrased.0);
    assert!(paraphrased.0.contains("verbatim"), "{}", paraphrased.0);

    let dropped = verify_condensation(&set, "Summary without it.").unwrap_err();
    assert!(dropped.0.contains("input-one"), "{}", dropped.0);
}

#[test]
fn an_observation_may_be_condensed_but_a_legacy_input_may_not() {
    let observation = validate_input_set_json(&input_set(2, Some("observation"))).unwrap();
    verify_condensation(&observation, "Shortened.").expect("observations may be condensed");

    let legacy = validate_input_set_json(&input_set(1, None)).unwrap();
    assert!(
        verify_condensation(&legacy, "Shortened.").is_err(),
        "an undeclared legacy input must be preserved, not silently condensed"
    );
}
