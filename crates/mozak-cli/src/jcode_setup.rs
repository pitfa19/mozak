use serde_json::json;
use std::{
    io::Write,
    path::Path,
    process::{Command, ExitCode, Stdio},
};

pub const SKILLS: [&str; 4] = ["swarm-low", "swarm-normal", "teacher", "mozak-jcode"];
pub const SKILL_FILES: [[(&str, &[u8]); 1]; 4] = [
    [(
        "SKILL.md",
        include_bytes!("../../../skills/swarm-low/SKILL.md"),
    )],
    [(
        "SKILL.md",
        include_bytes!("../../../skills/swarm-normal/SKILL.md"),
    )],
    [(
        "SKILL.md",
        include_bytes!("../../../skills/teacher/SKILL.md"),
    )],
    [(
        "SKILL.md",
        include_bytes!("../../../skills/mozak-jcode/SKILL.md"),
    )],
];

pub fn setup(action: &str, home: &Path) -> ExitCode {
    if !["plan", "install", "check"].contains(&action) {
        eprintln!("usage: mozak setup jcode <plan|install|check> <HOME>");
        return ExitCode::FAILURE;
    }
    let mut payload = serde_json::Map::new();
    for (name, files) in SKILLS.iter().zip(SKILL_FILES.iter()) {
        payload.insert(
            format!(".jcode/skills/{name}/SKILL.md"),
            json!(std::str::from_utf8(files[0].1).expect("embedded UTF-8 skill")),
        );
    }
    payload.insert(
        ".jcode/swarm-prompt.md".into(),
        json!(include_str!("../../../skills/mozak-jcode/swarm-prompt.md")),
    );
    payload.insert(
        ".jcode/prompt-overlay.md".into(),
        json!(include_str!(
            "../../../skills/mozak-jcode/prompt-overlay.md"
        )),
    );
    let result = (|| -> std::io::Result<_> {
        let mut child = Command::new("python3")
            .arg("-I")
            .arg("-c")
            .arg(include_str!("../../../skills/mozak-jcode/setup_jcode.py"))
            .arg(action)
            .arg(home)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;
        let bytes = serde_json::to_vec(&payload)?;
        child.stdin.take().expect("piped stdin").write_all(&bytes)?;
        child.wait_with_output()
    })();
    match result {
        Ok(output) if !output.stdout.is_empty() => {
            if std::io::stdout().write_all(&output.stdout).is_err() {
                return ExitCode::FAILURE;
            }
            ExitCode::from(u8::try_from(output.status.code().unwrap_or(3)).unwrap_or(3))
        }
        _ => {
            eprintln!("Jcode setup requires Python 3.11+ on PATH and an accessible real HOME");
            ExitCode::from(3)
        }
    }
}
