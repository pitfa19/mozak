use serde_json::Value;
use std::{fs, path::PathBuf, process::Command};

fn scratch(name: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!(
        "mozak-distribution-{name}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir(&path).unwrap();
    path
}

fn run(args: &[&str]) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_mozak"))
        .args(args)
        .output()
        .unwrap()
}

#[test]
fn version_is_stable() {
    let output = run(&["--version"]);
    assert!(output.status.success());
    // Derived from the manifest rather than written out, because a hardcoded
    // literal makes every release bump look like a regression and trains the
    // releaser to edit the test without reading what it was asserting.
    assert_eq!(
        String::from_utf8(output.stdout).unwrap(),
        format!("mozak {}\n", env!("CARGO_PKG_VERSION"))
    );
}

#[test]
fn install_and_check_are_embedded_idempotent_and_deterministic() {
    let home = scratch("install");
    let home_arg = home.to_str().unwrap();
    let first = run(&["setup", "install", home_arg]);
    assert!(
        first.status.success(),
        "{}",
        String::from_utf8_lossy(&first.stderr)
    );
    let second = run(&["setup", "install", home_arg]);
    assert!(second.status.success());
    assert_eq!(first.stdout, second.stdout);
    let report: Value = serde_json::from_slice(&first.stdout).unwrap();
    assert_eq!(report["state"], "ready");
    assert_eq!(report["parity"], true);
    assert_eq!(report["embedded"], true);
    assert_eq!(report["checks"].as_array().unwrap().len(), 28);
    for root in [".agents", ".jcode", ".claude", ".codex"] {
        assert!(
            home.join(root)
                .join("skills/mozak/companion-recommendations.json")
                .is_file()
        );
        assert!(
            home.join(root)
                .join("skills/i-have-adhd/SKILL.md")
                .is_file()
        );
    }
    assert_eq!(
        report["companion_recommendations"]["policy"],
        "MOZAK-managed companions are version-matched embedded payloads; missing recommended companions are reported only and are never auto-installed"
    );
    assert_eq!(
        report["companion_recommendations"]["required"][0]["classification"],
        "required"
    );
    assert_eq!(
        report["companion_recommendations"]["managed"][0]["id"],
        "adhd-skill"
    );
    assert_eq!(
        report["companion_recommendations"]["managed"][0]["classification"],
        "managed"
    );
    assert_eq!(
        report["companion_recommendations"]["managed"][0]["status"],
        "present"
    );
    assert_eq!(
        report["companion_recommendations"]["recommended"][0]["id"],
        "mmdr"
    );
    let check = run(&["setup", "check", home_arg]);
    assert!(check.status.success());
    let check_report: Value = serde_json::from_slice(&check.stdout).unwrap();
    assert_eq!(check_report["state"], "ready");
    assert_eq!(check_report["checks"], report["checks"]);
    fs::remove_dir_all(home).unwrap();
}

#[test]
fn missing_is_incomplete_and_drift_is_refused_without_overwrite() {
    let home = scratch("drift");
    let home_arg = home.to_str().unwrap();
    let missing = run(&["setup", "check", home_arg]);
    assert_eq!(missing.status.code(), Some(2));
    run(&["setup", "install", home_arg]);
    let skill = home.join(".agents/skills/i-have-adhd/SKILL.md");
    fs::write(&skill, b"owner bytes\n").unwrap();
    let drift = run(&["setup", "install", home_arg]);
    assert_eq!(drift.status.code(), Some(3));
    assert_eq!(fs::read(&skill).unwrap(), b"owner bytes\n");
    fs::remove_dir_all(home).unwrap();
}

#[cfg(unix)]
#[test]
fn symlink_hazards_fail_closed() {
    use std::os::unix::fs::symlink;
    let home = scratch("symlink");
    let outside = scratch("outside");
    symlink(&outside, home.join(".agents")).unwrap();
    let output = run(&["setup", "install", home.to_str().unwrap()]);
    assert_eq!(output.status.code(), Some(3));
    assert!(output.stderr.is_empty());
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["state"], "invalid");
    assert!(
        report["checks"][0]["message"]
            .as_str()
            .unwrap()
            .contains("symlink")
    );
    assert!(fs::read_dir(&outside).unwrap().next().is_none());
    fs::remove_file(home.join(".agents")).unwrap();
    fs::remove_dir_all(home).unwrap();
    fs::remove_dir_all(outside).unwrap();
}

