//! Planning-only Self Improvement Lab contracts.
//!
//! The Lab never edits MOZAK. It records an evidence-complete path from a
//! scoped improvement question to reviewable implementation plans, and refuses
//! to advance past owner review.
//!
//! # Why the run stops at owner review
//!
//! The boundary is not caution for its own sake; it is what the published
//! measurement of self-improving agents supports. Ye et al., *On the Fragility
//! of Self-Improving Agents: Variance, Task Order, and Underspecification*
//! (arXiv:2608.18066), re-evaluated memory-based self-improving agents across
//! multiple runs and shuffled task orders and reported three findings that bear
//! directly on this contract:
//!
//! - Agent evaluation is inherently noisy on complex multi-step tasks, and
//!   stacking a self-improving loop on top can further amplify that noise. A
//!   Lab that applied its own findings would therefore be acting on a signal
//!   it cannot yet distinguish from variance.
//! - Improvement depends heavily on task order, and default orderings impose an
//!   implicit curriculum that acts as a hidden prerequisite for success. The
//!   order in which a Lab happened to read its sources is exactly such a hidden
//!   prerequisite.
//! - The authors' findings on underspecification call for systems and
//!   interfaces that enable effective human oversight, preventing agents from
//!   failing in unforeseeable ways. Stopping at owner review is that interface.
//!
//! Recorded limitations of this justification, so it can be judged rather than
//! deferred to: the claims above were read from the paper's abstract, not its
//! full text; the subject is agents that rewrite their own textual memory from
//! a task stream, which is adjacent to but not identical with a planning-only
//! lab that writes no memory and changes no code; and the paper reports that
//! significant unexplained fragility remains after better specification, so its
//! own account is incomplete. This evidence supports keeping the stop; it does
//! not establish that a stop is sufficient for safety.
//!
//! Read through the Lab's own contract on 2026-09-06 in run
//! `improve-b1805c3b0f1488a48af592cc` as `claim-self-improvement-noise`,
//! `claim-task-order-dependence`, and `claim-underspecification-oversight`.

use crate::canonical_hash;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::fmt::{Display, Formatter, Write as _};

/// Contract version for every Lab artifact.
pub const CONTRACT_VERSION: u32 = 1;

/// Deterministic Lab failure.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LabError(pub String);

impl Display for LabError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for LabError {}

fn require(condition: bool, message: &str) -> Result<(), LabError> {
    if condition {
        Ok(())
    } else {
        Err(LabError(message.to_owned()))
    }
}

fn require_filled(value: &str, label: &str) -> Result<(), LabError> {
    require(
        !value.trim().is_empty(),
        &format!("{label} must not be empty"),
    )
}

/// A MOZAK module, and the improvement target that governs it.
///
/// This list is the architecture and the Lab target list at the same time, so
/// the number of modules MOZAK claims is always the number `mozak lab modules`
/// returns. Adding a module here adds an improvement surface for it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Module {
    Scope,
    Research,
    Plans,
    MetaKb,
    ImproveLab,
    Skill,

    // Retired identifiers, readable but not addressable. See `is_retired`.
    ResearchAndAdapters,
    ScopeAndKnowledgeState,
    EvaluationAndCases,
    ConceptsAndTranslations,
    PlanningAndExecution,
}

impl Module {
    /// Every MOZAK module, which is also every addressable improvement target.
    ///
    /// Retired identifiers are deliberately absent: they can be read out of an
    /// old run but never chosen for a new one.
    #[must_use]
    pub const fn all() -> [Self; 6] {
        [
            Self::Scope,
            Self::Research,
            Self::Plans,
            Self::MetaKb,
            Self::ImproveLab,
            Self::Skill,
        ]
    }

    /// Module identifiers that existed before the current six-module split.
    ///
    /// # Why these are variants rather than aliases
    ///
    /// The obvious repair for an unreadable old ledger is
    /// `#[serde(alias = "evaluation-and-cases")]` on the nearest current
    /// variant. That would be wrong, and quietly so: the previous list was a
    /// different partition of MOZAK, not a renaming of this one.
    /// `research-and-adapters` covered retrieval together with adapter
    /// plumbing, which now fall inside `research`; `evaluation-and-cases`
    /// covered case records and paired evaluation, which now straddle
    /// `research` and `improve-lab`. An alias would make a run assert it
    /// studied a module that did not exist when it ran, and every later reader
    /// would believe it.
    ///
    /// So a retired id deserializes to itself. History stays readable and
    /// stays honest about what it was, while `all()` and `parse` keep a new
    /// run from ever selecting one.
    #[must_use]
    pub const fn retired() -> [Self; 5] {
        [
            Self::ResearchAndAdapters,
            Self::ScopeAndKnowledgeState,
            Self::EvaluationAndCases,
            Self::ConceptsAndTranslations,
            Self::PlanningAndExecution,
        ]
    }

    /// Whether this identifier belongs to a superseded module split.
    ///
    /// A caller that reports a module to a reader should say so, because a
    /// retired id names a boundary MOZAK no longer draws.
    #[must_use]
    pub const fn is_retired(self) -> bool {
        matches!(
            self,
            Self::ResearchAndAdapters
                | Self::ScopeAndKnowledgeState
                | Self::EvaluationAndCases
                | Self::ConceptsAndTranslations
                | Self::PlanningAndExecution
        )
    }

