//! Provider-neutral, deterministic contracts for reproducible research runs.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt::{Display, Formatter};

pub const CONTRACT_VERSION: u64 = 1;
pub const MAX_PLANNING_INPUTS: usize = 64;
pub const MAX_PLANNING_INPUT_BYTES: usize = 65_536;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResearchError(pub String);

impl Display for ResearchError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for ResearchError {}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct SourceProfile {
    pub version: u64,
    pub id: String,
    pub allowed_schemes: Vec<String>,
    pub max_records: u32,
    pub max_bytes_per_record: u64,
    pub content_is_untrusted: bool,
    pub may_authorize_actions: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PipelineManifest {
    pub version: u64,
    pub id: String,
    pub revision: String,
    pub source_profile_id: String,
    pub stages: Vec<PipelineStage>,
    pub budgets: PipelineBudgets,
    pub required_artifacts: Vec<ArtifactKind>,
    pub output_authority: OutputAuthority,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PipelineStage {
    pub id: String,
    pub operation: StageOperation,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum StageOperation {
    Acquire,
    ExtractEvidence,
    IdentifyGaps,
    Synthesize,
    Audit,
    ExportPlanningInputs,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PipelineBudgets {
    pub max_sources: u32,
    pub max_raw_bytes: u64,
    pub max_claims: u32,
    pub max_planning_inputs: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum ArtifactKind {
    Scope,
    Plan,
    RawRecords,
    Evidence,
    Gaps,
    Synthesis,
    Audit,
    Receipt,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct OutputAuthority {
    pub planning_inputs_are_proposals: bool,
    pub may_mutate_accepted_plans: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ResearchRun {
    pub contract_version: u64,
    pub run_id: String,
    pub created_at: String,
    pub source_profile: SourceProfile,
    pub pipeline: PipelineManifest,
    pub scope: ScopeArtifact,
    pub plan: PlanArtifact,
    pub raw_records: Vec<RawRecord>,
    pub evidence: Vec<EvidenceRecord>,
    pub gaps: Vec<GapRecord>,
    pub synthesis: SynthesisArtifact,
    pub audit: AuditArtifact,
    pub receipt: RunReceipt,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ScopeArtifact {
    pub question: String,
    pub included: Vec<String>,
    pub excluded: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PlanArtifact {
    pub steps: Vec<String>,
    pub source_profile_id: String,
    pub pipeline_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RawRecord {
    pub id: String,
    pub source_uri: String,
    pub media_type: String,
    pub acquired_at: String,
    pub content: String,
    pub content_sha256: String,
    pub immutable: bool,
    pub trust: RawTrust,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RawTrust {
    UntrustedData,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct EvidenceRecord {
    pub id: String,
    pub raw_record_id: String,
    pub byte_start: u64,
    pub byte_end: u64,
    pub quote: String,
    pub stance: EvidenceStance,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceStance {
    Supports,
    Opposes,
    Context,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct GapRecord {
    pub id: String,
    pub description: String,
    pub impact: GapImpact,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GapImpact {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct SynthesisArtifact {
    pub summary: String,
    pub claims: Vec<ResearchClaim>,
    pub overall_claim: OverallClaim,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ResearchClaim {
    pub id: String,
    pub text: String,
    pub evidence_ids: Vec<String>,
    pub status: ClaimStatus,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum ClaimStatus {
    Failed,
    Qualified,
    Supported,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum OverallClaim {
    Failed,
    Qualified,
    Supported,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct AuditArtifact {
    pub failures: Vec<AuditFailure>,
    pub audited_claim_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct AuditFailure {
    pub claim_id: String,
    pub kind: AuditFailureKind,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AuditFailureKind {
    UnsupportedClaim,
    BrokenCitation,
    QuoteMismatch,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RunReceipt {
    pub run_id: String,
    pub pipeline_id: String,
    pub pipeline_revision: String,
    pub adapter_id: String,
    pub started_at: String,
    pub finished_at: String,
    pub input_hash: String,
    pub artifact_hash: String,
    pub capabilities: Vec<String>,
    pub status: RunStatus,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RunStatus {
    Passed,
    Qualified,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PlanningInputExport {
    pub contract_version: u64,
    pub run_id: String,
    pub run_artifact_hash: String,
    pub authority: PlanningAuthority,
    pub inputs: Vec<PlanningInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PlanningAuthority {
    ProposalOnly,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PlanningInput {
    pub id: String,
    pub claim_id: String,
    pub text: String,
    pub evidence_ids: Vec<String>,
    pub confidence: ClaimStatus,
    pub accepted: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProviderAlphaFixture {
    pub adapter_id: String,
    pub run: ResearchRun,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProviderBetaFixture {
    pub adapter: String,
    pub payload: ProviderBetaPayload,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProviderBetaPayload {
    pub contract: u64,
    pub id: String,
    pub timestamp: String,
    pub profile: SourceProfile,
    pub procedure: PipelineManifest,
    pub artifacts: ProviderBetaArtifacts,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProviderBetaArtifacts {
    pub scope: ScopeArtifact,
    pub plan: PlanArtifact,
    pub records: Vec<RawRecord>,
    pub citations: Vec<EvidenceRecord>,
    pub gaps: Vec<GapRecord>,
    pub synthesis: SynthesisArtifact,
    pub audit: AuditArtifact,
    pub receipt: RunReceipt,
}

/// Parses a closed-shape JSON run and performs strict semantic validation.
///
/// # Errors
/// Returns an error for malformed JSON or any contract violation.
pub fn validate_run_json(input: &str) -> Result<ResearchRun, ResearchError> {
    let run: ResearchRun = serde_json::from_str(input)
        .map_err(|error| ResearchError(format!("invalid research run JSON: {error}")))?;
    validate_run(&run)?;
    Ok(run)
}

/// Validates all cross-artifact and trust-boundary semantics of a run.
///
/// # Errors
/// Returns the first deterministic semantic failure.
#[allow(clippy::too_many_lines)]
pub fn validate_run(run: &ResearchRun) -> Result<(), ResearchError> {
    require(
        run.contract_version == CONTRACT_VERSION,
        "unsupported contract_version",
    )?;
    validate_identifier(&run.run_id, "run_id", "run-")?;
    validate_timestamp(&run.created_at, "created_at")?;
    validate_source_profile(&run.source_profile)?;
    validate_pipeline(&run.pipeline, &run.source_profile)?;
    require(
        !run.scope.question.trim().is_empty(),
        "scope.question must not be empty",
    )?;
    require(!run.plan.steps.is_empty(), "plan.steps must not be empty")?;
    require(
        run.plan.source_profile_id == run.source_profile.id,
        "plan source profile mismatch",
    )?;
    require(
        run.plan.pipeline_id == run.pipeline.id,
        "plan pipeline mismatch",
    )?;
    require(
        run.raw_records.len() <= run.pipeline.budgets.max_sources as usize,
        "raw record budget exceeded",
    )?;

    let mut record_ids = BTreeSet::new();
    let mut total_bytes = 0_u64;
    for record in &run.raw_records {
        validate_identifier(&record.id, "raw record id", "raw-")?;
        require(
            record_ids.insert(record.id.as_str()),
            "duplicate raw record id",
        )?;
        require(record.immutable, "raw records must be immutable")?;
        require(
            record.trust == RawTrust::UntrustedData,
            "raw records must remain untrusted data",
        )?;
        validate_timestamp(&record.acquired_at, "raw record acquired_at")?;
        let bytes = u64::try_from(record.content.len())
            .map_err(|_| ResearchError("raw record is too large".into()))?;
        require(
            bytes <= run.source_profile.max_bytes_per_record,
            "raw record byte budget exceeded",
        )?;
        total_bytes = total_bytes
            .checked_add(bytes)
            .ok_or_else(|| ResearchError("raw byte total overflow".into()))?;
        require(
            sha256_hex(record.content.as_bytes()) == record.content_sha256,
            "raw record content hash mismatch",
        )?;
        let scheme = record
            .source_uri
            .split_once(':')
            .map_or("", |(value, _)| value);
        require(
            run.source_profile
                .allowed_schemes
                .iter()
                .any(|allowed| allowed == scheme),
            "source URI scheme is not allowed",
        )?;
    }
    require(
        total_bytes <= run.pipeline.budgets.max_raw_bytes,
        "pipeline raw byte budget exceeded",
    )?;

    let mut evidence_ids = BTreeSet::new();
    let records = run
        .raw_records
        .iter()
        .map(|record| (record.id.as_str(), record))
        .collect::<BTreeMap<_, _>>();
    for evidence in &run.evidence {
        validate_identifier(&evidence.id, "evidence id", "ev-")?;
        require(
            evidence_ids.insert(evidence.id.as_str()),
            "duplicate evidence id",
        )?;
        let record = records
            .get(evidence.raw_record_id.as_str())
            .ok_or_else(|| {
                ResearchError(format!(
                    "broken citation {}: missing raw record",
                    evidence.id
                ))
            })?;
        let start = usize::try_from(evidence.byte_start).map_err(|_| {
            ResearchError(format!(
                "broken citation {}: invalid byte range",
                evidence.id
            ))
        })?;
        let end = usize::try_from(evidence.byte_end).map_err(|_| {
            ResearchError(format!(
                "broken citation {}: invalid byte range",
                evidence.id
            ))
        })?;
        require(
            start < end && end <= record.content.len(),
            &format!("broken citation {}: invalid byte range", evidence.id),
        )?;
        require(
            record.content.is_char_boundary(start) && record.content.is_char_boundary(end),
            &format!(
                "broken citation {}: byte range is not UTF-8 aligned",
                evidence.id
            ),
        )?;
        require(
            record.content[start..end] == evidence.quote,
            &format!("quote mismatch for citation {}", evidence.id),
        )?;
    }

    require(
        run.synthesis.claims.len() <= run.pipeline.budgets.max_claims as usize,
        "claim budget exceeded",
    )?;
    let mut claim_ids = BTreeSet::new();
    for claim in &run.synthesis.claims {
        validate_identifier(&claim.id, "claim id", "claim-")?;
        require(claim_ids.insert(claim.id.as_str()), "duplicate claim id")?;
        require(
            !claim.text.trim().is_empty(),
            "claim text must not be empty",
        )?;
        let citation_failure = claim
            .evidence_ids
            .iter()
            .any(|id| !evidence_ids.contains(id.as_str()));
        let expected = if claim.evidence_ids.is_empty() || citation_failure {
            ClaimStatus::Failed
        } else {
            ClaimStatus::Supported
        };
        require(
            claim.status <= expected,
            &format!("claim {} overstates audit support", claim.id),
        )?;
    }

    let audited = run
        .audit
        .audited_claim_ids
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    require(
        audited == claim_ids,
        "audit must enumerate every claim exactly once",
    )?;
    let expected_failures = expected_audit_failures(run, &evidence_ids);
    require(
        run.audit.failures == expected_failures,
        "audit failures do not exactly match claim-level citation failures",
    )?;
    let expected_overall = expected_overall_claim(&run.synthesis.claims);
    require(
        run.synthesis.overall_claim <= expected_overall,
        "overall run claim overstates claim-level support",
    )?;

    validate_receipt(run, expected_overall)?;
    Ok(())
}

fn validate_source_profile(profile: &SourceProfile) -> Result<(), ResearchError> {
    require(
        profile.version == CONTRACT_VERSION,
        "unsupported source profile version",
    )?;
    validate_identifier(&profile.id, "source profile id", "source-")?;
    require(
        !profile.allowed_schemes.is_empty(),
        "source profile requires allowed schemes",
    )?;
    require(
        profile.max_records > 0 && profile.max_bytes_per_record > 0,
        "source profile budgets must be positive",
    )?;
    require(
        profile.content_is_untrusted,
        "source content must be declared untrusted",
    )?;
    require(
        !profile.may_authorize_actions,
        "source content must not authorize actions",
    )?;
    require(
        profile
            .allowed_schemes
            .iter()
            .all(|scheme| matches!(scheme.as_str(), "file" | "recorded")),
        "only offline file and recorded schemes are permitted",
    )
}

fn validate_pipeline(
    pipeline: &PipelineManifest,
    profile: &SourceProfile,
) -> Result<(), ResearchError> {
    require(
        pipeline.version == CONTRACT_VERSION,
        "unsupported pipeline version",
    )?;
    validate_identifier(&pipeline.id, "pipeline id", "pipeline-")?;
    validate_sha256(&pipeline.revision, "pipeline revision")?;
    require(
        pipeline.source_profile_id == profile.id,
        "pipeline source profile mismatch",
    )?;
    require(
        !pipeline.stages.is_empty(),
        "pipeline stages must not be empty",
    )?;
    let mut stage_ids = BTreeSet::new();
    for stage in &pipeline.stages {
        validate_identifier(&stage.id, "stage id", "stage-")?;
        require(
            stage_ids.insert(stage.id.as_str()),
            "duplicate pipeline stage id",
        )?;
    }
    let operations = pipeline
        .stages
        .iter()
        .map(|stage| &stage.operation)
        .collect::<Vec<_>>();
    let required = [
        StageOperation::Acquire,
        StageOperation::ExtractEvidence,
        StageOperation::IdentifyGaps,
        StageOperation::Synthesize,
        StageOperation::Audit,
    ];
    for operation in &required {
        require(
            operations.contains(&operation),
            "pipeline is missing a required stage",
        )?;
    }
    require(
        pipeline.budgets.max_sources > 0
            && pipeline.budgets.max_raw_bytes > 0
            && pipeline.budgets.max_claims > 0,
        "pipeline budgets must be positive",
    )?;
    require(
        pipeline.budgets.max_sources <= profile.max_records,
        "pipeline source budget exceeds source profile",
    )?;
    require(
        pipeline.budgets.max_planning_inputs as usize <= MAX_PLANNING_INPUTS,
        "planning input count exceeds contract bound",
    )?;
    let actual = pipeline.required_artifacts.iter().collect::<BTreeSet<_>>();
    let expected = [
        ArtifactKind::Scope,
        ArtifactKind::Plan,
        ArtifactKind::RawRecords,
        ArtifactKind::Evidence,
        ArtifactKind::Gaps,
        ArtifactKind::Synthesis,
        ArtifactKind::Audit,
        ArtifactKind::Receipt,
    ]
    .iter()
    .collect::<BTreeSet<_>>();
    require(
        actual == expected,
        "required_artifacts must contain every immutable run artifact exactly once",
    )?;
    require(
        pipeline.output_authority.planning_inputs_are_proposals,
        "planning inputs must remain proposals",
    )?;
    require(
        !pipeline.output_authority.may_mutate_accepted_plans,
        "research output must not mutate accepted plans",
    )
}

fn expected_audit_failures(run: &ResearchRun, evidence_ids: &BTreeSet<&str>) -> Vec<AuditFailure> {
    let mut failures = Vec::new();
    for claim in &run.synthesis.claims {
        if claim.evidence_ids.is_empty() {
            failures.push(AuditFailure {
                claim_id: claim.id.clone(),
                kind: AuditFailureKind::UnsupportedClaim,
                detail: "claim has no evidence citations".into(),
            });
        }
        for citation in &claim.evidence_ids {
            if !evidence_ids.contains(citation.as_str()) {
                failures.push(AuditFailure {
                    claim_id: claim.id.clone(),
                    kind: AuditFailureKind::BrokenCitation,
                    detail: format!("citation {citation} does not exist"),
                });
            }
        }
    }
    failures
}

fn expected_overall_claim(claims: &[ResearchClaim]) -> OverallClaim {
    if claims
        .iter()
        .any(|claim| claim.status == ClaimStatus::Failed)
    {
        OverallClaim::Failed
    } else if claims
        .iter()
        .any(|claim| claim.status == ClaimStatus::Qualified)
    {
        OverallClaim::Qualified
    } else {
        OverallClaim::Supported
    }
}

fn validate_receipt(
    run: &ResearchRun,
    expected_overall: OverallClaim,
) -> Result<(), ResearchError> {
    let receipt = &run.receipt;
    require(receipt.run_id == run.run_id, "receipt run_id mismatch")?;
    require(
        receipt.pipeline_id == run.pipeline.id,
        "receipt pipeline_id mismatch",
    )?;
    require(
        receipt.pipeline_revision == run.pipeline.revision,
        "receipt pipeline revision mismatch",
    )?;
    validate_identifier(&receipt.adapter_id, "adapter id", "adapter-")?;
    validate_timestamp(&receipt.started_at, "receipt started_at")?;
    validate_timestamp(&receipt.finished_at, "receipt finished_at")?;
    require(
        receipt.started_at <= receipt.finished_at,
        "receipt timestamps are reversed",
    )?;
    validate_sha256(&receipt.input_hash, "receipt input hash")?;
    validate_sha256(&receipt.artifact_hash, "receipt artifact hash")?;
    let expected_status = match expected_overall {
        OverallClaim::Supported => RunStatus::Passed,
        OverallClaim::Qualified => RunStatus::Qualified,
        OverallClaim::Failed => RunStatus::Failed,
    };
    require(
        receipt.status == expected_status,
        "receipt status does not transparently reflect overall claim",
    )?;
    require(
        receipt.artifact_hash == run_artifact_hash(run)?,
        "receipt artifact hash mismatch",
    )
}

/// Produces a deterministic hash over all run artifacts except the self-referential receipt hash.
///
/// # Errors
/// Returns an error only if canonical serialization fails.
pub fn run_artifact_hash(run: &ResearchRun) -> Result<String, ResearchError> {
    let mut value = serde_json::to_value(run)
        .map_err(|error| ResearchError(format!("cannot serialize run: {error}")))?;
    value["receipt"]["artifact_hash"] = Value::String(String::new());
    Ok(sha256_hex(&canonical_json_bytes(&value)))
}

/// Derives a deterministic run ID from stable timestamp, pipeline revision, and input hash.
///
/// # Errors
/// Returns an error when the timestamp or either hash is not in canonical form.
pub fn deterministic_run_id(
    timestamp: &str,
    pipeline_revision: &str,
    input_hash: &str,
) -> Result<String, ResearchError> {
    validate_timestamp(timestamp, "run timestamp")?;
    validate_sha256(pipeline_revision, "pipeline revision")?;
    validate_sha256(input_hash, "input hash")?;
    let digest = sha256_hex(format!("{timestamp}\n{pipeline_revision}\n{input_hash}").as_bytes());
    Ok(format!("run-{}", &digest[..24]))
}

/// Exports only supported or qualified findings as bounded, non-authoritative planning proposals.
///
/// # Errors
/// Returns an error if the validated run or export size/count bounds are violated.
pub fn export_planning_inputs(run: &ResearchRun) -> Result<PlanningInputExport, ResearchError> {
    validate_run(run)?;
    let max = usize::try_from(run.pipeline.budgets.max_planning_inputs)
        .map_err(|_| ResearchError("planning input bound is invalid".into()))?
        .min(MAX_PLANNING_INPUTS);
    let mut inputs = run
        .synthesis
        .claims
        .iter()
        .filter(|claim| claim.status != ClaimStatus::Failed)
        .take(max)
        .map(|claim| PlanningInput {
            id: format!(
                "input-{}",
                claim.id.strip_prefix("claim-").unwrap_or(&claim.id)
            ),
            claim_id: claim.id.clone(),
            text: claim.text.clone(),
            evidence_ids: claim.evidence_ids.clone(),
            confidence: claim.status,
            accepted: false,
        })
        .collect::<Vec<_>>();
    inputs.sort_by(|left, right| left.id.cmp(&right.id));
    let export = PlanningInputExport {
        contract_version: CONTRACT_VERSION,
        run_id: run.run_id.clone(),
        run_artifact_hash: run_artifact_hash(run)?,
        authority: PlanningAuthority::ProposalOnly,
        inputs,
    };
    let bytes = serde_json::to_vec(&export)
        .map_err(|error| ResearchError(format!("cannot serialize planning export: {error}")))?;
    require(
        bytes.len() <= MAX_PLANNING_INPUT_BYTES,
        "planning input export exceeds byte bound",
    )?;
    Ok(export)
}

/// Normalizes a recorded provider-alpha fixture to the canonical run contract.
///
/// # Errors
/// Returns an error for malformed fixtures or invalid canonical runs.
pub fn normalize_provider_alpha(input: &str) -> Result<ResearchRun, ResearchError> {
    let fixture: ProviderAlphaFixture = serde_json::from_str(input)
        .map_err(|error| ResearchError(format!("invalid provider-alpha fixture: {error}")))?;
    require(
        fixture.adapter_id == fixture.run.receipt.adapter_id,
        "provider-alpha adapter mismatch",
    )?;
    validate_run(&fixture.run)?;
    Ok(fixture.run)
}

/// Normalizes a differently-shaped recorded provider-beta fixture to the canonical run contract.
///
/// # Errors
/// Returns an error for malformed fixtures or invalid canonical runs.
pub fn normalize_provider_beta(input: &str) -> Result<ResearchRun, ResearchError> {
    let fixture: ProviderBetaFixture = serde_json::from_str(input)
        .map_err(|error| ResearchError(format!("invalid provider-beta fixture: {error}")))?;
    let artifacts = fixture.payload.artifacts;
    let run = ResearchRun {
        contract_version: fixture.payload.contract,
        run_id: fixture.payload.id,
        created_at: fixture.payload.timestamp,
        source_profile: fixture.payload.profile,
        pipeline: fixture.payload.procedure,
        scope: artifacts.scope,
        plan: artifacts.plan,
        raw_records: artifacts.records,
        evidence: artifacts.citations,
        gaps: artifacts.gaps,
        synthesis: artifacts.synthesis,
        audit: artifacts.audit,
        receipt: artifacts.receipt,
    };
    require(
        fixture.adapter == run.receipt.adapter_id,
        "provider-beta adapter mismatch",
    )?;
    validate_run(&run)?;
    Ok(run)
}

fn canonical_json_bytes(value: &Value) -> Vec<u8> {
    fn write(value: &Value, output: &mut String) {
        match value {
            Value::Null => output.push_str("null"),
            Value::Bool(value) => output.push_str(if *value { "true" } else { "false" }),
            Value::Number(value) => output.push_str(&value.to_string()),
            Value::String(value) => output
                .push_str(&serde_json::to_string(value).expect("string serialization cannot fail")),
            Value::Array(values) => {
                output.push('[');
                for (index, value) in values.iter().enumerate() {
                    if index > 0 {
                        output.push(',');
                    }
                    write(value, output);
                }
                output.push(']');
            }
            Value::Object(values) => {
                output.push('{');
                let mut entries = values.iter().collect::<Vec<_>>();
                entries.sort_by(|left, right| left.0.cmp(right.0));
                for (index, (key, value)) in entries.into_iter().enumerate() {
                    if index > 0 {
                        output.push(',');
                    }
                    output.push_str(
                        &serde_json::to_string(key).expect("key serialization cannot fail"),
                    );
                    output.push(':');
                    write(value, output);
                }
                output.push('}');
            }
        }
    }
    let mut output = String::new();
    write(value, &mut output);
    output.into_bytes()
}

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn validate_sha256(value: &str, field: &str) -> Result<(), ResearchError> {
    require(
        value.len() == 64
            && value
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase()),
        &format!("{field} must be 64 lowercase hexadecimal characters"),
    )
}

fn validate_identifier(value: &str, field: &str, prefix: &str) -> Result<(), ResearchError> {
    require(
        value.starts_with(prefix)
            && value.len() > prefix.len()
            && value
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-'),
        &format!("{field} has invalid deterministic identifier syntax"),
    )
}

fn validate_timestamp(value: &str, field: &str) -> Result<(), ResearchError> {
    let bytes = value.as_bytes();
    require(
        bytes.len() == 20
            && bytes[4] == b'-'
            && bytes[7] == b'-'
            && bytes[10] == b'T'
            && bytes[13] == b':'
            && bytes[16] == b':'
            && bytes[19] == b'Z'
            && bytes.iter().enumerate().all(|(index, byte)| {
                matches!(index, 4 | 7 | 10 | 13 | 16 | 19) || byte.is_ascii_digit()
            }),
        &format!("{field} must use deterministic UTC YYYY-MM-DDTHH:MM:SSZ format"),
    )
}

fn require(condition: bool, message: &str) -> Result<(), ResearchError> {
    if condition {
        Ok(())
    } else {
        Err(ResearchError(message.to_owned()))
    }
}

/// An arXiv adapter fixture: a validated run plus the declared effects of
/// producing it.
///
/// MOZAK performs no networking, so a run that came from a network source must
/// carry what that access did. An adapter that quietly caused an external
/// effect is the failure this declaration exists to prevent.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProviderArxivFixture {
    pub adapter: String,
    pub adapter_version: String,
    pub capability: String,
    pub topic_id: String,
    pub effects: AdapterEffects,
    pub request: ArxivRequest,
    /// One report per interest cluster, including clusters that matched nothing.
    #[serde(default)]
    pub clusters: Vec<ClusterReport>,
    pub response_pages: Vec<String>,
    pub total_matched: u64,
    pub records_kept: u64,
    pub truncated: bool,
    pub run: ResearchRun,
}

/// What an adapter's execution did outside this machine.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct AdapterEffects {
    pub network_used: bool,
    pub external_writes: Vec<String>,
    /// Free text describing mutations, or `none`.
    pub mutations_performed: String,
    pub irreversible_effects: Vec<String>,
    pub dry_run_available: bool,
    pub owner_approval_required: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArxivRequest {
    pub mode: String,
    pub categories: Vec<String>,
    pub terms: Vec<String>,
    pub window: ArxivWindow,
    pub search_query: String,
    pub max_records: u64,
}

/// What one interest cluster retrieved.
///
/// A cluster that matched nothing is reported rather than omitted, because a
/// silent zero is indistinguishable from a cluster whose terms do not match the
/// vocabulary the field actually uses.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ClusterReport {
    pub name: String,
    pub terms: Vec<String>,
    pub search_query: String,
    pub total_matched: u64,
    pub records_kept: u64,
    pub truncated: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArxivWindow {
    pub start: String,
    pub end: String,
}

/// Normalizes an arXiv adapter fixture into a validated research run.
///
/// # Errors
/// Returns an error when the fixture is malformed, its declared effects exceed
/// read-only retrieval, its counts disagree with the recorded records, or the
/// run itself violates the research contract.
pub fn normalize_provider_arxiv(input: &str) -> Result<ResearchRun, ResearchError> {
    let fixture: ProviderArxivFixture = serde_json::from_str(input)
        .map_err(|error| ResearchError(format!("invalid provider-arxiv fixture: {error}")))?;
    require(
        fixture.adapter == fixture.run.receipt.adapter_id,
        "provider-arxiv adapter mismatch",
    )?;
    nonempty_text(&fixture.adapter_version, "adapter version")?;
    nonempty_text(&fixture.capability, "adapter capability")?;
    nonempty_text(&fixture.topic_id, "adapter topic id")?;

    validate_read_only_effects(&fixture.effects)?;

    require(
        matches!(fixture.request.mode.as_str(), "catchup" | "query"),
        "arXiv request mode must be catchup or query",
    )?;
    require(
        !fixture.request.categories.is_empty(),
        "arXiv request must name at least one category",
    )?;
    nonempty_text(&fixture.request.search_query, "arXiv search query")?;
    validate_timestamp(&fixture.request.window.start, "arXiv window start")?;
    validate_timestamp(&fixture.request.window.end, "arXiv window end")?;
    require(
        fixture.request.window.start < fixture.request.window.end,
        "arXiv window start must precede its end",
    )?;

    validate_clusters(&fixture)?;
    require(
        fixture.request.mode != "query"
            || !fixture.request.terms.is_empty()
            || !fixture.clusters.is_empty(),
        "arXiv query mode requires terms or clusters",
    )?;

    // Every response body must be pinned, so a recorded claim can be rechecked
    // against the exact bytes the API returned.
    require(
        !fixture.response_pages.is_empty(),
        "arXiv fixture must pin its response bodies",
    )?;
    for page in &fixture.response_pages {
        validate_sha256(page, "arXiv response page hash")?;
    }

    let kept = u64::try_from(fixture.run.raw_records.len())
        .map_err(|_| ResearchError("record count overflow".into()))?;
    require(
        fixture.records_kept == kept,
        "records_kept disagrees with the recorded raw records",
    )?;
    require(
        fixture.records_kept <= fixture.request.max_records,
        "records_kept exceeds the requested cap",
    )?;
    require(
        fixture.records_kept <= fixture.total_matched,
        "records_kept exceeds the reported total",
    )?;
    // Truncation is a real limit on what was examined, so it must be declared
    // rather than implied by comparing counts later.
    require(
        fixture.truncated == (fixture.records_kept < fixture.total_matched),
        "truncated does not reflect the recorded counts",
    )?;
    if fixture.truncated {
        require(
            fixture
                .run
                .gaps
                .iter()
                .any(|gap| gap.impact == GapImpact::High),
            "a truncated retrieval must record a high-impact gap",
        )?;
        require(
            fixture.run.synthesis.overall_claim != OverallClaim::Supported,
            "a truncated retrieval must not claim full support",
        )?;
    }

    validate_run(&fixture.run)?;
    Ok(fixture.run)
}

/// A recorded retrieval of GitHub repository release metadata.
///
/// This adapter has two modes because discovery and vigilance are different
/// jobs. `discover` runs owner-declared searches to surface tooling the owner
/// has not seen; `watch` tracks an explicit owner-curated list. Keeping them in
/// one contract makes the boundary enforceable: a discovery run must declare
/// that it proposes rather than promotes, so nothing can quietly graduate from
/// "found" to "adopted" without the owner editing a watch request.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProviderGithubToolingFixture {
    pub adapter: String,
    pub adapter_version: String,
    pub capability: String,
    pub scope_id: String,
    pub effects: AdapterEffects,
    pub mode: String,
    pub queries: Vec<GithubQueryReport>,
    pub watchlist: Vec<String>,
    pub pushed_since: Option<String>,
    pub min_stars: u64,
    pub response_files: Vec<String>,
    pub total_found: u64,
    pub records_kept: u64,
    pub truncated: bool,
    pub run: ResearchRun,
}

/// How one declared discovery query fared.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GithubQueryReport {
    pub name: String,
    pub terms: Vec<String>,
    pub records_matched: u64,
}

/// Normalizes a GitHub tooling fixture into a validated research run.
///
/// # Errors
/// Fails closed on malformed identity, an unpinned response, dishonest counts,
/// unsafe effects, retained repository prose, a mode that claims the other
/// mode's authority, or an invalid research run.
pub fn normalize_provider_github_tooling(input: &str) -> Result<ResearchRun, ResearchError> {
    let fixture: ProviderGithubToolingFixture = serde_json::from_str(input).map_err(|error| {
        ResearchError(format!("invalid provider-github-tooling fixture: {error}"))
    })?;
    require(
        fixture.adapter == "adapter-github-tooling-v1"
            && fixture.adapter == fixture.run.receipt.adapter_id,
        "provider-github-tooling adapter mismatch",
    )?;
    nonempty_text(&fixture.adapter_version, "adapter version")?;
    nonempty_text(&fixture.capability, "adapter capability")?;
    nonempty_text(&fixture.scope_id, "adapter scope id")?;
    validate_read_only_effects(&fixture.effects)?;

    validate_github_mode(&fixture)?;
    require(
        !fixture.response_files.is_empty(),
        "a GitHub tooling fixture must pin at least one response body",
    )?;
    for response in &fixture.response_files {
        validate_sha256(response, "GitHub response hash")?;
    }
    if let Some(since) = &fixture.pushed_since {
        require(
            since.len() == 10 && since.as_bytes()[4] == b'-' && since.as_bytes()[7] == b'-',
            "pushed_since must be a YYYY-MM-DD date",
        )?;
    }
    validate_github_queries(&fixture)?;

    let kept = u64::try_from(fixture.run.raw_records.len())
        .map_err(|_| ResearchError("record count overflow".into()))?;
    require(
        fixture.records_kept == kept,
        "records_kept disagrees with the recorded raw records",
    )?;
    require(
        fixture.records_kept <= fixture.total_found,
        "records_kept exceeds the total found",
    )?;
    if fixture.truncated {
        require(
            fixture
                .run
                .gaps
                .iter()
                .any(|gap| gap.id == "gap-truncated" && gap.impact == GapImpact::High),
            "a truncated GitHub tooling retrieval must record a high-impact gap",
        )?;
        require(
            fixture.run.synthesis.overall_claim != OverallClaim::Supported,
            "a truncated GitHub tooling retrieval must not claim full support",
        )?;
    }
    validate_github_records(&fixture)?;
    validate_run(&fixture.run)?;
    Ok(fixture.run)
}

/// Keeps each mode inside its own authority.
///
/// Discovery surfaces repositories nobody asked for, so it must not be able to
/// carry a watchlist or borrow watch mode's settled framing; watching observes
/// a closed owner-curated list, so it must not claim to have discovered
/// anything. Each mode also has to disclose what it cannot see.
fn validate_github_mode(fixture: &ProviderGithubToolingFixture) -> Result<(), ResearchError> {
    let has_gap = |id: &str, high: bool| {
        fixture
            .run
            .gaps
            .iter()
            .any(|gap| gap.id == id && (!high || gap.impact == GapImpact::High))
    };
    match fixture.mode.as_str() {
        "discover" => {
            require(
                !fixture.queries.is_empty(),
                "a discovery retrieval must record the queries it ran",
            )?;
            require(
                fixture.watchlist.is_empty(),
                "a discovery retrieval must not carry a watchlist; discovery does not promote",
            )?;
            require(
                has_gap("gap-discovery-is-proposal-only", true),
                "a discovery retrieval must disclose that it proposes rather than promotes",
            )?;
            require(
                has_gap("gap-topic-dependent", false),
                "a discovery retrieval must disclose that undeclared topics are invisible to it",
            )?;
        }
        "watch" => {
            require(
                !fixture.watchlist.is_empty(),
                "a watch retrieval must record the repositories it watched",
            )?;
            require(
                fixture.queries.is_empty(),
                "a watch retrieval must not claim discovery queries",
            )?;
            require(
                has_gap("gap-watchlist-is-closed", true),
                "a watch retrieval must disclose that it performs no discovery",
            )?;
        }
        _ => return Err(ResearchError("mode must be discover or watch".into())),
    }
    // Stars measure attention. Presenting them without saying so would let
    // popularity read as an assessment of fitness.
    require(
        has_gap("gap-stars-are-attention", false),
        "a GitHub tooling retrieval must disclose that stars are not quality",
    )?;
    require(
        has_gap("gap-license-varies", false),
        "a GitHub tooling retrieval must disclose its licence boundary",
    )
}

fn validate_github_queries(fixture: &ProviderGithubToolingFixture) -> Result<(), ResearchError> {
    let mut names = BTreeSet::new();
    for query in &fixture.queries {
        nonempty_text(&query.name, "query name")?;
        require(names.insert(query.name.as_str()), "duplicate query name")?;
        require(!query.terms.is_empty(), "a query must declare its terms")?;
        if query.records_matched == 0 {
            require(
                fixture
                    .run
                    .gaps
                    .iter()
                    .any(|gap| gap.id == format!("gap-empty-{}", query.name)),
                "an empty query must record a gap",
            )?;
        }
    }
    let mut repositories = BTreeSet::new();
    for repository in &fixture.watchlist {
        nonempty_text(repository, "watchlist repository")?;
        require(
            repository.split('/').count() == 2,
            "watchlist entries must be OWNER/NAME",
        )?;
        require(
            repositories.insert(repository.to_lowercase()),
            "duplicate watchlist repository",
        )?;
    }
    Ok(())
}

fn validate_github_records(fixture: &ProviderGithubToolingFixture) -> Result<(), ResearchError> {
    for record in &fixture.run.raw_records {
        require(
            record.source_uri.starts_with("recorded:github-tooling:"),
            "GitHub tooling records must use the recorded:github-tooling scheme",
        )?;
        let lines = record.content.lines().collect::<Vec<_>>();
        require(
            lines.len() == 12,
            "a GitHub tooling record must carry exactly its retained metadata lines",
        )?;
        require(
            lines[0].starts_with("repository: ") && lines[1].starts_with("url: "),
            "a GitHub tooling record must open with repository identity",
        )?;
        // Many active projects publish no releases, so a head commit is a
        // legitimate marker. Requiring one or the other keeps an actively
        // pushed repository from looking dormant.
        require(
            lines[2].starts_with("latest_release: ") || lines[2].starts_with("latest_commit: "),
            "a GitHub tooling record must state a latest release or commit",
        )?;
        for (index, prefix) in [
            "latest_at: ",
            "pushed_at: ",
            "stars: ",
            "language: ",
            "license: ",
            "archived: ",
            "topics: ",
            "matched: ",
            "retention: ",
        ]
        .iter()
        .enumerate()
        {
            require(
                lines[index + 3].starts_with(prefix),
                "GitHub tooling record fields are out of contract order",
            )?;
        }
        require(
            lines[11]
                == "retention: identity, activity, licence and topics only; repository prose not retained",
            "a GitHub tooling record must declare that repository prose was not retained",
        )?;
        require(
            !record.content.to_lowercase().contains("description:")
                && !record.content.to_lowercase().contains("readme"),
            "GitHub tooling records must not retain repository prose",
        )?;
    }
    Ok(())
}

/// A recorded retrieval from the official MCP registry.
///
/// MOZAK's modules are meant to stay upgradeable to whatever the industry now
/// treats as standard, which requires a source that reports released tooling
/// rather than literature. The registry is that source: it carries per-server
/// identity, version, and publication timestamps, so newness is a property of
/// the data rather than of when the fetch happened.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProviderMcpRegistryFixture {
    pub adapter: String,
    pub adapter_version: String,
    pub capability: String,
    pub scope_id: String,
    pub effects: AdapterEffects,
    pub registry: String,
    pub updated_since: Option<String>,
    pub interests: Vec<McpInterestReport>,
    pub response_files: Vec<String>,
    pub total_matched: u64,
    pub records_kept: u64,
    pub truncated: bool,
    pub run: ResearchRun,
}

/// How one declared interest cluster fared in a registry retrieval.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct McpInterestReport {
    pub name: String,
    pub terms: Vec<String>,
    pub records_matched: u64,
}

/// Normalizes an MCP registry fixture into a validated research run.
///
/// # Errors
/// Fails closed on malformed identity, an unpinned response, dishonest counts,
/// unsafe effects, retained publisher prose, a missing disclosure of what the
/// registry cannot see, or an invalid research run.
pub fn normalize_provider_mcp_registry(input: &str) -> Result<ResearchRun, ResearchError> {
    let fixture: ProviderMcpRegistryFixture = serde_json::from_str(input).map_err(|error| {
        ResearchError(format!("invalid provider-mcp-registry fixture: {error}"))
    })?;
    require(
        fixture.adapter == "adapter-mcp-registry-v1"
            && fixture.adapter == fixture.run.receipt.adapter_id,
        "provider-mcp-registry adapter mismatch",
    )?;
    nonempty_text(&fixture.adapter_version, "adapter version")?;
    nonempty_text(&fixture.capability, "adapter capability")?;
    nonempty_text(&fixture.scope_id, "adapter scope id")?;
    require(
        fixture.registry == "https://registry.modelcontextprotocol.io",
        "MCP registry identity mismatch",
    )?;
    if let Some(since) = &fixture.updated_since {
        require(
            since.len() == 20 && since.ends_with('Z'),
            "updated_since must be an RFC3339 UTC instant",
        )?;
    }
    validate_read_only_effects(&fixture.effects)?;
    require(
        !fixture.response_files.is_empty(),
        "an MCP registry fixture must pin at least one response body",
    )?;
    for response in &fixture.response_files {
        validate_sha256(response, "MCP registry response hash")?;
    }

    validate_mcp_interests(&fixture)?;

    let kept = u64::try_from(fixture.run.raw_records.len())
        .map_err(|_| ResearchError("record count overflow".into()))?;
    require(
        fixture.records_kept == kept,
        "records_kept disagrees with the recorded raw records",
    )?;
    require(
        fixture.records_kept <= fixture.total_matched,
        "records_kept exceeds the matched total",
    )?;
    if fixture.truncated {
        require(
            fixture
                .run
                .gaps
                .iter()
                .any(|gap| gap.id == "gap-truncated" && gap.impact == GapImpact::High),
            "a truncated MCP registry retrieval must record a high-impact gap",
        )?;
        require(
            fixture.run.synthesis.overall_claim != OverallClaim::Supported,
            "a truncated MCP registry retrieval must not claim full support",
        )?;
    } else {
        require(
            fixture.records_kept == fixture.total_matched,
            "an untruncated retrieval must keep everything it matched",
        )?;
    }

    // The registry only lists MCP servers, so a retrieval that did not say so
    // would overstate its coverage of agentic tooling.
    require(
        fixture
            .run
            .gaps
            .iter()
            .any(|gap| gap.id == "gap-mcp-servers-only" && gap.impact == GapImpact::High),
        "an MCP registry retrieval must disclose that non-MCP tooling is outside it",
    )?;
    // Presence is publication, not assessment.
    require(
        fixture
            .run
            .gaps
            .iter()
            .any(|gap| gap.id == "gap-self-published"),
        "an MCP registry retrieval must disclose that entries are self-published",
    )?;
    validate_mcp_records(&fixture)?;
    validate_run(&fixture.run)?;
    Ok(fixture.run)
}

fn validate_mcp_interests(fixture: &ProviderMcpRegistryFixture) -> Result<(), ResearchError> {
    let mut names = BTreeSet::new();
    for cluster in &fixture.interests {
        nonempty_text(&cluster.name, "interest cluster name")?;
        require(
            names.insert(cluster.name.as_str()),
            "duplicate interest cluster name",
        )?;
        require(
            !cluster.terms.is_empty(),
            "an interest cluster must declare its terms",
        )?;
        if cluster.records_matched == 0 {
            require(
                fixture
                    .run
                    .gaps
                    .iter()
                    .any(|gap| gap.id == format!("gap-empty-{}", cluster.name)),
                "an empty interest cluster must record a gap",
            )?;
        }
    }
    Ok(())
}

fn validate_mcp_records(fixture: &ProviderMcpRegistryFixture) -> Result<(), ResearchError> {
    for record in &fixture.run.raw_records {
        require(
            record.source_uri.starts_with("recorded:mcp-registry:"),
            "MCP registry records must use the recorded:mcp-registry scheme",
        )?;
        let lines = record.content.lines().collect::<Vec<_>>();
        require(
            lines.len() == 11,
            "an MCP registry record must carry exactly its retained metadata lines",
        )?;
        for (index, prefix) in [
            "server: ",
            "version: ",
            "repository: ",
            "website: ",
            "distribution: ",
            "published_at: ",
            "updated_at: ",
            "is_latest: ",
            "registry_status: ",
            "clusters: ",
            "retention: ",
        ]
        .iter()
        .enumerate()
        {
            require(
                lines[index].starts_with(prefix),
                "MCP registry record fields are out of contract order",
            )?;
        }
        // The registry carries publisher-written descriptions. They may be read
        // transiently for interest matching, but retaining them would make this
        // adapter a store of third-party marketing prose rather than of facts
        // about what was released.
        require(
            lines[10]
                == "retention: identity, version, links and dates only; publisher prose not retained",
            "an MCP registry record must declare that publisher prose was not retained",
        )?;
        require(
            !record.content.to_lowercase().contains("description:"),
            "MCP registry records must not retain publisher description prose",
        )?;
    }
    Ok(())
}

/// A recorded retrieval from DAIR.AI's curated Papers of the Week repository.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProviderDairAiFixture {
    pub adapter: String,
    pub adapter_version: String,
    pub capability: String,
    pub scope_id: String,
    pub effects: AdapterEffects,
    pub repository: String,
    pub source_revision: String,
    pub source_year: u32,
    pub weeks_requested: u32,
    pub clusters: Vec<DairClusterReport>,
    pub response_files: Vec<String>,
    pub total_curated: u64,
    pub records_kept: u64,
    pub truncated: bool,
    pub run: ResearchRun,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DairClusterReport {
    pub name: String,
    pub terms: Vec<String>,
    pub records_matched: u64,
}

/// Normalizes a DAIR.AI Papers of the Week fixture into a validated run.
///
/// # Errors
/// Fails closed on malformed identity, unpinned source bytes, dishonest counts,
/// unsafe effects, copied curator prose, or an invalid research run.
pub fn normalize_provider_dair_ai(input: &str) -> Result<ResearchRun, ResearchError> {
    let fixture: ProviderDairAiFixture = serde_json::from_str(input)
        .map_err(|error| ResearchError(format!("invalid provider-dair-ai fixture: {error}")))?;
    require(
        fixture.adapter == "adapter-dair-ai-v1"
            && fixture.adapter == fixture.run.receipt.adapter_id,
        "provider-dair-ai adapter mismatch",
    )?;
    nonempty_text(&fixture.adapter_version, "adapter version")?;
    nonempty_text(&fixture.capability, "adapter capability")?;
    nonempty_text(&fixture.scope_id, "adapter scope id")?;
    require(
        fixture.repository == "dair-ai/AI-Papers-of-the-Week",
        "DAIR.AI repository identity mismatch",
    )?;
    require(
        fixture.source_revision.len() == 40
            && fixture
                .source_revision
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase()),
        "DAIR.AI source revision must be 40 lowercase hexadecimal characters",
    )?;
    require(
        (2023..=9999).contains(&fixture.source_year),
        "DAIR.AI source year is invalid",
    )?;
    require(
        (1..=12).contains(&fixture.weeks_requested),
        "DAIR.AI weeks_requested must be between 1 and 12",
    )?;
    validate_read_only_effects(&fixture.effects)?;
    require(
        fixture.response_files.len() == 2,
        "DAIR.AI fixture must pin the commit response and year file",
    )?;
    for response in &fixture.response_files {
        validate_sha256(response, "DAIR.AI response hash")?;
    }

    validate_dair_clusters(&fixture)?;

    let kept = u64::try_from(fixture.run.raw_records.len())
        .map_err(|_| ResearchError("record count overflow".into()))?;
    require(
        fixture.records_kept == kept,
        "records_kept disagrees with the recorded raw records",
    )?;
    require(
        fixture.records_kept <= fixture.total_curated,
        "records_kept exceeds the curated total",
    )?;
    require(
        fixture.truncated == (fixture.records_kept < fixture.total_curated),
        "truncated does not reflect the curated counts",
    )?;
    if fixture.truncated {
        require(
            fixture
                .run
                .gaps
                .iter()
                .any(|gap| gap.id == "gap-truncated" && gap.impact == GapImpact::High),
            "a truncated DAIR.AI retrieval must record a high-impact gap",
        )?;
        require(
            fixture.run.synthesis.overall_claim != OverallClaim::Supported,
            "a truncated DAIR.AI retrieval must not claim full support",
        )?;
    }
    require(
        fixture
            .run
            .gaps
            .iter()
            .any(|gap| gap.id == "gap-curator-boundary"),
        "DAIR.AI retrieval must disclose its curator boundary",
    )?;
    require(
        fixture
            .run
            .gaps
            .iter()
            .any(|gap| gap.id == "gap-no-upstream-license"),
        "DAIR.AI retrieval must disclose the missing upstream license",
    )?;
    validate_dair_records(&fixture)?;
    validate_run(&fixture.run)?;
    Ok(fixture.run)
}

fn validate_dair_clusters(fixture: &ProviderDairAiFixture) -> Result<(), ResearchError> {
    let mut names = BTreeSet::new();
    for cluster in &fixture.clusters {
        nonempty_text(&cluster.name, "cluster name")?;
        require(
            names.insert(cluster.name.as_str()),
            "duplicate cluster name",
        )?;
        require(
            !cluster.terms.is_empty(),
            "a cluster must declare its terms",
        )?;
        if cluster.records_matched == 0 {
            require(
                fixture
                    .run
                    .gaps
                    .iter()
                    .any(|gap| gap.id == format!("gap-empty-{}", cluster.name)),
                "an empty DAIR.AI cluster must record a gap",
            )?;
        }
    }
    Ok(())
}

fn validate_dair_records(fixture: &ProviderDairAiFixture) -> Result<(), ResearchError> {
    for record in &fixture.run.raw_records {
        require(
            record.source_uri.starts_with("recorded:dair-ai:"),
            "DAIR.AI records must use the recorded:dair-ai scheme",
        )?;
        let lines = record.content.lines().collect::<Vec<_>>();
        require(
            lines.len() == 7
                && lines[1].starts_with("paper_url: https://")
                && lines[2].starts_with("week: ")
                && lines[3] == "curated_by: DAIR.AI Papers of the Week"
                && lines[4].starts_with(
                    "source_url: https://github.com/dair-ai/AI-Papers-of-the-Week/blob/",
                )
                && lines[5] == format!("source_revision: {}", fixture.source_revision)
                && lines[6].starts_with("clusters: "),
            "DAIR.AI durable records may contain only title, link, week, provenance, and clusters",
        )?;
    }
    Ok(())
}

/// A research adapter retrieves. Anything that writes, mutates, cannot be
/// rehearsed, or needs approval is not read-only retrieval.
fn validate_read_only_effects(effects: &AdapterEffects) -> Result<(), ResearchError> {
    require(
        effects.external_writes.is_empty(),
        "a research adapter must not declare external writes",
    )?;
    require(
        effects.irreversible_effects.is_empty(),
        "a research adapter must not declare irreversible effects",
    )?;
    require(
        effects.mutations_performed == "none",
        "a research adapter must not declare mutations",
    )?;
    require(
        !effects.owner_approval_required,
        "an adapter needing owner approval must not be normalized automatically",
    )?;
    require(
        effects.network_used,
        "the arXiv adapter reaches a network source and must declare it",
    )?;
    require(
        effects.dry_run_available,
        "a network adapter must offer a dry run",
    )
}

/// Each interest cluster must report its own honest result, including zero.
fn validate_clusters(fixture: &ProviderArxivFixture) -> Result<(), ResearchError> {
    let mut names = BTreeSet::new();
    for cluster in &fixture.clusters {
        nonempty_text(&cluster.name, "cluster name")?;
        require(
            names.insert(cluster.name.as_str()),
            "duplicate cluster name",
        )?;
        require(
            !cluster.terms.is_empty(),
            "a cluster must declare its terms",
        )?;
        nonempty_text(&cluster.search_query, "cluster search query")?;
        require(
            cluster.records_kept <= cluster.total_matched,
            "cluster kept more records than it matched",
        )?;
        require(
            cluster.truncated == (cluster.records_kept < cluster.total_matched),
            "cluster truncation does not reflect its counts",
        )?;
        // An empty or truncated cluster limits what was examined and must be
        // visible as a gap rather than inferred from counts later.
        let expected = if cluster.total_matched == 0 {
            format!("gap-empty-{}", cluster.name)
        } else if cluster.truncated {
            format!("gap-truncated-{}", cluster.name)
        } else {
            continue;
        };
        let message = if cluster.total_matched == 0 {
            "a cluster that matched nothing must record a gap"
        } else {
            "a truncated cluster must record a gap"
        };
        require(
            fixture.run.gaps.iter().any(|gap| gap.id == expected),
            message,
        )?;
    }
    Ok(())
}

fn nonempty_text(value: &str, label: &str) -> Result<(), ResearchError> {
    require(
        !value.trim().is_empty(),
        &format!("{label} must not be empty"),
    )
}
