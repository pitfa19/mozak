//! Deterministic M0 event projection and canonical hashing.

pub mod attestation;
pub mod case_study;
pub mod concept;
pub mod execution;
pub mod kb;
pub mod knowledge_package;
pub mod lab;
pub mod lab_evaluation;
pub mod lab_evidence;
pub mod landmark;
pub mod meta_kb;
pub mod package_import;
pub mod planning;
pub mod project_context;
pub mod project_contract;
pub mod project_release;
pub mod research;
pub mod scope;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt::{Display, Formatter};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReplayError(pub String);

impl Display for ReplayError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for ReplayError {}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Statement {
    pub subject: String,
    pub predicate: String,
    pub object: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SpanKind {
    Byte,
    Character,
    Line,
    Page,
    Field,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Span {
    pub kind: SpanKind,
    pub start: u64,
    pub end: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceStance {
    Supports,
    Opposes,
    Context,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Evidence {
    pub snapshot_id: String,
    pub snapshot_hash: String,
    pub span: Span,
    pub stance: EvidenceStance,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ClaimKind {
    Fact,
    Decision,
    Assumption,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Claim {
    pub id: String,
    pub label: String,
    pub statement: Statement,
    pub scope: String,
    pub kind: ClaimKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub valid_from: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub valid_to: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conditions: Option<BTreeMap<String, Value>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provenance_root: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dependencies: Option<Vec<String>>,
    pub evidence: Vec<Evidence>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Availability {
    Available,
    Unreachable,
    Deleted,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Snapshot {
    pub id: String,
    pub url: String,
    pub content_hash: String,
    pub availability: Availability,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Event {
    SnapshotCreated {
        id: String,
        actor: String,
        transaction_time: String,
        generation: u64,
        #[serde(default)]
        base_generation: Option<u64>,
        payload: SnapshotPayload,
    },
    SourceAvailabilityChanged {
        id: String,
        actor: String,
        transaction_time: String,
        generation: u64,
        #[serde(default)]
        base_generation: Option<u64>,
        payload: AvailabilityPayload,
    },
    ClaimProposed {
        id: String,
        actor: String,
        transaction_time: String,
        generation: u64,
        #[serde(default)]
        base_generation: Option<u64>,
        payload: ProposalPayload,
    },
    ClaimAccepted {
        id: String,
        actor: String,
        transaction_time: String,
        generation: u64,
        #[serde(default)]
        base_generation: Option<u64>,
        payload: AcceptPayload,
    },
    DecisionAccepted {
        id: String,
        actor: String,
        transaction_time: String,
        generation: u64,
        #[serde(default)]
        base_generation: Option<u64>,
        payload: AcceptPayload,
    },
    ClaimDisputed {
        id: String,
        actor: String,
        transaction_time: String,
        generation: u64,
        #[serde(default)]
        base_generation: Option<u64>,
        payload: DisputePayload,
    },
    ClaimSuperseded {
        id: String,
        actor: String,
        transaction_time: String,
        generation: u64,
        #[serde(default)]
        base_generation: Option<u64>,
        payload: SupersedePayload,
    },
    ClaimRetracted {
        id: String,
        actor: String,
        transaction_time: String,
        generation: u64,
        #[serde(default)]
        base_generation: Option<u64>,
        payload: RetractPayload,
    },
    PatchRejected {
        id: String,
        actor: String,
        transaction_time: String,
        generation: u64,
        base_generation: u64,
        payload: RejectPayload,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SnapshotPayload {
    pub snapshot: Snapshot,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AvailabilityPayload {
    pub snapshot_id: String,
    pub availability: Availability,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProposalPayload {
    pub claim: Claim,
    #[serde(default)]
    pub quarantined: bool,
    #[serde(default)]
    pub quarantine_reason: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AcceptPayload {
    pub claim: Claim,
    #[serde(default)]
    pub supersedes: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DisputePayload {
    pub conflict_id: String,
    pub claims: Vec<Claim>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SupersedePayload {
    pub prior_claim_id: String,
    pub claim: Claim,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RetractPayload {
    pub claim_id: String,
    pub reason: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RejectPayload {
    pub proposal: Claim,
    pub reason: String,
}

impl Event {
    fn metadata(&self) -> (&str, u64, Option<u64>, bool) {
        match self {
            Self::SnapshotCreated {
                id,
                generation,
                base_generation,
                ..
            }
            | Self::SourceAvailabilityChanged {
                id,
                generation,
                base_generation,
                ..
            }
            | Self::ClaimProposed {
                id,
                generation,
                base_generation,
                ..
            }
            | Self::ClaimAccepted {
                id,
                generation,
                base_generation,
                ..
            }
            | Self::DecisionAccepted {
                id,
                generation,
                base_generation,
                ..
            }
            | Self::ClaimDisputed {
                id,
                generation,
                base_generation,
                ..
            }
            | Self::ClaimSuperseded {
                id,
                generation,
                base_generation,
                ..
            }
            | Self::ClaimRetracted {
                id,
                generation,
                base_generation,
                ..
            } => (id, *generation, *base_generation, false),
            Self::PatchRejected {
                id,
                generation,
                base_generation,
                ..
            } => (id, *generation, Some(*base_generation), true),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ClaimRecord {
    #[serde(flatten)]
    pub claim: Claim,
    pub state: ClaimState,
    pub last_generation: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ClaimState {
    Candidate,
    Accepted,
    Rejected,
    Disputed,
    Superseded,
    Retracted,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RejectedPatch {
    pub event_id: String,
    pub base_generation: u64,
    pub reason: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Projection {
    pub generation: u64,
    pub accepted: BTreeMap<String, ClaimRecord>,
    pub history: BTreeMap<String, ClaimRecord>,
    pub conflicts: BTreeMap<String, Vec<String>>,
    pub snapshots: BTreeMap<String, Snapshot>,
    pub quarantine: BTreeMap<String, String>,
    pub rejected_patches: Vec<RejectedPatch>,
}

fn record(claim: Claim, state: ClaimState, generation: u64) -> ClaimRecord {
    ClaimRecord {
        claim,
        state,
        last_generation: generation,
    }
}

/// Replays events in generation order into canonical accepted state.
///
/// # Errors
/// Returns an error when an event violates an invariant or references missing state.
#[allow(clippy::too_many_lines)]
pub fn replay(events: &[Event]) -> Result<Projection, ReplayError> {
    let mut p = Projection::default();
    let mut seen = BTreeSet::new();
    for event in events {
        let (id, generation, base, rejected) = event.metadata();
        if !seen.insert(id.to_owned()) {
            return Err(ReplayError(format!("duplicate event id: {id}")));
        }
        if generation <= p.generation {
            return Err(ReplayError(format!("non-increasing generation at {id}")));
        }
        if !rejected && base.is_some_and(|value| value != p.generation) {
            return Err(ReplayError(format!("stale event was not rejected: {id}")));
        }
        match event {
            Event::SnapshotCreated { payload, .. } => {
                if p.snapshots
                    .get(&payload.snapshot.id)
                    .is_some_and(|old| old != &payload.snapshot)
                {
                    return Err(ReplayError(format!(
                        "immutable snapshot changed: {}",
                        payload.snapshot.id
                    )));
                }
                p.snapshots
                    .insert(payload.snapshot.id.clone(), payload.snapshot.clone());
            }
            Event::SourceAvailabilityChanged { payload, .. } => {
                let snapshot = p.snapshots.get_mut(&payload.snapshot_id).ok_or_else(|| {
                    ReplayError(format!(
                        "availability references unknown snapshot: {}",
                        payload.snapshot_id
                    ))
                })?;
                snapshot.availability = payload.availability.clone();
            }
            Event::ClaimProposed { payload, .. } => {
                let claim_id = payload.claim.id.clone();
                p.history.insert(
                    claim_id.clone(),
                    record(payload.claim.clone(), ClaimState::Candidate, generation),
                );
                if payload.quarantined {
                    p.quarantine.insert(
                        claim_id,
                        payload.quarantine_reason.clone().ok_or_else(|| {
                            ReplayError("quarantined proposal lacks reason".into())
                        })?,
                    );
                }
            }
            Event::ClaimAccepted { payload, .. } | Event::DecisionAccepted { payload, .. } => {
                if let Some(prior_id) = &payload.supersedes {
                    let prior = p.history.get_mut(prior_id).ok_or_else(|| {
                        ReplayError(format!("supersedes unknown claim: {prior_id}"))
                    })?;
                    prior.state = ClaimState::Superseded;
                    prior.last_generation = generation;
                    p.accepted.remove(prior_id);
                }
                let claim_id = payload.claim.id.clone();
                let accepted = record(payload.claim.clone(), ClaimState::Accepted, generation);
                p.history.insert(claim_id.clone(), accepted.clone());
                p.accepted.insert(claim_id, accepted);
            }
            Event::ClaimDisputed { payload, .. } => {
                if payload.claims.len() < 2 {
                    return Err(ReplayError("dispute requires at least two claims".into()));
                }
                let mut ids = Vec::new();
                for claim in &payload.claims {
                    let claim_id = claim.id.clone();
                    ids.push(claim_id.clone());
                    p.history.insert(
                        claim_id.clone(),
                        record(claim.clone(), ClaimState::Disputed, generation),
                    );
                    p.accepted.remove(&claim_id);
                }
                ids.sort();
                p.conflicts.insert(payload.conflict_id.clone(), ids);
            }
            Event::ClaimSuperseded { payload, .. } => {
                let prior = p.history.get_mut(&payload.prior_claim_id).ok_or_else(|| {
                    ReplayError(format!(
                        "supersedes unknown claim: {}",
                        payload.prior_claim_id
                    ))
                })?;
                prior.state = ClaimState::Superseded;
                prior.last_generation = generation;
                p.accepted.remove(&payload.prior_claim_id);
                let claim_id = payload.claim.id.clone();
                let accepted = record(payload.claim.clone(), ClaimState::Accepted, generation);
                p.history.insert(claim_id.clone(), accepted.clone());
                p.accepted.insert(claim_id, accepted);
            }
            Event::ClaimRetracted { payload, .. } => {
                let prior = p.history.get_mut(&payload.claim_id).ok_or_else(|| {
                    ReplayError(format!("retracts unknown claim: {}", payload.claim_id))
                })?;
                prior.state = ClaimState::Retracted;
                prior.last_generation = generation;
                p.accepted.remove(&payload.claim_id);
            }
            Event::PatchRejected {
                id,
                base_generation,
                payload,
                ..
            } => {
                if *base_generation >= p.generation {
                    return Err(ReplayError(format!("patch is not stale: {id}")));
                }
                p.history.insert(
                    payload.proposal.id.clone(),
                    record(payload.proposal.clone(), ClaimState::Rejected, generation),
                );
                p.rejected_patches.push(RejectedPatch {
                    event_id: id.clone(),
                    base_generation: *base_generation,
                    reason: payload.reason.clone(),
                });
            }
        }
        p.generation = generation;
    }
    p.rejected_patches
        .sort_by(|a, b| a.event_id.cmp(&b.event_id));
    Ok(p)
}

/// Serializes a value as compact JSON with lexicographically sorted object keys.
///
/// # Errors
/// Returns an error when the value cannot be represented as JSON.
pub fn canonical_json<T: Serialize>(value: &T) -> Result<String, ReplayError> {
    let value = serde_json::to_value(value)
        .map_err(|error| ReplayError(format!("canonical conversion failed: {error}")))?;
    serde_json::to_string(&value)
        .map_err(|error| ReplayError(format!("canonical serialization failed: {error}")))
}

/// Computes the lowercase SHA-256 digest of a value's canonical JSON bytes.
///
/// # Errors
/// Returns an error when canonical serialization fails.
pub fn canonical_hash<T: Serialize>(value: &T) -> Result<String, ReplayError> {
    let digest = Sha256::digest(canonical_json(value)?.as_bytes());
    Ok(format!("{digest:x}"))
}

#[derive(Debug, Clone, Deserialize)]
pub struct Fixture {
    pub id: String,
    pub case: String,
    pub description: String,
    pub events: Vec<Event>,
    pub expected: Expected,
    pub forbidden_outcomes: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Expected {
    pub projection: Projection,
    pub canonical_hash: String,
    pub human_diff: String,
}

/// Deserializes the M0 fixture array into typed domain events and expected state.
///
/// # Errors
/// Returns an error for malformed JSON or values outside the typed event model.
pub fn parse_fixtures(input: &str) -> Result<Vec<Fixture>, ReplayError> {
    serde_json::from_str(input)
        .map_err(|error| ReplayError(format!("invalid fixture JSON: {error}")))
}

/// Replays one fixture and verifies both its projection and canonical hash.
///
/// # Errors
/// Returns an error for replay failures or expected-value mismatches.
pub fn validate_fixture(fixture: &Fixture) -> Result<(), ReplayError> {
    let projection = replay(&fixture.events)?;
    if projection != fixture.expected.projection {
        return Err(ReplayError(format!("{} projection mismatch", fixture.id)));
    }
    let hash = canonical_hash(&projection)?;
    if hash != fixture.expected.canonical_hash {
        return Err(ReplayError(format!(
            "{} hash mismatch: expected {}, got {hash}",
            fixture.id, fixture.expected.canonical_hash
        )));
    }
    Ok(())
}