    /// Stable identifier used on the command line and in artifacts.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Scope => "scope",
            Self::Research => "research",
            Self::Plans => "plans",
            Self::MetaKb => "meta-kb",
            Self::ImproveLab => "improve-lab",
            Self::Skill => "skill",
            Self::ResearchAndAdapters => "research-and-adapters",
            Self::ScopeAndKnowledgeState => "scope-and-knowledge-state",
            Self::EvaluationAndCases => "evaluation-and-cases",
            Self::ConceptsAndTranslations => "concepts-and-translations",
            Self::PlanningAndExecution => "planning-and-execution",
        }
    }

    /// One sentence naming the boundary this module owns.
    #[must_use]
    pub const fn summary(self) -> &'static str {
        match self {
            Self::Scope => {
                "The container for work: a Topic you study or a Project you change, holding hashed immutable inputs."
            }
            Self::Research => {
                "Bounded observation of the outside world or of your own finished work. Output is always proposal-only."
            }
            Self::Plans => {
                "Accepted inputs, the goal DAG derived from them, execution, and the sealed package finished work becomes."
            }
            Self::MetaKb => {
                "Everything that crosses projects: what is registered, how projects relate, and which mechanisms generalise."
            }
            Self::ImproveLab => {
                "An improvement question turned into reviewable plans. Stops at owner review."
            }
            Self::Skill => {
                "How MOZAK reaches you: which request maps to which route, the shape of the answer, and installation."
            }
            // A retired id describes a boundary MOZAK no longer draws, so the
            // only honest summary says that rather than describing a current
            // module the old run did not study.
            Self::ResearchAndAdapters
            | Self::ScopeAndKnowledgeState
            | Self::EvaluationAndCases
            | Self::ConceptsAndTranslations
            | Self::PlanningAndExecution => {
                "A retired module boundary from a superseded split, readable for history and not addressable by a new run."
            }
        }
    }

    /// MOZAK source areas each module governs.
    #[must_use]
    pub const fn source_areas(self) -> &'static [&'static str] {
        match self {
            Self::Scope => &["scope.rs", "project_contract.rs", "project_context.rs"],
            Self::Research => &[
                "research.rs",
                "adapter_workflow.rs",
                "landmark.rs",
                "case_study.rs",
            ],
            Self::Plans => &[
                "planning.rs",
                "planning_archive.rs",
                "execution.rs",
                "project_release.rs",
                "knowledge_package.rs",
                "attestation.rs",
            ],
            Self::MetaKb => &["kb.rs", "meta_kb.rs", "concept.rs", "package_import.rs"],
            Self::ImproveLab => &["lab.rs", "lab_evidence.rs", "lab_evaluation.rs"],
            Self::Skill => &["distribution.rs"],
            // Deliberately empty. The files a retired boundary covered have
            // since been redistributed, so naming today's files would claim
            // the old run studied code it never saw.
            Self::ResearchAndAdapters
            | Self::ScopeAndKnowledgeState
            | Self::EvaluationAndCases
            | Self::ConceptsAndTranslations
            | Self::PlanningAndExecution => &[],
        }
    }

    /// Resolves a module identifier.
    ///
    /// # Errors
    /// Returns an error when the identifier is not a known module.
    pub fn parse(value: &str) -> Result<Self, LabError> {
        Self::all()
            .into_iter()
            .find(|module| module.as_str() == value)
            .ok_or_else(|| {
                let known = Self::all()
                    .iter()
                    .map(|module| module.as_str())
                    .collect::<Vec<_>>()
                    .join(", ");
                LabError(format!(
                    "unknown module '{value}'; expected one of: {known}"
                ))
            })
    }
}

/// Lifecycle position of a planning-only improvement run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunState {
    Requested,
    LiteratureRefreshed,
    PapersSelected,
    PapersRead,
    MechanismsExtracted,
    ImplementationPlansProposed,
    OwnerReviewed,
}

impl RunState {
    /// Stable identifier for the state.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Requested => "requested",
            Self::LiteratureRefreshed => "literature_refreshed",
            Self::PapersSelected => "papers_selected",
            Self::PapersRead => "papers_read",
            Self::MechanismsExtracted => "mechanisms_extracted",
            Self::ImplementationPlansProposed => "implementation_plans_proposed",
            Self::OwnerReviewed => "owner_reviewed",
        }
    }

    /// The state that must already be recorded before this one.
    #[must_use]
    pub const fn predecessor(self) -> Option<Self> {
        match self {
            Self::Requested => None,
            Self::LiteratureRefreshed => Some(Self::Requested),
            Self::PapersSelected => Some(Self::LiteratureRefreshed),
            Self::PapersRead => Some(Self::PapersSelected),
            Self::MechanismsExtracted => Some(Self::PapersRead),
            Self::ImplementationPlansProposed => Some(Self::MechanismsExtracted),
            Self::OwnerReviewed => Some(Self::ImplementationPlansProposed),
        }
    }

    /// Whether the planning-only lifecycle ends here.
    ///
    /// # Why this invariant exists
    ///
    /// Stopping at owner review is not caution. It is the property that keeps
    /// a self-improving system stable.
    ///
    /// Kim et al., *Metan* (arXiv:2608.24735) state the constraint directly:
    /// a system that edits its own editing machinery "must leave part of its
    /// own editing machinery untouched to stay stable", which caps realized
    /// meta-depth at roughly two. Their answer is to keep the meta-operation
    /// fixed and recurse on its input instead, so the operation "cannot
    /// destabilize the system" while its input strictly grows.
    ///
    /// MOZAK's Lab is that shape. The Lab contract is the fixed operation;
    /// Scope evidence is the growing input. A Lab run may propose changing the
    /// Lab itself, and that proposal still stops here, to be implemented by a
    /// separately authorized phase.
    ///
    /// Removing this stop would let a run apply its own proposed contract
    /// change, which is precisely the unstable configuration Metan avoids
    /// rather than solves. If you are here to make the Lab act on its own
    /// findings, that is the thing this prevents, deliberately.
    #[must_use]
    pub const fn is_terminal(self) -> bool {
        matches!(self, Self::OwnerReviewed)
    }
}

