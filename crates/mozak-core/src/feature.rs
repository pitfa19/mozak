//! Feature records: one finished piece of user-visible work.
//!
//! A feature record is the thin MOZAK index over a Pocock-style flow
//! (`/grill-me`, `/to-spec`, `/to-tickets`, `/implement`, `/code-review`).
//! The spec and tickets live in the issue tracker. MOZAK does not fetch them.
//! The agent host saves the exact issue text it saw under
//! `.mozak/evidence/<feature-id>/`, and the record pins those bytes by SHA-256,
//! so the record can later prove what a ticket said when the work finished.
//!
//! A feature record replaces the goal DAG for new work. Goal-DAG plans stay
//! readable as history and are not migrated.

use crate::planning::{GOAL_EVIDENCE_ROOT, GoalEvidence, validate_goal_evidence};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::fmt::{Display, Formatter};

/// Project-relative directory holding feature records.
pub const FEATURE_ROOT: &str = ".mozak/features/";
pub const FEATURE_CONTRACT_VERSION: u64 = 1;
pub const MAX_TICKETS: usize = 64;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FeatureError(pub String);

impl Display for FeatureError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for FeatureError {}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum FeatureStatus {
    Open,
    Done,
    Dropped,
}

/// A link to one issue plus the pinned snapshot of its text, if recorded.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct IssueLink {
    pub url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub snapshot: Option<GoalEvidence>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Feature {
    pub contract_version: u64,
    pub id: String,
    pub title: String,
    pub status: FeatureStatus,
    /// Monotonic version. A new version is written only when the owner changes
    /// scope or the record gains a pin; marking done does not need a new id.
    pub version: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spec: Option<IssueLink>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tickets: Vec<IssueLink>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub evidence: Vec<GoalEvidence>,
    /// SHA-256 of the exact bytes of version N-1. Absent only for version 1.
    /// This chains every version, so an earlier file cannot be edited by hand
    /// without breaking the successor that pinned it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub previous_sha256: Option<String>,
}

/// Validates a feature record's shape. File digests are checked separately,
/// because this module performs no filesystem access.
///
/// # Errors
/// Returns an error for a malformed id, title, URL, status rule, or pin.
pub fn validate_feature(feature: &Feature) -> Result<(), FeatureError> {
    require(
        feature.contract_version == FEATURE_CONTRACT_VERSION,
        "unsupported feature contract_version",
    )?;
    require(
        valid_id(&feature.id),
        "feature id must use lowercase letters, digits and single hyphens",
    )?;
    require(
        !feature.title.trim().is_empty() && !feature.title.chars().any(char::is_control),
        "feature title must be non-empty without control characters",
    )?;
    require(feature.version >= 1, "feature version starts at 1")?;
    match (&feature.previous_sha256, feature.version) {
        (None, 1) => {}
        (Some(hash), version) if version > 1 => require(
            hash.len() == 64
                && hash
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
            "previous_sha256 must be 64 lowercase hex characters",
        )?,
        _ => {
            return Err(FeatureError(
                "version 1 has no previous_sha256; every later version must pin one".into(),
            ));
        }
    }
    require(feature.tickets.len() <= MAX_TICKETS, "too many tickets")?;
    let own_root = format!("{GOAL_EVIDENCE_ROOT}{}/", feature.id);
    let mut urls = BTreeSet::new();
    let mut pins: Vec<GoalEvidence> = Vec::new();
    for (label, link) in feature
        .spec
        .iter()
        .map(|link| ("spec", link))
        .chain(feature.tickets.iter().map(|link| ("ticket", link)))
    {
        validate_url(&link.url).map_err(|e| FeatureError(format!("{label}: {e}")))?;
        require(urls.insert(link.url.as_str()), "duplicate issue URL")?;
        if let Some(snapshot) = &link.snapshot {
            require(
                snapshot.path.starts_with(&own_root),
                &format!("{label} snapshot must live under {own_root}"),
            )?;
            pins.push(snapshot.clone());
        }
    }
    for record in &feature.evidence {
        require(
            record.path.starts_with(&own_root),
            &format!("feature evidence must live under {own_root}"),
        )?;
    }
    pins.extend(feature.evidence.iter().cloned());
    validate_goal_evidence(&pins).map_err(|e| FeatureError(e.0.replace("goal", "feature")))?;
    if feature.status == FeatureStatus::Done {
        require(
            !feature.evidence.is_empty(),
            "a done feature must pin at least one evidence record",
        )?;
        require(
            feature
                .tickets
                .iter()
                .all(|ticket| ticket.snapshot.is_some()),
            "a done feature must pin a snapshot for every ticket",
        )?;
    }
    Ok(())
}

