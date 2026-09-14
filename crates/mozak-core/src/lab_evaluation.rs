//! Paired observation of a mechanism, and versioned gate criteria.
//!
//! Two problems, one module, because both are about the same confusion: taking
//! a check that passed as evidence that the thing checked is good.
//!
//! **Paired observation.** MOZAK had no way to tell a mechanism that helps from
//! one that merely sounds right. Kevin et al., *Skill Lift* (arXiv:2608.20614)
//! measured the gap: across 145 real skills, structural gates and live outcome
//! judgement correlated at Spearman 0.14, and only 72.8% of skills showed
//! positive lift at all. Roughly one in four capabilities did not help, and the
//! structural check could not say which. Their answer is a paired trial: the
//! same task run with and without the target, holding the model, harness,
//! workspace and grader fixed, reporting the difference rather than a verdict.
//!
//! **Gate criteria.** Kong et al. (Netflix) argue an evaluator is not a fixed
//! artifact: it is built, tuned, deployed and maintained while the world moves
//! under it. MOZAK's gates are code, so their criteria were implicit in the
//! implementation and nobody could audit why a gate accepts what it accepts.
//!
//! Two properties are enforced rather than described:
//!
//! - **A pair that did not hold its conditions fixed is not a result.** It is
//!   rejected, because an uncontrolled difference attributed to the mechanism
//!   is worse than no measurement: it looks like evidence.
//! - **A contribution is a difference, never a quality claim.** The contract
//!   has no field for "good". It records what changed under stated conditions,
//!   which is the only thing a pair can establish.

use crate::canonical_hash;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

/// Contract version for paired observations and gate declarations.
pub const CONTRACT_VERSION: u32 = 1;

/// A bounded evaluation failure.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EvaluationError(pub String);

impl std::fmt::Display for EvaluationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for EvaluationError {}

fn require(condition: bool, message: &str) -> Result<(), EvaluationError> {
    if condition {
        Ok(())
    } else {
        Err(EvaluationError(message.to_owned()))
    }
}

fn require_filled(value: &str, label: &str) -> Result<(), EvaluationError> {
    require(
        !value.trim().is_empty(),
        &format!("{label} must not be empty"),
    )
}

/// A condition that must be identical on both sides of a pair.
///
/// The same five conditions a case record accounts for, because a paired trial
/// and a case study are asking one question at different scales: what was held
/// constant while this was observed.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(deny_unknown_fields)]
pub struct FixedCondition {
    pub kind: String,
    /// The value on the baseline side.
    pub baseline: String,
    /// The value on the side with the mechanism applied.
    pub treatment: String,
}

impl FixedCondition {
    /// Whether this condition actually stayed fixed.
    #[must_use]
    pub fn held(&self) -> bool {
        self.baseline.trim() == self.treatment.trim()
    }
}

/// One side of a paired observation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PairedSide {
    /// What was observed, in the units the task is graded in.
    pub observed: String,
    /// Where the observation can be re-read.
    pub locator: String,
}

/// The same bounded task observed with and without one mechanism.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PairedObservation {
    pub contract_version: u32,
    /// The mechanism whose contribution this pair measures.
    pub mechanism_id: String,
    /// The bounded task both sides performed.
    pub task: String,
    pub baseline: PairedSide,
    pub treatment: PairedSide,
    /// Conditions declared as held fixed. Every one is checked.
    pub fixed_conditions: Vec<FixedCondition>,
    /// The observed difference. A difference under stated conditions, never a
    /// judgement: the contract has no field in which to record "better".
    pub difference: String,
    /// What this pair cannot establish.
    pub limitations: Vec<String>,
}

/// Why a mechanism is being promoted without a paired observation.
///
/// A contract-level mechanism's value appears across many later runs, so
/// demanding a pair for every one would make the honest answer impossible to
/// record and push people to fabricate a trial. The escape is explicit and
/// written down rather than silent.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct UnpairedReason {
    pub mechanism_id: String,
    pub reason: String,
}

/// Evidence offered for the mechanisms a run proposes.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct MechanismEvidence {
    pub contract_version: u32,
    pub run_id: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub paired: Vec<PairedObservation>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unpaired: Vec<UnpairedReason>,
}

/// Validates one paired observation.
///
/// # Errors
/// Returns the first contract violation, including any condition that did not
/// actually stay fixed.
pub fn validate_pair(pair: &PairedObservation) -> Result<(), EvaluationError> {
    require(
        pair.contract_version == CONTRACT_VERSION,
        "unsupported contract_version for a paired observation",
    )?;
    require_filled(&pair.mechanism_id, "mechanism_id")?;
    require_filled(&pair.task, "task")?;
    require_filled(&pair.baseline.observed, "baseline observation")?;
    require_filled(&pair.baseline.locator, "baseline locator")?;
    require_filled(&pair.treatment.observed, "treatment observation")?;
    require_filled(&pair.treatment.locator, "treatment locator")?;
    require_filled(&pair.difference, "difference")?;

    require(
        !pair.fixed_conditions.is_empty(),
        "a paired observation must declare the conditions it held fixed",
    )?;

    // The check that makes a pair a pair. A difference measured while something
    // else also changed is not the mechanism's contribution, and reporting it
    // as one is the overclaim Skill Lift's paired design exists to prevent.
    for condition in &pair.fixed_conditions {
        require_filled(&condition.kind, "condition kind")?;
        require_filled(&condition.baseline, "condition baseline value")?;
        require_filled(&condition.treatment, "condition treatment value")?;
        if !condition.held() {
            return Err(EvaluationError(format!(
                "condition {} was not held fixed: baseline {:?} differs from treatment {:?}",
                condition.kind, condition.baseline, condition.treatment
            )));
        }
    }

    // A pair establishes a difference on one task under one set of conditions.
    // Saying nothing about that is how a single trial becomes a general claim.
    require(
        !pair.limitations.is_empty(),
        "a paired observation must record what it cannot establish",
    )?;
    for limitation in &pair.limitations {
        require_filled(limitation, "limitation")?;
    }
    Ok(())
}

