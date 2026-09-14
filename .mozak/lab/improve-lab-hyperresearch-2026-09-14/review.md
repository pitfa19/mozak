# Improvement review: improve-b72c0ba7d046209c1807e342

- Scope: `topic-agentic-systems`
- Module: `improve-lab`
- Question: Which mechanisms from current deep-research systems should improve MOZAK's planning-only Self Improvement Lab while preserving explicit provenance, bounded evidence, and owner authority?
- Candidates: 12 (12 new, 0 unchanged)
- Read: 1 of 1 selected

## Sources read

- `paper-0006` (documentation, documentation) sha256 `3835bfb67113aa76953c3312f504d214ec0811204da7e5c5993d018b4efa89ff`

## Proposed mechanisms

### m-coverage-contract

- Change: Add a question decomposition artifact that records atomic subquestions, a coverage matrix, and an explicit research tier before candidate selection.
- Contract: lab::ImproveRequest and pre-selection transition
- Benefit: Makes scope coverage reviewable and exposes unanswered subquestions before the Lab proposes mechanisms.
- Risks: More ceremony for small questions; Poor decomposition can create false completeness
- Support: hr-c1, hr-c2

### m-multi-refresh

- Change: Allow one Lab run to ingest multiple validated adapter runs, preserving the exact binding id for each run and deduplicating candidates across sources by content identity.
- Contract: lab::LiteratureRun and lab refresh state machine
- Benefit: Lets DAIR.AI, arXiv, and GitHub evidence answer one improvement question without splitting provenance across disconnected Lab runs.
- Risks: Cross-source identity matching can merge non-equivalent versions; Larger candidate sets increase review cost
- Support: hr-c1, hr-c5

### m-adversarial-gap-loop

- Change: Insert a bounded contradiction and overturning-evidence review after readings and before mechanism extraction, with one optional validated gap-refresh cycle.
- Contract: lab run states between papers_read and mechanisms_extracted
- Benefit: Forces the Lab to seek disconfirming evidence and close high-impact gaps before converting readings into implementation proposals.
- Risks: Can prolong runs; A poorly bounded gap loop can become open-ended research
- Support: hr-c3

### m-claim-verification

- Change: Add a verification artifact that checks each source claim's locator against pinned source bytes and blocks plans with unresolved critical support failures.
- Contract: lab::ReadClaim, readings validation, and review gate
- Benefit: Turns locators from asserted strings into reproducible claim-to-source bindings and prevents unsupported mechanisms from reaching owner review.
- Risks: Full-text access and stable byte addressing are difficult; Version substitutions must be represented explicitly
- Support: hr-c4

### m-resume-recommendation

- Change: Extend Lab status with the exact next accepted command, required input schema, and unresolved blockers derived from the immutable ledger.
- Contract: lab status receipt
- Benefit: Makes interrupted runs straightforward to resume without weakening ordered transitions.
- Risks: A stale recommendation could mislead if external adapter state drifted
- Support: hr-c5

## Implementation plans

### P1 Multi-source literature refresh with exact provenance

- Mechanisms: m-multi-refresh
- Deliverable: LiteratureRun supports multiple AdapterRunRef values
- Deliverable: refresh identifies the actual matching binding instead of always selecting the first
- Deliverable: cross-source dedup accounting and CLI receipts
- Deliverable: tests covering DAIR.AI plus GitHub and rejected adapter/binding mismatches
- Check: A run ingests two validated adapter runs in order and retains both exact binding ids and artifact hashes
- Check: Refreshing with an adapter run that does not match any declared binding fails without advancing or writing partial state
- Check: Duplicate content across sources is represented once while preserving both provenance references

### P2 Question decomposition and coverage contract

- Mechanisms: m-coverage-contract, m-resume-recommendation
- Deliverable: Decomposition artifact schema
- Deliverable: bounded light/full tier rules
- Deliverable: coverage gaps in status and owner review
- Deliverable: exact next-step recommendation in status
- Check: Every atomic subquestion is covered or explicitly marked as a gap before selection completes
- Check: A light-tier run may use a smaller workflow without silently skipping required states
- Check: Status names one valid next command and the predecessor artifact it requires
- Depends on: P1

### P3 Adversarial evidence and claim-verification gate

- Mechanisms: m-adversarial-gap-loop, m-claim-verification
- Deliverable: Contradiction and overturning-source review artifact
- Deliverable: single bounded gap-refresh transition
- Deliverable: claim-to-pinned-bytes verification artifact
- Deliverable: critical support failure gate in review
- Check: A mechanism supported only by a claim whose locator cannot be reproduced is rejected
- Check: One bounded gap refresh can add evidence while a second loop is refused unless a new run is opened
- Check: The owner packet lists unresolved contradictions, source limitations, and verification failures
- Check: Temporary full text is deleted while hashes, locators, and verification results remain reproducible
- Depends on: P1, P2

## Limitations

- paper-0006: Repository documentation is self-authored and not independent validation of effectiveness.
- paper-0006: The GitHub adapter retained only repository metadata; README v0.11.1 was read separately and is identified by tag and section locators, but its byte hash is not pinned by the Lab candidate contract.
- paper-0006: The headline benchmark claim is internally benchmarked and explicitly awaits third-party validation.
- paper-0006: HyperResearch retains full source text persistently, while MOZAK's Lab requires temporary full text and must adapt mechanisms without copying that retention policy.

## Status

Planning only. No MOZAK code was changed. Implementation and promotion require explicit owner authorization.
