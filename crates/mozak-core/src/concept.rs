//! Transferable Concepts and target-owned Translations.
//!
//! A Concept records a reusable mechanism, the invariant that makes it work,
//! its evidence, and the assumptions it rests on. A Translation is owned by the
//! adopting target and records what happened to every one of those assumptions.
//!
//! The contract exists because of a measured failure: porting a working
//! mechanism between two real projects carried three target-invalid
//! assumptions, each of which transferred silently as a constant. Adopting a
//! Concept therefore requires re-deriving every assumption in the target, and a
//! Concept never authorizes anything on its own.

use crate::canonical_hash;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::fmt::{Display, Formatter};

pub const CONTRACT_VERSION: u64 = 1;
pub const MAX_ASSUMPTIONS: usize = 64;
pub const MAX_EVIDENCE: usize = 64;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConceptError(pub String);

impl Display for ConceptError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for ConceptError {}

/// A source-owned reusable pattern. Advisory only: never authority.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Concept {
    pub contract_version: u64,
    pub id: String,
    pub version: u64,
    pub title: String,
    /// The reusable mechanism, described independently of its origin.
    pub mechanism: String,
    /// The property that must still hold for an adoption to be a real port
    /// rather than an imitation.
    pub invariant: String,
    /// Where the Concept is claimed to apply, and where it is not.
    pub applicability: String,
    pub origin: ConceptOrigin,
    pub evidence: Vec<ConceptEvidence>,
    pub assumptions: Vec<Assumption>,
    pub authority: ConceptAuthority,
}

/// Provenance of the project or topic that authored the Concept.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ConceptOrigin {
    pub scope_id: String,
    pub revision: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ConceptEvidence {
    pub id: String,
    pub observation: String,
    /// Where the observation can be re-read, such as a pinned research run or
    /// content-addressed input.
    pub locator: String,
}

/// One thing the mechanism silently depends on.
///
/// Assumptions are the whole point of the contract: an unstated assumption is
/// what transfers as a constant and breaks in the target.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Assumption {
    pub id: String,
    pub statement: String,
    /// Whether the mechanism's invariant fails outright when this assumption
    /// does not hold in the target.
    pub load_bearing: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConceptAuthority {
    /// A Concept informs a target. It never authorizes adoption, execution, or
    /// mutation, and it never becomes the target's truth automatically.
    AdvisoryOnly,
}

/// A target-owned record of adopting one exact Concept version.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Translation {
    pub contract_version: u64,
    pub id: String,
    pub version: u64,
    /// The exact source Concept this Translation re-derived.
    pub concept: ConceptRef,
    /// The adopting scope. It owns this artifact; the source does not.
    pub target_scope_id: String,
    pub target_revision: String,
    /// One check per source assumption. Completeness is enforced.
    pub assumption_checks: Vec<AssumptionCheck>,
    /// What the target observed after adopting, in the target itself.
    pub target_evidence: Vec<ConceptEvidence>,
    pub adoption: Adoption,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ConceptRef {
    pub id: String,
    pub version: u64,
    /// Canonical hash of the exact Concept, so a Concept cannot drift beneath
    /// a Translation that claims to have re-derived it.
    pub concept_sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct AssumptionCheck {
    pub assumption_id: String,
    pub outcome: AssumptionOutcome,
}

/// What the target found when it re-derived one source assumption.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum AssumptionOutcome {
    /// The assumption holds in the target, evidenced in the target.
    Holds { target_evidence_id: String },
    /// The assumption did not hold, and the target substituted something else.
    Replaced {
        substitution: String,
        target_evidence_id: String,
    },
    /// The assumption did not hold and was deliberately dropped.
    Rejected { rationale: String },
    /// The assumption could not be observed in the target at all.
    ///
    /// This is neither holding nor failing. It keeps an unproven adoption
    /// visibly unproven instead of silently counting as verified.
    CouldNotCheck { reason: String },
}

/// Whether the target adopted the Concept, and how strong the claim is.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Adoption {
    /// Every assumption was re-derived and the invariant is evidenced.
    Adopted,
    /// Adopted with a disclosed limitation: something was replaced, rejected,
    /// or could not be checked.
    Qualified,
    /// Considered and not adopted.
    Declined,
}

