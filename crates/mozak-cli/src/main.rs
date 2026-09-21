use mozak_core::{
    canonical_hash, parse_fixtures,
    project_contract::{validate_idea_markdown, validate_project_yaml},
    project_release::{generate_project_release, write_release_new},
    replay, validate_fixture,
};
use std::{
    env, fs,
    io::Write,
    path::{Path, PathBuf},
    process::ExitCode,
};

mod adapter_workflow;
mod case_workflow;
mod concept_workflow;
mod distribution;
mod kb_workflow;
mod lab_workflow;
mod lifecycle;
mod meta_transfer_workflow;
mod meta_workflow;
mod package_workflow;
mod project_registry;
mod project_workflow;
mod scope_workflow;

const PROJECT_FILE: &str = ".mozak/project.yml";
const IDEA_FILE: &str = ".mozak/idea.md";

#[derive(Clone, Copy, PartialEq, Eq)]
enum ProjectState {
    Valid,
    Incomplete,
    Invalid,
}

impl ProjectState {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Valid => "valid",
            Self::Incomplete => "incomplete",
            Self::Invalid => "invalid",
        }
    }

    fn exit_code(self) -> ExitCode {
        match self {
            Self::Valid => ExitCode::SUCCESS,
            Self::Incomplete => ExitCode::from(2),
            Self::Invalid => ExitCode::from(3),
        }
    }
}

struct ProjectReport {
    state: ProjectState,
    checks: Vec<serde_json::Value>,
}

/// Routes the public knowledge-package commands.
fn run_package_command(args: &[String]) -> Result<ExitCode, String> {
    match args
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>()
        .as_slice()
    {
        ["history", "validate", roots @ ..] if !roots.is_empty() => {
            package_workflow::history_validate(&roots.iter().map(PathBuf::from).collect::<Vec<_>>())
        }
        ["validate", root] => package_workflow::validate(Path::new(root)),
        ["attest", root] => package_workflow::attest(Path::new(root)),
        ["list", root] => package_workflow::list(Path::new(root)),
        _ => Err(usage()),
    }
}

/// Routes the public Concept and Translation commands.
fn run_concept_command(args: &[String]) -> Result<ExitCode, String> {
    match args
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>()
        .as_slice()
    {
        ["translation", "validate", concept, translation] => {
            concept_workflow::translation_validate(Path::new(concept), Path::new(translation))
        }
        ["list", concept, translation] => {
            concept_workflow::list(Path::new(concept), Some(Path::new(translation)))
        }
        ["validate", concept] => concept_workflow::validate(Path::new(concept)),
        ["list", concept] => concept_workflow::list(Path::new(concept), None),
        _ => Err(usage()),
    }
}

/// Routes the public Scope commands.
fn run_scope_command(args: &[String]) -> Result<ExitCode, String> {
    match args
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>()
        .as_slice()
    {
        [
            "ingest-links",
            scope_root,
            source_root,
            revision,
            plan,
            output,
        ] => scope_workflow::ingest(
            Path::new(scope_root),
            Path::new(source_root),
            revision,
            Path::new(plan),
            Path::new(output),
        ),
        [
            "source-check",
            root,
            source_id,
            source_root,
            observed_revision,
        ] => scope_workflow::source_check(
            Path::new(root),
            source_id,
            Path::new(source_root),
            observed_revision,
        ),
        ["init", root, id, title, intent] => {
            scope_workflow::init(Path::new(root), id, title, intent)
        }
        ["add-topic", root, id, title, intent] => {
            scope_workflow::add_topic(Path::new(root), id, title, intent)
        }
        ["add-project", root, id, title, intent, project_root] => {
            scope_workflow::add_project(Path::new(root), id, title, intent, Path::new(project_root))
        }
        ["add-goal", root, id, title, scope_ids @ ..] if !scope_ids.is_empty() => {
            scope_workflow::add_goal(
                Path::new(root),
                id,
                title,
                &scope_ids
                    .iter()
                    .map(|value| (*value).to_owned())
                    .collect::<Vec<_>>(),
            )
        }
        [command, root] => scope_workflow::run(command, Path::new(root)),
        _ => Err(usage()),
    }
}

