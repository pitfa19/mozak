use mozak_core::research::{
    export_planning_inputs, normalize_provider_alpha, normalize_provider_beta, run_artifact_hash,
};

const ALPHA: &str = include_str!("fixtures/research/provider-alpha.json");
const BETA: &str = include_str!("fixtures/research/provider-beta.json");

#[test]
fn recorded_provider_adapters_normalize_to_contract_equivalent_artifacts() {
    let alpha = normalize_provider_alpha(ALPHA).expect("provider alpha fixture must normalize");
    let beta = normalize_provider_beta(BETA).expect("provider beta fixture must normalize");

    assert_eq!(alpha, beta);
    assert_eq!(
        run_artifact_hash(&alpha).unwrap(),
        run_artifact_hash(&beta).unwrap()
    );
    assert_eq!(
        export_planning_inputs(&alpha).unwrap(),
        export_planning_inputs(&beta).unwrap()
    );
}

#[test]
fn adapters_are_strict_about_recorded_envelopes() {
    let alpha = ALPHA.replace("adapter-recorded-v1", "adapter-wrong");
    assert!(normalize_provider_alpha(&alpha).is_err());

    let beta = BETA.replace("\"contract\": 1", "\"contract\": 2");
    assert!(normalize_provider_beta(&beta).is_err());
}
