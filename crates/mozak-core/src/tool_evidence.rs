//! Source-neutral recording of one MCP, CLI, skill, or API tool call as
//! proposal-only research evidence.
//!
//! The six legacy adapters each own a source-specific fixture shape. This
//! module records any read-only tool call through one closed shape instead,
//! `mozak.tool-evidence.v1`, and derives an ordinary [`ResearchRun`] from it so
//! `research validate` and `research landmarks` keep working unchanged.
//!
//! Three properties are enforced rather than documented:
//!
//! - Provenance is exact. The tool identity and pinned version, the canonical
//!   call arguments and their hash, the call window, every locator, and the
//!   SHA-256 and length of the exact response bytes are pinned. Each retained
//!   excerpt must equal its byte range inside those response bytes.
//! - Retention is selective. The full response is hashed and discarded; only
//!   bounded owner-selected excerpts persist, as immutable untrusted data.
//! - Authority is proposal-only. A recording is never accepted, every claim is
//!   at most qualified, and a call that declares an external write, mutation,
//!   irreversible effect, or pending owner approval is refused. No field can
//!   declare a call "safe" to bypass those checks, because unknown fields are
//!   refused outright.
//!
//! The derived run embeds its canonical fixture, so `research validate` alone
//! re-derives the whole run and detects any edit to it. MOZAK performs no
//! networking here: the tool ran outside MOZAK and this module only validates
//! what it returned.

use crate::research::{AdapterEffects, CONTRACT_VERSION};
use crate::research::{
    ArtifactKind, AuditArtifact, ClaimStatus, EvidenceRecord, EvidenceStance, GapImpact, GapRecord,
    OutputAuthority, OverallClaim, PipelineBudgets, PipelineManifest, PipelineStage, PlanArtifact,
    RawRecord, RawTrust, ResearchClaim, ResearchError, ResearchRun, RunReceipt, RunStatus,
    ScopeArtifact, SourceProfile, StageOperation, SynthesisArtifact, canonical_json_bytes,
    deterministic_run_id, require, run_artifact_hash, sha256_hex, validate_identifier,
    validate_sha256, validate_timestamp,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeSet;

/// The exact schema identifier a tool-evidence fixture must declare.
pub const TOOL_EVIDENCE_SCHEMA: &str = "mozak.tool-evidence.v1";
/// Adapter id written into every derived run receipt.
pub const TOOL_EVIDENCE_ADAPTER_ID: &str = "adapter-tool-evidence-v1";
/// Source profile id of every derived run.
pub const TOOL_EVIDENCE_SOURCE_PROFILE_ID: &str = "source-tool-evidence-v1";
/// Pipeline id of every derived run.
pub const TOOL_EVIDENCE_PIPELINE_ID: &str = "pipeline-tool-evidence-v1";
/// URI prefix of every raw record in a derived run.
pub const TOOL_EVIDENCE_URI_PREFIX: &str = "recorded:tool-evidence:";

/// Maximum retained selections per recording.
pub const MAX_SELECTIONS: usize = 32;
/// Maximum bytes of one retained excerpt.
pub const MAX_EXCERPT_BYTES: usize = 2_000;
/// Maximum bytes of all retained excerpts together.
pub const MAX_TOTAL_EXCERPT_BYTES: usize = 8_000;
/// Maximum bytes of the exact response the excerpts are taken from.
pub const MAX_RESPONSE_BYTES: u64 = 16 * 1024 * 1024;
/// Maximum canonical bytes of the call arguments.
pub const MAX_ARGUMENT_BYTES: usize = 8_192;
/// Maximum canonical bytes of the whole fixture.
pub const MAX_FIXTURE_BYTES: usize = 49_152;
/// Maximum caller-declared gaps.
pub const MAX_GAPS: usize = 16;

const PROVENANCE_RECORD_ID: &str = "raw-provenance";
const MAX_RECORD_BYTES: u64 = 65_536;
const RESERVED_GAPS: [&str; 3] = [
    "gap-tool-output-untrusted",
    "gap-selected-excerpts-only",
    "gap-truncated",
];
const CREDENTIAL_KEY_MARKERS: [&str; 13] = [
    "token",
    "secret",
    "password",
    "passwd",
    "api_key",
    "apikey",
    "api-key",
    "authorization",
    "cookie",
    "credential",
    "private_key",
    "privatekey",
    "session",
];

/// A recorded tool call. Closed shape: unknown fields are refused.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ToolEvidenceFixture {
    pub schema: String,
    pub scope_id: String,
    pub question: String,
    pub tool: ToolIdentity,
    pub call: ToolCall,
    pub effects: AdapterEffects,
    pub response: ResponsePin,
    pub selections: Vec<Selection>,
    pub total_results: u64,
    pub truncated: bool,
    pub gaps: Vec<GapRecord>,
    pub accepted: bool,
    pub authority: String,
}