/// Returns the canonical hash of a Concept.
///
/// # Errors
/// Returns an error when the Concept cannot be canonically serialized.
pub fn concept_hash(concept: &Concept) -> Result<String, ConceptError> {
    canonical_hash(concept).map_err(|error| ConceptError(format!("cannot hash concept: {error}")))
}

/// Parses and validates a closed-shape Concept.
///
/// # Errors
/// Returns an error for malformed JSON or any contract violation.
pub fn validate_concept_json(input: &str) -> Result<Concept, ConceptError> {
    let concept: Concept = serde_json::from_str(input)
        .map_err(|error| ConceptError(format!("invalid concept JSON: {error}")))?;
    validate_concept(&concept)?;
    Ok(concept)
}

/// Validates a Concept's identity, provenance, evidence, and assumptions.
///
/// # Errors
/// Returns the first deterministic contract violation.
pub fn validate_concept(concept: &Concept) -> Result<(), ConceptError> {
    require(
        concept.contract_version == CONTRACT_VERSION,
        "unsupported contract_version",
    )?;
    nonempty(&concept.id, "concept id")?;
    require(concept.version > 0, "concept version must be positive")?;
    nonempty(&concept.title, "concept title")?;
    nonempty(&concept.mechanism, "concept mechanism")?;
    nonempty(&concept.invariant, "concept invariant")?;
    nonempty(&concept.applicability, "concept applicability")?;
    nonempty(&concept.origin.scope_id, "concept origin scope_id")?;
    nonempty(&concept.origin.revision, "concept origin revision")?;

    // A Concept without evidence is an opinion, and transferring an opinion is
    // exactly what this contract exists to prevent.
    require(
        !concept.evidence.is_empty(),
        "concept must carry supporting evidence",
    )?;
    require(
        concept.evidence.len() <= MAX_EVIDENCE,
        "too many concept evidence records",
    )?;
    let mut evidence_ids = BTreeSet::new();
    for evidence in &concept.evidence {
        nonempty(&evidence.id, "concept evidence id")?;
        nonempty(&evidence.observation, "concept evidence observation")?;
        nonempty(&evidence.locator, "concept evidence locator")?;
        require(
            evidence_ids.insert(evidence.id.as_str()),
            "duplicate concept evidence id",
        )?;
    }

    // An unstated assumption is the failure mode, so a Concept must name at
    // least one rather than presenting itself as universally portable.
    require(
        !concept.assumptions.is_empty(),
        "concept must state at least one assumption",
    )?;
    require(
        concept.assumptions.len() <= MAX_ASSUMPTIONS,
        "too many concept assumptions",
    )?;
    let mut assumption_ids = BTreeSet::new();
    for assumption in &concept.assumptions {
        nonempty(&assumption.id, "assumption id")?;
        nonempty(&assumption.statement, "assumption statement")?;
        require(
            assumption_ids.insert(assumption.id.as_str()),
            "duplicate assumption id",
        )?;
    }
    Ok(())
}

/// Parses and validates a Translation against its exact source Concept.
///
/// # Errors
/// Returns an error for malformed JSON or any contract violation.
pub fn validate_translation_json(
    input: &str,
    concept: &Concept,
) -> Result<Translation, ConceptError> {
    let translation: Translation = serde_json::from_str(input)
        .map_err(|error| ConceptError(format!("invalid translation JSON: {error}")))?;
    validate_translation(&translation, concept)?;
    Ok(translation)
}

