//! Provider-neutral contracts for accepted planning inputs and versioned goal DAGs.

use crate::research::{PlanningAuthority, PlanningInputExport};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt::{Display, Formatter};

pub const CONTRACT_VERSION: u64 = 1;

/// The current accepted-input-set contract, which requires retention.
///
/// This advances independently of `CONTRACT_VERSION` because plans and input
/// sets are separate artifacts and only the input set gained a field.
pub const INPUT_SET_CONTRACT_VERSION: u64 = 2;

/// The oldest accepted-input contract this build still reads.
///
/// Sealed releases pin the exact bytes of the input set they were derived
/// from. Requiring a new field at the same version would silently invalidate
/// those releases, so v1 remains readable and only v2 requires retention.
pub const MIN_INPUT_SET_VERSION: u64 = 1;
pub const MAX_ACCEPTED_INPUTS: usize = 64;
pub const MAX_GOALS: usize = 256;
pub const MAX_DEPENDENCIES: usize = 1_024;
pub const MAX_RECOVERY_ATTEMPTS: u32 = 8;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlanningError(pub String);

impl Display for PlanningError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for PlanningError {}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PlanningInputSet {
    pub contract_version: u64,
    pub id: String,
    pub accepted_at: String,
    pub inputs: Vec<AcceptedPlanningInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct AcceptedPlanningInput {
    pub id: String,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retention: Option<InputRetention>,
    pub provenance: PlanningInputProvenance,
}

/// How much fidelity an accepted input requires if it is ever condensed.
///
/// Published measurement shows that summarizing a knowledge base at one
/// uniform rate destroys exactly the items whose wording carries the
/// obligation, because a binding rule and a background note compete for the
/// same budget while only the rule needs exact wording to remain enforceable.
/// Recording the distinction at acceptance time means MOZAK cannot acquire
/// that failure by default when a condensing route is added later.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum InputRetention {
    /// Binds the plan and must survive any condensation verbatim.
    Constraint,
    /// Explains context and may be condensed.
    Observation,
}

impl InputRetention {
    /// Stable identifier for the retention class.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Constraint => "constraint",
            Self::Observation => "observation",
        }
    }

    /// Whether this input's exact wording must be preserved.
    #[must_use]
    pub const fn requires_verbatim(self) -> bool {
        matches!(self, Self::Constraint)
    }
}