/// Parses and validates one feature record.
///
/// # Errors
/// Returns an error for invalid JSON, unknown fields, or a rule violation.
pub fn validate_feature_json(input: &str) -> Result<Feature, FeatureError> {
    let feature: Feature = serde_json::from_str(input)
        .map_err(|e| FeatureError(format!("invalid feature JSON: {e}")))?;
    validate_feature(&feature)?;
    Ok(feature)
}

/// Every pinned file of a record, in a stable order.
#[must_use]
pub fn pinned_files(feature: &Feature) -> Vec<&GoalEvidence> {
    feature
        .spec
        .iter()
        .chain(feature.tickets.iter())
        .filter_map(|link| link.snapshot.as_ref())
        .chain(feature.evidence.iter())
        .collect()
}

/// Validates that `next` is an allowed successor of `previous`.
///
/// # Errors
/// Returns an error when id, version, or pins would be rewritten.
pub fn validate_successor(previous: &Feature, next: &Feature) -> Result<(), FeatureError> {
    require(previous.id == next.id, "successor must keep the feature id")?;
    require(
        next.version == previous.version + 1,
        "successor version must be previous + 1",
    )?;
    require(
        previous.status == FeatureStatus::Open,
        "only an open feature can change; a done or dropped feature is final",
    )?;
    for old in pinned_files(previous) {
        require(
            pinned_files(next)
                .iter()
                .any(|new| new.path == old.path && new.sha256 == old.sha256),
            &format!("successor must keep pin {} unchanged", old.path),
        )?;
    }
    for old in previous.tickets.iter().chain(previous.spec.iter()) {
        require(
            next.tickets
                .iter()
                .chain(next.spec.iter())
                .any(|new| new.url == old.url),
            &format!("successor must keep issue {}", old.url),
        )?;
    }
    Ok(())
}

