# ADR 0001: modular monolith and standalone core

Status: accepted for alpha planning.

MOZAK will begin as a modular monolith with explicit unit boundaries and a CLI/application-service interface. The core remains independent of Jcode. This minimizes deployment and migration complexity while preserving later process separation.