/// Recorded transition into a state.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Transition {
    pub state: RunState,
    pub actor: String,
    pub at: String,
    pub input_hash: String,
}

/// Durable state of one improvement run.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RunLedger {
    pub contract_version: u32,
    pub run_id: String,
    pub scope_id: String,
    pub module: Module,
    pub state: RunState,
    pub stop_at: RunState,
    pub transitions: Vec<Transition>,
    #[serde(default)]
    pub seen_sources: BTreeMap<String, String>,
}

/// Who evaluated a Lab run's own output.
///
/// A case record already refuses to call review independent when one actor both
/// performed and evaluated the work. A Lab run could not make that distinction
/// at all, so a run that authored its own mechanisms and then accepted them
/// read exactly like one an independent reader had checked. The weaker evidence
/// was indistinguishable from the stronger, which is the confusion this names.
///
/// Kong et al. (Netflix) argue the same point from the other direction: an
/// evaluator is not a fixed artifact, and treating it as one hides whose
/// judgement is actually being recorded.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AcceptanceKind {
    /// The same actor authored the run and accepted it.
    SelfReview,
    /// A different actor accepted what the author produced.
    Independent,
}

impl AcceptanceKind {
    /// Stable identifier for the acceptance kind.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::SelfReview => "self_review",
            Self::Independent => "independent",
        }
    }

    /// The only honest label for a given pair of actors.
    ///
    /// Derived rather than declared, because a declaration can disagree with
    /// the actors it describes and the actors are the fact.
    #[must_use]
    pub fn derive(performed_by: &str, evaluated_by: &str) -> Self {
        if performed_by.trim() == evaluated_by.trim() {
            Self::SelfReview
        } else {
            Self::Independent
        }
    }
}

/// What a run set out to settle, and what it deliberately left alone.
///
/// A free-text question can be answered at any width, so a run could widen as
/// it went and nothing would notice. Feng et al., *Harness-of-Harness*
/// (arXiv:2609.01481) §3.4 make the opposite choice: each loop selects one
/// coherent objective "while excluding unrelated changes", and establishing
/// that scope *before* modification is what gives the increment "observable
/// completion conditions".
///
/// The exclusions matter as much as the objective. A boundary stated only as
/// what was included cannot be checked, because anything absent looks like
/// something nobody thought of rather than something ruled out.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RunObjective {
    /// The single coherent thing this run is for.
    pub objective: String,
    /// Observable conditions that would show the objective was met. Without at
    /// least one, "done" is whatever the run later decides it is.
    pub completion_conditions: Vec<String>,
    /// What this run deliberately does not cover.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub excludes: Vec<String>,
}

/// The scoped improvement question and its authorized boundaries.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ImproveRequest {
    pub contract_version: u32,
    pub run_id: String,
    pub scope_id: String,
    pub module: Module,
    pub question: String,
    #[serde(default)]
    pub constraints: Vec<String>,
    pub adapter_bindings: Vec<String>,
    pub stop_at: RunState,
    pub created_at: String,
    /// Who authored the run's readings, mechanisms and plans. Absent in runs
    /// recorded before acceptance was contracted.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub performed_by: Option<String>,
    /// Who accepted that output. Must differ from `performed_by` before a run
    /// may be called independently accepted.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub evaluated_by: Option<String>,
    /// The claimed acceptance kind. Validated against the actors, so a run
    /// cannot assert independence it does not have.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub acceptance: Option<AcceptanceKind>,
    /// What this run is bounded to. Absent in runs recorded before objectives
    /// were contracted; present ones must carry a completion condition.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope_boundary: Option<RunObjective>,
}

impl ImproveRequest {
    /// The acceptance this run can honestly claim.
    ///
    /// A run that recorded no actors gets `None` rather than a default, because
    /// an unrecorded acceptance and a self-reviewed one are different states and
    /// collapsing them would let silence read as a claim.
    #[must_use]
    pub fn derived_acceptance(&self) -> Option<AcceptanceKind> {
        match (&self.performed_by, &self.evaluated_by) {
            (Some(performed), Some(evaluated)) => {
                Some(AcceptanceKind::derive(performed, evaluated))
            }
            _ => None,
        }
    }
}

/// A candidate paper discovered through an adapter run.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Candidate {
    pub paper_id: String,
    pub title: String,
    pub source_uri: String,
    pub content_sha256: String,
    #[serde(default)]
    pub clusters: Vec<String>,
}

/// Literature refresh derived from one or more adapter runs.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct LiteratureRun {
    pub contract_version: u32,
    pub run_id: String,
    pub adapter_runs: Vec<AdapterRunRef>,
    pub candidates: Vec<Candidate>,
    pub new_candidates: Vec<String>,
    pub unchanged_candidates: Vec<String>,
}

/// Provenance for one adapter invocation consumed by the Lab.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct AdapterRunRef {
    pub binding_id: String,
    pub adapter_id: String,
    pub adapter_run_id: String,
    pub artifact_hash: String,
    pub source_revision: String,
}

/// Inclusion or exclusion of a candidate, always with a reason.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct SelectionDecision {
    pub paper_id: String,
    pub reason: String,
}

/// Which candidates will be read, and why the rest will not.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Selection {
    pub contract_version: u32,
    pub run_id: String,
    pub included: Vec<SelectionDecision>,
    pub excluded: Vec<SelectionDecision>,
}

/// Whether a statement came from the source or from the Lab.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ClaimOrigin {
    SourceClaim,
    LabInference,
}

/// How authoritative the read source is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceClass {
    PeerReviewed,
    Preprint,
    CuratedSecondary,
    Documentation,
    Unknown,
}

