import { WorkspaceCode } from "@/shared/contracts/common";

export interface WorkspaceContextContract {
  workspace: WorkspaceCode;
  source_surface: string;
  model_id: string | null;
  scope_id: string | null;
  analysis_mode: string | null;
  projection_mode: string | null;
  session_id: string | null;
}