/// Which tool ran, at which exact version.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ToolIdentity {
    /// Catalog tool id, so a recording links to the shipped tool catalog.
    pub tool_id: String,
    pub kind: ToolKind,
    /// Exact released version observed when the call ran.
    pub version: String,
    /// The tool operation invoked, for example an MCP tool name.
    pub operation: String,
    /// MCP server name; required for `mcp` and absent otherwise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server: Option<String>,
}

/// The kind of tool that produced the response.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ToolKind {
    Mcp,
    Cli,
    Skill,
    Api,
    Other,
}

impl ToolKind {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Mcp => "mcp",
            Self::Cli => "cli",
            Self::Skill => "skill",
            Self::Api => "api",
            Self::Other => "other",
        }
    }
}

/// The exact call: arguments and the window in which it ran.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ToolCall {
    pub arguments: Value,
    pub started_at: String,
    pub finished_at: String,
}

/// Pin of the exact response bytes. The bytes themselves are not retained.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ResponsePin {
    pub sha256: String,
    pub byte_length: u64,
    pub media_type: String,
}

/// One retained excerpt and the exact response byte range it was taken from.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Selection {
    pub id: String,
    /// `scheme:rest` locator of the source the excerpt describes.
    pub locator: String,
    pub response_byte_start: u64,
    pub response_byte_end: u64,
    pub excerpt: String,
}

/// Parses a fixture, checks it against the exact response bytes, and derives
/// a validated proposal-only research run.
///
/// # Errors
/// Fails closed on malformed or unknown fields, a schema or contract
/// violation, response hash or length drift, an excerpt that differs from its
/// response range, unsafe declared effects, or a false acceptance claim.
pub fn record_tool_evidence(
    fixture_json: &str,
    response: &[u8],
) -> Result<ResearchRun, ResearchError> {
    let fixture = parse_fixture(fixture_json)?;
    validate_fixture(&fixture)?;
    validate_against_response(&fixture, response)?;
    let run = derive_run(&fixture)?;
    crate::research::validate_run(&run)?;
    Ok(run)
}

/// Re-derives a run from a fixture and the exact response bytes and requires
/// it to equal the stored run exactly.
///
/// # Errors
/// Fails closed when the stored run is invalid, when the fixture or response
/// no longer validates, or when any byte of the stored run differs from the
/// re-derived run.
pub fn verify_tool_evidence(
    fixture_json: &str,
    response: &[u8],
    stored: &ResearchRun,
) -> Result<(), ResearchError> {
    crate::research::validate_run(stored)?;
    let derived = record_tool_evidence(fixture_json, response)?;
    require(
        &derived == stored,
        "stored tool-evidence run does not match the run re-derived from its fixture and response",
    )
}

/// Parses a fixture with its closed shape.
///
/// # Errors
/// Returns an error for malformed JSON or unknown fields.
pub fn parse_fixture(fixture_json: &str) -> Result<ToolEvidenceFixture, ResearchError> {
    serde_json::from_str(fixture_json)
        .map_err(|error| ResearchError(format!("invalid tool-evidence fixture: {error}")))
}

/// Whether a run claims any tool-evidence identity marker. Such a run must
/// pass [`validate_tool_evidence_run`]; no legacy adapter uses these markers.
#[must_use]
pub fn claims_tool_evidence_identity(run: &ResearchRun) -> bool {
    run.receipt.adapter_id == TOOL_EVIDENCE_ADAPTER_ID
        || run.source_profile.id == TOOL_EVIDENCE_SOURCE_PROFILE_ID
        || run.pipeline.id == TOOL_EVIDENCE_PIPELINE_ID
        || run
            .raw_records
            .iter()
            .any(|record| record.source_uri.starts_with(TOOL_EVIDENCE_URI_PREFIX))
}

