---
name: swarm-low
description: Explicitly select the Low agent-work profile for this Jcode session. Sol 6.1 low coordinator and Sonnet 5.5 medium workers. Does not turn teacher mode on or off.
---

# Low profile

Only activate on explicit owner selection. Automatic skill discovery does not
authorize switching a profile. Read ~/.jcode/swarm-prompt.md for the full policy.

1. Select LOW for this session. Keep the global default LOW and do not edit config
   merely to select a session profile. Retain the existing teacher-mode state.
2. Coordinators use model `gpt-6.1-sol`, effort `low`. All leaf workers use model
   `claude-oauth:claude-sonnet-5-5`, effort `medium`. Supply model, effort, label,
   role and selected profile in every new agent brief and delegation call.
3. Outside teacher mode the current session is the coordinator. Inspect its actual
   model and effort. Use supported session-scoped controls if available to align
   it, otherwise give the exact /model gpt-6.1-sol and /effort low prerequisites.
   Do not guess a session id or operate on another user's window. Do not claim a
   runtime switch based solely on this skill being loaded.
4. In teacher mode preserve the teacher's model and effort. New development
   coordinators use LOW. For an already-running coordinator, send the updated
   profile and align it with supported session-scoped controls before new work.
   Do not interrupt working agents or duplicate their tasks to change profiles.
5. On Claude quota exhaustion use the other configured Claude OAuth account with
   the same model. If both are exhausted, the Sol coordinator resumes work itself
   from verified checkpoints. Authentication and ordinary errors are not quota.

Keep the selection in the session's durable handoff/context. Report any runtime
alignment still needed, not a fictitious completed switch.
