//! Pinned case records from real work, and the proposals derived from them.
//!
//! MOZAK is developed using MOZAK, so finished work on an onboarded project is
//! the primary evidence about MOZAK itself. This contract makes such a record
//! comparable across cases and honest about what one case can support.
//!
//! Two boundaries are enforced rather than documented. A case never becomes
//! accepted knowledge by being recorded: its derived proposals are
//! `proposal_only` and must pass the ordinary planning gates. And a case cannot
//! claim more than its own design supports, so a general or comparative claim
//! requires a comparable control or more than one case.

use crate::canonical_hash;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::fmt::{Display, Formatter};

/// Version written by new records.
///
/// Version 2 adds the conditions a case ran under, the variance that survived
/// them, a separate performer and evaluator, and an inconclusive claim state.
/// Version 1 records stay readable: sealed evidence is not invalidated by a
/// later contract learning to ask for more.
pub const CONTRACT_VERSION: u64 = 2;

/// Every version this contract can still read.
pub const SUPPORTED_VERSIONS: &[u64] = &[1, 2];

pub const MAX_OBSERVATIONS: usize = 128;
pub const MAX_FINDINGS: usize = 128;
pub const MAX_PROPOSALS: usize = 64;
pub const MAX_CONDITIONS: usize = 32;

/// A condition the work ran under.
///
/// The set is taken from what paired-evaluation practice actually holds fixed
/// rather than from what seemed plausible. Kevin et al., *Evaluating Skills,
/// Not Just Agents* (arXiv:2608.20614) §7 enumerates task, harness, model,
/// scorer, sandbox and the configured non-target skills as the conditions its
/// paired design holds constant, and states that holding them still yields
/// only a marginal contribution under a declared policy rather than an
/// environment-independent one. Feng et al., *Harness-of-Harness*
/// (arXiv:2609.01481) Algorithm 1 likewise declares model, harness and role
/// contracts as fixed inputs.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum ConditionKind {
    /// The model or agent that performed the work.
    Agent,
    /// The harness the agent ran inside.
    Harness,
    /// What decided the work was acceptable.
    AcceptanceGrader,
    /// The machine, container, or sandbox the work ran in.
    ExecutionEnvironment,
    /// The other tools and skills available while the work was performed.
    SurroundingTools,
}

impl ConditionKind {
    /// Every condition a case at version 2 or later must account for.
    #[must_use]
    pub const fn all() -> [Self; 5] {
        [
            Self::Agent,
            Self::Harness,
            Self::AcceptanceGrader,
            Self::ExecutionEnvironment,
            Self::SurroundingTools,
        ]
    }

    /// Stable identifier for the condition.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Agent => "agent",
            Self::Harness => "harness",
            Self::AcceptanceGrader => "acceptance_grader",
            Self::ExecutionEnvironment => "execution_environment",
            Self::SurroundingTools => "surrounding_tools",
        }
    }
}

/// One condition, either observed with its method or explicitly not observed.
///
/// A value without an observation method would let an assertion pass as an
/// observation, which makes a record look more rigorous while being less true.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CaseCondition {
    pub kind: ConditionKind,
    /// The observed value, or None when this condition was not observed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    /// How the value was observed. Required whenever a value is recorded.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub observed_how: Option<String>,
    /// Why the condition was not observed. Required when there is no value.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub not_observed_reason: Option<String>,
}

/// Variance that remains after the declared conditions were held fixed.
///
/// Qwen et al., *E-Commerce Bench* (arXiv:2608.30730) §3.5.2 is the model: a
/// design that made determinism a primary goal still named the two sources
/// that survived it and said which metric each contaminated. A development
/// case has far more residual variance and can seed nothing, so naming it is
/// the only honest option available.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ResidualVariance {
    pub source: String,
    /// Observations this variance could move.
    pub affected_observation_ids: Vec<String>,
}

/// What run-to-run variance survived, or how its absence was established.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct VarianceStatement {
    pub sources: Vec<ResidualVariance>,
    /// How a claim of no residual variance was established. Required when
    /// `sources` is empty, because silence and "none" must not look alike.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub none_established_how: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CaseError(pub String);