#[allow(clippy::too_many_lines)]
fn run() -> Result<ExitCode, String> {
    let args = env::args().skip(1).collect::<Vec<_>>();
    if let Some(result) = run_distribution_command(&args) {
        return result;
    }
    if let Some(result) = run_project_registry_command(&args) {
        return result;
    }
    match args.as_slice() {
        [research, command, adapter, fixture, output]
            if research == "research" && command == "normalize" =>
        {
            lifecycle::research_normalize(adapter, Path::new(fixture), Path::new(output))?;
            Ok(ExitCode::SUCCESS)
        }
        [research, command, run, index] if research == "research" && command == "landmarks" => {
            lifecycle::landmarks_validate(Path::new(run), Path::new(index))?;
            Ok(ExitCode::SUCCESS)
        }
        [research, command, path] if research == "research" && command == "validate" => {
            lifecycle::research_validate(Path::new(path))?;
            Ok(ExitCode::SUCCESS)
        }
        [planning, compact, command, root, output, generated_at]
            if planning == "planning" && compact == "compact" && command == "plan" =>
        {
            lifecycle::planning_compact_plan(Path::new(root), Path::new(output), generated_at)?;
            Ok(ExitCode::SUCCESS)
        }
        [planning, compact, command, root, plan, approval]
            if planning == "planning" && compact == "compact" && command == "apply" =>
        {
            lifecycle::planning_compact_apply(
                Path::new(root),
                Path::new(plan),
                Path::new(approval),
            )?;
            Ok(ExitCode::SUCCESS)
        }
        [planning, compact, command, root, index, approval, output]
            if planning == "planning" && compact == "compact" && command == "restore" =>
        {
            lifecycle::planning_compact_restore(
                Path::new(root),
                Path::new(index),
                Path::new(approval),
                Path::new(output),
            )?;
            Ok(ExitCode::SUCCESS)
        }
        [planning, command, inputs, plan] if planning == "planning" && command == "next" => {
            lifecycle::planning_next(Path::new(inputs), Path::new(plan))?;
            Ok(ExitCode::SUCCESS)
        }
        [execution, command, bundle, revision, observed_at]
            if execution == "execution" && command == "validate" =>
        {
            lifecycle::execution_validate(Path::new(bundle), revision, observed_at)?;
            Ok(ExitCode::SUCCESS)
        }
        [command, path] if command == "validate" || command == "replay" => {
            run_fixture_command(command, path)?;
            Ok(ExitCode::SUCCESS)
        }
        [package, rest @ ..] if package == "package" => run_package_command(rest),
        [case, command, path] if case == "case" && command == "validate" => {
            case_workflow::validate(Path::new(path))
        }
        [case, command, path] if case == "case" && command == "reproduce-packet" => {
            case_workflow::reproduce_packet(Path::new(path))
        }
        [case, command, path] if case == "case" && command == "list" => {
            case_workflow::list(Path::new(path))
        }
        [concept, rest @ ..] if concept == "concept" => run_concept_command(rest),
        [kb, concept, command, target, research_runs @ ..]
            if kb == "kb" && concept == "concept" && command == "candidates" =>
        {
            meta_transfer_workflow::candidates(target, research_runs)
        }
        [kb, concept, command, target, concept_id, concept_sha256]
            if kb == "kb" && concept == "concept" && command == "translation-packet" =>
        {
            meta_transfer_workflow::translation_packet(target, concept_id, concept_sha256)
        }
        [meta, command, root] if meta == "meta" => run_meta_command(command, Path::new(root)),
        [kb, command, root, id, scope_root] if kb == "kb" && command == "register" => {
            kb_workflow::register(Path::new(root), id, Path::new(scope_root))
        }
        [kb, command, root, id, scope_root] if kb == "kb" && command == "repin" => {
            kb_workflow::repin(Path::new(root), id, Path::new(scope_root))
        }
        [kb, command, root, observations] if kb == "kb" && command == "parity" => {
            kb_workflow::parity(Path::new(root), Path::new(observations))
        }
        [kb, command, package, registry, approval, output]
            if kb == "kb" && command == "import-package" =>
        {
            kb_workflow::import(
                Path::new(package),
                Path::new(registry),
                Path::new(approval),
                Path::new(output),
            )
        }
        [kb, command, rest @ ..] if kb == "kb" && command == "tree" => kb_workflow::tree(rest),
        [kb, command, root] if kb == "kb" => kb_workflow::run(command, Path::new(root)),
        [kb, command] if kb == "kb" => kb_workflow::run_current(command),
        [project, command] if project == "project" => run_project_command(command, Path::new(".")),
        [project, command, path] if project == "project" => {
            run_project_command(command, Path::new(path))
        }
        [project, command, root, accepted_state, output]
            if project == "project" && command == "release" =>
        {
            generate_release(
                Path::new(root),
                Path::new(accepted_state),
                Path::new(output),
            )
        }
        _ => Err(usage()),
    }
}

