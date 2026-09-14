# Improvement review: improve-77388f6038bb61bcacbc6ef6

- Scope: `topic-agentic-systems`
- Module: `improve-lab`
- Question: Which mechanisms from current research on self-improving harnesses, evaluation lifecycles and agent memory should improve MOZAK's Improve Lab and its evidence contracts?
- Candidates: 20 (20 new, 0 unchanged)
- Read: 4 of 4 selected

## Sources read

- `paper-0004` (preprint, full_text) sha256 `275bc502387f256e3257ffe8cbb107e8e1a634e7dd0e3c1a621c11ecccfb8e98`
- `paper-0012` (peer_reviewed, full_text) sha256 `b75b07b0bb8613b6551d527946b46ccf02b57c9d6d93d771ad19d7f794a86265`
- `paper-0000` (preprint, full_text) sha256 `0d385bca74463b13e613f68c2b32658923821fd151d9bd66fac2ab2920160642`
- `paper-0015` (preprint, full_text) sha256 `29d3c59d32c7a284f58903b630efe61d85b4fec84e6ffedeceaffec8a7ae6fc4`

## Proposed mechanisms

### m-evidence-state-carry

- Change: Give a Scope a durable evidence state, separate from its accepted inputs, recording which claims were checked and held, which remain unsupported, and which observed failures are still open. A later Lab run or planning decision reads that state rather than reconstructing it from artifacts.
- Contract: scope::Scope and a new evidence-state artifact read by lab::ImproveRequest
- Benefit: Stops each run from rebuilding project knowledge out of whatever files survived. MOZAK already carries the artifact side well; it carries almost nothing about what was already checked and found wanting.
- Risks: Evidence state can rot into a second source of truth that disagrees with the artifacts; It must not become an accepted-input back door that skips the owner gate
- Support: hoh-c1, hoh-c2

### m-validated-becomes-preservation

- Change: When a Lab run records a claim as verified, emit it as a named preservation requirement that later plan cards must either honour or explicitly retire with a reason.
- Contract: lab::ReadClaim to a preservation list consumed by lab::ImplementationPlan
- Benefit: Turns evidence into a constraint on future work instead of a note that only informed one decision. Regression becomes a contract violation rather than an oversight.
- Risks: Accumulated preservation requirements can ossify the design; A wrongly verified claim becomes a wrongly binding constraint
- Support: hoh-c5, hoh-c1

### m-independent-acceptance-role

- Change: Record acceptance as produced by a role that did not author the artifact, and make the Lab packet state plainly when author and acceptor are the same. Where they are the same, the run is labelled self-reviewed and cannot claim independent acceptance.
- Contract: lab::Readings and the review packet, mirroring case_study::ReviewKind
- Benefit: MOZAK already enforces this for case records but not for Lab runs, so a Lab run can currently self-accept without the packet saying so. This closes that asymmetry.
- Risks: A solo owner cannot always supply an independent acceptor, so the honest label will often be self_review; Labelling is not the same as achieving independence
- Support: hoh-c3, jl-c1

### m-bounded-objective-per-run

- Change: Require a Lab run to declare one bounded objective with observable completion conditions before selection, and record what it deliberately excludes.
- Contract: lab::ImproveRequest, a pre-selection transition
- Benefit: Scope is currently a free-text question, so a run can drift or quietly widen. An explicit objective plus exclusions makes the boundary reviewable at the start rather than inferable at the end.
- Risks: Over-narrow objectives can miss the connection that mattered; More ceremony for a small question
- Support: hoh-c4

### m-gate-lifecycle

- Change: Treat MOZAK's acceptance gates as versioned artifacts with recorded criteria and a change history, rather than as fixed code. Each gate states what it checks, when its criteria last changed, and why.
- Contract: the validation surfaces across lab, research and planning
- Benefit: A gate whose criteria are implicit cannot be audited or deliberately revised. Recording them makes the evaluator itself reviewable.
- Risks: Versioned criteria invite drift between the recorded criterion and the implemented check; The record must not become a substitute for the check
- Support: jl-c1, jl-c2, jl-c3

### m-paired-mechanism-trial

- Change: Before promoting a mechanism, record a paired observation of the same bounded task performed with and without it, holding the agent, harness, environment and grader fixed, and report the difference as the mechanism's contribution.
- Contract: case_study::CaseControl and a promotion gate for lab mechanisms
- Benefit: MOZAK currently has no way to tell a mechanism that helps from one that merely sounds right. The case contract already demands a comparable control; this extends that demand to Lab mechanisms.
- Risks: A contract-level mechanism's value appears over many runs, so one paired trial may be uninformative; Paired trials are expensive and could discourage recording anything
- Support: sl-c1, sl-c3, sl-c4

### m-structural-checks-are-not-outcome

- Change: State in the Lab packet and in research receipts that contract validation measures structural conformance only, and that it is a weak predictor of whether the recorded work was useful.
- Contract: lab review packet and research validation receipts
- Benefit: MOZAK's validators are structural. A reader who takes a valid receipt as evidence of quality is making exactly the conflation the ACES correlation of 0.14 measured.
- Risks: Repeated disclaimers dilute attention; Understating validation's value could discourage its use
- Support: sl-c2, sl-c3

### m-fixed-meta-operation