/// Validates a tool-evidence run by re-deriving it from the canonical fixture
/// embedded in its provenance record.
///
/// # Errors
/// Fails closed when the provenance record is missing or malformed, the
/// embedded fixture no longer validates, or the run differs from its
/// re-derivation in any field.
pub fn validate_tool_evidence_run(run: &ResearchRun) -> Result<(), ResearchError> {
    let provenance = run
        .raw_records
        .iter()
        .find(|record| record.id == PROVENANCE_RECORD_ID)
        .ok_or_else(|| {
            ResearchError("tool-evidence run is missing its provenance record".into())
        })?;
    let line = provenance
        .content
        .lines()
        .last()
        .and_then(|line| line.strip_prefix("fixture: "))
        .ok_or_else(|| {
            ResearchError("tool-evidence provenance record does not embed its fixture".into())
        })?;
    let fixture = parse_fixture(line)?;
    validate_fixture(&fixture)?;
    let derived = derive_run(&fixture)?;
    require(
        &derived == run,
        "tool-evidence run does not match the run re-derived from its embedded fixture",
    )
}

/// Validates every fixture rule that does not need the response bytes.
///
/// # Errors
/// Returns the first deterministic contract violation.
pub fn validate_fixture(fixture: &ToolEvidenceFixture) -> Result<(), ResearchError> {
    require(
        fixture.schema == TOOL_EVIDENCE_SCHEMA,
        "tool-evidence schema must be mozak.tool-evidence.v1",
    )?;
    require(
        !fixture.accepted,
        "a tool-evidence recording must not claim acceptance; acceptance is a separate owner decision",
    )?;
    require(
        fixture.authority == "proposal_only",
        "a tool-evidence recording authority must be proposal_only",
    )?;
    validate_slug(&fixture.scope_id, "scope_id", false)?;
    bounded_text(&fixture.question, "question", 1_000)?;
    validate_tool(&fixture.tool)?;
    validate_call(&fixture.call)?;
    validate_effects(&fixture.effects)?;
    validate_response_pin(&fixture.response)?;
    validate_selections(fixture)?;
    validate_gaps(&fixture.gaps)?;
    let canonical = canonical_fixture(fixture)?;
    require(
        canonical.len() <= MAX_FIXTURE_BYTES,
        "tool-evidence fixture exceeds its canonical byte bound",
    )
}

fn validate_tool(tool: &ToolIdentity) -> Result<(), ResearchError> {
    validate_slug(&tool.tool_id, "tool.tool_id", true)?;
    validate_version(&tool.version)?;
    validate_token(&tool.operation, "tool.operation")?;
    match (tool.kind, &tool.server) {
        (ToolKind::Mcp, Some(server)) => validate_token(server, "tool.server"),
        (ToolKind::Mcp, None) => Err(ResearchError(
            "an mcp tool must name its server in tool.server".into(),
        )),
        (_, Some(_)) => Err(ResearchError(
            "tool.server is only valid for an mcp tool".into(),
        )),
        (_, None) => Ok(()),
    }
}

fn validate_version(version: &str) -> Result<(), ResearchError> {
    require(
        !version.is_empty()
            && version.len() <= 64
            && version.bytes().all(|byte| {
                byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'+' | b'_')
            })
            && version.bytes().any(|byte| byte.is_ascii_digit()),
        "tool.version must be an exact pinned version such as 0.8.1",
    )?;
    let lower = version.to_ascii_lowercase();
    require(
        !matches!(
            lower.as_str(),
            "latest" | "unknown" | "head" | "main" | "master" | "dev"
        ),
        "tool.version must be an exact pinned version, not a moving label",
    )
}

fn validate_call(call: &ToolCall) -> Result<(), ResearchError> {
    require(
        call.arguments.is_object(),
        "call.arguments must be a JSON object",
    )?;
    reject_credentials(&call.arguments, "call.arguments")?;
    require(
        canonical_json_bytes(&call.arguments).len() <= MAX_ARGUMENT_BYTES,
        "call.arguments exceed their canonical byte bound",
    )?;
    validate_instant(&call.started_at, "call.started_at")?;
    validate_instant(&call.finished_at, "call.finished_at")?;
    require(
        call.started_at <= call.finished_at,
        "call.started_at must not follow call.finished_at",
    )
}