fn run_project_registry_command(args: &[String]) -> Option<Result<ExitCode, String>> {
    match args {
        [project, command, kb_root, roots @ ..]
            if project == "project" && command == "discover" && !roots.is_empty() =>
        {
            Some(project_registry::discover(
                Path::new(kb_root),
                &roots.iter().map(PathBuf::from).collect::<Vec<_>>(),
            ))
        }
        [project, command, discovery, approval]
            if project == "project" && command == "register" =>
        {
            Some(project_registry::register(
                Path::new(discovery),
                Path::new(approval),
            ))
        }
        [project, command, discovery] if project == "project" && command == "review" => {
            Some(project_registry::review(Path::new(discovery)))
        }
        [project, command] if project == "project" && command == "registrations" => {
            Some(project_registry::registrations())
        }
        [project, refresh, command]
            if project == "project" && refresh == "refresh" && command == "history" =>
        {
            Some(project_registry::refresh_history())
        }
        [project, refresh, command, digest]
            if project == "project" && refresh == "refresh" && command == "rollback" =>
        {
            Some(project_registry::refresh_rollback(digest))
        }
        [project, command, discovery, approval] if project == "project" && command == "refresh" => {
            Some(project_registry::refresh(
                Path::new(discovery),
                Path::new(approval),
            ))
        }
        [project, command, id] if project == "project" && command == "context" => Some(
            project_registry::context(id, project_registry::ContextOutputMode::Auto),
        ),
        [project, command, id, flag]
            if project == "project" && command == "context" && flag == "--json" =>
        {
            Some(project_registry::context(
                id,
                project_registry::ContextOutputMode::Json,
            ))
        }
        [project, command, id, flag]
            if project == "project" && command == "context" && flag == "--human" =>
        {
            Some(project_registry::context(
                id,
                project_registry::ContextOutputMode::Human,
            ))
        }
        _ => None,
    }
}

fn run_distribution_command(args: &[String]) -> Option<Result<ExitCode, String>> {
    match args {
        [adapter, rest @ ..] if adapter == "adapter" => Some(adapter_workflow::run(rest)),
        [lab, rest @ ..] if lab == "lab" => Some(lab_workflow::run(rest)),
        [scope, rest @ ..] if scope == "scope" => Some(run_scope_command(rest)),
        [flag] if flag == "--version" || flag == "-V" => {
            println!("mozak {}", env!("CARGO_PKG_VERSION"));
            Some(Ok(ExitCode::SUCCESS))
        }
        [setup, command, home, rest @ ..] if setup == "setup" => {
            Some(distribution::setup(command, Path::new(home), rest))
        }
        [doctor, home] if doctor == "doctor" => Some(distribution::doctor(Path::new(home), None)),
        [doctor, home, kb_root] if doctor == "doctor" => Some(distribution::doctor(
            Path::new(home),
            Some(Path::new(kb_root)),
        )),
        [delivery, command] if delivery == "delivery" && command == "status" => {
            Some(distribution::delivery_status())
        }
        [command, ..] if command == "update" || command == "rollback" => {
            Some(distribution::delivery_unavailable(command))
        }
        _ => None,
    }
}

fn generate_release(root: &Path, accepted_state: &Path, output: &Path) -> Result<ExitCode, String> {
    if !root.is_dir() {
        return Err(format!(
            "project path is not a directory: {}",
            root.display()
        ));
    }
    let manifest_path = root.join(PROJECT_FILE);
    let project = fs::read_to_string(&manifest_path)
        .map_err(|error| format!("cannot read {}: {error}", manifest_path.display()))?;
    let manifest = validate_project_yaml(&project).map_err(|error| error.to_string())?;
    let input = fs::read_to_string(accepted_state)
        .map_err(|error| format!("cannot read {}: {error}", accepted_state.display()))?;
    let generated = generate_project_release(&input).map_err(|error| error.to_string())?;
    if generated.release.project.id != manifest.project.id {
        return Err("accepted state project.id does not match project manifest".into());
    }
    if generated.release.project.name != manifest.project.name {
        return Err("accepted state project.name does not match project manifest".into());
    }
    write_release_new(output, &generated).map_err(|error| error.to_string())?;
    println!(
        "{}",
        serde_json::to_string(&serde_json::json!({
            "schema_version": 1,
            "command": "project release",
            "project_root": display_root(root)?,
            "output": output.to_string_lossy(),
            "release_id": generated.release.release_id,
            "sha256": generated.sha256,
            "bytes": generated.canonical_bytes.len()
        }))
        .map_err(|error| error.to_string())?
    );
    Ok(ExitCode::SUCCESS)
}