impl SourceClass {
    /// Stable identifier for the source class.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::PeerReviewed => "peer_reviewed",
            Self::Preprint => "preprint",
            Self::CuratedSecondary => "curated_secondary",
            Self::Documentation => "documentation",
            Self::Unknown => "unknown",
        }
    }
}

/// How much of the source was actually read.
///
/// This is not the same question as [`PaperReading::retained_full_text`],
/// which asks whether full text was *kept*. A reading may legitimately read
/// everything and retain nothing; that is the intended shape. Before this
/// distinction existed the contract recorded only the retention answer, so a
/// reading taken entirely from an abstract was indistinguishable from a
/// thorough one, and mechanisms rested on whichever the author happened to do.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReadDepth {
    /// Title, abstract, or catalogue metadata only.
    AbstractOnly,
    /// The body of the work, so section-level locators are available.
    FullText,
    /// Primary documentation, a specification, or a repository read directly.
    Documentation,
}

impl ReadDepth {
    /// Stable identifier for the read depth.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::AbstractOnly => "abstract_only",
            Self::FullText => "full_text",
            Self::Documentation => "documentation",
        }
    }

    /// Whether a reading at this depth may carry a mechanism.
    ///
    /// An abstract states conclusions without the design that produced them,
    /// so it can justify selecting a paper but not transferring a mechanism
    /// out of it.
    #[must_use]
    pub const fn supports_mechanism(self) -> bool {
        matches!(self, Self::FullText | Self::Documentation)
    }

    /// The depth assumed for a reading recorded before depth was contracted.
    ///
    /// Older readings are labelled `abstract_only` rather than assumed
    /// adequate. That is what they were, and it means an earlier run's
    /// mechanisms fail this contract instead of being grandfathered past it.
    #[must_use]
    pub const fn assumed_for_legacy() -> Self {
        Self::AbstractOnly
    }
}

const fn legacy_read_depth() -> ReadDepth {
    ReadDepth::assumed_for_legacy()
}

/// One extracted statement with its locator.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ReadClaim {
    pub id: String,
    pub text: String,
    pub origin: ClaimOrigin,
    pub locator: String,
}

/// Result of reading one selected paper.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PaperReading {
    pub paper_id: String,
    pub source_class: SourceClass,
    pub source_uri: String,
    pub content_sha256: String,
    /// How much of the source was read. Absent in runs recorded before the
    /// field existed, which are therefore read as `abstract_only`.
    #[serde(default = "legacy_read_depth")]
    pub read_depth: ReadDepth,
    pub claims: Vec<ReadClaim>,
    pub limitations: Vec<String>,
    pub retained_full_text: bool,
}

/// All readings for a run.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Readings {
    pub contract_version: u32,
    pub run_id: String,
    pub readings: Vec<PaperReading>,
}

/// A proposed MOZAK change derived from read claims.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Mechanism {
    pub id: String,
    pub proposed_mechanism: String,
    pub affected_contract: String,
    pub expected_benefit: String,
    pub risks: Vec<String>,
    pub supporting_claim_ids: Vec<String>,
}

/// Mechanisms extracted for a run.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct MechanismMap {
    pub contract_version: u32,
    pub run_id: String,
    pub mechanisms: Vec<Mechanism>,
}

/// A bounded, reviewable plan card.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ImplementationPlan {
    pub id: String,
    pub title: String,
    pub mechanism_ids: Vec<String>,
    pub deliverables: Vec<String>,
    pub acceptance_checks: Vec<String>,
    #[serde(default)]
    pub dependencies: Vec<String>,
}

/// Plan cards proposed for owner review.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ImplementationPlans {
    pub contract_version: u32,
    pub run_id: String,
    pub plans: Vec<ImplementationPlan>,
}

fn validate_version(version: u32) -> Result<(), LabError> {
    require(
        version == CONTRACT_VERSION,
        "unsupported contract_version for Lab artifact",
    )
}

fn validate_run_id(value: &str) -> Result<(), LabError> {
    require(
        value.starts_with("improve-") && value.len() > "improve-".len(),
        "run_id must start with 'improve-'",
    )
}

fn unique_ids<'a>(
    ids: impl Iterator<Item = &'a str>,
    label: &str,
) -> Result<BTreeSet<String>, LabError> {
    let mut seen = BTreeSet::new();
    for id in ids {
        require_filled(id, label)?;
        require(
            seen.insert(id.to_owned()),
            &format!("duplicate {label}: {id}"),
        )?;
    }
    Ok(seen)
}

