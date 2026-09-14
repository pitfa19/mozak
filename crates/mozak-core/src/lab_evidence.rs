//! Durable evidence state carried between Lab runs on one Scope.
//!
//! MOZAK preserves artifacts well and knowledge badly. A Scope records what its
//! project *is*; nothing recorded what had already been *checked*. So every Lab
//! run began from files and re-derived its understanding, and the second run of
//! this feature's own development had no idea the first had happened.
//!
//! Feng et al., *Harness-of-Harness* (arXiv:2609.01481) §3.3 names the failure
//! precisely: a loop inheriting only the artifact "must reconstruct the
//! development state from the implementation", and that reconstruction can
//! "overlook unmet requirements, repeat work whose outcome is already known,
//! forget unresolved failures, or regress validated behaviour". Their answer is
//! two states that do not subsume each other, an artifact state and an evidence
//! state, carried together across every loop boundary.
//!
//! This module is MOZAK's evidence state. Three properties make it safe to
//! carry rather than merely convenient:
//!
//! - **It proposes, never authorizes.** An entry is something a run observed.
//!   Promoting it to an accepted planning input remains an owner decision, so
//!   carrying knowledge forward cannot become a route around the owner gate.
//! - **It contradicts loudly.** A later run disagreeing with an earlier held
//!   claim records a contradiction rather than overwriting it. Silent overwrite
//!   would let the most recent run rewrite history by being most recent.
//! - **It binds.** A claim recorded as held becomes a preservation requirement,
//!   so later work must honour it or retire it with a reason. Evidence that
//!   only informs one decision is a note; evidence that constrains later work
//!   is a contract.

use crate::canonical_hash;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

/// Contract version for Scope evidence state.
pub const CONTRACT_VERSION: u32 = 1;

/// A bounded evidence-state failure.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EvidenceError(pub String);

impl std::fmt::Display for EvidenceError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for EvidenceError {}

fn fail<T>(message: impl Into<String>) -> Result<T, EvidenceError> {
    Err(EvidenceError(message.into()))
}

fn require_evidence(condition: bool, message: &str) -> Result<(), EvidenceError> {
    if condition {
        Ok(())
    } else {
        Err(EvidenceError(message.to_owned()))
    }
}

fn require_filled(value: &str, label: &str) -> Result<(), EvidenceError> {
    require_evidence(
        !value.trim().is_empty(),
        &format!("{label} must not be empty"),
    )
}

/// What a run concluded about one claim.
///
/// The three states are deliberately not a boolean. A claim that was checked
/// and failed to hold is different from one nobody has checked, and an open
/// failure is different again: it is work outstanding rather than a verdict.
/// Collapsing them would make absence of evidence look like evidence.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum ClaimStanding {
    /// Checked and supported. Becomes a preservation requirement.
    Held,
    /// Checked and not supported by what the run observed.
    Unsupported,
    /// An observed failure that remains unresolved.
    OpenFailure,
}

impl ClaimStanding {
    /// Stable identifier for the standing.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Held => "held",
            Self::Unsupported => "unsupported",
            Self::OpenFailure => "open_failure",
        }
    }

    /// Whether a claim at this standing constrains later work.
    ///
    /// Only a held claim binds. An unsupported claim records that a check
    /// failed, which is worth carrying but is not a behaviour to preserve.
    #[must_use]
    pub const fn is_preservation_requirement(self) -> bool {
        matches!(self, Self::Held)
    }
}

/// One thing a Lab run established about a Scope.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct EvidenceEntry {
    /// Stable identity of the claim across runs. Two runs using the same id
    /// are talking about the same thing, which is what makes disagreement
    /// detectable rather than invisible.
    pub claim_id: String,
    pub text: String,
    pub standing: ClaimStanding,
    /// Where the claim can be re-read.
    pub locator: String,
    /// The Lab run that recorded this entry.
    pub recorded_by_run: String,
    pub recorded_at: String,
    /// Hash of the source the claim was read from, so a later reader can tell
    /// whether the underlying source has since changed.
    pub source_sha256: String,
}

/// A disagreement between runs about the same claim.
///
/// Recorded rather than resolved. MOZAK cannot know which run was right, and
/// a contract that picked one would be asserting a judgement it has no basis
/// for. Surfacing the conflict is the honest and the useful behaviour.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct EvidenceContradiction {
    pub claim_id: String,
    pub earlier_standing: ClaimStanding,
    pub earlier_run: String,
    pub later_standing: ClaimStanding,
    pub later_run: String,
}

/// Evidence accumulated across every Lab run on one Scope.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ScopeEvidence {
    pub contract_version: u32,
    pub scope_id: String,
    /// Every entry ever recorded, in the order recorded. Append-only, because
    /// an evidence state that forgets cannot be audited.
    pub entries: Vec<EvidenceEntry>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub contradictions: Vec<EvidenceContradiction>,
}

impl ScopeEvidence {
    /// An empty evidence state for a Scope.
    #[must_use]
    pub fn new(scope_id: &str) -> Self {
        Self {
            contract_version: CONTRACT_VERSION,
            scope_id: scope_id.to_owned(),
            entries: Vec::new(),
            contradictions: Vec::new(),
        }
    }

    /// The current standing of each claim, latest recording winning.
    ///
    /// Latest wins for *reading*, while every earlier entry survives in
    /// `entries` and any disagreement is recorded in `contradictions`. A reader
    /// gets the current picture; an auditor still gets the whole history.
    #[must_use]
    pub fn current(&self) -> BTreeMap<&str, &EvidenceEntry> {
        let mut current: BTreeMap<&str, &EvidenceEntry> = BTreeMap::new();
        for entry in &self.entries {
            current.insert(entry.claim_id.as_str(), entry);
        }
        current
    }