/// Refuses argument keys or values that look like credentials, so a recording
/// can never persist a secret that was passed to the tool.
fn reject_credentials(value: &Value, path: &str) -> Result<(), ResearchError> {
    match value {
        Value::Object(entries) => {
            for (key, nested) in entries {
                let lower = key.to_ascii_lowercase();
                require(
                    !CREDENTIAL_KEY_MARKERS
                        .iter()
                        .any(|marker| lower.contains(marker)),
                    &format!("{path} must not carry credential-like key {key}"),
                )?;
                reject_credentials(nested, &format!("{path}.{key}"))?;
            }
            Ok(())
        }
        Value::Array(items) => items
            .iter()
            .try_for_each(|item| reject_credentials(item, path)),
        Value::String(text) => {
            let lower = text.trim_start().to_ascii_lowercase();
            require(
                !lower.starts_with("bearer ") && !lower.starts_with("basic "),
                &format!("{path} must not carry an authorization value"),
            )
        }
        _ => Ok(()),
    }
}

fn validate_effects(effects: &AdapterEffects) -> Result<(), ResearchError> {
    require(
        effects.external_writes.is_empty(),
        "a recorded tool call must not declare external writes",
    )?;
    require(
        effects.mutations_performed == "none",
        "a recorded tool call must not declare mutations",
    )?;
    require(
        effects.irreversible_effects.is_empty(),
        "a recorded tool call must not declare irreversible effects",
    )?;
    require(
        !effects.owner_approval_required,
        "a tool call needing owner approval must not be recorded as research evidence",
    )
}

fn validate_response_pin(pin: &ResponsePin) -> Result<(), ResearchError> {
    validate_sha256(&pin.sha256, "response.sha256")?;
    require(
        pin.byte_length > 0 && pin.byte_length <= MAX_RESPONSE_BYTES,
        "response.byte_length must be positive and within the response bound",
    )?;
    require(
        !pin.media_type.is_empty()
            && pin.media_type.len() <= 128
            && pin
                .media_type
                .bytes()
                .all(|byte| byte.is_ascii_graphic() || byte == b' '),
        "response.media_type must be a bounded printable media type",
    )
}

fn validate_selections(fixture: &ToolEvidenceFixture) -> Result<(), ResearchError> {
    require(
        !fixture.selections.is_empty() && fixture.selections.len() <= MAX_SELECTIONS,
        "a tool-evidence recording must retain between 1 and 32 selections",
    )?;
    let mut ids = BTreeSet::new();
    let mut locators = BTreeSet::new();
    let mut total = 0_usize;
    for selection in &fixture.selections {
        validate_identifier(&selection.id, "selection id", "sel-")?;
        require(selection.id.len() <= 64, "selection id is too long")?;
        require(ids.insert(selection.id.as_str()), "duplicate selection id")?;
        validate_locator(&selection.locator)?;
        locators.insert(selection.locator.as_str());
        require(
            selection.response_byte_start < selection.response_byte_end
                && selection.response_byte_end <= fixture.response.byte_length,
            &format!(
                "selection {} has an invalid response byte range",
                selection.id
            ),
        )?;
        let length = usize::try_from(selection.response_byte_end - selection.response_byte_start)
            .map_err(|_| ResearchError("selection range overflow".into()))?;
        require(
            selection.excerpt.len() == length,
            &format!(
                "selection {} excerpt length disagrees with its byte range",
                selection.id
            ),
        )?;
        require(
            length <= MAX_EXCERPT_BYTES,
            &format!("selection {} excerpt exceeds 2000 bytes", selection.id),
        )?;
        require(
            !selection.excerpt.trim().is_empty(),
            &format!("selection {} excerpt must not be blank", selection.id),
        )?;
        total += length;
    }
    require(
        total <= MAX_TOTAL_EXCERPT_BYTES,
        "retained excerpts exceed 8000 bytes in total; record hashes, not full responses",
    )?;
    let distinct = u64::try_from(locators.len())
        .map_err(|_| ResearchError("locator count overflow".into()))?;
    require(
        distinct <= fixture.total_results,
        "selections cite more distinct locators than total_results",
    )
}

fn validate_against_response(
    fixture: &ToolEvidenceFixture,
    response: &[u8],
) -> Result<(), ResearchError> {
    let length = u64::try_from(response.len())
        .map_err(|_| ResearchError("response length overflow".into()))?;
    require(
        length == fixture.response.byte_length,
        "response byte length does not match the pinned response.byte_length",
    )?;
    require(
        sha256_hex(response) == fixture.response.sha256,
        "response bytes do not match the pinned response.sha256",
    )?;
    for selection in &fixture.selections {
        let start = usize::try_from(selection.response_byte_start)
            .map_err(|_| ResearchError("selection range overflow".into()))?;
        let end = usize::try_from(selection.response_byte_end)
            .map_err(|_| ResearchError("selection range overflow".into()))?;
        require(
            &response[start..end] == selection.excerpt.as_bytes(),
            &format!(
                "selection {} excerpt does not equal its response byte range",
                selection.id
            ),
        )?;
    }
    Ok(())
}

