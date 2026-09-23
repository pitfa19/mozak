# Preference learning

A preference becomes durable only when the owner accepts it in words. Everything here produces proposals.

The failure this guards against is quiet drift: an agent corrected once starts applying that correction everywhere, the owner never agreed to a rule, and months later the notes are shaped by decisions nobody made.

## What may become a proposal

**A direct standing instruction.** "Always put the todo at the end", "from now on skip frontmatter here". The strongest signal, because the owner used standing language.

**A correction repeated across separate occasions.** Once is an instance. Twice, in different sessions, is a pattern worth naming.

**A consistent pattern in existing notes.** Twenty notes in a folder share a shape the defaults do not produce. That is evidence about the destination, not about the owner's wishes, and it should be proposed as a destination-scoped rule.

## What may not

- A single correction inside one operation. That instruction governs that write.
- An inference from one note.
- Anything the owner declined earlier. Re-proposing a rejected rule is nagging.
- A rule invented because the agent found the default awkward.

## Scope

Every proposal names the narrowest scope that fits.

| Scope | Use when |
|---|---|
| `operation` | The instruction applies to this write only. Not a proposal at all. |
| `path` | The rule belongs to one folder or project. |
| `destination` | The rule belongs to one configured destination. |
| `note_type` | The rule belongs to a kind of note, such as reports or paper notes. |
| `global` | The rule is about how the owner writes, everywhere. |

Prefer the narrower option when uncertain. A rule learned from formal research notes must not silently reshape a personal journal. `global` needs explicit standing language, not inference.

## Writing a proposal

```bash
python3 scripts/propose_preference.py \
  --id sparse-internal-links \
  --scope destination:example-research \
  --rule "Add an internal link only when it is likely to be followed." \
  --evidence "Owner removed decorative links in two separate sessions, 2026-09-14 and 2026-09-21." \
  --output /path/to/proposals.json
```

The script records the rule with `status: "proposed"` and writes nothing else. It does not touch the profile, it does not apply the rule, and it refuses to write a proposal already marked accepted.

Then show the owner the rule, its scope, and the evidence, in that order, and wait. Accepted proposals are merged into the profile by the owner or by an explicit later operation, never as a side effect of proposing.

## Conflicts

Two rules can contradict each other, and a profile rule can contradict a vault-local style document. When that happens, report both and let the owner decide.

The precedence order in `SKILL.md` already says which one governs a given write. It does not say which one is correct. Silently applying the winner and never mentioning the loser hides a decision the owner should make.

## Reviewing what was learned

Keep proposals inspectable. An owner should be able to read every rule the agent believes, see the evidence behind each, and remove any of them. A preference nobody can find is indistinguishable from a bug.
