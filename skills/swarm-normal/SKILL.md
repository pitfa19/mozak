---
name: swarm-normal
description: Explicitly select the Normal (medium) agent-work profile for this Jcode session. Sol 6.1 medium coordinator and Opus 5.5 medium workers. Keeps Low as the global default.
---

# Normal profile

Only activate on explicit owner selection. Automatic skill discovery does not
authorize switching a profile. Read ~/.jcode/swarm-prompt.md for the full policy.

1. Select NORMAL for this session. "Medium profile" is an alias. Do not change
   the global LOW default. Retain the existing teacher-mode state.
2. Coordinators use model `gpt-6.1-sol`, effort `medium`. All leaf workers use model
   `claude-oauth:claude-opus-5-5`, effort `medium`. Supply model, effort, label,
   role and selected profile in every new agent brief and delegation call.
3. Outside teacher mode the current session is the coordinator. Inspect its actual
   model and effort. Use supported session-scoped controls if available to align
   it, otherwise give the exact /model gpt-6.1-sol and /effort medium prerequisites.
   Do not guess a session id or operate on another user's window. Do not claim a
   runtime switch based solely on this skill being loaded.
4. In teacher mode preserve the teacher's model and effort. New development
   coordinators use NORMAL. For an already-running coordinator, send the updated
   profile and align it with supported session-scoped controls before new work.
   Do not interrupt working agents or duplicate their tasks to change profiles.
5. On Claude quota exhaustion use the other configured Claude OAuth account with
   the same model. If both are exhausted, the Sol coordinator resumes work itself
   from verified checkpoints. Authentication and ordinary errors are not quota.

Keep the selection in the session's durable handoff/context. Explicitly carry
NORMAL into every child brief because new sessions otherwise default to LOW.
Report runtime alignment still needed, not a fictitious completed switch.
