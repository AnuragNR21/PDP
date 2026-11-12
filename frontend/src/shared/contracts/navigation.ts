import { FocusReason, WorkspaceCode } from "@/shared/contracts/common";

export interface NavigationHandoffContract {
  source_workspace: WorkspaceCode;
  destination_workspace: WorkspaceCode;
  destination_route: string;
  entity_kind: string;
  entity_id: string;
  reason: FocusReason;
}
