//! Projects a sealed knowledge package as an in-toto v1 Statement.
//!
//! A MOZAK package is already the shape in-toto standardized: it pins
//! immutable artifacts by SHA-256 and asserts typed claims about them. What it
//! never declared was in-toto's identifiers, so a package that is fully
//! verifiable inside MOZAK cannot be interpreted by anything outside it. The
//! gap was naming, not architecture.
//!
//! Three properties keep this projection honest:
//!
//! - It is **derived, never stored**. The package remains the single source of
//!   truth, so there is no second copy to drift from the first.
//! - It attests to **identity and derivation only**. A statement says which
//!   immutable bytes this release was sealed from; it makes no claim that the
//!   knowledge inside is correct, useful, or endorsed.
//! - It is **computed from a validated package**. A tampered package produces
//!   no statement rather than a confident wrong one.

use crate::knowledge_package::{ValidatedKnowledgePackage, package_identity};
use serde::Serialize;
use std::collections::BTreeMap;

/// The in-toto Statement type URI this projection emits.
pub const STATEMENT_TYPE: &str = "https://in-toto.io/Statement/v1";

/// The MOZAK-owned predicate type describing a sealed knowledge release.
///
/// The major version is carried in the URI, as in-toto's versioning rules
/// require, so a later incompatible predicate gets a different URI rather than
/// silently changing meaning under this one.
pub const PREDICATE_TYPE: &str = "https://mozak.dev/KnowledgeRelease/v1";

/// Error raised when a package cannot be projected.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AttestationError(pub String);

impl std::fmt::Display for AttestationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for AttestationError {}

/// One artifact this statement is about, identified by digest.
///
/// in-toto requires every subject element to carry a digest and assumes
/// subjects are immutable. Both already hold for a sealed package artifact.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Subject {
    /// Distinguishes this artifact from others in the subject array.
    pub name: String,
    /// Cryptographic digests, keyed by algorithm as the spec requires.
    pub digest: BTreeMap<String, String>,
}

/// What MOZAK asserts about those subjects.
///
/// Deliberately narrow. It records what was sealed and where it came from,
/// which is verifiable, and says nothing about quality, which is not.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct KnowledgeReleasePredicate {
    /// The package's content-derived identity.
    pub package_identity: String,
    /// The package identifier recorded in its manifest.
    pub package_id: String,
    /// The project this release belongs to.
    pub project_id: String,
    /// The release this package sealed.
    pub release_id: String,
    /// The prior package in this history, when one exists.
    pub predecessor: Option<String>,
    /// What this attestation does and does not claim.
    pub claim_boundary: String,
    /// How a recipient can check the statement without trusting it.
    pub verification: String,
}

/// An in-toto v1 Statement projecting one sealed package.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Statement {
    /// Always the in-toto v1 Statement type URI.
    #[serde(rename = "_type")]
    pub statement_type: String,
    /// The artifacts this statement is about.
    pub subject: Vec<Subject>,
    /// The predicate type URI.
    #[serde(rename = "predicateType")]
    pub predicate_type: String,
    /// The MOZAK release predicate.
    pub predicate: KnowledgeReleasePredicate,
}

/// Projects a validated package as an in-toto Statement.
///
/// The package is not modified and nothing is written. Callers that want a file
/// should serialize the returned statement themselves, deliberately, rather
/// than having this route leave one beside the package it describes.
///
/// # Errors
///
/// Returns an error when the package declares no artifacts, when an artifact
/// digest is not a valid SHA-256 hex string, or when the package identity
/// cannot be computed.
pub fn project_statement(
    package: &ValidatedKnowledgePackage,
) -> Result<Statement, AttestationError> {
    let manifest = &package.manifest;
    if manifest.artifacts.is_empty() {
        return Err(AttestationError(
            "a package with no artifacts has no subject to attest".into(),
        ));
    }

    let mut subject = Vec::with_capacity(manifest.artifacts.len());
    for artifact in &manifest.artifacts {
        // A subject whose digest is malformed would be worse than no
        // statement: it would look verifiable and match nothing.
        if artifact.sha256.len() != 64
            || !artifact
                .sha256
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
        {
            return Err(AttestationError(format!(
                "artifact {} does not carry a lowercase hexadecimal SHA-256 digest",
                artifact.path
            )));
        }
        let mut digest = BTreeMap::new();
        digest.insert("sha256".to_owned(), artifact.sha256.clone());
        subject.push(Subject {
            name: artifact.path.clone(),
            digest,
        });
    }
    // Deterministic ordering, so the same package always projects identically.
    subject.sort_by(|left, right| left.name.cmp(&right.name));

    let identity = package_identity(manifest).map_err(|error| AttestationError(error.0))?;

    Ok(Statement {
        statement_type: STATEMENT_TYPE.to_owned(),
        subject,
        predicate_type: PREDICATE_TYPE.to_owned(),
        predicate: KnowledgeReleasePredicate {
            package_identity: identity,
            package_id: manifest.package_id.clone(),
            project_id: manifest.project_id.clone(),
            release_id: manifest.release_id.clone(),
            predecessor: manifest
                .predecessor
                .as_ref()
                .map(|reference| reference.package_id.clone()),
            claim_boundary: "attests to the identity and derivation of sealed bytes only; asserts nothing about the correctness, quality or fitness of the knowledge they contain".to_owned(),
            verification: "recompute each subject digest from the package artifact at the named path and compare; the package remains authoritative and this statement is derived from it".to_owned(),
        },
    })
}

/// Serializes a statement as canonical JSON with a trailing newline.
///
/// # Errors
///
/// Returns an error when the statement cannot be serialized.
pub fn statement_json(statement: &Statement) -> Result<String, AttestationError> {
    let mut text = serde_json::to_string_pretty(statement)
        .map_err(|error| AttestationError(format!("cannot serialize statement: {error}")))?;
    text.push('\n');
    Ok(text)
}
