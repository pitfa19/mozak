//! Landmarks that keep a condensed statement addressable back to exact evidence.
//!
//! A digest, shortlist, or Scope input derived from a research run is a
//! condensation: it is shorter than the evidence it came from, and once it
//! exists people read it instead of the run. The risk is not that the summary
//! is wrong, it is that the path back to the exact recorded bytes is lost, so
//! a later reader cannot tell what the statement rests on.
//!
//! A landmark records that path. Each condensed statement names the evidence id
//! it came from and pins that evidence's content hash, so the mapping fails
//! closed when the recorded bytes change rather than silently pointing at
//! different content. Landmarks add addressing only; they accept nothing,
//! promote nothing, and grant no authority.

use crate::research::ResearchRun;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

/// The landmark contract version.
pub const CONTRACT_VERSION: u32 = 1;

/// Error raised when a landmark index does not hold.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LandmarkError(pub String);

impl std::fmt::Display for LandmarkError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for LandmarkError {}

/// One condensed statement and the exact evidence it was derived from.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Landmark {
    /// Identifier for the condensed statement.
    pub id: String,
    /// The condensed text as it appears in the derived artifact.
    pub statement: String,
    /// The evidence record this statement was derived from.
    pub evidence_id: String,
    /// The raw record that evidence was quoted from.
    pub raw_record_id: String,
    /// SHA-256 of the raw record content observed when the landmark was written.
    pub content_sha256: String,
}

/// Landmarks for one condensation of one research run.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct LandmarkIndex {
    /// Contract version.
    pub contract_version: u32,
    /// The research run these landmarks address.
    pub run_id: String,
    /// The derived artifact this index belongs to.
    pub derived_artifact: String,
    /// Every condensed statement in that artifact.
    pub landmarks: Vec<Landmark>,
}

fn require(condition: bool, message: &str) -> Result<(), LandmarkError> {
    if condition {
        Ok(())
    } else {
        Err(LandmarkError(message.to_owned()))
    }
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

/// Validates a landmark index against the run it claims to address.
///
/// Every landmark must name evidence that exists in the run, name the raw
/// record that evidence actually quotes, and pin that record's current content
/// hash. A run that was never condensed needs no index, so an empty landmark
/// list is rejected only when it claims to describe an artifact.
///
/// # Errors
///
/// Returns an error naming the first landmark whose evidence is missing, whose
/// raw record disagrees with the evidence, or whose pinned hash no longer
/// matches the recorded bytes.
pub fn validate_landmarks(index: &LandmarkIndex, run: &ResearchRun) -> Result<(), LandmarkError> {
    require(
        index.contract_version == CONTRACT_VERSION,
        "unsupported landmark contract_version",
    )?;
    require(!index.run_id.is_empty(), "landmark index must name a run")?;
    require(
        index.run_id == run.run_id,
        "landmark index addresses a different research run",
    )?;
    require(
        !index.derived_artifact.is_empty(),
        "landmark index must name the derived artifact",
    )?;
    require(
        !index.landmarks.is_empty(),
        "landmark index must record at least one condensed statement",
    )?;

    let mut ids = BTreeSet::new();
    for landmark in &index.landmarks {
        require(!landmark.id.is_empty(), "landmark must have an identifier")?;
        require(
            ids.insert(landmark.id.as_str()),
            &format!("duplicate landmark id: {}", landmark.id),
        )?;
        require(
            !landmark.statement.trim().is_empty(),
            &format!("landmark {} has no statement", landmark.id),
        )?;

        let evidence = run
            .evidence
            .iter()
            .find(|record| record.id == landmark.evidence_id)
            .ok_or_else(|| {
                LandmarkError(format!(
                    "landmark {} cites evidence {} which is absent from run {}",
                    landmark.id, landmark.evidence_id, run.run_id
                ))
            })?;
        require(
            evidence.raw_record_id == landmark.raw_record_id,
            &format!(
                "landmark {} names raw record {} but evidence {} quotes {}",
                landmark.id, landmark.raw_record_id, evidence.id, evidence.raw_record_id
            ),
        )?;

        let raw = run
            .raw_records
            .iter()
            .find(|record| record.id == landmark.raw_record_id)
            .ok_or_else(|| {
                LandmarkError(format!(
                    "landmark {} cites raw record {} which is absent from run {}",
                    landmark.id, landmark.raw_record_id, run.run_id
                ))
            })?;
        // Pinning the observed hash is what makes altered evidence fail closed
        // instead of silently repointing the statement at different bytes.
        require(
            raw.content_sha256 == landmark.content_sha256,
            &format!(
                "landmark {} pinned content {} but raw record {} now hashes {}",
                landmark.id, landmark.content_sha256, raw.id, raw.content_sha256
            ),
        )?;
        require(
            sha256(raw.content.as_bytes()) == raw.content_sha256,
            &format!(
                "raw record {} content does not match its recorded hash",
                raw.id
            ),
        )?;
    }
    Ok(())
}

/// Parses and validates a landmark index from JSON.
///
/// # Errors
///
/// Returns an error when the JSON is malformed or the index does not hold.
pub fn validate_landmarks_json(
    input: &str,
    run: &ResearchRun,
) -> Result<LandmarkIndex, LandmarkError> {
    let index: LandmarkIndex = serde_json::from_str(input)
        .map_err(|error| LandmarkError(format!("invalid landmark index JSON: {error}")))?;
    validate_landmarks(&index, run)?;
    Ok(index)
}
