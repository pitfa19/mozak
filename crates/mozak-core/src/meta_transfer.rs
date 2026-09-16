//! Read-only cross-project Concept discovery and target Translation preparation.
//!
//! This module deliberately does not rank relevance, accept research, author a
//! Translation, or transfer authority. It projects only already registered
//! Concepts plus explicitly supplied, validated research runs.

use crate::{
    concept::{Assumption, Concept, ConceptEvidence, concept_hash, validate_concept_json},
    kb::ValidatedKb,
    research::{ClaimStatus, OverallClaim, validate_run_json},
    scope::ScopeKind,
};
use serde::Serialize;
use std::{collections::BTreeSet, fs, path::Path};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MetaTransferError(pub String);

impl std::fmt::Display for MetaTransferError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for MetaTransferError {}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct TargetScope {
    pub registration_id: String,
    pub scope_id: String,
    pub kind: ScopeKind,
    pub title: String,
    pub intent: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ConceptCandidate {
    pub registration_id: String,
    pub owner_scope_id: String,
    pub concept_id: String,
    pub concept_version: u64,
    pub concept_sha256: String,
    pub source_file_sha256: String,
    pub title: String,
    pub mechanism: String,
    pub invariant: String,
    pub applicability: String,
    pub evidence: Vec<ConceptEvidence>,
    pub assumptions: Vec<Assumption>,
    pub authority: &'static str,
    pub relationship: &'static str,
    pub shared_meta_goals: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ResearchClaimCandidate {
    pub id: String,
    pub text: String,
    pub evidence_ids: Vec<String>,
    pub status: ClaimStatus,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ResearchCandidate {
    pub path: String,
    pub run_id: String,
    pub artifact_sha256: String,
    pub question: String,
    pub summary: String,
    pub overall_claim: OverallClaim,
    pub claims: Vec<ResearchClaimCandidate>,
    pub gaps: Vec<String>,
    pub authority: &'static str,
    pub accepted: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct CandidateSet {
    pub schema_version: u64,
    pub command: &'static str,
    pub registry_sha256: String,
    pub target: TargetScope,
    pub concepts: Vec<ConceptCandidate>,
    pub research: Vec<ResearchCandidate>,
    pub ranking: &'static str,
    pub mutation: bool,
    pub authority: &'static str,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct AssumptionPrompt {
    pub assumption: Assumption,
    pub allowed_outcomes: Vec<&'static str>,
    pub target_evidence_required_for: Vec<&'static str>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct TranslationPacket {
    pub schema_version: u64,
    pub command: &'static str,
    pub registry_sha256: String,
    pub target: TargetScope,
    pub source_registration_id: String,
    pub source_scope_id: String,
    pub concept: Concept,
    pub concept_sha256: String,
    pub assumption_prompts: Vec<AssumptionPrompt>,
    pub next_command: String,
    pub mutation: bool,
    pub authority: &'static str,
}

/// Returns every registered external Concept in deterministic order, plus only
/// the explicitly supplied research runs after strict validation.
///
/// No relevance score is inferred. Shared Meta Goals are reported as context,
/// not as authority or proof of applicability.
///
/// # Errors
///
/// Returns an error when the target is unknown or ambiguous, a registered
/// Concept cannot be loaded or validated, or a supplied research run is
/// unreadable, invalid, or duplicated.
pub fn candidates(
    kb: &ValidatedKb,
    target_scope_id: &str,
    research_paths: &[impl AsRef<Path>],
) -> Result<CandidateSet, MetaTransferError> {
    let target = find_target(kb, target_scope_id)?;
    let concepts = collect_concepts(kb, target_scope_id)?;
    let research = collect_research(research_paths)?;

    Ok(CandidateSet {
        schema_version: 1,
        command: "kb concept candidates",
        registry_sha256: kb.registry_sha256.clone(),
        target,
        concepts,
        research,
        ranking: "none_deterministic_inventory_only",
        mutation: false,
        authority: "candidates transfer no truth and authorize no adoption, execution, or mutation",
    })
}

fn collect_concepts(
    kb: &ValidatedKb,
    target_scope_id: &str,
) -> Result<Vec<ConceptCandidate>, MetaTransferError> {
    let mut concepts = Vec::new();
    for entry in &kb.entries {
        for registered in &entry.scopes.manifest.concepts {
            if registered.scope_id == target_scope_id {
                continue;
            }
            let concept = load_registered_concept(entry, registered)?;
            let canonical_hash =
                concept_hash(&concept).map_err(|error| MetaTransferError(error.to_string()))?;
            let shared_meta_goals = shared_meta_goals(
                &entry.scopes.manifest.meta_goals,
                target_scope_id,
                &registered.scope_id,
            );
            concepts.push(ConceptCandidate {
                registration_id: entry.registration.id.clone(),
                owner_scope_id: registered.scope_id.clone(),
                concept_id: concept.id,
                concept_version: concept.version,
                concept_sha256: canonical_hash,
                source_file_sha256: registered.sha256.clone(),
                title: concept.title,
                mechanism: concept.mechanism,
                invariant: concept.invariant,
                applicability: concept.applicability,
                evidence: concept.evidence,
                assumptions: concept.assumptions,
                authority: "advisory_only",
                relationship: if shared_meta_goals.is_empty() {
                    "registered_external_concept"
                } else {
                    "shared_advisory_meta_goal"
                },
                shared_meta_goals,
            });
        }
    }
    concepts.sort_by(|left, right| {
        (
            &left.registration_id,
            &left.owner_scope_id,
            &left.concept_id,
            left.concept_version,
        )
            .cmp(&(
                &right.registration_id,
                &right.owner_scope_id,
                &right.concept_id,
                right.concept_version,
            ))
    });
    Ok(concepts)
}

fn collect_research(
    research_paths: &[impl AsRef<Path>],
) -> Result<Vec<ResearchCandidate>, MetaTransferError> {
    let mut research = Vec::new();
    let mut run_ids = BTreeSet::new();
    for path in research_paths {
        let path = path.as_ref();
        let bytes = fs::read(path).map_err(|error| {
            MetaTransferError(format!(
                "cannot read supplied research run {}: {error}",
                path.display()
            ))
        })?;
        let text = std::str::from_utf8(&bytes).map_err(|_| {
            MetaTransferError(format!(
                "supplied research run is not UTF-8: {}",
                path.display()
            ))
        })?;
        let run = validate_run_json(text).map_err(|error| {
            MetaTransferError(format!(
                "invalid supplied research run {}: {error}",
                path.display()
            ))
        })?;
        if !run_ids.insert(run.run_id.clone()) {
            return Err(MetaTransferError(format!(
                "duplicate supplied research run: {}",
                run.run_id
            )));
        }
        let canonical = path.canonicalize().map_err(|error| {
            MetaTransferError(format!(
                "cannot resolve supplied research run {}: {error}",
                path.display()
            ))
        })?;
        research.push(ResearchCandidate {
            path: canonical.to_string_lossy().into_owned(),
            run_id: run.run_id,
            artifact_sha256: run.receipt.artifact_hash,
            question: run.scope.question,
            summary: run.synthesis.summary,
            overall_claim: run.synthesis.overall_claim,
            claims: run
                .synthesis
                .claims
                .into_iter()
                .map(|claim| ResearchClaimCandidate {
                    id: claim.id,
                    text: claim.text,
                    evidence_ids: claim.evidence_ids,
                    status: claim.status,
                })
                .collect(),
            gaps: run.gaps.into_iter().map(|gap| gap.description).collect(),
            authority: "proposal_only",
            accepted: false,
        });
    }
    research.sort_by(|left, right| left.run_id.cmp(&right.run_id));
    Ok(research)
}

/// Builds a read-only packet for re-deriving one exact registered Concept in a
/// target scope. The packet is not a Translation and cannot be accepted as one.
///
/// # Errors
///
/// Returns an error when the target or Concept is unknown or ambiguous, the
/// requested hash does not identify an exact registered Concept, the Concept
/// cannot be validated, or the target owns the source Concept.
pub fn translation_packet(
    kb: &ValidatedKb,
    target_scope_id: &str,
    concept_id: &str,
    requested_concept_sha256: &str,
) -> Result<TranslationPacket, MetaTransferError> {
    let target = find_target(kb, target_scope_id)?;
    let mut matches = Vec::new();
    let mut id_match_count = 0_usize;
    for entry in &kb.entries {
        for registered in &entry.scopes.manifest.concepts {
            if registered.id == concept_id {
                id_match_count += 1;
                let concept = load_registered_concept(entry, registered)?;
                let canonical_hash =
                    concept_hash(&concept).map_err(|error| MetaTransferError(error.to_string()))?;
                if canonical_hash == requested_concept_sha256 {
                    matches.push((entry, registered, concept, canonical_hash));
                }
            }
        }
    }
    let (entry, registered, concept, hash) = match matches.as_slice() {
        [] if id_match_count == 0 => {
            return Err(MetaTransferError(format!(
                "unknown registered concept: {concept_id}"
            )));
        }
        [] => {
            return Err(MetaTransferError(format!(
                "requested Concept hash does not match any registered pin for {concept_id}"
            )));
        }
        [value] => value.clone(),
        _ => {
            return Err(MetaTransferError(format!(
                "ambiguous registered concept identity: {concept_id}@{requested_concept_sha256}"
            )));
        }
    };
    if registered.scope_id == target_scope_id {
        return Err(MetaTransferError(
            "a target cannot translate its own Concept".into(),
        ));
    }
    let prompts = concept
        .assumptions
        .iter()
        .cloned()
        .map(|assumption| AssumptionPrompt {
            assumption,
            allowed_outcomes: vec!["holds", "replaced", "rejected", "could_not_check"],
            target_evidence_required_for: vec!["holds", "replaced"],
        })
        .collect();
    Ok(TranslationPacket {
        schema_version: 1,
        command: "kb concept translation-packet",
        registry_sha256: kb.registry_sha256.clone(),
        target,
        source_registration_id: entry.registration.id.clone(),
        source_scope_id: registered.scope_id.clone(),
        concept,
        concept_sha256: hash,
        assumption_prompts: prompts,
        next_command:
            "mozak concept translation validate <concept.json> <target-owned-translation.json>"
                .to_owned(),
        mutation: false,
        authority: "packet is advisory preparation only; the target must author and validate its own Translation",
    })
}

fn find_target(kb: &ValidatedKb, target_scope_id: &str) -> Result<TargetScope, MetaTransferError> {
    let mut matches = Vec::new();
    for entry in &kb.entries {
        for scope in &entry.scopes.manifest.scopes {
            if scope.id == target_scope_id {
                matches.push((entry, scope));
            }
        }
    }
    match matches.as_slice() {
        [] => Err(MetaTransferError(format!(
            "unknown registered target scope: {target_scope_id}"
        ))),
        [(entry, scope)] => Ok(TargetScope {
            registration_id: entry.registration.id.clone(),
            scope_id: scope.id.clone(),
            kind: scope.kind.clone(),
            title: scope.title.clone(),
            intent: scope.intent.clone(),
        }),
        _ => Err(MetaTransferError(format!(
            "ambiguous registered target scope id: {target_scope_id}"
        ))),
    }
}

fn load_registered_concept(
    entry: &crate::kb::RegisteredScopes,
    registered: &crate::scope::ScopeConcept,
) -> Result<Concept, MetaTransferError> {
    let path = entry.root.join(&registered.path);
    let bytes = fs::read(&path).map_err(|error| {
        MetaTransferError(format!(
            "cannot read registered Concept {}: {error}",
            registered.id
        ))
    })?;
    let text = std::str::from_utf8(&bytes)
        .map_err(|_| MetaTransferError(format!("non-UTF8 Concept: {}", registered.id)))?;
    let concept = validate_concept_json(text).map_err(|error| {
        MetaTransferError(format!(
            "invalid registered Concept {}: {error}",
            registered.id
        ))
    })?;
    if concept.id != registered.id {
        return Err(MetaTransferError(format!(
            "registered Concept id does not match bytes: {}",
            registered.id
        )));
    }
    Ok(concept)
}

fn shared_meta_goals(
    goals: &[crate::scope::MetaGoal],
    target_scope_id: &str,
    source_scope_id: &str,
) -> Vec<String> {
    let mut matches = goals
        .iter()
        .filter(|goal| {
            goal.scope_ids.iter().any(|id| id == target_scope_id)
                && goal.scope_ids.iter().any(|id| id == source_scope_id)
        })
        .map(|goal| goal.id.clone())
        .collect::<Vec<_>>();
    matches.sort();
    matches
}
