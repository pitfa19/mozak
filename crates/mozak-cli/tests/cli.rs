use std::process::Command;

const FIXTURE_PATH: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../spec/m0/fixtures/canonical-state.json"
);

#[test]
fn validate_and_replay_commands_work_end_to_end() {
    let binary = env!("CARGO_BIN_EXE_mozak");
    let validate = Command::new(binary)
        .args(["validate", FIXTURE_PATH])
        .output()
        .unwrap();
    assert!(
        validate.status.success(),
        "{}",
        String::from_utf8_lossy(&validate.stderr)
    );
    assert_eq!(
        String::from_utf8(validate.stdout).unwrap(),
        "validated 12 fixtures\n"
    );

    let replay = Command::new(binary)
        .args(["replay", FIXTURE_PATH])
        .output()
        .unwrap();
    assert!(
        replay.status.success(),
        "{}",
        String::from_utf8_lossy(&replay.stderr)
    );
    let output: serde_json::Value = serde_json::from_slice(&replay.stdout).unwrap();
    assert_eq!(output.as_array().unwrap().len(), 12);
    assert_eq!(
        output[0]["canonical_hash"],
        "d6c62e3365cc27225ad3c49744a4bc43f2db9f1d9ae1aa3eb6e34c580679b93a"
    );
}

#[test]
fn invalid_usage_and_invalid_json_fail() {
    let binary = env!("CARGO_BIN_EXE_mozak");
    assert!(!Command::new(binary).output().unwrap().status.success());
    assert!(
        !Command::new(binary)
            .args(["validate", "does-not-exist.json"])
            .output()
            .unwrap()
            .status
            .success()
    );
}
