# Personal agent-work settings (approved 2026-10-06)

- Default swarm profile is LOW: Sol 6.1 low coordinator and Sonnet 5.5 medium
  workers. NORMAL (also called medium profile) is Sol 6.1 medium coordinator
  and Opus 5.5 medium workers. Profiles are independent of native swarm depth.
- For "use low", "low profile", or /swarm-low, load swarm-low. For "use normal",
  "normal profile", "medium profile", or /swarm-normal, load swarm-normal.
  Profile selection is session-local unless the owner explicitly changes defaults.
- Teacher mode is OFF by default. Only load teacher on explicit invocation:
  "teacher mode", "be the teacher", or /teacher. Skill discovery or an embedding
  hit alone is not permission to activate teacher mode or change a profile.
- Read ~/.jcode/swarm-prompt.md before applying these settings. Include the selected
  profile and role in child briefs so a NORMAL child does not revert to LOW.
- Claude quota fallback is other configured Claude OAuth account first, using
  the same worker model, then coordinator execution if both accounts are exhausted.
  No alternate worker provider or paid API substitution without owner consent.
- Existing sessions keep their original prompt. Never claim these files updated
  an already-captured system/tool prompt. Load relevant skills dynamically when needed.