/// Validates an improvement request.
///
/// # Errors
/// Returns the first contract violation.
pub fn validate_request(request: &ImproveRequest) -> Result<(), LabError> {
    validate_version(request.contract_version)?;
    validate_run_id(&request.run_id)?;
    require_filled(&request.scope_id, "scope_id")?;
    require_filled(&request.question, "question")?;
    require_filled(&request.created_at, "created_at")?;
    // Read paths deserialize a retired id happily, which is the point. Authoring
    // one is different: it would create new work under a boundary MOZAK no
    // longer draws. `validate_request` runs only on the two authoring paths.
    require(
        !request.module.is_retired(),
        "module is retired and cannot be used for a new run; run `mozak lab modules`",
    )?;
    require(
        !request.adapter_bindings.is_empty(),
        "adapter_bindings must not be empty",
    )?;
    unique_ids(
        request.adapter_bindings.iter().map(String::as_str),
        "adapter binding",
    )?;
    require(
        request.stop_at == RunState::OwnerReviewed,
        "phase A runs must stop at owner_reviewed",
    )?;

    // Acceptance is optional, but a half-recorded pair is not: one actor
    // without the other cannot be checked against anything, so it would let an
    // unverifiable claim sit in the record looking like a verified one.
    match (&request.performed_by, &request.evaluated_by) {
        (None, None) => {}
        (Some(performed), Some(evaluated)) => {
            require_filled(performed, "performed_by")?;
            require_filled(evaluated, "evaluated_by")?;
        }
        _ => {
            return Err(LabError(
                "record both performed_by and evaluated_by, or neither".to_owned(),
            ));
        }
    }

    // The actors are the fact; the label is a claim about them. A claim of
    // independence from a single actor is the overstatement this refuses.
    if let Some(claimed) = request.acceptance {
        let derived = request.derived_acceptance().ok_or_else(|| {
            LabError(
                "acceptance cannot be claimed without recording performed_by and evaluated_by"
                    .to_owned(),
            )
        })?;
        require(
            claimed == derived,
            match derived {
                AcceptanceKind::SelfReview => {
                    "acceptance cannot be independent when the same actor performed and evaluated the run"
                }
                AcceptanceKind::Independent => {
                    "acceptance is independent when different actors performed and evaluated the run"
                }
            },
        )?;
    }

    // An objective with no observable completion condition is a restatement of
    // the question, and "done" becomes whatever the run later decides it is.
    if let Some(boundary) = &request.scope_boundary {
        require_filled(&boundary.objective, "objective")?;
        require(
            !boundary.completion_conditions.is_empty(),
            "an objective must declare at least one observable completion condition",
        )?;
        for condition in &boundary.completion_conditions {
            require_filled(condition, "completion condition")?;
        }
        for exclusion in &boundary.excludes {
            require_filled(exclusion, "exclusion")?;
        }
    }
    Ok(())
}

/// Validates a literature refresh and its dedup accounting.
///
/// # Errors
/// Returns the first contract violation.
pub fn validate_literature(literature: &LiteratureRun) -> Result<(), LabError> {
    validate_version(literature.contract_version)?;
    validate_run_id(&literature.run_id)?;
    require(
        !literature.adapter_runs.is_empty(),
        "adapter_runs must not be empty",
    )?;
    for reference in &literature.adapter_runs {
        require_filled(&reference.binding_id, "binding_id")?;
        require_filled(&reference.adapter_id, "adapter_id")?;
        require_filled(&reference.adapter_run_id, "adapter_run_id")?;
        require_filled(&reference.artifact_hash, "artifact_hash")?;
        require_filled(&reference.source_revision, "source_revision")?;
    }
    let ids = unique_ids(
        literature.candidates.iter().map(|c| c.paper_id.as_str()),
        "paper_id",
    )?;
    for candidate in &literature.candidates {
        require_filled(&candidate.title, "candidate title")?;
        require_filled(&candidate.source_uri, "candidate source_uri")?;
        require_filled(&candidate.content_sha256, "candidate content_sha256")?;
    }
    for paper_id in literature
        .new_candidates
        .iter()
        .chain(literature.unchanged_candidates.iter())
    {
        require(
            ids.contains(paper_id.as_str()),
            &format!("dedup entry references unknown paper: {paper_id}"),
        )?;
    }
    require(
        literature.new_candidates.len() + literature.unchanged_candidates.len()
            == literature.candidates.len(),
        "every candidate must be classified as new or unchanged",
    )
}

/// Validates that selection covers the refreshed candidates with reasons.
///
/// # Errors
/// Returns the first contract violation.
pub fn validate_selection(
    selection: &Selection,
    literature: &LiteratureRun,
) -> Result<(), LabError> {
    validate_version(selection.contract_version)?;
    validate_run_id(&selection.run_id)?;
    require(
        selection.run_id == literature.run_id,
        "selection run_id must match the literature run",
    )?;
    require(
        !selection.included.is_empty(),
        "selection must include at least one paper",
    )?;
    let known = literature
        .candidates
        .iter()
        .map(|candidate| candidate.paper_id.as_str())
        .collect::<BTreeSet<_>>();
    let mut decided = BTreeSet::new();
    for decision in selection.included.iter().chain(selection.excluded.iter()) {
        require_filled(&decision.reason, "selection reason")?;
        require(
            known.contains(decision.paper_id.as_str()),
            &format!("selection references unknown paper: {}", decision.paper_id),
        )?;
        require(
            decided.insert(decision.paper_id.as_str()),
            &format!("paper decided twice: {}", decision.paper_id),
        )?;
    }
    require(
        decided.len() == known.len(),
        "every refreshed candidate needs an inclusion or exclusion reason",
    )
}

/// Validates readings, including the no-retained-full-text rule.
///
/// # Errors
/// Returns the first contract violation.
pub fn validate_readings(readings: &Readings, selection: &Selection) -> Result<(), LabError> {
    validate_version(readings.contract_version)?;
    validate_run_id(&readings.run_id)?;
    require(
        readings.run_id == selection.run_id,
        "readings run_id must match the selection",
    )?;
    let included = selection
        .included
        .iter()
        .map(|decision| decision.paper_id.as_str())
        .collect::<BTreeSet<_>>();
    let read = unique_ids(
        readings.readings.iter().map(|r| r.paper_id.as_str()),
        "reading paper_id",
    )?;
    for reading in &readings.readings {
        require(
            included.contains(reading.paper_id.as_str()),
            &format!("reading for unselected paper: {}", reading.paper_id),
        )?;
        require(
            !reading.retained_full_text,
            &format!(
                "full text must not be retained for {}; keep hashes and claims only",
                reading.paper_id
            ),
        )?;
        require_filled(&reading.content_sha256, "reading content_sha256")?;
        require_filled(&reading.source_uri, "reading source_uri")?;
        require(
            !reading.claims.is_empty(),
            &format!(
                "reading {} must record at least one claim",
                reading.paper_id
            ),
        )?;
        for claim in &reading.claims {
            require_filled(&claim.text, "claim text")?;
            require_filled(&claim.locator, "claim locator")?;
        }
    }
    require(
        read.len() == included.len(),
        "every included paper must be read before mechanism extraction",
    )?;
    unique_ids(
        readings
            .readings
            .iter()
            .flat_map(|reading| reading.claims.iter().map(|claim| claim.id.as_str())),
        "claim id",
    )?;
    Ok(())
}