/// Resolves the retention of an input that may predate the field.
///
/// A v1 input declared nothing. Treating an undeclared input as an observation
/// would permit condensing text that may well have been binding, so the
/// fail-safe reading is that anything undeclared must be preserved verbatim.
#[must_use]
pub const fn effective_retention(input: &AcceptedPlanningInput) -> InputRetention {
    match input.retention {
        Some(retention) => retention,
        None => InputRetention::Constraint,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum PlanningInputProvenance {
    ResearchProposal {
        run_id: String,
        run_artifact_hash: String,
        proposal_input_id: String,
        claim_id: String,
        evidence_ids: Vec<String>,
    },
    HumanDecision {
        decision_id: String,
        actor: String,
    },
    CodebaseObservation {
        observation_id: String,
        repository_revision: String,
        paths: Vec<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Plan {
    pub contract_version: u64,
    pub id: String,
    pub version: u64,
    pub input_set_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub supersedes: Option<PlanRef>,
    pub goals: Vec<Goal>,
    pub dependencies: Vec<DependencyEdge>,
    pub recovery: RecoveryPolicy,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PlanRef {
    pub id: String,
    pub version: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Goal {
    pub id: String,
    pub version: u64,
    pub title: String,
    pub status: GoalStatus,
    pub priority: u32,
    pub input_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub supersedes_version: Option<u64>,
    pub recovery_attempts: u32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GoalStatus {
    Planned,
    Ready,
    InProgress,
    Blocked,
    Failed,
    Completed,
    Superseded,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct DependencyEdge {
    pub goal_id: String,
    pub depends_on_goal_id: String,
    pub provenance: DependencyProvenance,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum DependencyProvenance {
    Declared {
        input_ids: Vec<String>,
    },
    Observed {
        observation_input_id: String,
        detail: String,
    },
    Inferred {
        rationale: String,
        treated_as_fact: bool,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RecoveryPolicy {
    pub max_attempts_per_goal: u32,
    pub allowed_failed_transition: GoalStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PlanHistory {
    pub versions: Vec<Plan>,
}

/// Accepts proposal-only PF-0004 research exports through an explicit selection boundary.
///
/// # Errors
/// Returns an error when the export is not proposal-only, selection is invalid, or provenance is incomplete.
pub fn accept_research_proposals(
    id: String,
    accepted_at: String,
    export: &PlanningInputExport,
    selected_ids: &[String],
) -> Result<PlanningInputSet, PlanningError> {
    require(
        export.authority == PlanningAuthority::ProposalOnly,
        "research planning export must be proposal_only",
    )?;
    let proposals: BTreeMap<_, _> = export
        .inputs
        .iter()
        .map(|input| (input.id.as_str(), input))
        .collect();
    let mut seen = BTreeSet::new();
    let mut inputs = Vec::with_capacity(selected_ids.len());
    for selected_id in selected_ids {
        require(
            seen.insert(selected_id),
            "duplicate selected planning input",
        )?;
        let proposal = proposals
            .get(selected_id.as_str())
            .ok_or_else(|| PlanningError(format!("unknown research proposal: {selected_id}")))?;
        require(
            !proposal.accepted,
            "research proposal was already marked accepted",
        )?;
        require(
            !proposal.evidence_ids.is_empty(),
            "research proposal lacks evidence provenance",
        )?;
        inputs.push(AcceptedPlanningInput {
            id: proposal.id.clone(),
            text: proposal.text.clone(),
            // Research is proposal-only evidence. Nothing arriving from outside
            // binds a plan by itself, so it is an observation until the owner
            // separately records it as a constraint.
            retention: Some(InputRetention::Observation),
            provenance: PlanningInputProvenance::ResearchProposal {
                run_id: export.run_id.clone(),
                run_artifact_hash: export.run_artifact_hash.clone(),
                proposal_input_id: proposal.id.clone(),
                claim_id: proposal.claim_id.clone(),
                evidence_ids: proposal.evidence_ids.clone(),
            },
        });
    }
    let set = PlanningInputSet {
        contract_version: INPUT_SET_CONTRACT_VERSION,
        id,
        accepted_at,
        inputs,
    };
    validate_input_set(&set)?;
    Ok(set)
}

/// Parses and validates a closed-shape accepted planning-input set.
///
/// # Errors
/// Returns an error for malformed JSON or contract violations.
pub fn validate_input_set_json(input: &str) -> Result<PlanningInputSet, PlanningError> {
    let set = serde_json::from_str(input)
        .map_err(|error| PlanningError(format!("invalid planning input set JSON: {error}")))?;
    validate_input_set(&set)?;
    Ok(set)
}

/// Checks that a condensed rendering preserved every constraint verbatim.
///
/// MOZAK has no condensing route today. This is the rule such a route must
/// satisfy, expressed as a check rather than as prose, so the obligation is
/// executable the moment one exists. An observation may be shortened or
/// dropped; a constraint must appear in the output exactly as accepted.
///
/// # Errors
///
/// Returns an error naming the first constraint whose exact text is absent.
pub fn verify_condensation(set: &PlanningInputSet, condensed: &str) -> Result<(), PlanningError> {
    for input in &set.inputs {
        if effective_retention(input).requires_verbatim() && !condensed.contains(&input.text) {
            return Err(PlanningError(format!(
                "condensation dropped or altered constraint input {}; constraint text must survive verbatim",
                input.id
            )));
        }
    }
    Ok(())
}

/// Validates bounded accepted inputs and mandatory provenance.
///
/// # Errors
/// Returns the first deterministic contract violation.
pub fn validate_input_set(set: &PlanningInputSet) -> Result<(), PlanningError> {
    require(
        (MIN_INPUT_SET_VERSION..=INPUT_SET_CONTRACT_VERSION).contains(&set.contract_version),
        "unsupported input set contract_version",
    )?;
    nonempty(&set.id, "planning input set id")?;
    nonempty(&set.accepted_at, "accepted_at")?;
    require(
        !set.inputs.is_empty(),
        "planning input set must not be empty",
    )?;
    require(
        set.inputs.len() <= MAX_ACCEPTED_INPUTS,
        "too many accepted planning inputs",
    )?;
    let mut ids = BTreeSet::new();
    for input in &set.inputs {
        nonempty(&input.id, "planning input id")?;
        nonempty(&input.text, "planning input text")?;
        require(ids.insert(&input.id), "duplicate planning input id")?;
        if set.contract_version >= 2 {
            require(
                input.retention.is_some(),
                &format!(
                    "planning input {} must declare retention as constraint or observation",
                    input.id
                ),
            )?;
        }
        match &input.provenance {
            PlanningInputProvenance::ResearchProposal {
                run_id,
                run_artifact_hash,
                proposal_input_id,
                claim_id,
                evidence_ids,
            } => {
                nonempty(run_id, "research run_id")?;
                require(
                    run_artifact_hash.len() == 64,
                    "invalid research artifact hash",
                )?;
                require(
                    proposal_input_id == &input.id,
                    "research proposal input id mismatch",
                )?;
                nonempty(claim_id, "research claim_id")?;
                require(
                    !evidence_ids.is_empty(),
                    "research proposal lacks evidence provenance",
                )?;
                unique_nonempty(evidence_ids, "research evidence id")?;
            }
            PlanningInputProvenance::HumanDecision { decision_id, actor } => {
                nonempty(decision_id, "decision_id")?;
                nonempty(actor, "decision actor")?;
            }
            PlanningInputProvenance::CodebaseObservation {
                observation_id,
                repository_revision,
                paths,
            } => {
                nonempty(observation_id, "observation_id")?;
                require(
                    repository_revision.len() == 40
                        && repository_revision
                            .bytes()
                            .all(|byte| byte.is_ascii_hexdigit()),
                    "invalid observation repository revision",
                )?;
                require(!paths.is_empty(), "codebase observation must name paths")?;
                unique_nonempty(paths, "observation path")?;
            }
        }
    }
    Ok(())
}

/// Parses and validates a closed-shape plan against its accepted input set.
///
/// # Errors
/// Returns an error for malformed JSON or any graph, provenance, lifecycle, or recovery violation.
pub fn validate_plan_json(input: &str, inputs: &PlanningInputSet) -> Result<Plan, PlanningError> {
    let plan = serde_json::from_str(input)
        .map_err(|error| PlanningError(format!("invalid plan JSON: {error}")))?;
    validate_plan(&plan, inputs)?;
    Ok(plan)
}

/// Validates a bounded versioned DAG and its lifecycle state.
///
/// # Errors
/// Returns the first deterministic contract violation.
#[allow(clippy::too_many_lines)]
pub fn validate_plan(plan: &Plan, inputs: &PlanningInputSet) -> Result<(), PlanningError> {
    validate_input_set(inputs)?;
    require(
        plan.contract_version == CONTRACT_VERSION,
        "unsupported contract_version",
    )?;
    nonempty(&plan.id, "plan id")?;
    require(plan.version > 0, "plan version must be positive")?;
    require(plan.input_set_id == inputs.id, "plan input set mismatch")?;
    match &plan.supersedes {
        None => require(plan.version == 1, "initial plan must be version 1")?,
        Some(previous) => {
            require(
                previous.id == plan.id,
                "plan may only supersede the same plan id",
            )?;
            require(
                previous.version + 1 == plan.version,
                "plan versions must be consecutive",
            )?;
        }
    }
    require(!plan.goals.is_empty(), "plan must contain goals")?;
    require(plan.goals.len() <= MAX_GOALS, "too many goals")?;
    require(
        plan.dependencies.len() <= MAX_DEPENDENCIES,
        "too many dependencies",
    )?;
    require(
        (1..=MAX_RECOVERY_ATTEMPTS).contains(&plan.recovery.max_attempts_per_goal),
        "recovery max attempts is out of bounds",
    )?;
    require(
        plan.recovery.allowed_failed_transition == GoalStatus::Blocked,
        "failed goals may recover only to blocked",
    )?;

    let input_ids: BTreeSet<_> = inputs
        .inputs
        .iter()
        .map(|input| input.id.as_str())
        .collect();
    let mut goals = BTreeMap::new();
    for goal in &plan.goals {
        nonempty(&goal.id, "goal id")?;
        nonempty(&goal.title, "goal title")?;
        require(goal.version > 0, "goal version must be positive")?;
        require(
            goals.insert(goal.id.as_str(), goal).is_none(),
            "duplicate goal id",
        )?;
        unique_nonempty(&goal.input_ids, "goal input id")?;
        require(
            goal.input_ids
                .iter()
                .all(|id| input_ids.contains(id.as_str())),
            "goal references missing planning input",
        )?;
        require(
            goal.recovery_attempts <= plan.recovery.max_attempts_per_goal,
            "goal recovery attempts exceed policy",
        )?;
        match goal.supersedes_version {
            None => require(goal.version == 1, "initial goal must be version 1")?,
            Some(previous) => require(
                previous + 1 == goal.version,
                "goal versions must be consecutive",
            )?,
        }
    }

    let mut edge_keys = BTreeSet::new();
    let mut adjacency: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    for edge in &plan.dependencies {
        require(
            goals.contains_key(edge.goal_id.as_str()),
            "dependency references missing goal",
        )?;
        require(
            goals.contains_key(edge.depends_on_goal_id.as_str()),
            "dependency references missing dependency",
        )?;
        require(
            edge.goal_id != edge.depends_on_goal_id,
            "goal cannot depend on itself",
        )?;
        require(
            edge_keys.insert((edge.goal_id.as_str(), edge.depends_on_goal_id.as_str())),
            "duplicate dependency edge",
        )?;
        match &edge.provenance {
            DependencyProvenance::Declared { input_ids: ids } => {
                require(!ids.is_empty(), "declared dependency lacks provenance")?;
                unique_nonempty(ids, "declared dependency input id")?;
                require(
                    ids.iter().all(|id| input_ids.contains(id.as_str())),
                    "declared dependency references missing planning input",
                )?;
            }
            DependencyProvenance::Observed {
                observation_input_id,
                detail,
            } => {
                nonempty(detail, "observed dependency detail")?;
                let source = inputs
                    .inputs
                    .iter()
                    .find(|input| input.id == *observation_input_id);
                require(
                    source.is_some(),
                    "observed dependency references missing planning input",
                )?;
                require(
                    matches!(
                        source.map(|input| &input.provenance),
                        Some(PlanningInputProvenance::CodebaseObservation { .. })
                    ),
                    "observed dependency must cite a codebase observation",
                )?;
            }
            DependencyProvenance::Inferred {
                rationale,
                treated_as_fact,
            } => {
                nonempty(rationale, "inferred dependency rationale")?;
                require(
                    !treated_as_fact,
                    "inferred dependency must not be silently treated as fact",
                )?;
            }
        }
        adjacency
            .entry(edge.goal_id.as_str())
            .or_default()
            .push(edge.depends_on_goal_id.as_str());
    }
    reject_cycles(goals.keys().copied(), &adjacency)?;
    validate_status_consistency(&plan.goals, &adjacency)?;
    Ok(())
}

/// Validates immutable plan history and exact supersession links.
///
/// # Errors
/// Returns an error for duplicates, gaps, identity changes, or invalid goal version transitions.
pub fn validate_plan_history(
    history: &PlanHistory,
    inputs: &PlanningInputSet,
) -> Result<(), PlanningError> {
    require(
        !history.versions.is_empty(),
        "plan history must not be empty",
    )?;
    for plan in &history.versions {
        validate_plan(plan, inputs)?;
    }
    validate_plan_history_transitions(history)
}

/// Validates immutable plan history when successor versions intentionally bind
/// to different immutable accepted-input sets.
///
/// # Errors
/// Returns an error for duplicate or missing input-set identities, invalid plans,
/// version gaps, broken supersession, or invalid goal lifecycle transitions.
pub fn validate_plan_history_with_input_sets(
    history: &PlanHistory,
    input_sets: &[PlanningInputSet],
) -> Result<(), PlanningError> {
    require(
        !history.versions.is_empty(),
        "plan history must not be empty",
    )?;
    let mut registry = BTreeMap::new();
    for inputs in input_sets {
        validate_input_set(inputs)?;
        require(
            registry.insert(inputs.id.as_str(), inputs).is_none(),
            "duplicate planning input set id",
        )?;
    }
    for plan in &history.versions {
        let inputs = registry.get(plan.input_set_id.as_str()).ok_or_else(|| {
            PlanningError(format!(
                "plan references missing planning input set: {}",
                plan.input_set_id
            ))
        })?;
        validate_plan(plan, inputs)?;
    }
    validate_plan_history_transitions(history)
}

fn validate_plan_history_transitions(history: &PlanHistory) -> Result<(), PlanningError> {
    for pair in history.versions.windows(2) {
        let previous = &pair[0];
        let current = &pair[1];
        require(
            current.supersedes
                == Some(PlanRef {
                    id: previous.id.clone(),
                    version: previous.version,
                }),
            "plan supersession link mismatch",
        )?;
        let previous_goals: BTreeMap<_, _> =
            previous.goals.iter().map(|goal| (&goal.id, goal)).collect();
        for goal in &current.goals {
            if let Some(old) = previous_goals.get(&goal.id) {
                require(
                    goal.supersedes_version == Some(old.version),
                    "changed plan must explicitly supersede prior goal versions",
                )?;
                validate_status_transition(
                    old.status,
                    goal.status,
                    old.recovery_attempts,
                    goal.recovery_attempts,
                    &current.recovery,
                )?;
            }
        }
    }
    Ok(())
}

/// Returns ready goals in deterministic priority, identifier order.
///
/// # Errors
/// Fails closed if the plan is invalid.
pub fn next_ready_goals(
    plan: &Plan,
    inputs: &PlanningInputSet,
) -> Result<Vec<String>, PlanningError> {
    validate_plan(plan, inputs)?;
    let status: BTreeMap<_, _> = plan
        .goals
        .iter()
        .map(|goal| (goal.id.as_str(), goal.status))
        .collect();
    let mut ready: Vec<_> = plan
        .goals
        .iter()
        .filter(|goal| goal.status == GoalStatus::Ready)
        .filter(|goal| {
            plan.dependencies
                .iter()
                .filter(|edge| edge.goal_id == goal.id)
                .all(|edge| {
                    status.get(edge.depends_on_goal_id.as_str()) == Some(&GoalStatus::Completed)
                })
        })
        .collect();
    ready.sort_by_key(|goal| (goal.priority, goal.id.as_str()));
    Ok(ready.into_iter().map(|goal| goal.id.clone()).collect())
}

fn validate_status_consistency(
    goals: &[Goal],
    adjacency: &BTreeMap<&str, Vec<&str>>,
) -> Result<(), PlanningError> {
    let statuses: BTreeMap<_, _> = goals
        .iter()
        .map(|goal| (goal.id.as_str(), goal.status))
        .collect();
    for goal in goals {
        let all_complete = adjacency
            .get(goal.id.as_str())
            .into_iter()
            .flatten()
            .all(|dependency| statuses.get(dependency) == Some(&GoalStatus::Completed));
        if goal.status == GoalStatus::Ready {
            require(all_complete, "ready goal has incomplete dependencies")?;
        }
        if goal.status == GoalStatus::Completed {
            require(all_complete, "completed goal has incomplete dependencies")?;
        }
    }
    Ok(())
}

fn validate_status_transition(
    from: GoalStatus,
    to: GoalStatus,
    old_attempts: u32,
    new_attempts: u32,
    policy: &RecoveryPolicy,
) -> Result<(), PlanningError> {
    let normal = matches!(
        (from, to),
        (
            GoalStatus::Planned,
            GoalStatus::Planned | GoalStatus::Ready | GoalStatus::Superseded
        ) | (
            GoalStatus::Ready,
            GoalStatus::Ready | GoalStatus::InProgress | GoalStatus::Superseded
        ) | (
            GoalStatus::InProgress,
            GoalStatus::InProgress
                | GoalStatus::Blocked
                | GoalStatus::Failed
                | GoalStatus::Completed
                | GoalStatus::Superseded
        ) | (
            GoalStatus::Blocked,
            GoalStatus::Blocked | GoalStatus::Ready | GoalStatus::Superseded
        ) | (
            GoalStatus::Completed,
            GoalStatus::Completed | GoalStatus::Superseded
        ) | (GoalStatus::Superseded, GoalStatus::Superseded)
    );
    if from == GoalStatus::Failed && to == policy.allowed_failed_transition {
        require(
            new_attempts == old_attempts + 1,
            "recovery must increment attempts exactly once",
        )?;
        require(
            new_attempts <= policy.max_attempts_per_goal,
            "recovery attempts exceed policy",
        )?;
        return Ok(());
    }
    require(normal, "invalid goal status transition")?;
    require(
        new_attempts == old_attempts,
        "recovery attempts changed outside recovery",
    )
}

fn reject_cycles<'a>(
    goals: impl Iterator<Item = &'a str>,
    adjacency: &BTreeMap<&'a str, Vec<&'a str>>,
) -> Result<(), PlanningError> {
    fn visit<'a>(
        goal: &'a str,
        adjacency: &BTreeMap<&'a str, Vec<&'a str>>,
        visiting: &mut BTreeSet<&'a str>,
        visited: &mut BTreeSet<&'a str>,
    ) -> Result<(), PlanningError> {
        if visited.contains(goal) {
            return Ok(());
        }
        require(visiting.insert(goal), "dependency cycle detected")?;
        if let Some(dependencies) = adjacency.get(goal) {
            for dependency in dependencies {
                visit(dependency, adjacency, visiting, visited)?;
            }
        }
        visiting.remove(goal);
        visited.insert(goal);
        Ok(())
    }

    let mut visiting = BTreeSet::new();
    let mut visited = BTreeSet::new();
    for goal in goals {
        visit(goal, adjacency, &mut visiting, &mut visited)?;
    }
    Ok(())
}

fn unique_nonempty(values: &[String], label: &str) -> Result<(), PlanningError> {
    let mut seen = BTreeSet::new();
    for value in values {
        nonempty(value, label)?;
        require(seen.insert(value), &format!("duplicate {label}"))?;
    }
    Ok(())
}

fn nonempty(value: &str, label: &str) -> Result<(), PlanningError> {
    require(
        !value.trim().is_empty(),
        &format!("{label} must not be empty"),
    )
}

fn require(condition: bool, message: &str) -> Result<(), PlanningError> {
    if condition {
        Ok(())
    } else {
        Err(PlanningError(message.to_owned()))
    }
}

/// Reports which of the supplied plans are superseded by another supplied plan.
///
/// Recorded lineage is unsafe if public routes do not enforce it: a caller that
/// selects a plan file without consulting supersession can serve a stale plan
/// and redo completed work. Only plans present in `plans` can supersede, so an
/// unrelated or partial selection never silently marks a plan stale.
#[must_use]
pub fn superseded_by<'a>(plans: &'a [Plan], plan: &Plan) -> Option<&'a Plan> {
    plans
        .iter()
        .filter(|candidate| {
            candidate.supersedes.as_ref()
                == Some(&PlanRef {
                    id: plan.id.clone(),
                    version: plan.version,
                })
        })
        .max_by_key(|candidate| candidate.version)
}
