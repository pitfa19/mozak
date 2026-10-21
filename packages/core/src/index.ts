// Read-only note helpers and text folding.
export * from "./notes.ts";
export * from "./fold.ts";
export * from "./paths.ts";

// Supported v3 understanding model, conversation and guarded public operations.
export * from "./errors.ts";
export * from "./understanding.ts";
export * from "./scope-index.ts";
export * from "./scope-store.ts";
export * from "./scope-files.ts";
export * from "./scope-list.ts";
export * from "./review.ts";
export * from "./roadmap.ts";
export { mdText, stopLabel, completedPlanLine, planHeading, planDisplayState, progressStrip, type PlanDisplayState } from "./bridge.ts";
export * from "./api.ts";
export * from "./remote-meta.ts";
export * from "./remote.ts";
export * from "./visibility.ts";
export * from "./working-copy.ts";
export * from "./durable.ts";
export * from "./update.ts";
export * from "./annotations.ts";
export * from "./deadlines.ts";
export * from "./crossplan.ts";
export * from "./settings.ts";
export * from "./lock-recover.ts";
export * from "./prune.ts";
export * from "./history.ts";
export * from "./local-sync.ts";
export * from "./locators.ts";
export * from "./similar.ts";
export * from "./plans-index.ts";