/// Validates that every mechanism is anchored in a real source claim.
///
/// # Errors
/// Returns the first contract violation.
pub fn validate_mechanisms(map: &MechanismMap, readings: &Readings) -> Result<(), LabError> {
    validate_version(map.contract_version)?;
    validate_run_id(&map.run_id)?;
    require(
        map.run_id == readings.run_id,
        "mechanism map run_id must match the readings",
    )?;
    require(
        !map.mechanisms.is_empty(),
        "mechanism map must not be empty",
    )?;
    let origins = readings
        .readings
        .iter()
        .flat_map(|reading| {
            reading
                .claims
                .iter()
                .map(|claim| (claim.id.as_str(), (claim.origin, reading.read_depth)))
        })
        .collect::<BTreeMap<_, _>>();
    unique_ids(map.mechanisms.iter().map(|m| m.id.as_str()), "mechanism id")?;
    for mechanism in &map.mechanisms {
        require_filled(&mechanism.proposed_mechanism, "proposed_mechanism")?;
        require_filled(&mechanism.affected_contract, "affected_contract")?;
        require_filled(&mechanism.expected_benefit, "expected_benefit")?;
        require(
            !mechanism.risks.is_empty(),
            &format!("mechanism {} must state at least one risk", mechanism.id),
        )?;
        require(
            !mechanism.supporting_claim_ids.is_empty(),
            &format!("mechanism {} must cite supporting claims", mechanism.id),
        )?;
        let mut has_source_claim = false;
        let mut has_deep_source_claim = false;
        for claim_id in &mechanism.supporting_claim_ids {
            let (origin, depth) = origins.get(claim_id.as_str()).ok_or_else(|| {
                LabError(format!(
                    "mechanism {} cites unknown claim {claim_id}",
                    mechanism.id
                ))
            })?;
            if *origin == ClaimOrigin::SourceClaim {
                has_source_claim = true;
                if depth.supports_mechanism() {
                    has_deep_source_claim = true;
                }
            }
        }
        require(
            has_source_claim,
            &format!(
                "mechanism {} rests only on Lab inference; cite at least one source claim",
                mechanism.id
            ),
        )?;
        // An abstract reports what a paper concluded, not the design that
        // produced it. Transferring a mechanism out of one means copying a
        // summary of a method rather than the method.
        require(
            has_deep_source_claim,
            &format!(
                "mechanism {} rests only on abstract-only reading; read the full text before proposing it",
                mechanism.id
            ),
        )?;
    }
    Ok(())
}

/// Validates plan cards against the mechanism map.
///
/// # Errors
/// Returns the first contract violation.
pub fn validate_plans(plans: &ImplementationPlans, map: &MechanismMap) -> Result<(), LabError> {
    validate_version(plans.contract_version)?;
    validate_run_id(&plans.run_id)?;
    require(
        plans.run_id == map.run_id,
        "plans run_id must match the mechanism map",
    )?;
    require(!plans.plans.is_empty(), "plans must not be empty")?;
    let mechanisms = map
        .mechanisms
        .iter()
        .map(|mechanism| mechanism.id.as_str())
        .collect::<BTreeSet<_>>();
    let ids = unique_ids(plans.plans.iter().map(|plan| plan.id.as_str()), "plan id")?;
    for plan in &plans.plans {
        require_filled(&plan.title, "plan title")?;
        require(
            !plan.mechanism_ids.is_empty(),
            &format!("plan {} must reference a mechanism", plan.id),
        )?;
        for mechanism_id in &plan.mechanism_ids {
            require(
                mechanisms.contains(mechanism_id.as_str()),
                &format!(
                    "plan {} references unknown mechanism {mechanism_id}",
                    plan.id
                ),
            )?;
        }
        require(
            !plan.deliverables.is_empty(),
            &format!("plan {} must list deliverables", plan.id),
        )?;
        require(
            plan.acceptance_checks.len() >= 2,
            &format!("plan {} needs at least two acceptance checks", plan.id),
        )?;
        for dependency in &plan.dependencies {
            require(
                ids.contains(dependency.as_str()),
                &format!("plan {} depends on unknown plan {dependency}", plan.id),
            )?;
        }
    }
    Ok(())
}

/// Advances the ledger, refusing out-of-order or post-terminal transitions.
///
/// # Errors
/// Returns an error when the transition is not the next legal step.
pub fn advance(
    ledger: &mut RunLedger,
    next: RunState,
    actor: &str,
    at: &str,
    input: &Value,
) -> Result<(), LabError> {
    require(
        !ledger.state.is_terminal(),
        "run reached owner_reviewed; implementation requires a separately authorized phase",
    )?;
    require(
        next <= ledger.stop_at,
        "refusing to advance past the authorized stopping point",
    )?;
    let expected = next
        .predecessor()
        .ok_or_else(|| LabError("requested is only recorded when the run is created".to_owned()))?;
    require(
        ledger.state == expected,
        &format!(
            "cannot move to {} from {}; expected {}",
            next.as_str(),
            ledger.state.as_str(),
            expected.as_str()
        ),
    )?;
    require_filled(actor, "actor")?;
    require_filled(at, "at")?;
    let input_hash = canonical_hash(input).map_err(|error| LabError(error.to_string()))?;
    ledger.state = next;
    ledger.transitions.push(Transition {
        state: next,
        actor: actor.to_owned(),
        at: at.to_owned(),
        input_hash,
    });
    Ok(())
}

