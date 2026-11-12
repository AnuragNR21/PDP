import { FocusReason, SelectionMode, WorkspaceCode } from "@/shared/contracts/common";

export interface SelectionFocusContract {
  workspace: WorkspaceCode;
  source_surface: string;
  focused_item_kind: string;
  canonical_entity_kind: string;
  canonical_entity_id: string;
  model_id?: string | null;
  scope_id?: string | null;
  reason: FocusReason;
  selection_mode: SelectionMode;
}
