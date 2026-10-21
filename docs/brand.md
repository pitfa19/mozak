# mozak brand

The name is always lowercase: **mozak** (Croatian for "brain"). Plan files are `mozak.json` and `mozak.md`.

Headline: **One approved plan per project, shared by your coding agents, visible in Obsidian.** (Until 0.4.2 it was "Use Obsidian as your IDE.", dropped because the Obsidian plugin is a read-only view, not an IDE.)

## Logo

A brain outline with a three-node circuit inside: gold (proposed, waiting for your yes), purple (approved, the current step), green (done with proof). Under it, a three-segment bar in the same colours, the same strip the Obsidian sidebar shows for each plan.

| File | Use |
|---|---|
| `docs/assets/brand/mozak-lockup-light.png` | Logo with the word mozak and the headline, light background. README hero, title cards. |
| `docs/assets/brand/mozak-social-preview.png` | GitHub social preview, 1280x640. |
| `docs/assets/brand/mozak-mark-light.png` | The brain mark alone, 512x512. |
| `docs/assets/brand/mozak-favicon-32.png`, `mozak-favicon-16.png` | Small icon sizes. |
| `docs/assets/brand/mozak-icon.svg`, `mozak-mark-transparent.svg` | Vector mark for animation, with named layers for each node. |
| `docs/assets/brand/mozak-lockup-dark.svg` / `.png` | Dark version (older wordmark), for dark title cards. |

The light lockup comes from the end card of the final demo video, which is the reference for the brand.

## Colours

On light backgrounds (README, video, GIFs):

| Role | Hex |
|---|---|
| Background | `#eceef3` |
| Text | `#1a1e28` |
| Muted text | `#626a7e` |
| Gold, waiting for approval | `#b0841c` |
| Purple, approved or current step | `#6e5bd6` |
| Green, done with proof | `#1e8a52` |

On dark backgrounds the same roles use the brighter set: gold `#d8b35a`, purple `#9a8ce8`, green `#5cbf8a`, text `#eceff7`. Machine-readable values are in `docs/assets/brand/brand-tokens.json`.

## Type

All fonts are free (SIL Open Font License) and bundled in `docs/assets/brand/fonts/`.

- **Space Grotesk**: the wordmark and titles.
- **Plus Jakarta Sans**: captions and body text.
- **JetBrains Mono**: file names, commands and tool names.

## Obsidian

The plugin sidebar uses Obsidian's own `brain-circuit` icon, tinted gold, purple or green by the active filter, so it stays native to Obsidian and still matches the mark.