/// Splits candidates into newly seen and unchanged, then updates the ledger.
#[must_use]
pub fn classify_candidates(
    ledger: &mut RunLedger,
    candidates: &[Candidate],
) -> (Vec<String>, Vec<String>) {
    let mut fresh = Vec::new();
    let mut unchanged = Vec::new();
    for candidate in candidates {
        let previous = ledger.seen_sources.get(&candidate.paper_id);
        if previous.is_some_and(|hash| hash == &candidate.content_sha256) {
            unchanged.push(candidate.paper_id.clone());
        } else {
            fresh.push(candidate.paper_id.clone());
        }
        ledger
            .seen_sources
            .insert(candidate.paper_id.clone(), candidate.content_sha256.clone());
    }
    (fresh, unchanged)
}

/// Renders what the Scope already knew, before what this run found.
///
/// A reader who meets the new mechanisms first has no way to tell which are
/// genuinely new, and a preservation requirement discovered after the plans is
/// a constraint arriving too late to constrain anything.
fn render_inherited(out: &mut String, inherited: Option<&crate::lab_evidence::ScopeEvidence>) {
    let Some(evidence) = inherited else {
        return;
    };

    let requirements = evidence.preservation_requirements();
    let failures = evidence.open_failures();
    if !requirements.is_empty() || !failures.is_empty() {
        let _ = writeln!(out, "## Carried from earlier runs\n");
        if !requirements.is_empty() {
            let _ = writeln!(
                out,
                "Preservation requirements. Later work must honour these or retire them with a reason.\n"
            );
            for entry in requirements {
                let _ = writeln!(
                    out,
                    "- `{}` {} (recorded by {}, at {})",
                    entry.claim_id, entry.text, entry.recorded_by_run, entry.locator
                );
            }
            let _ = writeln!(out);
        }
        if !failures.is_empty() {
            let _ = writeln!(out, "Open failures from earlier runs.\n");
            for entry in failures {
                let _ = writeln!(out, "- `{}` {}", entry.claim_id, entry.text);
            }
            let _ = writeln!(out);
        }
        if !evidence.contradictions.is_empty() {
            let _ = writeln!(
                out,
                "Contradictions between runs, recorded rather than resolved.\n"
            );
            for conflict in &evidence.contradictions {
                let _ = writeln!(
                    out,
                    "- `{}` was {} in {}, now {} in {}",
                    conflict.claim_id,
                    conflict.earlier_standing.as_str(),
                    conflict.earlier_run,
                    conflict.later_standing.as_str(),
                    conflict.later_run
                );
            }
            let _ = writeln!(out);
        }
        let _ = writeln!(out, "{}\n", crate::lab_evidence::authority());
    }
}

/// Renders the declared boundary: what the run set out to settle, and what it
/// ruled out.
///
/// Exclusions are shown beside the objective rather than below the findings,
/// because a reader judging whether a gap is an oversight or a decision needs
/// both at once.
fn render_objective(out: &mut String, request: &ImproveRequest) {
    let Some(boundary) = &request.scope_boundary else {
        return;
    };
    let _ = writeln!(out, "## Objective\n");
    let _ = writeln!(out, "{}\n", boundary.objective);
    let _ = writeln!(out, "Complete when:\n");
    for condition in &boundary.completion_conditions {
        let _ = writeln!(out, "- {condition}");
    }
    let _ = writeln!(out);
    if !boundary.excludes.is_empty() {
        let _ = writeln!(out, "Deliberately excluded:\n");
        for exclusion in &boundary.excludes {
            let _ = writeln!(out, "- {exclusion}");
        }
        let _ = writeln!(out);
    }
}

/// Renders what was actually measured about each mechanism.
///
/// A mechanism with neither a pair nor a stated reason is listed as
/// unaccounted, because silence about evidence reads as evidence to a reader
/// skimming for problems.
fn render_mechanism_evidence(
    out: &mut String,
    evidence: Option<&crate::lab_evaluation::MechanismEvidence>,
    map: &MechanismMap,
) {
    let Some(evidence) = evidence else {
        return;
    };
    let _ = writeln!(out, "## Evidence for these mechanisms\n");
    for pair in &evidence.paired {
        let _ = writeln!(out, "### {} (paired observation)\n", pair.mechanism_id);
        let _ = writeln!(out, "- Task: {}", pair.task);
        let _ = writeln!(out, "- Without it: {}", pair.baseline.observed);
        let _ = writeln!(out, "- With it: {}", pair.treatment.observed);
        let _ = writeln!(out, "- Difference: {}", pair.difference);
        let held = pair
            .fixed_conditions
            .iter()
            .map(|condition| condition.kind.as_str())
            .collect::<Vec<_>>()
            .join(", ");
        let _ = writeln!(out, "- Held fixed: {held}");
        for limitation in &pair.limitations {
            let _ = writeln!(out, "- Limitation: {limitation}");
        }
        let _ = writeln!(out);
    }
    for unpaired in &evidence.unpaired {
        let _ = writeln!(
            out,
            "- `{}` has no paired observation: {}",
            unpaired.mechanism_id, unpaired.reason
        );
    }
    if !evidence.unpaired.is_empty() {
        let _ = writeln!(out);
    }
    let ids = map
        .mechanisms
        .iter()
        .map(|mechanism| mechanism.id.as_str())
        .collect::<Vec<_>>();
    let unaccounted = crate::lab_evaluation::unaccounted(evidence, &ids);
    if !unaccounted.is_empty() {
        let _ = writeln!(
            out,
            "**Unaccounted.** These mechanisms carry no paired observation and no stated reason for lacking one: {}\n",
            unaccounted.join(", ")
        );
    }
    let _ = writeln!(out, "{}\n", crate::lab_evaluation::authority());
}

