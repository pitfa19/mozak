# mozak docs

Start with the [README](../README.md). This page lists every doc in the repo and says whether it describes mozak as it is now or records history.

## Current: how mozak works today

| Doc | What it covers |
| --- | --- |
| [installation.md](installation.md) | Build from source, the portable installer, `mozak upgrade` and `mozak doctor`, exit codes, recovery, the write lock, the experimental `concurrency.rebase` setting, remote scopes, known limits, and the verification status of every check. |
| [annotations.md](annotations.md) | Owner annotations: cross-plan refs (needs, informs, supersedes), deadlines, `mozak annotate`, `graph`, `ready` and `plans --sort deadline`. |
| [../packages/obsidian/README.md](../packages/obsidian/README.md) | The Obsidian plugin: use, settings, and the community plugin disclosures (files outside the vault, network use, no self-update). |
| [../skills/mozak/SKILL.md](../skills/mozak/SKILL.md) | The agent skill source. It is a template: load the installed copy, not this file. Its `references/` folder has the routes, bootstrap and recovery notes. |
| [brand.md](brand.md) | Name, headline, logo files, colors and fonts. |
| [../CHANGELOG.md](../CHANGELOG.md) | User-visible changes per release. |

## Launch and release (drafts for the owner)

| Doc | What it covers |
| --- | --- |
| [release-notes-draft.md](release-notes-draft.md) | DRAFT release notes for the next version. Not published. |
| [obsidian-submission-checklist.md](obsidian-submission-checklist.md) | Each Obsidian community directory requirement, its status in this repo, and what the owner must do to submit. |

## Design specs for features that shipped

These explain why a feature works the way it does. The code and [installation.md](installation.md) win where they differ.

| Doc | What it covers |
| --- | --- |
| [obsidian-roadmap-spec.md](obsidian-roadmap-spec.md) | The readable `mozak.md` with a roadmap, and the plugin as pure navigation. |
| [private-plan-storage-spec.md](private-plan-storage-spec.md) | Plans for public repos kept in a vault folder. |

## Historical records

These record how the first packages were specified, built and accepted in October 2026. They are kept for provenance. Do not build against them. Some names in them are older (for example `MOZAK.json`).

| Doc | What it covers |
| --- | --- |
| [../SPEC.md](../SPEC.md) | Legacy format 1 spec from the first design. Superseded. |
| [detailed-specification-handoff.md](detailed-specification-handoff.md) | Design review and handoff record. |
| [implementation-package-1-plan-state-review.md](implementation-package-1-plan-state-review.md) | Package 1 spec: plan state and review. |
| [implementation-package-1-acceptance.md](implementation-package-1-acceptance.md) | Package 1 acceptance evidence. |
| [implementation-package-2-conversation-and-handoff.md](implementation-package-2-conversation-and-handoff.md) | Package 2 spec: conversation, continuity and implementation handoff. |
| [implementation-package-2-acceptance.md](implementation-package-2-acceptance.md) | Package 2 acceptance and live-trial handoff. |
| [implementation-package-2-live-trial.md](implementation-package-2-live-trial.md) | Package 2 live trial report. |
| [implementation-package-3-portable-workspace.md](implementation-package-3-portable-workspace.md) | Package 3 proposal: official delivery and portable workspace. |
| [assets/src/HANDOFF.md](assets/src/HANDOFF.md), [assets/src/AGENT-CHAT-SCRIPT.md](assets/src/AGENT-CHAT-SCRIPT.md), [assets/brand/BRAND.md](assets/brand/BRAND.md) | Older video and brand briefs from 0.3.0. [brand.md](brand.md) is current. |

## Checking the docs

`node scripts/check-links.mjs` checks every relative link and heading anchor in the repo's Markdown files. It exits 1 on a broken link. `npm test` runs the same check.