impl Display for CaseError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for CaseError {}

/// One pinned case record about work performed on a real subject.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CaseStudy {
    pub contract_version: u64,
    pub id: String,
    pub evaluation_id: String,
    pub recorded_at: String,
    pub subject: CaseSubject,
    pub method: CaseMethod,
    pub observations: Vec<CaseObservation>,
    pub findings: Vec<CaseFinding>,
    pub calibration: ClaimCalibration,
    /// Candidate improvements. Proposals only, never authority.
    pub derived_proposals: Vec<DerivedProposal>,
    pub authority: CaseAuthority,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CaseSubject {
    pub scope_id: String,
    pub kind: SubjectKind,
    pub baseline_revision: String,
    pub final_revision: String,
    /// Whether MOZAK was actually used for the work being evaluated.
    pub mozak_was_used: bool,
    pub session_shape: SessionShape,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub control: Option<CaseControl>,
    /// Conditions the work ran under. Required from version 2.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub conditions: Vec<CaseCondition>,
    /// Variance surviving those conditions. Required from version 2.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub residual_variance: Option<VarianceStatement>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SubjectKind {
    Project,
    Topic,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SessionShape {
    OneShot,
    MultiSession,
}

/// A comparison subject, which must state whether it is actually comparable.
///
/// A sibling worked in the same sessions isolates no variable. Recording that
/// honestly is what stops it being cited as a control later.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CaseControl {
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope_id: Option<String>,
    pub comparable: bool,
    /// Why the control is or is not comparable.
    pub reason: String,
    /// What stayed present in the comparison condition.
    ///
    /// A control described only as an absence, "the same work without MOZAK",
    /// is the naive empty baseline of arXiv:2608.20614 §4.7, which conflates
    /// the subject's content with its discoverability and inflates the
    /// apparent effect. A comparable control must say what was held fixed.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub held_fixed: Vec<String>,
}

/// How the case was conducted, so later cases can match the method.
///
/// Rigor is a set rather than a row of flags: a later case is comparable when
/// it applied the same practices, and absent practices are visible by omission.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CaseMethod {
    pub rigor: BTreeSet<MethodRigor>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mutation_count: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mutations_caught: Option<u32>,
    pub review: ReviewKind,
    pub notes: String,
    /// Who performed the work. Required from version 2.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub performed_by: Option<String>,
    /// Who evaluated it. Required from version 2, and it must differ from
    /// `performed_by` before review may be called independent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub evaluated_by: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum MethodRigor {
    /// The baseline revision was pinned before the work was evaluated.
    BaselinePinned,
    /// Defects were deliberately injected to test whether checks catch them.
    MutationTested,
    /// Acceptance was exercised at more than one observable layer.
    LayeredAcceptance,
}