/// Renders what this run read, proposed, and planned.
///
/// Split from the packet assembler so each renderer stays short enough to read
/// in one screen, which is the same reason the sections exist at all.
fn render_findings(
    out: &mut String,
    readings: &Readings,
    map: &MechanismMap,
    plans: &ImplementationPlans,
) {
    let _ = writeln!(out, "## Sources read\n");
    for reading in &readings.readings {
        let _ = writeln!(
            out,
            "- `{}` ({}, {}) sha256 `{}`",
            reading.paper_id,
            reading.source_class.as_str(),
            reading.read_depth.as_str(),
            reading.content_sha256
        );
    }

    let _ = writeln!(out, "\n## Proposed mechanisms\n");
    for mechanism in &map.mechanisms {
        let _ = writeln!(out, "### {}\n", mechanism.id);
        let _ = writeln!(out, "- Change: {}", mechanism.proposed_mechanism);
        let _ = writeln!(out, "- Contract: {}", mechanism.affected_contract);
        let _ = writeln!(out, "- Benefit: {}", mechanism.expected_benefit);
        let _ = writeln!(out, "- Risks: {}", mechanism.risks.join("; "));
        let _ = writeln!(
            out,
            "- Support: {}\n",
            mechanism.supporting_claim_ids.join(", ")
        );
    }

    let _ = writeln!(out, "## Implementation plans\n");
    for plan in &plans.plans {
        let _ = writeln!(out, "### {} {}\n", plan.id, plan.title);
        let _ = writeln!(out, "- Mechanisms: {}", plan.mechanism_ids.join(", "));
        for deliverable in &plan.deliverables {
            let _ = writeln!(out, "- Deliverable: {deliverable}");
        }
        for check in &plan.acceptance_checks {
            let _ = writeln!(out, "- Check: {check}");
        }
        if !plan.dependencies.is_empty() {
            let _ = writeln!(out, "- Depends on: {}", plan.dependencies.join(", "));
        }
        out.push('\n');
    }

    let _ = writeln!(out, "## Limitations\n");
    for reading in &readings.readings {
        for limitation in &reading.limitations {
            let _ = writeln!(out, "- {}: {limitation}", reading.paper_id);
        }
    }
    // A reader who takes contract validity as evidence of quality is making a
    // conflation the field has measured: Kevin et al. (arXiv:2608.20614) found
    // structural gates and live outcome judgement correlate at Spearman 0.14
    // across 145 real skills. Saying so here costs two lines and stops a valid
    // receipt from being read as a verdict on the work.
}

/// Everything the owner packet is rendered from.
///
/// Grouped rather than passed positionally: eight same-shaped references in a
/// row is a call site where two arguments can be swapped silently, and the two
/// optional ones at the end are exactly the pair most easily confused.
#[derive(Debug, Clone, Copy)]
pub struct ReviewInputs<'a> {
    pub request: &'a ImproveRequest,
    pub literature: &'a LiteratureRun,
    pub selection: &'a Selection,
    pub readings: &'a Readings,
    pub map: &'a MechanismMap,
    pub plans: &'a ImplementationPlans,
    /// What earlier runs on this Scope established.
    pub inherited: Option<&'a crate::lab_evidence::ScopeEvidence>,
    /// What was actually measured about this run's mechanisms.
    pub evidence: Option<&'a crate::lab_evaluation::MechanismEvidence>,
}

/// Renders the owner review packet.
#[must_use]
pub fn render_review(packet: &ReviewInputs<'_>) -> String {
    let ReviewInputs {
        request,
        literature,
        selection,
        readings,
        map,
        plans,
        inherited,
        evidence,
    } = *packet;
    let mut out = String::new();
    let _ = writeln!(out, "# Improvement review: {}\n", request.run_id);
    let _ = writeln!(out, "- Scope: `{}`", request.scope_id);
    let _ = writeln!(out, "- Module: `{}`", request.module.as_str());
    let _ = writeln!(out, "- Question: {}", request.question);
    let _ = writeln!(
        out,
        "- Candidates: {} ({} new, {} unchanged)",
        literature.candidates.len(),
        literature.new_candidates.len(),
        literature.unchanged_candidates.len()
    );
    let _ = writeln!(
        out,
        "- Read: {} of {} selected",
        readings.readings.len(),
        selection.included.len()
    );
    // Acceptance sits in the header, next to what the run covered, because a
    // reader weighs the findings by who checked them. Buried at the end it
    // would arrive after the conclusions it qualifies.
    match request.derived_acceptance() {
        Some(AcceptanceKind::SelfReview) => {
            let _ = writeln!(
                out,
                "- Acceptance: **self-review** ({} both performed and accepted this run)\n",
                request.performed_by.as_deref().unwrap_or("the same actor")
            );
        }
        Some(AcceptanceKind::Independent) => {
            let _ = writeln!(
                out,
                "- Acceptance: independent ({} performed, {} accepted)\n",
                request.performed_by.as_deref().unwrap_or("unrecorded"),
                request.evaluated_by.as_deref().unwrap_or("unrecorded")
            );
        }
        None => {
            let _ = writeln!(
                out,
                "- Acceptance: **not recorded** (this run does not say who performed or accepted it)\n"
            );
        }
    }

    render_objective(&mut out, request);
    render_inherited(&mut out, inherited);

    render_findings(&mut out, readings, map, plans);
    render_mechanism_evidence(&mut out, evidence, map);
    out.push_str(
        "\n## Status\n\nPlanning only. No MOZAK code was changed. Implementation and promotion require explicit owner authorization.\n\nValidation of this run checked structural conformance to the Lab contract. It did not assess whether the mechanisms are sound or the plans worth implementing, and a valid run is not evidence that they are.\n",
    );
    out
}
