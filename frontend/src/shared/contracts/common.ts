export type WorkspaceCode =
  | "home"
  | "model"
  | "structure"
  | "discover"
  | "impact"
  | "improve"
  | "settings"
  | "admin";

export type SelectionMode = "single" | "multi";
export type FocusReason = "click" | "launch" | "resume" | "programmatic" | "review";
export type ProjectionMode = "tree" | "diagram" | "matrix" | "summary" | "dashboard" | "graph";
export type RefreshScope = "workspace" | "feature" | "entity" | "projection" | "session";

export interface AuditStamp {
  actor_id: string;
  occurred_at: string;
  correlation_id: string;
}