/// Validates that a target re-derived every source assumption before adopting.
///
/// # Errors
/// Returns the first deterministic contract violation.
pub fn validate_translation(
    translation: &Translation,
    concept: &Concept,
) -> Result<(), ConceptError> {
    validate_concept(concept)?;
    require(
        translation.contract_version == CONTRACT_VERSION,
        "unsupported contract_version",
    )?;
    nonempty(&translation.id, "translation id")?;
    require(
        translation.version > 0,
        "translation version must be positive",
    )?;
    nonempty(&translation.target_scope_id, "translation target_scope_id")?;
    nonempty(&translation.target_revision, "translation target_revision")?;

    // The Translation must pin the exact Concept it re-derived, or its checks
    // describe a source that has since changed.
    require(
        translation.concept.id == concept.id,
        "translation references a different concept id",
    )?;
    require(
        translation.concept.version == concept.version,
        "translation references a different concept version",
    )?;
    require(
        translation.concept.concept_sha256 == concept_hash(concept)?,
        "translation concept hash mismatch",
    )?;

    // A target must not adopt its own source: a Translation records crossing a
    // boundary between independently owned scopes.
    require(
        translation.target_scope_id != concept.origin.scope_id,
        "translation target must differ from the concept origin scope",
    )?;

    let mut target_evidence_ids = BTreeSet::new();
    for evidence in &translation.target_evidence {
        nonempty(&evidence.id, "target evidence id")?;
        nonempty(&evidence.observation, "target evidence observation")?;
        nonempty(&evidence.locator, "target evidence locator")?;
        require(
            target_evidence_ids.insert(evidence.id.as_str()),
            "duplicate target evidence id",
        )?;
    }

    // Completeness is the core invariant. Porting a mechanism means
    // re-deriving its assumptions, not transplanting its constants, so every
    // source assumption needs exactly one recorded outcome.
    let source_ids: BTreeSet<_> = concept
        .assumptions
        .iter()
        .map(|assumption| assumption.id.as_str())
        .collect();
    let mut checked = BTreeSet::new();
    for check in &translation.assumption_checks {
        require(
            source_ids.contains(check.assumption_id.as_str()),
            "translation checks an assumption the concept does not state",
        )?;
        require(
            checked.insert(check.assumption_id.as_str()),
            "duplicate assumption check",
        )?;
        validate_outcome(&check.outcome, &target_evidence_ids)?;
    }
    require(
        checked.len() == source_ids.len(),
        "translation must re-derive every concept assumption",
    )?;

    validate_adoption(translation, concept)
}

fn validate_outcome(
    outcome: &AssumptionOutcome,
    target_evidence_ids: &BTreeSet<&str>,
) -> Result<(), ConceptError> {
    match outcome {
        AssumptionOutcome::Holds { target_evidence_id } => require(
            target_evidence_ids.contains(target_evidence_id.as_str()),
            "a holding assumption requires evidence observed in the target",
        ),
        AssumptionOutcome::Replaced {
            substitution,
            target_evidence_id,
        } => {
            nonempty(substitution, "substitution")?;
            require(
                target_evidence_ids.contains(target_evidence_id.as_str()),
                "a replaced assumption requires evidence observed in the target",
            )
        }
        AssumptionOutcome::Rejected { rationale } => nonempty(rationale, "rejection rationale"),
        AssumptionOutcome::CouldNotCheck { reason } => nonempty(reason, "could_not_check reason"),
    }
}

fn validate_adoption(translation: &Translation, concept: &Concept) -> Result<(), ConceptError> {
    let load_bearing: BTreeSet<_> = concept
        .assumptions
        .iter()
        .filter(|assumption| assumption.load_bearing)
        .map(|assumption| assumption.id.as_str())
        .collect();
    let mut unproven = false;
    let mut weakened = false;
    let mut broken_invariant = false;
    for check in &translation.assumption_checks {
        let critical = load_bearing.contains(check.assumption_id.as_str());
        match &check.outcome {
            AssumptionOutcome::Holds { .. } => {}
            AssumptionOutcome::Replaced { .. } => weakened = true,
            AssumptionOutcome::Rejected { .. } => {
                weakened = true;
                if critical {
                    broken_invariant = true;
                }
            }
            AssumptionOutcome::CouldNotCheck { .. } => {
                unproven = true;
                if critical {
                    broken_invariant = true;
                }
            }
        }
    }
    match translation.adoption {
        Adoption::Adopted => {
            require(
                !unproven,
                "an adopted translation must not rest on an unchecked assumption",
            )?;
            require(
                !weakened,
                "a translation that replaced or rejected an assumption is qualified, not adopted",
            )?;
            require(
                !translation.target_evidence.is_empty(),
                "an adopted translation requires target evidence",
            )?;
        }
        Adoption::Qualified => {
            require(
                unproven || weakened,
                "a qualified translation must disclose a limitation",
            )?;
            require(
                !broken_invariant,
                "a load-bearing assumption that was rejected or unchecked cannot be qualified adoption",
            )?;
        }
        Adoption::Declined => {}
    }
    Ok(())
}

fn require(condition: bool, message: &str) -> Result<(), ConceptError> {
    if condition {
        Ok(())
    } else {
        Err(ConceptError(message.to_owned()))
    }
}

fn nonempty(value: &str, label: &str) -> Result<(), ConceptError> {
    require(
        !value.trim().is_empty(),
        &format!("{label} must not be empty"),
    )
}
