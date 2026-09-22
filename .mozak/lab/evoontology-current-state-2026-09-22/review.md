# Improvement review: improve-0dcf6d817acd034bb8bafc69

- Scope: `mozak`
- Module: `scope`
- Question: How should MOZAK add a unified, provenance-aware current-state view inspired by EvoOntology without creating a second source of truth or weakening owner approval boundaries?
- Candidates: 150 (150 new, 0 unchanged)
- Read: 1 of 1 selected
- Acceptance: **self-review** (pitfa both performed and accepted this run)

## Objective

produce owner-reviewable implementation plan cards for a unified provenance-aware MOZAK current-state view that combines project workflow state, adapter freshness, and proposal-only research without becoming a second source of truth

Complete when:

- at least one plan card defines a read-only current-state public interface
- the plan separates latest recorded, latest observed, and accepted state
- every plan card has acceptance checks exercised through the installed MOZAK CLI
- the plan preserves fail-closed hashes and owner approval boundaries

Deliberately excluded:

- autonomous promotion of research or plans
- automatic ontology mutation
- replacing Scope, Concept, Translation, or package contracts
- implementing or releasing the proposed changes in this Lab run

## Sources read

- `paper-0060` (preprint, full_text) sha256 `64012dfebd0f351cdb5c80176100c8dc8cc0ece04b938f75290026fe9493a338`

## Proposed mechanisms

### mechanism-layered-current-state

- Change: Derive a read-only current-state projection with separate content, relationship-schema, and presentation-tool layers from already validated MOZAK artifacts.
- Contract: project context and project overview
- Benefit: A single view can connect goals, adapter freshness, research authority, supersession, and next owner decisions without making the projection authoritative.
- Risks: The projection could become a competing source of truth if it stores independent state.; Cross-module relationships could imply authority transfer unless every edge carries provenance and authority.
- Support: claim-evo-three-layers

### mechanism-selective-navigation

- Change: Expose bounded current, browse, resolve, and why operations that retrieve only relevant validated records and explicitly distinguish latest recorded, latest observed, and accepted state.
- Contract: project context public CLI and MCP transport
- Benefit: Agents can answer current-state questions without manually joining project, adapter, KB, and research interfaces or loading the whole KB.
- Risks: Search ranking could be mistaken for recommendation or truth.; A compact response could omit a blocking freshness or authority condition.
- Support: claim-evo-selective-tools, claim-evo-static-layer-risk

### mechanism-owner-gated-improvement

- Change: Record navigation failures, attribute each to content, schema, or tool behavior, propose one localized change, and require paired CLI evaluation plus owner approval before implementation or promotion.
- Contract: Improve Lab evaluation and owner review
- Benefit: MOZAK can learn from failures such as stale-research selection without permitting autonomous self-modification.
- Risks: Synthetic evaluation scenarios may not predict real user benefit.; Poor attribution can optimize the wrong layer.; Evaluation can overfit to one model or workflow.
- Support: claim-evo-attributed-edits, claim-evo-paired-gate, claim-evo-gate-load-bearing

## Implementation plans

### plan-current-state-projection Add a deterministic read-only current-state projection

- Mechanisms: mechanism-layered-current-state
- Deliverable: A core current-state contract derived only from validated project, adapter, KB, and research artifacts
- Deliverable: Typed relationships carrying source path, content hash, freshness, and authority
- Deliverable: No independently stored acceptance, recommendation, or execution state
- Check: Repeated projection over unchanged inputs emits byte-identical JSON
- Check: Changing or removing a pinned source hash causes a fail-closed result rather than stale output
- Check: Every displayed relationship names its authoritative source and authority class
- Check: The projection performs no writes and cannot promote proposal-only evidence

### plan-project-current-cli Expose the smallest useful project current command

- Mechanisms: mechanism-layered-current-state, mechanism-selective-navigation
- Deliverable: A public `mozak project current PROJECT_ID` route
- Deliverable: Bounded sections for goal state, adapter freshness, newest proposal-only research, superseded artifacts, and next owner decision
- Deliverable: Explicit labels for latest recorded, latest observed, and accepted state
- Check: After a newer adapter run exists, the command does not describe an older run as current without a stale warning
- Check: For the MOZAK project it reports no ready goals, the compaction finding, and today's agentic-systems research freshness in one response
- Check: A project with no adapters or research still returns a valid bounded response
- Check: The command output makes no trust transfer or automatic-promotion claim
- Depends on: plan-current-state-projection

### plan-browse-resolve-why Add provenance-aware browse, resolve, and why navigation

- Mechanisms: mechanism-selective-navigation
- Deliverable: Bounded browse over explicitly configured records without filesystem scanning
- Deliverable: Resolve output that follows only declared relationships
- Deliverable: Why output that explains inclusion, freshness, authority, and blocking conditions
- Check: Browse never presents ranking as recommendation, acceptance, or truth
- Check: Resolve refuses stale hashes and undeclared relationships
- Check: Why can explain why today's DAIR run supersedes yesterday's recorded run without accepting either as project knowledge
- Check: Default output remains bounded and does not dump note bodies or the full KB
- Depends on: plan-current-state-projection, plan-project-current-cli

### plan-attributed-improvement-loop Gate future navigation improvements through attributed paired evaluation

- Mechanisms: mechanism-owner-gated-improvement
- Deliverable: A failure record that classifies each observed problem as content, schema, or tool behavior
- Deliverable: A paired before-and-after CLI evaluation format with fixed project inputs
- Deliverable: Owner-review packet that keeps passing proposals non-authoritative
- Check: The stale-DAIR scenario is reproduced through the installed CLI before a proposed change is evaluated
- Check: Only one attributed layer changes per proposal unless dependencies are explicitly justified
- Check: A failed or inconclusive comparison produces no implementation or promotion
- Check: A passing comparison still requires separate owner approval before implementation
- Depends on: plan-project-current-cli

## Limitations

- paper-0060: The source is an arXiv preprint and has not been treated as peer reviewed.
- paper-0060: Its experiments concern data agents, not project-management or provenance frameworks like MOZAK.
- paper-0060: Its self-evolution loop is automatic and backbone-specific, while MOZAK requires owner-gated authority transitions.
- paper-0060: Reported benchmark gains do not establish that the same architecture will improve MOZAK usability.

## Status

Planning only. No MOZAK code was changed. Implementation and promotion require explicit owner authorization.

Validation of this run checked structural conformance to the Lab contract. It did not assess whether the mechanisms are sound or the plans worth implementing, and a valid run is not evidence that they are.