fn validate_gaps(gaps: &[GapRecord]) -> Result<(), ResearchError> {
    require(gaps.len() <= MAX_GAPS, "too many declared gaps")?;
    let mut ids = BTreeSet::new();
    for gap in gaps {
        validate_identifier(&gap.id, "gap id", "gap-")?;
        require(
            !RESERVED_GAPS.contains(&gap.id.as_str()),
            &format!(
                "gap id {} is reserved for MOZAK-derived disclosures",
                gap.id
            ),
        )?;
        require(ids.insert(gap.id.as_str()), "duplicate gap id")?;
        bounded_text(&gap.description, "gap description", 1_000)?;
    }
    Ok(())
}

fn validate_slug(value: &str, field: &str, allow_dots: bool) -> Result<(), ResearchError> {
    require(
        !value.is_empty()
            && value.len() <= 128
            && value.as_bytes()[0].is_ascii_alphanumeric()
            && value.bytes().all(|byte| {
                byte.is_ascii_lowercase()
                    || byte.is_ascii_digit()
                    || byte == b'-'
                    || (allow_dots && matches!(byte, b'.' | b'_'))
            }),
        &format!("{field} has invalid identifier syntax"),
    )
}

fn validate_token(value: &str, field: &str) -> Result<(), ResearchError> {
    require(
        !value.is_empty()
            && value.len() <= 128
            && value.bytes().all(|byte| {
                byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.' | b'/' | b':')
            }),
        &format!("{field} has invalid syntax"),
    )
}

fn validate_locator(locator: &str) -> Result<(), ResearchError> {
    let valid = locator.len() <= 512
        && locator.bytes().all(|byte| byte.is_ascii_graphic())
        && locator.split_once(':').is_some_and(|(scheme, rest)| {
            !rest.is_empty()
                && scheme
                    .as_bytes()
                    .first()
                    .is_some_and(u8::is_ascii_lowercase)
                && scheme.bytes().all(|byte| {
                    byte.is_ascii_lowercase()
                        || byte.is_ascii_digit()
                        || matches!(byte, b'+' | b'.' | b'-')
                })
        });
    require(
        valid,
        &format!("selection locator {locator} must be a printable scheme:rest locator"),
    )
}

fn bounded_text(value: &str, field: &str, max: usize) -> Result<(), ResearchError> {
    require(
        !value.trim().is_empty() && value.len() <= max,
        &format!("{field} must be non-empty and at most {max} bytes"),
    )
}

/// Strict UTC instant that is also a real calendar time.
fn validate_instant(value: &str, field: &str) -> Result<(), ResearchError> {
    validate_timestamp(value, field)?;
    let number =
        |range: std::ops::Range<usize>| -> u32 { value[range].parse().unwrap_or(u32::MAX) };
    let (year, month, day) = (number(0..4), number(5..7), number(8..10));
    let (hour, minute, second) = (number(11..13), number(14..16), number(17..19));
    let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
    let days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => 0,
    };
    require(
        year >= 1970 && day >= 1 && day <= days && hour < 24 && minute < 60 && second < 60,
        &format!("{field} is not a real calendar UTC instant"),
    )
}

fn canonical_fixture(fixture: &ToolEvidenceFixture) -> Result<Vec<u8>, ResearchError> {
    let value = serde_json::to_value(fixture)
        .map_err(|error| ResearchError(format!("cannot serialize fixture: {error}")))?;
    Ok(canonical_json_bytes(&value))
}

fn pipeline_revision() -> String {
    sha256_hex(format!("{TOOL_EVIDENCE_SCHEMA}\n{TOOL_EVIDENCE_PIPELINE_ID}").as_bytes())
}

fn selection_suffix(selection: &Selection) -> &str {
    selection.id.strip_prefix("sel-").unwrap_or(&selection.id)
}