- Change: Keep the Lab's own contract fixed within a run and let successive runs recurse on accumulated evidence instead. A run that proposes changing the Lab contract must stop at review and be implemented by a separately authorized phase, never applied by the run that proposed it.
- Contract: lab run state machine and the improve-lab module boundary
- Benefit: This is already MOZAK's behaviour, and Meta^n explains why it is the stable choice: a system that edits its own editing machinery must hold part of it fixed. Recording the reason turns an accident of design into a defended invariant.
- Risks: Fixing the meta-operation caps how fast the Lab can improve itself; The invariant must be stated where someone would otherwise remove it
- Support: mn-c1, mn-c2, mn-c4

## Implementation plans

### D1 Scope evidence state that survives between runs

- Mechanisms: m-evidence-state-carry, m-validated-becomes-preservation
- Deliverable: An evidence-state artifact owned by a Scope, separate from accepted inputs
- Deliverable: Entries carrying claim, status of held, unsupported or open failure, and the run that recorded it
- Deliverable: lab start reads existing evidence state and reports what is already known
- Deliverable: Verified claims emit named preservation requirements
- Deliverable: Tests covering carry-forward, contradiction between runs, and the owner-gate boundary
- Check: A second Lab run on the same Scope reads the first run's evidence state instead of starting empty
- Check: A claim recorded as verified appears as a preservation requirement in a later run's packet
- Check: Evidence state cannot become an accepted planning input without the ordinary owner approval
- Check: A later run recording a claim that contradicts an earlier held claim is surfaced rather than silently overwriting it

### D2 Honest acceptance labelling in Lab runs

- Mechanisms: m-independent-acceptance-role, m-structural-checks-are-not-outcome
- Deliverable: performed_by and evaluated_by fields on a Lab run, mirroring the case contract
- Deliverable: The review packet states self_review when the two match
- Deliverable: Validation receipts state that they check structural conformance only
- Deliverable: Tests asserting a run cannot claim independent acceptance when author and acceptor are the same
- Check: A run whose author and acceptor are the same is labelled self_review in the rendered packet
- Check: A run claiming independent acceptance with matching actors is rejected
- Check: Every validation receipt names its boundary, so a valid receipt cannot be read as an outcome claim
- Check: The existing case-record rule and the new Lab rule use the same vocabulary
- Depends on: D1

### D3 Bounded objective and a defended meta-boundary

- Mechanisms: m-bounded-objective-per-run, m-fixed-meta-operation
- Deliverable: A declared objective with observable completion conditions, recorded before selection
- Deliverable: An explicit exclusion list stating what the run is not covering
- Deliverable: The improve-lab module boundary documented as a deliberate invariant with its stability rationale
- Deliverable: Tests covering an objective with no completion condition and a run attempting to apply its own proposal
- Check: A run without observable completion conditions is rejected before selection
- Check: The packet shows the declared objective beside what the run excluded
- Check: A run proposing a change to the Lab contract still stops at owner_reviewed and applies nothing
- Check: The invariant's rationale is recorded where a future editor would encounter it
- Depends on: D1

### D4 Paired trials and versioned gate criteria

- Mechanisms: m-paired-mechanism-trial, m-gate-lifecycle
- Deliverable: A paired-observation artifact holding the mechanism under test with agent, harness, environment and grader fixed
- Deliverable: A promotion gate requiring either a paired observation or a recorded reason why one is impractical
- Deliverable: Each acceptance gate declares its criteria and the date they last changed
- Deliverable: Tests covering an uncontrolled pair, a missing fixed condition, and a gate whose recorded criteria drift from its implementation
- Check: A paired observation that fails to hold a declared condition fixed is rejected rather than reported as a result
- Check: A mechanism promoted without a paired observation carries a recorded reason in the packet
- Check: A gate whose declared criteria no longer match its implemented check is reported as drift
- Check: The contribution of a mechanism is reported as a difference under fixed conditions, never as an absolute quality claim
- Depends on: D1, D2, D3

## Limitations

- paper-0004: The benchmarks are software-development tasks with executable tests. MOZAK's Lab produces reviewable plans, where no equivalent automatic grader exists, so the reported gains do not transfer as numbers.
- paper-0004: The three-role separation assumes each role can invoke a model. MOZAK's Lab is a contract over artifacts authored by one agent, so independence must be structural rather than organizational.
- paper-0004: A preprint reporting its own framework's gains, with no independent replication cited.
- paper-0012: The domain is recommendation explanations with hundreds of thousands of weekly instances. MOZAK's Lab produces a handful of mechanisms per run, so statistical drift detection has no direct analogue.
- paper-0012: Results come from the authors' own production system with no external replication.
- paper-0012: The paper concerns judging generated natural language, not judging whether a proposed engineering mechanism is sound.
- paper-0000: Skills evaluated are enterprise task-completion skills with gradeable outcomes. A MOZAK mechanism changes a contract, and its value appears over many later runs rather than in one paired trial.
- paper-0000: The 0.14 correlation is between two specific instruments on one skill corpus, not a general claim that structural checks are uninformative.
- paper-0000: Vendor-authored preprint reporting its own framework.
- paper-0015: Benchmarks are reasoning tasks with automatic scoring, which is what lets depth be set by convergence. A planning-only Lab has no automatic convergence signal.
- paper-0015: The stability argument rests on the meta-operation being fixed. MOZAK's Lab contract is exactly what a Lab run might propose changing, which is the unstable case the paper avoids rather than solves.
- paper-0015: Preprint with self-reported results.

## Status

Planning only. No MOZAK code was changed. Implementation and promotion require explicit owner authorization.