#[test]
fn doctor_reports_honest_incomplete_and_invalid_states() {
    let home = scratch("doctor");
    let output = Command::new(env!("CARGO_BIN_EXE_mozak"))
        .args(["doctor", home.to_str().unwrap()])
        .env("PATH", "")
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(2));
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["state"], "incomplete");
    let companion_check = report["checks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|check| check["name"] == "companion_recommendations")
        .unwrap();
    assert_eq!(companion_check["status"], "ready");
    assert_eq!(
        companion_check["companions"]["managed"][0]["id"],
        "adhd-skill"
    );
    assert_eq!(
        companion_check["companions"]["managed"][0]["classification"],
        "managed"
    );
    assert_eq!(
        companion_check["companions"]["recommended"][0]["id"],
        "mmdr"
    );
    assert_eq!(
        companion_check["companions"]["recommended"][0]["classification"],
        "recommended"
    );
    assert_eq!(
        report["trust"],
        "no automatic trust, authority, or package selection is inferred"
    );
    let invalid = run(&["doctor", home.to_str().unwrap(), "/does/not/exist"]);
    assert_eq!(invalid.status.code(), Some(3));
    fs::remove_dir_all(home).unwrap();
}

#[test]
fn companion_recommendations_detect_installed_skills_without_installing_missing_tools() {
    let home = scratch("companions");
    fs::create_dir_all(home.join(".jcode/skills/caveman")).unwrap();
    fs::create_dir_all(home.join(".claude/skills/archify")).unwrap();
    fs::create_dir_all(home.join(".codex/skills/excalidraw-skill")).unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_mozak"))
        .args(["setup", "check", home.to_str().unwrap()])
        .env("PATH", "")
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(2));
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    let recommended = report["companion_recommendations"]["recommended"]
        .as_array()
        .unwrap();
    assert_eq!(recommended[0]["id"], "mmdr");
    assert_eq!(recommended[0]["status"], "missing");
    assert_eq!(recommended[1]["status"], "present");
    assert_eq!(recommended[2]["status"], "present");
    assert_eq!(
        report["companion_recommendations"]["managed"][0]["status"],
        "missing"
    );
    assert!(!home.join(".agents/skills/mmdr").exists());
    fs::remove_dir_all(home).unwrap();
}

#[test]
fn unmanaged_binary_reports_honest_delivery_state_and_refuses_launcher_routes() {
    let status = run(&["delivery", "status"]);
    assert!(status.status.success());
    let report: Value = serde_json::from_slice(&status.stdout).unwrap();
    assert_eq!(report["command"], "delivery status");
    assert_eq!(report["state"]["installation"], "unmanaged");
    assert_eq!(report["networking"], "this binary performs no networking");
    assert_eq!(
        report["state_boundary"],
        "projects, registries, scopes, adapters, and KB roots are not delivery state"
    );
    for command in [
        vec!["update"],
        vec!["update", "--channel", "main"],
        vec!["rollback"],
    ] {
        let refused = run(&command);
        assert!(
            !refused.status.success(),
            "{command:?} unexpectedly succeeded"
        );
        assert!(refused.stdout.is_empty());
        let message = String::from_utf8(refused.stderr).unwrap();
        assert!(message.contains("managed launcher"), "{message}");
    }
}

#[test]
fn usage_documents_delivery_routes() {
    let output = run(&["nonexistent-command"]);
    assert!(!output.status.success());
    let usage = String::from_utf8(output.stderr).unwrap();
    assert!(usage.contains("mozak delivery status"), "{usage}");
    assert!(usage.contains("mozak update"), "{usage}");
    assert!(usage.contains("mozak rollback"), "{usage}");
}