/// Who evaluated the work. Self-review is weaker evidence and must not be
/// silently presented as independent.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ReviewKind {
    None,
    SelfReview,
    Independent,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CaseObservation {
    pub id: String,
    pub observation: String,
    pub significance: String,
    /// Where the observation can be re-read.
    pub locator: String,
    /// Whether this was measured or is a qualitative interpretation. A
    /// judgement presented as a measurement is the overclaim this separates.
    pub measured: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CaseFinding {
    pub id: String,
    pub summary: String,
    pub severity: FindingSeverity,
    pub state: FindingState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolution: Option<String>,
    pub observation_ids: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum FindingSeverity {
    Informational,
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FindingState {
    Open,
    Closed,
    /// Considered and deliberately left as it is, with a recorded reason.
    Accepted,
}

/// What this case supports, what it does not, and why.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ClaimCalibration {
    pub supported_claims: Vec<String>,
    /// Claims explicitly not supported. Naming them is what keeps a favourable
    /// case from reading as a general endorsement.
    pub unsupported_claims: Vec<String>,
    /// Claims checked but neither established nor refuted.
    ///
    /// Without this state a checked-but-inconclusive result must pick a
    /// column, so absence of evidence silently becomes evidence one way or the
    /// other. arXiv:2609.01481 §3.4.3 records insufficient evidence as a gap
    /// for the same reason.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub inconclusive_claims: Vec<InconclusiveClaim>,
    pub requires_comparative_evaluation: Vec<String>,
    pub limitations: Vec<String>,
    pub generality: Generality,
    /// Per-dimension results. Required when `generality` is comparative, so a
    /// single verdict cannot hide a dimension where the subject did worse.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub dimension_results: Vec<DimensionResult>,
}

/// A claim that was checked without reaching a conclusion.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct InconclusiveClaim {
    pub claim: String,
    pub what_was_checked: String,
    pub missing_evidence: String,
}

/// One named dimension of a comparative result.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct DimensionResult {
    pub dimension: String,
    pub result: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Generality {
    /// One case. Describes itself and nothing else.
    SingleCase,
    /// Several cases sharing a method, still not a controlled comparison.
    MultiCase,
    /// A comparison against a comparable control.
    Comparative,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct DerivedProposal {
    pub id: String,
    pub text: String,
    /// The observations that motivate this proposal. A proposal with no
    /// observation behind it is an opinion.
    pub observation_ids: Vec<String>,
    pub priority: u32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CaseAuthority {
    /// Recording a case never accepts its proposals. They must pass the
    /// ordinary planning gates like any other candidate input.
    ProposalOnly,
}

/// Returns the canonical hash of a case record.
///
/// # Errors
/// Returns an error when the record cannot be canonically serialized.
pub fn case_hash(case: &CaseStudy) -> Result<String, CaseError> {
    canonical_hash(case).map_err(|error| CaseError(format!("cannot hash case: {error}")))
}

/// Parses and validates a closed-shape case record.
///
/// # Errors
/// Returns an error for malformed JSON or any contract violation.
pub fn validate_case_json(input: &str) -> Result<CaseStudy, CaseError> {
    let case: CaseStudy = serde_json::from_str(input)
        .map_err(|error| CaseError(format!("invalid case study JSON: {error}")))?;
    validate_case(&case)?;
    Ok(case)
}

/// Validates a case record's pins, traceability, and claim calibration.
///
/// # Errors
/// Returns the first deterministic contract violation.
pub fn validate_case(case: &CaseStudy) -> Result<(), CaseError> {
    require(
        SUPPORTED_VERSIONS.contains(&case.contract_version),
        "unsupported contract_version",
    )?;
    nonempty(&case.id, "case id")?;
    nonempty(&case.evaluation_id, "evaluation_id")?;
    nonempty(&case.recorded_at, "recorded_at")?;
    nonempty(&case.subject.scope_id, "subject scope_id")?;
    nonempty(&case.subject.baseline_revision, "baseline_revision")?;
    nonempty(&case.subject.final_revision, "final_revision")?;
    nonempty(&case.method.notes, "method notes")?;

    if let Some(control) = &case.subject.control {
        nonempty(&control.kind, "control kind")?;
        nonempty(&control.reason, "control reason")?;
        // An empty baseline is not a control. Saying what stayed present is
        // what separates a comparison from an absence.
        if control.comparable {
            require(
                !control.held_fixed.is_empty(),
                "a comparable control must record what was held fixed in the comparison condition",
            )?;
            for item in &control.held_fixed {
                nonempty(item, "control held_fixed entry")?;
            }
        }
    }
    if let (Some(count), Some(caught)) = (case.method.mutation_count, case.method.mutations_caught)
    {
        require(
            caught <= count,
            "mutations caught cannot exceed mutations injected",
        )?;
    }
    require(
        !case.method.rigor.contains(&MethodRigor::MutationTested)
            || case.method.mutation_count.is_some(),
        "a mutation-tested case must record how many mutations were injected",
    )?;
    validate_actors(case)?;

    let observation_ids = validate_observations(case)?;
    if case.contract_version >= 2 {
        validate_conditions(case)?;
        validate_residual_variance(case, &observation_ids)?;
    }
    validate_findings(case, &observation_ids)?;
    validate_calibration(case)?;
    validate_proposals(case, &observation_ids)
}

/// Independence is a property of two different actors, not of a label.
///
/// arXiv:2609.01481 §3.4.3 makes the separation structural: the assessing role
/// receives a frozen, read-only candidate so it cannot repair what it
/// evaluates. MOZAK cannot enforce read-only access to the owner's own
/// repository, so it enforces the part it can observe: an evaluator who also
/// performed the work is not an independent reviewer.
fn validate_actors(case: &CaseStudy) -> Result<(), CaseError> {
    if case.contract_version >= 2 {
        let performed = case
            .method
            .performed_by
            .as_deref()
            .ok_or_else(|| CaseError("a case must record who performed the work".into()))?;
        let evaluated = case
            .method
            .evaluated_by
            .as_deref()
            .ok_or_else(|| CaseError("a case must record who evaluated the work".into()))?;
        nonempty(performed, "performed_by")?;
        nonempty(evaluated, "evaluated_by")?;
    }
    if case.method.review == ReviewKind::Independent
        && let (Some(performed), Some(evaluated)) =
            (&case.method.performed_by, &case.method.evaluated_by)
    {
        require(
            performed.trim() != evaluated.trim(),
            "review cannot be independent when the same actor performed and evaluated the work",
        )?;
    }
    Ok(())
}

/// Every condition is accounted for, and a value carries how it was observed.
fn validate_conditions(case: &CaseStudy) -> Result<(), CaseError> {
    require(
        case.subject.conditions.len() <= MAX_CONDITIONS,
        "too many conditions",
    )?;
    let mut seen = BTreeSet::new();
    for condition in &case.subject.conditions {
        require(
            seen.insert(condition.kind),
            "duplicate condition for the same kind",
        )?;
        match (&condition.value, &condition.observed_how) {
            (Some(value), Some(how)) => {
                nonempty(value, "condition value")?;
                nonempty(how, "condition observed_how")?;
            }
            // A value with no method would let an assertion pass as an
            // observation, which is the overclaim this field exists to stop.
            (Some(_), None) => {
                return Err(CaseError(format!(
                    "condition {} records a value without saying how it was observed",
                    condition.kind.as_str()
                )));
            }
            (None, _) => {
                let reason = condition.not_observed_reason.as_deref().ok_or_else(|| {
                    CaseError(format!(
                        "condition {} must record a value or why it was not observed",
                        condition.kind.as_str()
                    ))
                })?;
                nonempty(reason, "condition not_observed_reason")?;
            }
        }
    }
    for kind in ConditionKind::all() {
        require(
            seen.contains(&kind),
            &format!("case does not account for condition {}", kind.as_str()),
        )?;
    }
    Ok(())
}

/// Residual variance is named, and points at real observations.
fn validate_residual_variance(
    case: &CaseStudy,
    observation_ids: &BTreeSet<&str>,
) -> Result<(), CaseError> {
    let statement = case.subject.residual_variance.as_ref().ok_or_else(|| {
        CaseError("a case must record the variance that survived its conditions".into())
    })?;
    if statement.sources.is_empty() {
        // Silence and a claim of none must not look alike.
        let how = statement.none_established_how.as_deref().ok_or_else(|| {
            CaseError(
                "a case claiming no residual variance must record how that was established".into(),
            )
        })?;
        return nonempty(how, "none_established_how");
    }
    for source in &statement.sources {
        nonempty(&source.source, "residual variance source")?;
        require(
            source
                .affected_observation_ids
                .iter()
                .all(|id| observation_ids.contains(id.as_str())),
            "residual variance references an unknown observation",
        )?;
    }
    Ok(())
}

fn validate_observations(case: &CaseStudy) -> Result<BTreeSet<&str>, CaseError> {
    // A case with no observations records nothing, and cannot support a claim.
    require(
        !case.observations.is_empty(),
        "case must record at least one observation",
    )?;
    require(
        case.observations.len() <= MAX_OBSERVATIONS,
        "too many observations",
    )?;
    let mut ids = BTreeSet::new();
    for observation in &case.observations {
        nonempty(&observation.id, "observation id")?;
        nonempty(&observation.observation, "observation text")?;
        nonempty(&observation.significance, "observation significance")?;
        nonempty(&observation.locator, "observation locator")?;
        require(
            ids.insert(observation.id.as_str()),
            "duplicate observation id",
        )?;
    }
    Ok(ids)
}

fn validate_findings(case: &CaseStudy, observation_ids: &BTreeSet<&str>) -> Result<(), CaseError> {
    require(case.findings.len() <= MAX_FINDINGS, "too many findings")?;
    let mut ids = BTreeSet::new();
    for finding in &case.findings {
        nonempty(&finding.id, "finding id")?;
        nonempty(&finding.summary, "finding summary")?;
        require(ids.insert(finding.id.as_str()), "duplicate finding id")?;
        require(
            finding
                .observation_ids
                .iter()
                .all(|id| observation_ids.contains(id.as_str())),
            "finding references an unknown observation",
        )?;
        // Closing or accepting a finding without saying how is exactly the
        // silent resolution this record exists to prevent.
        match finding.state {
            FindingState::Closed | FindingState::Accepted => {
                let resolution = finding
                    .resolution
                    .as_deref()
                    .ok_or_else(|| CaseError("a resolved finding must record how".into()))?;
                nonempty(resolution, "finding resolution")?;
            }
            FindingState::Open => {}
        }
    }
    Ok(())
}

fn validate_calibration(case: &CaseStudy) -> Result<(), CaseError> {
    let calibration = &case.calibration;
    require(
        !calibration.supported_claims.is_empty(),
        "calibration must state what the case supports",
    )?;
    // The case that motivated this contract was useful precisely because it
    // said what it could not support.
    require(
        !calibration.limitations.is_empty(),
        "calibration must record the limitations of this case",
    )?;
    for claim in &calibration.supported_claims {
        nonempty(claim, "supported claim")?;
    }
    for claim in &calibration.unsupported_claims {
        nonempty(claim, "unsupported claim")?;
    }
    for item in &calibration.limitations {
        nonempty(item, "limitation")?;
    }
    // A checked but inconclusive claim must say what was missing, or the state
    // becomes a place to file anything inconvenient.
    for claim in &calibration.inconclusive_claims {
        nonempty(&claim.claim, "inconclusive claim")?;
        nonempty(
            &claim.what_was_checked,
            "inconclusive claim what_was_checked",
        )?;
        nonempty(
            &claim.missing_evidence,
            "inconclusive claim missing_evidence",
        )?;
    }

    // Generality must match the design. One case cannot report a comparative
    // result, and a comparative result needs a control that says it compares.
    let comparable_control = case
        .subject
        .control
        .as_ref()
        .is_some_and(|control| control.comparable);
    match calibration.generality {
        Generality::Comparative => {
            require(
                comparable_control,
                "a comparative claim requires a control declared comparable",
            )?;
            // One number can hide the dimension where the subject did worse.
            // arXiv:2608.30730 §4.3 reports its top earner ranking 16th of 18
            // on fraud avoidance, which an aggregate verdict would have erased.
            require(
                !calibration.dimension_results.is_empty(),
                "a comparative claim must report per-dimension results, not a single verdict",
            )?;
            for entry in &calibration.dimension_results {
                nonempty(&entry.dimension, "dimension name")?;
                nonempty(&entry.result, "dimension result")?;
            }
        }
        Generality::MultiCase | Generality::SingleCase => {}
    }

    // A qualitative observation must not be the sole support for a claim
    // presented as measured, so at least one measured observation is required
    // whenever the case claims anything at all.
    let measured = case
        .observations
        .iter()
        .filter(|observation| observation.measured)
        .count();
    require(
        measured > 0,
        "a case that states supported claims must record at least one measured observation",
    )
}

fn validate_proposals(case: &CaseStudy, observation_ids: &BTreeSet<&str>) -> Result<(), CaseError> {
    require(
        case.derived_proposals.len() <= MAX_PROPOSALS,
        "too many derived proposals",
    )?;
    let mut ids = BTreeSet::new();
    for proposal in &case.derived_proposals {
        nonempty(&proposal.id, "proposal id")?;
        nonempty(&proposal.text, "proposal text")?;
        require(ids.insert(proposal.id.as_str()), "duplicate proposal id")?;
        // Traceability is what makes a proposal reviewable rather than a
        // preference smuggled in beside real evidence.
        require(
            !proposal.observation_ids.is_empty(),
            "a derived proposal must cite the observations that motivate it",
        )?;
        require(
            proposal
                .observation_ids
                .iter()
                .all(|id| observation_ids.contains(id.as_str())),
            "derived proposal references an unknown observation",
        )?;
    }
    Ok(())
}

/// Counts findings by severity for terminal and machine reporting.
#[must_use]
pub fn open_findings(case: &CaseStudy) -> Vec<&CaseFinding> {
    case.findings
        .iter()
        .filter(|finding| finding.state == FindingState::Open)
        .collect()
}

/// Returns the proposals of one case in deterministic priority order.
#[must_use]
pub fn proposals_by_priority(case: &CaseStudy) -> Vec<&DerivedProposal> {
    let mut proposals: Vec<_> = case.derived_proposals.iter().collect();
    proposals.sort_by_key(|proposal| (proposal.priority, proposal.id.as_str()));
    proposals
}

/// What a second party needs to re-derive a case's observations.
///
/// Google `DeepMind`, *Accelerating Scientific Research with Gemini in the
/// Real-World* (arXiv:2608.26701) appendix D.3 gave its 30 reviewers the
/// experimental logs and source code rather than only the write-up, and
/// withheld the authors' own conclusions. A MOZAK case record is the opposite
/// arrangement: it leads with findings, calibration and proposals. This packet
/// inverts that for one reader.
///
/// It is derived on demand and never written beside the case, so the case
/// stays the single source of truth. It is not blinding: the subject is a
/// named repository whose author is identifiable. The same study reported
/// inter-rater agreement of only 0.38 to 0.43, so a packet buys an
/// independent reading, not an authoritative verdict.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ReproductionPacket<'a> {
    pub case_id: &'a str,
    pub evaluation_id: &'a str,
    pub subject_scope_id: &'a str,
    pub baseline_revision: &'a str,
    /// The single frozen revision every observation is bound to.
    pub evaluated_revision: &'a str,
    pub conditions: &'a [CaseCondition],
    pub residual_variance: Option<&'a VarianceStatement>,
    pub measured_observations: Vec<&'a CaseObservation>,
    pub withheld: Vec<&'static str>,
    pub blinding: &'static str,
    pub authority: &'static str,
}

/// Derives the reproduction packet for one case.
///
/// # Errors
/// Returns an error when the case records no measured observation, because a
/// packet of interpretations promises a reproduction it cannot support.
pub fn reproduction_packet(case: &CaseStudy) -> Result<ReproductionPacket<'_>, CaseError> {
    let measured_observations: Vec<&CaseObservation> = case
        .observations
        .iter()
        .filter(|observation| observation.measured)
        .collect();
    require(
        !measured_observations.is_empty(),
        "case records no measured observation, so there is nothing to reproduce",
    )?;
    Ok(ReproductionPacket {
        case_id: &case.id,
        evaluation_id: &case.evaluation_id,
        subject_scope_id: &case.subject.scope_id,
        baseline_revision: &case.subject.baseline_revision,
        evaluated_revision: &case.subject.final_revision,
        conditions: &case.subject.conditions,
        residual_variance: case.subject.residual_variance.as_ref(),
        measured_observations,
        withheld: vec![
            "findings",
            "calibration",
            "derived_proposals",
            "interpretive_observations",
        ],
        blinding: "not blinded: the subject repository and its author remain identifiable; conclusions are withheld from this packet, which is not the same thing",
        authority: "reproduction_outstanding: this packet authorizes nothing and records no result until a second party returns one",
    })
}

fn require(condition: bool, message: &str) -> Result<(), CaseError> {
    if condition {
        Ok(())
    } else {
        Err(CaseError(message.to_owned()))
    }
}

fn nonempty(value: &str, label: &str) -> Result<(), CaseError> {
    require(
        !value.trim().is_empty(),
        &format!("{label} must not be empty"),
    )
}