/// Derives the canonical run. Callers validate the fixture first; this does
/// not call `validate_run`, which itself re-derives through here.
#[allow(clippy::too_many_lines)]
fn derive_run(fixture: &ToolEvidenceFixture) -> Result<ResearchRun, ResearchError> {
    let canonical = canonical_fixture(fixture)?;
    let canonical_text = String::from_utf8(canonical.clone())
        .map_err(|_| ResearchError("canonical fixture is not UTF-8".into()))?;
    let input_hash = sha256_hex(&canonical);
    let revision = pipeline_revision();
    let run_id = deterministic_run_id(&fixture.call.finished_at, &revision, &input_hash)?;
    let tool = &fixture.tool;
    let arguments_sha256 = sha256_hex(&canonical_json_bytes(&fixture.call.arguments));

    let provenance_content = format!(
        "schema: {TOOL_EVIDENCE_SCHEMA}\n\
         tool_id: {}\n\
         tool_kind: {}\n\
         tool_version: {}\n\
         tool_server: {}\n\
         operation: {}\n\
         call_arguments_sha256: {arguments_sha256}\n\
         call_started_at: {}\n\
         call_finished_at: {}\n\
         response_sha256: {}\n\
         response_byte_length: {}\n\
         response_media_type: {}\n\
         scope_id: {}\n\
         accepted: false\n\
         authority: proposal_only\n\
         retention: provenance, hashes and selected excerpts only; full response not retained\n\
         fixture: {canonical_text}",
        tool.tool_id,
        tool.kind.as_str(),
        tool.version,
        tool.server.as_deref().unwrap_or("none"),
        tool.operation,
        fixture.call.started_at,
        fixture.call.finished_at,
        fixture.response.sha256,
        fixture.response.byte_length,
        fixture.response.media_type,
        fixture.scope_id,
    );
    let mut raw_records = vec![RawRecord {
        id: PROVENANCE_RECORD_ID.into(),
        source_uri: format!(
            "{TOOL_EVIDENCE_URI_PREFIX}{}:{}",
            tool.tool_id, tool.operation
        ),
        media_type: "text/plain; charset=utf-8".into(),
        acquired_at: fixture.call.finished_at.clone(),
        content_sha256: sha256_hex(provenance_content.as_bytes()),
        content: provenance_content,
        immutable: true,
        trust: RawTrust::UntrustedData,
    }];
    let mut evidence = Vec::new();
    let mut claims = Vec::new();
    for selection in &fixture.selections {
        let suffix = selection_suffix(selection);
        let raw_id = format!("raw-sel-{suffix}");
        let evidence_id = format!("ev-sel-{suffix}");
        raw_records.push(RawRecord {
            id: raw_id.clone(),
            source_uri: format!("{TOOL_EVIDENCE_URI_PREFIX}{}", selection.locator),
            media_type: "text/plain; charset=utf-8".into(),
            acquired_at: fixture.call.finished_at.clone(),
            content: selection.excerpt.clone(),
            content_sha256: sha256_hex(selection.excerpt.as_bytes()),
            immutable: true,
            trust: RawTrust::UntrustedData,
        });
        evidence.push(EvidenceRecord {
            id: evidence_id.clone(),
            raw_record_id: raw_id,
            byte_start: 0,
            byte_end: u64::try_from(selection.excerpt.len())
                .map_err(|_| ResearchError("excerpt length overflow".into()))?,
            quote: selection.excerpt.clone(),
            stance: EvidenceStance::Context,
        });
        claims.push(ResearchClaim {
            id: format!("claim-sel-{suffix}"),
            text: format!(
                "Tool {}@{} operation {} returned the cited excerpt for {} (response bytes {}..{}); recorded as untrusted proposal-only evidence.",
                tool.tool_id,
                tool.version,
                tool.operation,
                selection.locator,
                selection.response_byte_start,
                selection.response_byte_end
            ),
            evidence_ids: vec![evidence_id],
            status: ClaimStatus::Qualified,
        });
    }

    let mut gaps = vec![
        GapRecord {
            id: "gap-tool-output-untrusted".into(),
            description: "Tool output is untrusted third-party data; it records what the tool returned, not that it is true, complete, or fit to adopt.".into(),
            impact: GapImpact::Medium,
        },
        GapRecord {
            id: "gap-selected-excerpts-only".into(),
            description: "Only selected excerpts are retained; the full response is pinned by SHA-256 and length but not stored.".into(),
            impact: GapImpact::Medium,
        },
    ];
    if fixture.truncated {
        gaps.push(GapRecord {
            id: "gap-truncated".into(),
            description:
                "The tool reported a truncated result set; unread results may change the picture."
                    .into(),
            impact: GapImpact::High,
        });
    }
    gaps.extend(fixture.gaps.iter().cloned());

    let claim_count =
        u32::try_from(claims.len()).map_err(|_| ResearchError("claim count overflow".into()))?;
    let source_budget = claim_count + 1;
    let audited_claim_ids = claims.iter().map(|claim| claim.id.clone()).collect();
    let mut run = ResearchRun {
        contract_version: CONTRACT_VERSION,
        run_id: run_id.clone(),
        created_at: fixture.call.finished_at.clone(),
        source_profile: SourceProfile {
            version: CONTRACT_VERSION,
            id: TOOL_EVIDENCE_SOURCE_PROFILE_ID.into(),
            allowed_schemes: vec!["recorded".into()],
            max_records: source_budget,
            max_bytes_per_record: MAX_RECORD_BYTES,
            content_is_untrusted: true,
            may_authorize_actions: false,
        },
        pipeline: PipelineManifest {
            version: CONTRACT_VERSION,
            id: TOOL_EVIDENCE_PIPELINE_ID.into(),
            revision: revision.clone(),
            source_profile_id: TOOL_EVIDENCE_SOURCE_PROFILE_ID.into(),
            stages: [
                ("stage-acquire", StageOperation::Acquire),
                ("stage-evidence", StageOperation::ExtractEvidence),
                ("stage-gaps", StageOperation::IdentifyGaps),
                ("stage-synthesis", StageOperation::Synthesize),
                ("stage-audit", StageOperation::Audit),
            ]
            .into_iter()
            .map(|(id, operation)| PipelineStage {
                id: id.into(),
                operation,
            })
            .collect(),
            budgets: PipelineBudgets {
                max_sources: source_budget,
                max_raw_bytes: MAX_RECORD_BYTES * u64::from(source_budget),
                max_claims: claim_count,
                max_planning_inputs: claim_count,
            },
            required_artifacts: vec![
                ArtifactKind::Scope,
                ArtifactKind::Plan,
                ArtifactKind::RawRecords,
                ArtifactKind::Evidence,
                ArtifactKind::Gaps,
                ArtifactKind::Synthesis,
                ArtifactKind::Audit,
                ArtifactKind::Receipt,
            ],
            output_authority: OutputAuthority {
                planning_inputs_are_proposals: true,
                may_mutate_accepted_plans: false,
            },
        },
        scope: ScopeArtifact {
            question: fixture.question.clone(),
            included: vec![
                format!("scope:{}", fixture.scope_id),
                format!("tool:{}@{}", tool.tool_id, tool.version),
                format!("operation:{}", tool.operation),
            ],
            excluded: vec![
                "full response bytes (pinned by hash only)".into(),
                "unselected response content".into(),
            ],
        },
        plan: PlanArtifact {
            steps: vec![
                "record tool identity, version, call arguments and call window".into(),
                "pin the exact response bytes by SHA-256 and length".into(),
                "retain selected excerpts as immutable untrusted data".into(),
                "audit every claim against its excerpt".into(),
            ],
            source_profile_id: TOOL_EVIDENCE_SOURCE_PROFILE_ID.into(),
            pipeline_id: TOOL_EVIDENCE_PIPELINE_ID.into(),
        },
        raw_records,
        evidence,
        gaps,
        synthesis: SynthesisArtifact {
            summary: format!(
                "Proposal-only record of {}@{} {} with {} selected excerpt(s); nothing is accepted.",
                tool.tool_id, tool.version, tool.operation, claim_count
            ),
            claims,
            overall_claim: OverallClaim::Qualified,
        },
        audit: AuditArtifact {
            failures: Vec::new(),
            audited_claim_ids,
        },
        receipt: RunReceipt {
            run_id,
            pipeline_id: TOOL_EVIDENCE_PIPELINE_ID.into(),
            pipeline_revision: revision,
            adapter_id: TOOL_EVIDENCE_ADAPTER_ID.into(),
            started_at: fixture.call.started_at.clone(),
            finished_at: fixture.call.finished_at.clone(),
            input_hash,
            artifact_hash: String::new(),
            capabilities: vec!["record-tool-evidence".into(), "read-only".into()],
            status: RunStatus::Qualified,
        },
    };
    run.receipt.artifact_hash = run_artifact_hash(&run)?;
    Ok(run)
}