    /// Claims that later work must honour or explicitly retire.
    #[must_use]
    pub fn preservation_requirements(&self) -> Vec<&EvidenceEntry> {
        let mut held = self
            .current()
            .into_values()
            .filter(|entry| entry.standing.is_preservation_requirement())
            .collect::<Vec<_>>();
        held.sort_by(|a, b| a.claim_id.cmp(&b.claim_id));
        held
    }

    /// Failures recorded by earlier runs and never resolved.
    #[must_use]
    pub fn open_failures(&self) -> Vec<&EvidenceEntry> {
        let mut open = self
            .current()
            .into_values()
            .filter(|entry| entry.standing == ClaimStanding::OpenFailure)
            .collect::<Vec<_>>();
        open.sort_by(|a, b| a.claim_id.cmp(&b.claim_id));
        open
    }

    /// Records new entries, surfacing any disagreement with what is already held.
    ///
    /// # Errors
    /// Returns an error when an entry is malformed or belongs to another Scope.
    pub fn record(
        &mut self,
        scope_id: &str,
        incoming: Vec<EvidenceEntry>,
    ) -> Result<Vec<EvidenceContradiction>, EvidenceError> {
        require_evidence(
            scope_id == self.scope_id,
            "evidence belongs to a different Scope",
        )?;
        let mut found = Vec::new();
        for entry in incoming {
            validate_entry(&entry)?;
            if let Some(existing) = self.current().get(entry.claim_id.as_str())
                && existing.standing != entry.standing
            {
                found.push(EvidenceContradiction {
                    claim_id: entry.claim_id.clone(),
                    earlier_standing: existing.standing,
                    earlier_run: existing.recorded_by_run.clone(),
                    later_standing: entry.standing,
                    later_run: entry.recorded_by_run.clone(),
                });
            }
            self.entries.push(entry);
        }
        self.contradictions.extend(found.iter().cloned());
        Ok(found)
    }

    /// Canonical hash of this evidence state.
    ///
    /// # Errors
    /// Returns an error when the state cannot be canonically serialized.
    pub fn hash(&self) -> Result<String, EvidenceError> {
        canonical_hash(self)
            .map_err(|error| EvidenceError(format!("cannot hash evidence: {error}")))
    }
}

fn validate_entry(entry: &EvidenceEntry) -> Result<(), EvidenceError> {
    require_filled(&entry.claim_id, "claim_id")?;
    require_filled(&entry.text, "claim text")?;
    require_filled(&entry.locator, "locator")?;
    require_filled(&entry.recorded_by_run, "recorded_by_run")?;
    require_filled(&entry.recorded_at, "recorded_at")?;
    // Deliberately as strict as the Lab reading contract it derives from, and
    // no stricter. A reading records whatever identifier its adapter produced,
    // so demanding a 64-character digest here would reject evidence from runs
    // the Lab itself accepts, and the first thing that broke would be the
    // carry-forward this module exists to perform.
    require_filled(&entry.source_sha256, "source_sha256")
}

/// Validates a whole evidence state.
///
/// # Errors
/// Returns the first contract violation.
pub fn validate(evidence: &ScopeEvidence) -> Result<(), EvidenceError> {
    require_evidence(
        evidence.contract_version == CONTRACT_VERSION,
        "unsupported contract_version for Scope evidence",
    )?;
    require_filled(&evidence.scope_id, "scope_id")?;
    for entry in &evidence.entries {
        validate_entry(entry)?;
    }

    // A recorded contradiction must correspond to entries that actually
    // disagree. Without this an evidence state could carry a manufactured
    // conflict, or claim a conflict was handled when no such claim exists.
    let known = evidence
        .entries
        .iter()
        .map(|entry| entry.claim_id.as_str())
        .collect::<BTreeSet<_>>();
    for contradiction in &evidence.contradictions {
        require_evidence(
            known.contains(contradiction.claim_id.as_str()),
            "a contradiction names a claim with no recorded entry",
        )?;
        require_evidence(
            contradiction.earlier_standing != contradiction.later_standing,
            "a contradiction must record two different standings",
        )?;
    }

    // Every disagreement present in the entries must be recorded. A state that
    // silently dropped one would look consistent while hiding the conflict
    // that matters most.
    let mut seen: BTreeMap<&str, &EvidenceEntry> = BTreeMap::new();
    let recorded = evidence
        .contradictions
        .iter()
        .map(|c| c.claim_id.as_str())
        .collect::<BTreeSet<_>>();
    for entry in &evidence.entries {
        if let Some(previous) = seen.get(entry.claim_id.as_str())
            && previous.standing != entry.standing
            && !recorded.contains(entry.claim_id.as_str())
        {
            return fail(format!(
                "claim {} changed standing without a recorded contradiction",
                entry.claim_id
            ));
        }
        seen.insert(entry.claim_id.as_str(), entry);
    }
    Ok(())
}

/// Parses and validates evidence state from JSON.
///
/// # Errors
/// Returns an error for malformed JSON or any contract violation.
pub fn validate_json(input: &str) -> Result<ScopeEvidence, EvidenceError> {
    let evidence: ScopeEvidence = serde_json::from_str(input)
        .map_err(|error| EvidenceError(format!("invalid Scope evidence JSON: {error}")))?;
    validate(&evidence)?;
    Ok(evidence)
}

/// What carrying evidence forward does and does not authorize.
///
/// Stated as a value rather than left to documentation, because the whole risk
/// of a durable evidence state is that it quietly becomes a source of accepted
/// truth. A caller that renders this cannot omit the boundary by accident.
#[must_use]
pub const fn authority() -> &'static str {
    "proposal_only: carried evidence informs a later run and constrains what it may silently discard; it accepts nothing and remains subject to the ordinary owner approval before becoming a planning input"
}
