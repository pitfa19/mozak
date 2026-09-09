use mozak_core::meta_kb::{MetaProject, ValidatedMetaKb, load_meta_kb};
use serde::Serialize;
use std::{
    env,
    fmt::Write as _,
    io::Write,
    path::Path,
    process::{Command, ExitCode, Stdio},
};

#[derive(Serialize)]
struct Validation<'a> {
    schema_version: u64,
    command: &'static str,
    meta_kb_root: String,
    projects: &'a [MetaProject],
    relationship_count: usize,
}

pub fn validate(root: &Path) -> Result<ExitCode, String> {
    let kb = load_meta_kb(root).map_err(|e| e.to_string())?;
    let root = root
        .canonicalize()
        .map_err(|e| format!("cannot resolve Meta KB root: {e}"))?;
    let mut projects = kb.manifest.projects.clone();
    projects.sort_by(|a, b| a.project_id.cmp(&b.project_id));
    println!(
        "{}",
        serde_json::to_string(&Validation {
            schema_version: 1,
            command: "meta validate",
            meta_kb_root: root.to_string_lossy().into_owned(),
            projects: &projects,
            relationship_count: kb.manifest.relationships.len()
        })
        .map_err(|e| e.to_string())?
    );
    Ok(ExitCode::SUCCESS)
}
pub fn list(root: &Path) -> Result<ExitCode, String> {
    let kb = load_meta_kb(root).map_err(|e| e.to_string())?;
    print!("{}", render_list(&kb));
    Ok(ExitCode::SUCCESS)
}
pub fn graph_source(root: &Path) -> Result<ExitCode, String> {
    let kb = load_meta_kb(root).map_err(|e| e.to_string())?;
    print!("{}", mermaid(&kb));
    Ok(ExitCode::SUCCESS)
}
pub fn graph(root: &Path) -> Result<ExitCode, String> {
    let kb = load_meta_kb(root).map_err(|e| e.to_string())?;
    let source = mermaid(&kb);
    let executable = env::var("MOZAK_TERMAID").unwrap_or_else(|_| "termaid".into());
    let mut child = Command::new(&executable)
        .stdin(Stdio::piped())
        .stdout(Stdio::inherit())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("cannot run Termaid executable {executable:?}: {e}"))?;
    // A Termaid that fails immediately can close stdin before the source is
    // written. Reporting that broken pipe would hide the child's real error,
    // so the write failure is held and only surfaces if the child succeeded
    // anyway, which would mean the source never arrived.
    let write_failed = child
        .stdin
        .take()
        .ok_or_else(|| "cannot open Termaid stdin".to_owned())?
        .write_all(source.as_bytes())
        .err();
    let output = child
        .wait_with_output()
        .map_err(|e| format!("cannot wait for Termaid: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "Termaid failed with {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    if let Some(error) = write_failed {
        return Err(format!("cannot write Termaid stdin: {error}"));
    }
    Ok(ExitCode::SUCCESS)
}
fn render_list(kb: &ValidatedMetaKb) -> String {
    let mut projects = kb.manifest.projects.clone();
    projects.sort_by(|a, b| a.project_id.cmp(&b.project_id));
    let mut relations = kb.manifest.relationships.clone();
    relations.sort();
    let mut out = String::from("Projects:\n");
    for p in projects {
        let _ = writeln!(
            out,
            "  {} @ {} ({})",
            p.project_id, p.release_id, p.release_path
        );
    }
    out.push_str("Relationships:\n");
    if relations.is_empty() {
        out.push_str("  (none)\n");
    } else {
        for r in relations {
            let _ = writeln!(
                out,
                "  {} -[{}]-> {}",
                r.from_project_id, r.relationship, r.to_project_id
            );
        }
    }
    out
}
fn mermaid(kb: &ValidatedMetaKb) -> String {
    let mut projects = kb.manifest.projects.clone();
    projects.sort_by(|a, b| a.project_id.cmp(&b.project_id));
    let mut relations = kb.manifest.relationships.clone();
    relations.sort();
    let mut out = String::from("flowchart LR\n");
    for (i, p) in projects.iter().enumerate() {
        let _ = writeln!(
            out,
            "  p{i}[\"{}\\n{}\"]",
            escape(&p.project_id),
            escape(&p.release_id)
        );
    }
    for r in relations {
        let from = projects
            .iter()
            .position(|p| p.project_id == r.from_project_id)
            .expect("validated endpoint");
        let to = projects
            .iter()
            .position(|p| p.project_id == r.to_project_id)
            .expect("validated endpoint");
        let _ = writeln!(out, "  p{from} -->|{}| p{to}", r.relationship.as_str());
    }
    out
}
fn escape(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('|', "\\|")
        .replace('\n', " ")
}