fn run_fixture_command(command: &str, path: &str) -> Result<(), String> {
    let input = fs::read_to_string(path).map_err(|error| format!("cannot read {path}: {error}"))?;
    let fixtures = parse_fixtures(&input).map_err(|error| error.to_string())?;
    match command {
        "validate" => {
            for fixture in &fixtures {
                validate_fixture(fixture).map_err(|error| error.to_string())?;
            }
            println!("validated {} fixtures", fixtures.len());
        }
        "replay" => {
            let output = fixtures
                .iter()
                .map(|fixture| {
                    let projection = replay(&fixture.events).map_err(|error| error.to_string())?;
                    let hash = canonical_hash(&projection).map_err(|error| error.to_string())?;
                    Ok(serde_json::json!({"id": fixture.id, "projection": projection, "canonical_hash": hash}))
                })
                .collect::<Result<Vec<_>, String>>()?;
            println!(
                "{}",
                serde_json::to_string_pretty(&output).map_err(|error| error.to_string())?
            );
        }
        _ => return Err(usage()),
    }
    Ok(())
}

fn run_meta_command(command: &str, root: &Path) -> Result<ExitCode, String> {
    match command {
        "validate" => meta_workflow::validate(root),
        "list" => meta_workflow::list(root),
        "graph-source" => meta_workflow::graph_source(root),
        "graph" => meta_workflow::graph(root),
        _ => Err(usage()),
    }
}

fn run_project_command(command: &str, root: &Path) -> Result<ExitCode, String> {
    if !root.is_dir() {
        return Err(format!(
            "project path is not a directory: {}",
            root.display()
        ));
    }
    match command {
        "init" => initialize_project(root),
        "overview" => project_workflow::overview(root),
        "list" => project_workflow::list(root),
        "graph-source" => project_workflow::graph_source(root),
        "graph" => project_workflow::graph(root),
        "status" | "validate" => {
            let report = inspect_project(root);
            print_project_report(command, root, &report, None)?;
            if command == "status" && report.state == ProjectState::Incomplete {
                Ok(ExitCode::SUCCESS)
            } else {
                Ok(report.state.exit_code())
            }
        }
        _ => Err(usage()),
    }
}

fn initialize_project(root: &Path) -> Result<ExitCode, String> {
    let control_root = root.join(".mozak");
    if control_root.exists() && !control_root.is_dir() {
        let report = ProjectReport {
            state: ProjectState::Invalid,
            checks: vec![check(
                ".mozak",
                "invalid",
                ".mozak exists but is not a directory",
            )],
        };
        print_project_report("init", root, &report, Some(Vec::new()))?;
        return Ok(report.state.exit_code());
    }
    fs::create_dir_all(&control_root)
        .map_err(|error| format!("cannot create {}: {error}", control_root.display()))?;

    let mut created = Vec::new();
    create_new(
        &root.join(PROJECT_FILE),
        &project_template(root)?,
        PROJECT_FILE,
        &mut created,
    )?;
    create_new(
        &root.join(IDEA_FILE),
        &idea_template(root),
        IDEA_FILE,
        &mut created,
    )?;

    let report = inspect_project(root);
    print_project_report("init", root, &report, Some(created))?;
    Ok(report.state.exit_code())
}

fn create_new(
    path: &Path,
    contents: &str,
    label: &str,
    created: &mut Vec<String>,
) -> Result<(), String> {
    if path.exists() {
        return Ok(());
    }
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    let mut file = options
        .open(path)
        .map_err(|error| format!("cannot create {}: {error}", path.display()))?;
    file.write_all(contents.as_bytes())
        .map_err(|error| format!("cannot write {}: {error}", path.display()))?;
    created.push(label.to_owned());
    Ok(())
}

