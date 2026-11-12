import { WorkspaceCode } from "@/shared/contracts/common";

export interface ActionRequestContract {
  requesting_workspace: WorkspaceCode;
  action_family: string;
  target_kind: string;
  target_id: string;
  requested_mutation: string;
  parent_id?: string | null;
  scope_id?: string | null;
  correlation_id: string;
  actor_id: string;
}
