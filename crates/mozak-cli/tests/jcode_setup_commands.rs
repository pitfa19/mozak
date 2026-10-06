use serde_json::Value;
use std::{fs, path::Path, process::Command};

fn home(name: &str) -> std::path::PathBuf {
    let path = std::env::temp_dir().join(format!(
        "mozak-jcode-{name}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir(&path).unwrap();
    path
}

fn run(action: &str, home: &Path, exit: i32) -> Value {
    let output = Command::new(env!("CARGO_BIN_EXE_mozak"))
        .args(["setup", "jcode", action, home.to_str().unwrap()])
        .output()
        .unwrap();
    assert_eq!(
        output.status.code(),
        Some(exit),
        "{} {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).unwrap()
}

#[test]
fn real_cli_plan_check_install_and_idempotency() {
    let home = home("fresh");
    let plan = run("plan", &home, 0);
    assert_eq!(plan["state"], "planned");
    assert!(!home.join(".jcode").exists());
    assert_eq!(run("check", &home, 2)["state"], "incomplete");
    assert!(!home.join(".jcode").exists());
    let installed = run("install", &home, 0);
    assert_eq!(installed["default_profile"], "low");
    assert_eq!(installed["teacher_default"], "off");
    assert_eq!(installed["runtime"]["verified"], false);
    assert_eq!(run("check", &home, 0)["state"], "ready");
    assert_eq!(run("install", &home, 0)["effects"]["mutation"], false);
    for name in ["swarm-low", "swarm-normal", "teacher", "mozak-jcode"] {
        assert!(
            home.join(format!(".jcode/skills/{name}/SKILL.md"))
                .is_file()
        );
        assert!(!home.join(format!(".claude/skills/{name}")).exists());
    }
    fs::remove_dir_all(home).unwrap();
}

#[test]
fn preserves_comments_unrelated_settings_overlay_credentials_and_backups() {
    let home = home("preserve");
    fs::create_dir(home.join(".jcode")).unwrap();
    let config = "# owner comment\n[provider]\nopenai_reasoning_effort = 'high' # keep me\nendpoint = 'private-test-only'\n[other]\nflags = [1, 2]\n";
    fs::write(home.join(".jcode/config.toml"), config).unwrap();
    fs::write(
        home.join(".jcode/prompt-overlay.md"),
        "# Owner\nKeep my prose.\n",
    )
    .unwrap();
    fs::write(
        home.join(".jcode/credentials.json"),
        "sentinel-not-a-real-credential",
    )
    .unwrap();
    let report = run("install", &home, 0);
    assert_eq!(report["backups"].as_array().unwrap().len(), 2);
    let merged = fs::read_to_string(home.join(".jcode/config.toml")).unwrap();
    assert!(merged.contains("\"low\" # keep me"));
    assert!(merged.contains("endpoint = 'private-test-only'"));
    assert!(merged.contains("flags = [1, 2]"));
    let overlay = fs::read_to_string(home.join(".jcode/prompt-overlay.md")).unwrap();
    assert!(overlay.starts_with("# Owner\nKeep my prose.\n"));
    assert_eq!(
        fs::read_to_string(home.join(".jcode/credentials.json")).unwrap(),
        "sentinel-not-a-real-credential"
    );
    assert_eq!(run("install", &home, 0)["changes"], serde_json::json!([]));
    for backup in report["backups"].as_array().unwrap() {
        let saved = fs::read_to_string(home.join(backup.as_str().unwrap())).unwrap();
        assert!(saved == config || saved == "# Owner\nKeep my prose.\n");
    }
    fs::remove_dir_all(home).unwrap();
}

#[test]
fn malformed_and_ambiguous_toml_refuse_before_any_skill_write() {
    for content in [
        "[provider\n",
        "provider = { openai_reasoning_effort = 'high' }\n",
        "[provider]\n\"openai_reasoning_effort\" = 'high'\n",
    ] {
        let home = home("invalid");
        fs::create_dir(home.join(".jcode")).unwrap();
        fs::write(home.join(".jcode/config.toml"), content).unwrap();
        assert_eq!(run("install", &home, 3)["state"], "invalid");
        assert_eq!(
            fs::read_to_string(home.join(".jcode/config.toml")).unwrap(),
            content
        );
        assert!(!home.join(".jcode/skills").exists());
        fs::remove_dir_all(home).unwrap();
    }
}

#[test]
fn base_setup_ships_invocations_but_never_opts_in_and_drift_is_refused() {
    let home = home("base");
    let output = Command::new(env!("CARGO_BIN_EXE_mozak"))
        .args(["setup", "install", home.to_str().unwrap()])
        .output()
        .unwrap();
    assert!(output.status.success());
    assert!(!home.join(".jcode/config.toml").exists());
    assert!(!home.join(".jcode/swarm-prompt.md").exists());
    fs::write(
        home.join(".jcode/skills/swarm-normal/SKILL.md"),
        "owner customized",
    )
    .unwrap();
    assert_eq!(run("install", &home, 3)["state"], "invalid");
    assert!(!home.join(".jcode/config.toml").exists());
    fs::remove_dir_all(home).unwrap();
}

#[cfg(unix)]
#[test]
fn home_ancestor_directory_and_leaf_symlinks_are_refused() {
    use std::os::unix::fs::symlink;
    let root = home("links");
    let real = root.join("real");
    fs::create_dir(&real).unwrap();
    let alias = root.join("alias");
    symlink(&real, &alias).unwrap();
    assert_eq!(run("install", &alias, 3)["state"], "invalid");
    let child = real.join("child");
    fs::create_dir(&child).unwrap();
    assert_eq!(run("install", &alias.join("child"), 3)["state"], "invalid");
    symlink(&child, real.join(".jcode")).unwrap();
    assert_eq!(run("install", &real, 3)["state"], "invalid");
    fs::remove_file(real.join(".jcode")).unwrap();
    fs::create_dir(real.join(".jcode")).unwrap();
    fs::write(root.join("outside"), "untouched").unwrap();
    symlink(root.join("outside"), real.join(".jcode/config.toml")).unwrap();
    assert_eq!(run("install", &real, 3)["state"], "invalid");
    assert_eq!(
        fs::read_to_string(root.join("outside")).unwrap(),
        "untouched"
    );
    fs::remove_dir_all(root).unwrap();
}