fn inspect_project(root: &Path) -> ProjectReport {
    let mut checks = Vec::new();
    let mut state = ProjectState::Valid;
    inspect_file(
        root,
        PROJECT_FILE,
        |input| {
            validate_project_yaml(input)
                .map(|_| ())
                .map_err(|error| error.to_string())
        },
        &mut state,
        &mut checks,
    );
    inspect_file(
        root,
        IDEA_FILE,
        |input| {
            validate_idea_markdown(input)
                .map(|_| ())
                .map_err(|error| error.to_string())
        },
        &mut state,
        &mut checks,
    );
    ProjectReport { state, checks }
}

fn inspect_file(
    root: &Path,
    relative: &str,
    validator: impl FnOnce(&str) -> Result<(), String>,
    state: &mut ProjectState,
    checks: &mut Vec<serde_json::Value>,
) {
    let path = root.join(relative);
    match fs::read_to_string(&path) {
        Ok(input) => match validator(&input) {
            Ok(()) => checks.push(check(relative, "valid", "contract validation passed")),
            Err(message) => {
                *state = ProjectState::Invalid;
                checks.push(check(relative, "invalid", &message));
            }
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            if *state != ProjectState::Invalid {
                *state = ProjectState::Incomplete;
            }
            checks.push(check(relative, "missing", "required file is missing"));
        }
        Err(error) => {
            *state = ProjectState::Invalid;
            checks.push(check(
                relative,
                "invalid",
                &format!("cannot read file: {error}"),
            ));
        }
    }
}

fn check(path: &str, status: &str, message: &str) -> serde_json::Value {
    serde_json::json!({"path": path, "status": status, "message": message})
}

fn print_project_report(
    command: &str,
    root: &Path,
    report: &ProjectReport,
    created: Option<Vec<String>>,
) -> Result<(), String> {
    let root = display_root(root)?;
    let mut output = serde_json::json!({
        "schema_version": 1,
        "command": command,
        "project_root": root,
        "state": report.state.as_str(),
        "checks": report.checks,
    });
    if let Some(created) = created {
        output["created"] = serde_json::json!(created);
    }
    println!(
        "{}",
        serde_json::to_string_pretty(&output).map_err(|error| error.to_string())?
    );
    Ok(())
}

fn display_root(root: &Path) -> Result<String, String> {
    root.canonicalize()
        .map(|path| path.to_string_lossy().into_owned())
        .map_err(|error| format!("cannot resolve project path {}: {error}", root.display()))
}

fn project_template(root: &Path) -> Result<String, String> {
    let name = root
        .canonicalize()
        .map_err(|error| format!("cannot resolve project path {}: {error}", root.display()))?
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("project")
        .to_owned();
    let id = project_id(&name);
    let revision =
        read_revision(root).unwrap_or_else(|| "0000000000000000000000000000000000000000".into());
    Ok(format!(
        "version: 1\nframework_contract_version: 1\nproject:\n  id: {id}\n  name: {name:?}\nrepository:\n  revision: {revision}\nowned_paths:\n  - .mozak\n"
    ))
}

fn idea_template(root: &Path) -> String {
    let name = root
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Project");
    format!(
        "# {name}\n\n## Intent\n\nDescribe and maintain this project's agreed direction.\n\n## Desired outcomes\n\nProduce useful, reviewable outcomes for the project's users.\n\n## Boundaries\n\nKeep work within the repository and require explicit approval for external effects.\n\n## Assumptions\n\nThe repository contents and owner decisions are the authoritative local context.\n\n## Open questions\n\nWhich outcomes and constraints should be refined next?\n"
    )
}

fn project_id(name: &str) -> String {
    let mut id = String::new();
    let mut hyphen = false;
    for byte in name.bytes() {
        if byte.is_ascii_alphanumeric() {
            if hyphen && !id.is_empty() {
                id.push('-');
            }
            id.push(char::from(byte.to_ascii_lowercase()));
            hyphen = false;
        } else {
            hyphen = true;
        }
    }
    if id.is_empty() { "project".into() } else { id }
}

fn read_revision(root: &Path) -> Option<String> {
    let git = root.join(".git");
    let head = fs::read_to_string(git.join("HEAD")).ok()?;
    let head = head.trim();
    if valid_revision(head) {
        return Some(head.to_owned());
    }
    let reference = head.strip_prefix("ref: ")?;
    let loose = fs::read_to_string(git.join(reference)).ok();
    if let Some(revision) = loose
        .as_deref()
        .map(str::trim)
        .filter(|value| valid_revision(value))
    {
        return Some(revision.to_owned());
    }
    let packed = fs::read_to_string(git.join("packed-refs")).ok()?;
    packed.lines().find_map(|line| {
        let (revision, name) = line.split_once(' ')?;
        (name == reference && valid_revision(revision)).then(|| revision.to_owned())
    })
}

