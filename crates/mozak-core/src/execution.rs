//! Closed-shape, provider-neutral contracts for bounded execution handoffs and evaluation.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt::{Display, Formatter};

pub const CONTRACT_VERSION: u64 = 1;
pub const MAX_CONTEXT_ITEMS: usize = 64;
pub const MAX_CONTEXT_BYTES: usize = 65_536;
pub const MAX_ACCEPTANCE_CONDITIONS: usize = 64;
pub const MAX_ARTIFACTS: usize = 128;
pub const MAX_OBSERVED_DEPENDENCIES: usize = 128;
pub const MAX_RETRY_ATTEMPTS: u32 = 8;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecutionError(pub String);

impl Display for ExecutionError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for ExecutionError {}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ReleasedExecutionPacket {
    pub contract_version: u64,
    pub id: String,
    pub version: u64,
    pub released_at: String,
    pub released_by: String,
    pub packet_hash: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub supersedes: Option<PacketRef>,
    pub objective: String,
    pub scope: ExecutionScope,
    pub context: Vec<ContextItem>,
    pub constraints: Vec<String>,
    pub dependencies: Vec<DeclaredDependency>,
    pub acceptance_conditions: Vec<AcceptanceCondition>,
    pub risks: Vec<String>,
    pub freshness: Freshness,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PacketRef {
    pub id: String,
    pub version: u64,
    pub packet_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ExecutionScope {
    pub included: Vec<String>,
    pub excluded: Vec<String>,
    pub permitted_capabilities: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ContextItem {
    pub id: String,
    pub media_type: String,
    pub content: String,
    pub content_sha256: String,
    pub provenance: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct DeclaredDependency {
    pub id: String,
    pub version: String,
    pub digest: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct AcceptanceCondition {
    pub id: String,
    pub behavior: String,
    pub required_evidence: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Freshness {
    pub project_revision: String,
    pub valid_after: String,
    pub expires_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ExecutionResult {
    pub contract_version: u64,
    pub id: String,
    pub packet: PacketRef,
    pub executor: ActorIdentity,
    pub attempt: u32,
    pub started_at: String,
    pub completed_at: String,
    pub status: ExecutionStatus,
    pub summary: String,
    pub artifacts: Vec<ExecutionArtifact>,
    pub validation_evidence: Vec<ValidationEvidence>,
    pub gates: Vec<GateResult>,
    pub observed_dependencies: Vec<ObservedDependency>,
    pub failures: Vec<ExecutionFailure>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retry: Option<RetryState>,
    pub receipt: ExecutionReceipt,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ActorIdentity {
    pub id: String,
    pub provider: String,
    pub adapter: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionStatus {
    Succeeded,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ExecutionArtifact {
    pub id: String,
    pub kind: String,
    pub uri: String,
    pub sha256: String,
    pub immutable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ValidationEvidence {
    pub id: String,
    pub check: String,
    pub observed: String,
    pub artifact_ids: Vec<String>,
    pub passed: bool,
    /// Present only when the check could not observe its subject at all.
    ///
    /// A check that reports on its own instrument rather than on the subject is
    /// neither a pass nor a failure of the subject. Recording the reason keeps an
    /// unproven claim visibly unproven instead of silently counting as either.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub could_not_check: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct GateResult {
    pub id: String,
    pub evidence_ids: Vec<String>,
    pub passed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failure: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ObservedDependency {
    pub id: String,
    pub version: String,
    pub digest: String,
    pub evidence_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ExecutionFailure {
    pub code: String,
    pub detail: String,
    pub evidence_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RetryState {
    pub previous_result_id: String,
    pub previous_attempt: u32,
    pub addressed_failed_gate_ids: Vec<String>,
    pub improvement: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ExecutionReceipt {
    pub procedure: String,
    pub procedure_version: String,
    pub input_packet_hash: String,
    pub capability_log: Vec<String>,
    pub output_artifact_ids: Vec<String>,
    pub result_sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct EvaluatorReport {
    pub contract_version: u64,
    pub id: String,
    pub result_id: String,
    pub evaluator: ActorIdentity,
    pub evaluated_at: String,
    pub condition_evaluations: Vec<ConditionEvaluation>,
    pub gate_evaluations: Vec<GateEvaluation>,
    pub claim: EvaluationClaim,
    pub rationale: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ConditionEvaluation {
    pub acceptance_condition_id: String,
    pub evidence_ids: Vec<String>,
    pub observed: String,
    pub passed: bool,
    /// Present only when the acceptance condition could not be exercised.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub could_not_check: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct GateEvaluation {
    pub gate_id: String,
    pub evidence_ids: Vec<String>,
    pub passed: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum EvaluationClaim {
    Failed,
    Qualified,
    Passed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ExecutionBundle {
    pub packet: ReleasedExecutionPacket,
    pub result: ExecutionResult,
    pub evaluation: EvaluatorReport,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ExecutionHistory {
    pub packets: Vec<ReleasedExecutionPacket>,
    pub results: Vec<ExecutionResult>,
    pub evaluations: Vec<EvaluatorReport>,
}

/// Parses and validates one self-contained packet, result, and independent evaluation bundle.
///
/// # Errors
/// Returns an error for malformed JSON or any contract violation.
pub fn validate_bundle_json(
    json: &str,
    observed_revision: &str,
    observed_at: &str,
) -> Result<ExecutionBundle, ExecutionError> {
    let bundle: ExecutionBundle = serde_json::from_str(json)
        .map_err(|error| ExecutionError(format!("invalid execution bundle JSON: {error}")))?;
    validate_bundle(&bundle, observed_revision, observed_at)?;
    Ok(bundle)
}

/// Validates a self-contained execution handoff without consulting project history.
///
/// # Errors
/// Returns an error when packet, execution, or evaluation evidence is invalid.
pub fn validate_bundle(
    bundle: &ExecutionBundle,
    observed_revision: &str,
    observed_at: &str,
) -> Result<(), ExecutionError> {
    validate_packet(&bundle.packet, observed_revision, observed_at)?;
    validate_result(&bundle.result, &bundle.packet, None)?;
    validate_evaluation(&bundle.evaluation, &bundle.packet, &bundle.result)
}

/// Validates a released immutable packet and its bounded context.
///
/// # Errors
/// Returns an error when shape-independent packet invariants or freshness fail.
pub fn validate_packet(
    packet: &ReleasedExecutionPacket,
    observed_revision: &str,
    observed_at: &str,
) -> Result<(), ExecutionError> {
    require(
        packet.contract_version == CONTRACT_VERSION,
        "unsupported execution contract version",
    )?;
    require(packet.version > 0, "packet version must be positive")?;
    require_nonempty(&packet.id, "packet id is required")?;
    require_nonempty(&packet.released_by, "packet releaser is required")?;
    require_nonempty(&packet.objective, "packet objective is required")?;
    require(
        !packet.scope.included.is_empty(),
        "packet scope must include work",
    )?;
    require(
        !packet.acceptance_conditions.is_empty(),
        "packet requires acceptance conditions",
    )?;
    require(
        packet.acceptance_conditions.len() <= MAX_ACCEPTANCE_CONDITIONS,
        "too many acceptance conditions",
    )?;
    require(
        packet.context.len() <= MAX_CONTEXT_ITEMS,
        "packet context item limit exceeded",
    )?;
    let context_bytes = packet.context.iter().try_fold(0usize, |total, item| {
        total
            .checked_add(item.content.len())
            .ok_or(ExecutionError("packet context byte count overflow".into()))
    })?;
    require(
        context_bytes <= MAX_CONTEXT_BYTES,
        "packet context byte budget exceeded",
    )?;
    unique_nonempty(
        packet.context.iter().map(|item| item.id.as_str()),
        "duplicate context id",
    )?;
    unique_nonempty(
        packet
            .acceptance_conditions
            .iter()
            .map(|item| item.id.as_str()),
        "duplicate acceptance condition id",
    )?;
    unique_nonempty(
        packet.dependencies.iter().map(|item| item.id.as_str()),
        "duplicate declared dependency id",
    )?;
    for item in &packet.context {
        require(
            item.content_sha256 == sha256_hex(item.content.as_bytes()),
            "context content hash mismatch",
        )?;
        require_nonempty(&item.provenance, "context provenance is required")?;
    }
    require(
        packet.freshness.project_revision == observed_revision,
        "stale packet project revision",
    )?;
    require(
        observed_at >= packet.freshness.valid_after.as_str(),
        "packet is not yet valid",
    )?;
    require(
        observed_at <= packet.freshness.expires_at.as_str(),
        "stale packet expired",
    )?;
    require(
        packet.freshness.valid_after < packet.freshness.expires_at,
        "invalid packet freshness window",
    )?;
    require(
        packet.packet_hash == packet_content_hash(packet)?,
        "released packet hash mismatch",
    )?;
    if let Some(previous) = &packet.supersedes {
        require(
            previous.id == packet.id,
            "supersession must retain packet id",
        )?;
        require(
            previous.version + 1 == packet.version,
            "packet supersession versions must be consecutive",
        )?;
        require(
            previous.packet_hash != packet.packet_hash,
            "successor packet must change content",
        )?;
    } else {
        require(
            packet.version == 1,
            "non-initial packet requires supersession link",
        )?;
    }
    Ok(())
}

/// Validates an execution result and optional preceding attempt.
///
/// # Errors
/// Returns an error when receipts, retries, failures, or validation evidence are inconsistent.
#[allow(clippy::too_many_lines)]
pub fn validate_result(
    result: &ExecutionResult,
    packet: &ReleasedExecutionPacket,
    previous: Option<&ExecutionResult>,
) -> Result<(), ExecutionError> {
    require(
        result.contract_version == CONTRACT_VERSION,
        "unsupported execution result version",
    )?;
    require(
        result.packet == packet_ref(packet),
        "result references a different packet",
    )?;
    require(
        result.attempt > 0 && result.attempt <= MAX_RETRY_ATTEMPTS,
        "execution attempt is out of bounds",
    )?;
    require(
        result.completed_at >= result.started_at,
        "execution completed before it started",
    )?;
    require(
        result.artifacts.len() <= MAX_ARTIFACTS,
        "too many execution artifacts",
    )?;
    require(
        result.observed_dependencies.len() <= MAX_OBSERVED_DEPENDENCIES,
        "too many observed dependencies",
    )?;
    unique_nonempty(
        result.artifacts.iter().map(|item| item.id.as_str()),
        "duplicate artifact id",
    )?;
    unique_nonempty(
        result
            .validation_evidence
            .iter()
            .map(|item| item.id.as_str()),
        "duplicate validation evidence id",
    )?;
    unique_nonempty(
        result.gates.iter().map(|item| item.id.as_str()),
        "duplicate gate id",
    )?;
    let artifact_ids: BTreeSet<_> = result
        .artifacts
        .iter()
        .map(|item| item.id.as_str())
        .collect();
    let evidence_ids: BTreeSet<_> = result
        .validation_evidence
        .iter()
        .map(|item| item.id.as_str())
        .collect();
    for artifact in &result.artifacts {
        require(artifact.immutable, "execution artifact must be immutable")?;
    }
    for evidence in &result.validation_evidence {
        require(
            !evidence.artifact_ids.is_empty(),
            "validation evidence must reference an artifact",
        )?;
        require(
            evidence
                .artifact_ids
                .iter()
                .all(|id| artifact_ids.contains(id.as_str())),
            "validation evidence references unknown artifact",
        )?;
        if let Some(reason) = &evidence.could_not_check {
            require(
                !reason.trim().is_empty(),
                "could_not_check requires a non-empty reason",
            )?;
            require(
                !evidence.passed,
                "a check that could not observe its subject must not be recorded as passed",
            )?;
        }
    }
    for gate in &result.gates {
        require(
            !gate.evidence_ids.is_empty(),
            "gate lacks validation evidence",
        )?;
        require(
            gate.evidence_ids
                .iter()
                .all(|id| evidence_ids.contains(id.as_str())),
            "gate references unknown validation evidence",
        )?;
        require(
            gate.passed == gate.failure.is_none(),
            "gate failure state is inconsistent",
        )?;
    }
    for dependency in &result.observed_dependencies {
        require(
            !dependency.evidence_ids.is_empty(),
            "observed dependency lacks evidence",
        )?;
        require(
            dependency
                .evidence_ids
                .iter()
                .all(|id| evidence_ids.contains(id.as_str())),
            "observed dependency references unknown evidence",
        )?;
    }
    for failure in &result.failures {
        require(
            !failure.evidence_ids.is_empty(),
            "execution failure lacks evidence",
        )?;
        require(
            failure
                .evidence_ids
                .iter()
                .all(|id| evidence_ids.contains(id.as_str())),
            "execution failure references unknown evidence",
        )?;
    }
    match result.status {
        ExecutionStatus::Succeeded => require(
            result.failures.is_empty(),
            "successful execution records failures",
        )?,
        ExecutionStatus::Failed => require(
            !result.failures.is_empty(),
            "failed execution must record a failure",
        )?,
    }
    let output_ids: BTreeSet<_> = result
        .receipt
        .output_artifact_ids
        .iter()
        .map(String::as_str)
        .collect();
    require(
        output_ids == artifact_ids,
        "receipt artifact inventory is incomplete",
    )?;
    require(
        result.receipt.input_packet_hash == packet.packet_hash,
        "receipt packet hash mismatch",
    )?;
    require(
        result.receipt.result_sha256 == result_content_hash(result)?,
        "execution result hash mismatch",
    )?;
    match (result.attempt, &result.retry, previous) {
        (1, None, None) => {}
        (1, _, _) => {
            return Err(ExecutionError(
                "initial execution must not contain retry state".into(),
            ));
        }
        (_, Some(retry), Some(prior)) => {
            require(
                result.attempt == prior.attempt + 1,
                "retry must increment attempt exactly once",
            )?;
            require(
                retry.previous_result_id == prior.id && retry.previous_attempt == prior.attempt,
                "retry does not link the previous result",
            )?;
            let failed_gates: BTreeSet<_> = prior
                .gates
                .iter()
                .filter(|gate| !gate.passed)
                .map(|gate| gate.id.as_str())
                .collect();
            require(
                !failed_gates.is_empty(),
                "retry requires a previously failed gate",
            )?;
            require(
                !retry.improvement.trim().is_empty(),
                "retry must describe its improvement",
            )?;
            require(
                retry
                    .addressed_failed_gate_ids
                    .iter()
                    .any(|id| failed_gates.contains(id.as_str())),
                "retry must address a previously failed gate",
            )?;
        }
        (_, None, _) => {
            return Err(ExecutionError(
                "retry state is required after attempt one".into(),
            ));
        }
        (_, Some(_), None) => {
            return Err(ExecutionError(
                "previous result is required to validate retry".into(),
            ));
        }
    }
    Ok(())
}

/// Validates complete requirement-to-evidence traceability by an independent evaluator.
///
/// # Errors
/// Returns an error for evaluator conflicts, missing mappings, or overstated claims.
#[allow(clippy::too_many_lines)]
pub fn validate_evaluation(
    report: &EvaluatorReport,
    packet: &ReleasedExecutionPacket,
    result: &ExecutionResult,
) -> Result<(), ExecutionError> {
    require(
        report.contract_version == CONTRACT_VERSION,
        "unsupported evaluator report version",
    )?;
    require(
        report.result_id == result.id,
        "evaluation references a different result",
    )?;
    require(
        report.evaluator.id != result.executor.id,
        "evaluator identity conflicts with executor",
    )?;
    require(
        !report.rationale.trim().is_empty(),
        "evaluation rationale is required",
    )?;
    let evidence: BTreeMap<_, _> = result
        .validation_evidence
        .iter()
        .map(|item| (item.id.as_str(), item))
        .collect();
    let expected_conditions: BTreeSet<_> = packet
        .acceptance_conditions
        .iter()
        .map(|item| item.id.as_str())
        .collect();
    let mapped_conditions: BTreeSet<_> = report
        .condition_evaluations
        .iter()
        .map(|item| item.acceptance_condition_id.as_str())
        .collect();
    require(
        report.condition_evaluations.len() == mapped_conditions.len(),
        "duplicate acceptance condition evaluation",
    )?;
    require(
        mapped_conditions == expected_conditions,
        "incomplete acceptance condition traceability",
    )?;
    for mapping in &report.condition_evaluations {
        require(
            !mapping.evidence_ids.is_empty(),
            "acceptance condition lacks observed evidence",
        )?;
        require(
            mapping
                .evidence_ids
                .iter()
                .all(|id| evidence.contains_key(id.as_str())),
            "acceptance condition references unknown evidence",
        )?;
        if mapping.passed {
            require(
                mapping
                    .evidence_ids
                    .iter()
                    .any(|id| evidence[id.as_str()].passed),
                "passed condition lacks passing observed evidence",
            )?;
        }
        if let Some(reason) = &mapping.could_not_check {
            require(
                !reason.trim().is_empty(),
                "could_not_check requires a non-empty reason",
            )?;
            require(
                !mapping.passed,
                "an acceptance condition that could not be exercised must not be recorded as passed",
            )?;
        }
    }
    let expected_gates: BTreeSet<_> = result.gates.iter().map(|item| item.id.as_str()).collect();
    let mapped_gates: BTreeSet<_> = report
        .gate_evaluations
        .iter()
        .map(|item| item.gate_id.as_str())
        .collect();
    require(
        report.gate_evaluations.len() == mapped_gates.len(),
        "duplicate gate evaluation",
    )?;
    require(
        mapped_gates == expected_gates,
        "incomplete gate traceability",
    )?;
    for mapping in &report.gate_evaluations {
        let gate = result
            .gates
            .iter()
            .find(|gate| gate.id == mapping.gate_id)
            .ok_or_else(|| ExecutionError("gate evaluation references unknown gate".into()))?;
        require(
            mapping.passed == gate.passed,
            "evaluator gate finding conflicts with observed gate",
        )?;
        require(
            !mapping.evidence_ids.is_empty()
                && mapping
                    .evidence_ids
                    .iter()
                    .all(|id| evidence.contains_key(id.as_str())),
            "gate evaluation lacks observed evidence",
        )?;
    }
    let all_conditions_pass = report.condition_evaluations.iter().all(|item| item.passed);
    let any_unproven = report
        .condition_evaluations
        .iter()
        .any(|item| item.could_not_check.is_some())
        || result
            .validation_evidence
            .iter()
            .any(|item| item.could_not_check.is_some());
    let all_gates_pass = report.gate_evaluations.iter().all(|item| item.passed);
    match report.claim {
        EvaluationClaim::Passed => {
            require(
                result.status == ExecutionStatus::Succeeded,
                "claimed pass for failed execution",
            )?;
            require(
                !any_unproven,
                "claimed pass while a check could not observe its subject",
            )?;
            require(
                all_conditions_pass,
                "claimed pass with failed acceptance condition",
            )?;
            require(all_gates_pass, "claimed pass with failed gate")?;
        }
        EvaluationClaim::Qualified => require(
            !all_conditions_pass
                || !all_gates_pass
                || any_unproven
                || result.status == ExecutionStatus::Failed,
            "qualified claim must disclose a limitation",
        )?,
        EvaluationClaim::Failed => {}
    }
    Ok(())
}

/// Validates immutable packet releases, explicit supersession, and retry chains.
///
/// # Errors
/// Returns an error when history is incomplete, mutable, or has invalid lifecycle links.
pub fn validate_history(
    history: &ExecutionHistory,
    observed_revision: &str,
    observed_at: &str,
) -> Result<(), ExecutionError> {
    require(
        !history.packets.is_empty(),
        "execution history has no packets",
    )?;
    let mut packets = history.packets.clone();
    packets.sort_by_key(|packet| packet.version);
    for (index, packet) in packets.iter().enumerate() {
        validate_packet(packet, observed_revision, observed_at)?;
        if index > 0 {
            let prior = &packets[index - 1];
            let link = packet
                .supersedes
                .as_ref()
                .ok_or_else(|| ExecutionError("successor packet lacks supersession link".into()))?;
            require(
                *link == packet_ref(prior),
                "packet supersession link mismatch",
            )?;
        }
    }
    let packet_map: BTreeMap<_, _> = history
        .packets
        .iter()
        .map(|packet| ((packet.id.as_str(), packet.version), packet))
        .collect();
    let result_map: BTreeMap<_, _> = history
        .results
        .iter()
        .map(|result| (result.id.as_str(), result))
        .collect();
    for result in &history.results {
        let packet = packet_map
            .get(&(result.packet.id.as_str(), result.packet.version))
            .ok_or_else(|| ExecutionError("result references missing packet release".into()))?;
        let previous = result
            .retry
            .as_ref()
            .and_then(|retry| result_map.get(retry.previous_result_id.as_str()).copied());
        validate_result(result, packet, previous)?;
    }
    for evaluation in &history.evaluations {
        let result = result_map
            .get(evaluation.result_id.as_str())
            .ok_or_else(|| ExecutionError("evaluation references missing result".into()))?;
        let packet = packet_map
            .get(&(result.packet.id.as_str(), result.packet.version))
            .ok_or_else(|| ExecutionError("evaluation result packet is missing".into()))?;
        validate_evaluation(evaluation, packet, result)?;
    }
    for result in &history.results {
        require(
            history
                .evaluations
                .iter()
                .any(|evaluation| evaluation.result_id == result.id),
            "executor cannot be its only evaluator",
        )?;
    }
    Ok(())
}

/// Computes the hash committed by a released packet, excluding its hash field.
///
/// # Errors
/// Returns an error if canonical serialization fails.
pub fn packet_content_hash(packet: &ReleasedExecutionPacket) -> Result<String, ExecutionError> {
    let mut value =
        serde_json::to_value(packet).map_err(|error| ExecutionError(error.to_string()))?;
    value["packet_hash"] = Value::String(String::new());
    canonical_hash(&value)
}

/// Computes the hash committed by an execution result, excluding its receipt hash field.
///
/// # Errors
/// Returns an error if canonical serialization fails.
pub fn result_content_hash(result: &ExecutionResult) -> Result<String, ExecutionError> {
    let mut value =
        serde_json::to_value(result).map_err(|error| ExecutionError(error.to_string()))?;
    value["receipt"]["result_sha256"] = Value::String(String::new());
    canonical_hash(&value)
}

fn packet_ref(packet: &ReleasedExecutionPacket) -> PacketRef {
    PacketRef {
        id: packet.id.clone(),
        version: packet.version,
        packet_hash: packet.packet_hash.clone(),
    }
}

fn canonical_hash(value: &Value) -> Result<String, ExecutionError> {
    let bytes = serde_json::to_vec(value).map_err(|error| ExecutionError(error.to_string()))?;
    Ok(sha256_hex(&bytes))
}

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn unique_nonempty<'a>(
    values: impl Iterator<Item = &'a str>,
    duplicate: &str,
) -> Result<(), ExecutionError> {
    let mut seen = BTreeSet::new();
    for value in values {
        require_nonempty(value, "identifier is required")?;
        require(seen.insert(value), duplicate)?;
    }
    Ok(())
}

fn require_nonempty(value: &str, message: &str) -> Result<(), ExecutionError> {
    require(!value.trim().is_empty(), message)
}

fn require(condition: bool, message: &str) -> Result<(), ExecutionError> {
    if condition {
        Ok(())
    } else {
        Err(ExecutionError(message.into()))
    }
}