/// Validates the evidence offered for a run's mechanisms.
///
/// # Errors
/// Returns the first contract violation.
pub fn validate_evidence(evidence: &MechanismEvidence) -> Result<(), EvaluationError> {
    require(
        evidence.contract_version == CONTRACT_VERSION,
        "unsupported contract_version for mechanism evidence",
    )?;
    require_filled(&evidence.run_id, "run_id")?;
    for pair in &evidence.paired {
        validate_pair(pair)?;
    }
    for unpaired in &evidence.unpaired {
        require_filled(&unpaired.mechanism_id, "mechanism_id")?;
        require_filled(&unpaired.reason, "reason")?;
    }

    // A mechanism cannot be both measured and excused. Allowing both would let
    // a weak pair sit beside an excuse, and a reader could not tell which the
    // promotion actually rested on.
    let paired = evidence
        .paired
        .iter()
        .map(|pair| pair.mechanism_id.as_str())
        .collect::<BTreeSet<_>>();
    for unpaired in &evidence.unpaired {
        require(
            !paired.contains(unpaired.mechanism_id.as_str()),
            "a mechanism cannot carry both a paired observation and a reason for lacking one",
        )?;
    }
    Ok(())
}

/// Mechanisms in `ids` with neither a pair nor a recorded reason.
///
/// Returned rather than rejected, because whether an unaccounted mechanism
/// blocks a run is the caller's decision and not this contract's.
#[must_use]
pub fn unaccounted<'a>(evidence: &MechanismEvidence, ids: &[&'a str]) -> Vec<&'a str> {
    let accounted = evidence
        .paired
        .iter()
        .map(|pair| pair.mechanism_id.as_str())
        .chain(
            evidence
                .unpaired
                .iter()
                .map(|unpaired| unpaired.mechanism_id.as_str()),
        )
        .collect::<BTreeSet<_>>();
    ids.iter()
        .filter(|id| !accounted.contains(*id))
        .copied()
        .collect()
}

/// One acceptance gate, with the criteria it claims to apply.
///
/// A gate whose criteria live only in its implementation cannot be audited,
/// argued with, or deliberately revised. Declaring them makes the evaluator
/// itself reviewable, which is Kong et al.'s point about a judge having a
/// lifecycle rather than a construction date.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct GateDeclaration {
    pub gate_id: String,
    /// What the gate checks, in reviewable prose.
    pub criteria: Vec<String>,
    /// When the criteria last changed.
    pub criteria_revised_at: String,
    /// Hash of the implementation the criteria were last reconciled against.
    /// Drift between this and the current implementation is the signal that a
    /// gate's description has stopped matching what it does.
    pub reconciled_implementation_sha256: String,
}

/// A gate whose declared criteria no longer match its implementation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct GateDrift {
    pub gate_id: String,
    pub reconciled_sha256: String,
    pub observed_sha256: String,
}

/// Validates a gate declaration.
///
/// # Errors
/// Returns the first contract violation.
pub fn validate_gate(gate: &GateDeclaration) -> Result<(), EvaluationError> {
    require_filled(&gate.gate_id, "gate_id")?;
    require(
        !gate.criteria.is_empty(),
        "a gate must declare what it checks",
    )?;
    for criterion in &gate.criteria {
        require_filled(criterion, "criterion")?;
    }
    require_filled(&gate.criteria_revised_at, "criteria_revised_at")?;
    require_filled(
        &gate.reconciled_implementation_sha256,
        "reconciled_implementation_sha256",
    )
}

/// Reports gates whose declared criteria have drifted from the implementation.
///
/// A gate absent from `observed` is not reported as drift. Absence means the
/// implementation was not inspected, which is a different and quieter problem
/// than a mismatch, and conflating them would make every unchecked gate look
/// broken.
#[must_use]
pub fn detect_drift(
    gates: &[GateDeclaration],
    observed: &std::collections::BTreeMap<String, String>,
) -> Vec<GateDrift> {
    let mut drifted = Vec::new();
    for gate in gates {
        if let Some(current) = observed.get(&gate.gate_id)
            && current != &gate.reconciled_implementation_sha256
        {
            drifted.push(GateDrift {
                gate_id: gate.gate_id.clone(),
                reconciled_sha256: gate.reconciled_implementation_sha256.clone(),
                observed_sha256: current.clone(),
            });
        }
    }
    drifted
}

/// Canonical hash of mechanism evidence.
///
/// # Errors
/// Returns an error when the evidence cannot be canonically serialized.
pub fn evidence_hash(evidence: &MechanismEvidence) -> Result<String, EvaluationError> {
    canonical_hash(evidence)
        .map_err(|error| EvaluationError(format!("cannot hash mechanism evidence: {error}")))
}

/// Parses and validates mechanism evidence from JSON.
///
/// # Errors
/// Returns an error for malformed JSON or any contract violation.
pub fn validate_evidence_json(input: &str) -> Result<MechanismEvidence, EvaluationError> {
    let evidence: MechanismEvidence = serde_json::from_str(input)
        .map_err(|error| EvaluationError(format!("invalid mechanism evidence JSON: {error}")))?;
    validate_evidence(&evidence)?;
    Ok(evidence)
}

/// What a paired observation does and does not establish.
#[must_use]
pub const fn authority() -> &'static str {
    "difference_under_stated_conditions: a pair reports what changed on one bounded task with the declared conditions held fixed; it is not a quality claim, does not generalize beyond that task, and promotes nothing"
}