fn valid_revision(value: &str) -> bool {
    value.len() == 40
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

pub(crate) fn usage() -> String {
    "usage: mozak --version\n       mozak delivery status\n       mozak update [--channel stable|main] [--enable-auto|--disable-auto]  (managed launcher)\n       mozak rollback  (managed launcher)\n       mozak setup <install|check> <HOME> [--owner OWNER --kb-root KB_ROOT]\n       mozak doctor <HOME> [KB_ROOT]\n       mozak adapter catalog\n       mozak adapter setup <arxiv|dair-ai|mcp-registry|github-tooling|hyperresearch> <binding-id> <scope-id> <request.json> <runner> <runs-dir>\n       mozak adapter <list|show ID|run ID|recheck ID>\n       mozak lab modules\n       mozak lab start <run-dir> <scope-id> <module> <question> <binding-id> [binding-id ...]\n       mozak lab refresh <run-dir> <adapter-run.json>\n       mozak lab objective <run-dir> <objective.json>\n       mozak lab <select|read|mechanisms|plans|evidence> <run-dir> <input.json>\n       mozak lab group define <run-dir> <source-inventory.json> <groups.json>\n       mozak lab group synthesize <run-dir> <group-synthesis.json>\n       mozak lab group skill <run-dir> <group-skill.json>\n       mozak lab <review|status> <run-dir>\n       mozak <validate|replay> <fixture-file>\n       mozak project <init|status|validate|overview|list|graph-source|graph> [project-directory]\n       mozak project discover <kb-root> <workspace-root> [workspace-root ...]\n       mozak project review <discovery.json>\n       mozak project register <discovery.json> <approval.json>\n       mozak project refresh <discovery.json> <approval.json>\n       mozak project refresh history\n       mozak project refresh rollback <config-sha256>\n       mozak project context <project-id>\n       mozak project registrations\n       mozak project release <project-root> <accepted-state.json> <output.json>\n       mozak package <validate|list|attest> <package-root>\n       mozak package history validate <package-root> [package-root ...]\n       mozak meta <validate|list|graph-source|graph> <meta-kb-root>
       mozak kb concept candidates <target-scope-id> [research-run.json ...]
       mozak kb concept translation-packet <target-scope-id> <concept-id> <concept-sha256>\n       mozak case <validate|list|reproduce-packet> <case.json>\n       mozak concept <validate|list> <concept.json>\n       mozak concept list <concept.json> <translation.json>\n       mozak concept translation validate <concept.json> <translation.json>\n       mozak scope init <scope-root> <scope-id> <title> <intent>\n       mozak scope add-topic <scope-root> <scope-id> <title> <intent>\n       mozak scope add-project <scope-root> <scope-id> <title> <intent> <project-root>\n       mozak scope add-goal <scope-root> <goal-id> <title> <scope-id> [scope-id ...]\n       mozak scope <validate|list|graph-source|graph|export> <scope-root>\n       mozak scope source-check <scope-root> <source-id> <source-root> <observed-revision>\n       mozak scope ingest-links <scope-root> <source-root> <observed-revision> <plan.json> <output-root>\n       mozak kb <validate|list|graph-source|graph> [registry-root]\n       mozak kb tree [registry-root] [--concept] [--project] [--topic]\n       mozak kb register <registry-root> <registration-id> <scope-root>\n       mozak kb repin <registry-root> <registration-id> <scope-root>\n       mozak kb parity <registry-root> <observations.json>\n       mozak kb import-package <package-root> <input-registry-root> <approval.json> <output-kb-root>\n       mozak research validate <run.json>\n       mozak research landmarks <run.json> <landmarks.json>\n       mozak research normalize <arxiv|dair-ai|mcp-registry|github-tooling|hyperresearch> <fixture.json> <run.json>\n       mozak planning compact plan <project-root> <plan.json> <generated-at>\n       mozak planning compact apply <project-root> <plan.json> <approval.json>\n       mozak planning compact restore <project-root> <active-index.json> <approval.json> <output-root>\n       mozak planning next <accepted-inputs.json> <plan.json>\n       mozak execution validate <bundle.json> <observed-revision> <observed-at>".to_owned()
}

fn main() -> ExitCode {
    match run() {
        Ok(code) => code,
        Err(error) => {
            eprintln!("error: {error}");
            ExitCode::FAILURE
        }
    }
}
