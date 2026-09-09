# Alpha product contract

## Primary user

The alpha user is one technical person managing several local projects with CLI agents. They need portable, evidence-backed project state that a fresh agent can understand without replaying previous conversations.

## Primary workflow

1. Initialize a brain repository.
2. Register a project and its priority.
3. Add approved local or web source profiles.
4. Discover or ingest a source and create an immutable snapshot.
5. Extract candidate statements with exact evidence spans.
6. Review a patch that accepts, rejects, disputes, or supersedes candidates.
7. Generate compact human, agent, and formal views from accepted state.
8. Generate a bounded research, decision, or implementation packet.
9. Export canonical events and content-addressed snapshots to a portable archive.

## First branch type

The first branch type is `discovery`. It has a project-scoped question, approved source profiles, an evidence budget, candidate findings, review state, and a release or refresh-due outcome.

Supported alpha sources are local files, Git repositories, manually supplied URLs, RSS or sitemap discoveries, and free public registry APIs. Dynamic pages may be rendered locally, but rendered content remains untrusted source data.

## Knowledge states

- Current knowledge is the latest accepted statement valid for the requested scope and time.
- Historical knowledge is reconstructable from append-only events and immutable snapshots.
- Candidate statements are unapproved proposals and never appear as accepted facts.
- Disputed statements retain explicit conflicting evidence without manufacturing consensus.
- Superseded statements remain historical and point to their replacement.
- Retracted statements remain historical and cannot be returned as current accepted facts.

## Outputs

The human view is short and readable. The agent view contains bounded accepted state, provenance, unresolved conflicts, assumptions, and next actions. The formal view contains typed identifiers and relations. Every packet includes scope, objective, evidence, constraints, dependencies, acceptance checks, risks, and freshness metadata.

## Approval boundary

Registration, snapshot creation, parsing, exact-span extraction, hashing, and candidate proposal may happen automatically. Accepting or retracting claims, changing project policy, authorizing external writes, and releasing packets requires an authorized human in the alpha.

## Observable alpha demonstration

Given one local project and at least one local and one web snapshot, MOZAK can preserve provenance, expose a corrected or disputed fact without losing history, reject source-embedded instructions, produce three bounded views, generate an implementation packet, export the brain, restore it on another path, and reproduce the same canonical hash without a GPU, cloud database, or Jcode.