fn validate_url(url: &str) -> Result<(), String> {
    let ok = url.len() <= 300
        && (url.starts_with("https://") || url.starts_with("file:local/"))
        && !url.chars().any(|c| c.is_control() || c.is_whitespace())
        && !url.contains('@');
    if ok {
        Ok(())
    } else {
        Err(format!(
            "issue URL must be https:// without credentials, or file:local/<path> for local tickets: {url}"
        ))
    }
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 80
        && !id.starts_with('-')
        && !id.ends_with('-')
        && !id.contains("--")
        && id
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

fn require(condition: bool, message: &str) -> Result<(), FeatureError> {
    if condition {
        Ok(())
    } else {
        Err(FeatureError(message.to_owned()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pin(path: &str) -> GoalEvidence {
        GoalEvidence {
            path: path.into(),
            sha256: "a".repeat(64),
        }
    }

    fn open() -> Feature {
        Feature {
            contract_version: 1,
            id: "voice-onboarding".into(),
            title: "Voice onboarding".into(),
            status: FeatureStatus::Open,
            version: 1,
            spec: Some(IssueLink {
                url: "https://github.com/o/r/issues/1".into(),
                snapshot: Some(pin(".mozak/evidence/voice-onboarding/issues/1.md")),
            }),
            tickets: vec![IssueLink {
                url: "https://github.com/o/r/issues/2".into(),
                snapshot: None,
            }],
            evidence: vec![],
            previous_sha256: None,
        }
    }

    #[test]
    fn versions_after_one_must_chain_to_their_predecessor() {
        let mut feature = open();
        feature.version = 2;
        assert!(
            validate_feature(&feature).is_err(),
            "v2 without previous_sha256"
        );
        feature.previous_sha256 = Some("b".repeat(64));
        validate_feature(&feature).unwrap();
        let mut first = open();
        first.previous_sha256 = Some("b".repeat(64));
        assert!(
            validate_feature(&first).is_err(),
            "v1 cannot have a predecessor"
        );
    }

    #[test]
    fn open_feature_without_ticket_snapshots_is_valid() {
        validate_feature(&open()).unwrap();
    }

    #[test]
    fn done_requires_evidence_and_every_ticket_snapshot() {
        let mut feature = open();
        feature.status = FeatureStatus::Done;
        assert!(validate_feature(&feature).is_err());
        feature.evidence = vec![pin(".mozak/evidence/voice-onboarding/acceptance.md")];
        assert!(
            validate_feature(&feature).is_err(),
            "ticket 2 has no snapshot"
        );
        feature.tickets[0].snapshot = Some(pin(".mozak/evidence/voice-onboarding/issues/2.md"));
        validate_feature(&feature).unwrap();
    }

    #[test]
    fn pins_must_stay_inside_the_features_own_evidence_folder() {
        let mut feature = open();
        feature.evidence = vec![pin(".mozak/evidence/other-feature/x.md")];
        assert!(validate_feature(&feature).is_err());
        let mut feature = open();
        feature.evidence = vec![pin(".mozak/evidence/voice-onboarding/../x.md")];
        assert!(validate_feature(&feature).is_err());
    }

    #[test]
    fn urls_are_https_or_local_and_unique() {
        for bad in [
            "http://x/1",
            "https://u:p@github.com/o/r/issues/1",
            "file:///etc/passwd",
            "https://a b",
        ] {
            let mut feature = open();
            feature.tickets[0].url = bad.into();
            assert!(validate_feature(&feature).is_err(), "{bad}");
        }
        let mut feature = open();
        feature.tickets[0].url = feature.spec.as_ref().unwrap().url.clone();
        assert!(validate_feature(&feature).is_err(), "duplicate");
        let mut feature = open();
        feature.tickets[0].url = "file:local/.scratch/voice/issues/01-a.md".into();
        validate_feature(&feature).unwrap();
    }

    #[test]
    fn bad_ids_and_unknown_fields_are_refused() {
        for bad in ["", "Voice", "a--b", "-a", "a_b"] {
            let mut feature = open();
            feature.id = bad.into();
            assert!(validate_feature(&feature).is_err(), "{bad}");
        }
        let json = serde_json::to_value(open()).unwrap();
        let mut extra = json.clone();
        extra["goals"] = serde_json::json!([]);
        assert!(validate_feature_json(&extra.to_string()).is_err());
        validate_feature_json(&json.to_string()).unwrap();
    }

    #[test]
    fn successor_keeps_id_pins_and_issues_and_increments_version() {
        let previous = open();
        let mut next = previous.clone();
        next.version = 2;
        next.tickets[0].snapshot = Some(pin(".mozak/evidence/voice-onboarding/issues/2.md"));
        validate_successor(&previous, &next).unwrap();
        let mut skipped = next.clone();
        skipped.version = 3;
        assert!(validate_successor(&previous, &skipped).is_err());
        let mut dropped_pin = next.clone();
        dropped_pin.spec.as_mut().unwrap().snapshot = None;
        assert!(validate_successor(&previous, &dropped_pin).is_err());
        let mut dropped_issue = next.clone();
        dropped_issue.tickets.clear();
        assert!(validate_successor(&previous, &dropped_issue).is_err());
        let mut done = previous.clone();
        done.status = FeatureStatus::Dropped;
        let mut after = done.clone();
        after.version = 2;
        assert!(
            validate_successor(&done, &after).is_err(),
            "final features cannot change"
        );
    }
}
