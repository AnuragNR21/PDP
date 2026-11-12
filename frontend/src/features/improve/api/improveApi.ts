
import { apiClient } from "@/shared/http/apiClient";
import type {
  DashboardSummary,
  ImproveAttentionSignalSummary,
  ImproveCandidateSummary,
  RemediationTaskSummary,
  VerificationEvidenceSummary,
  VerificationFollowUpSummary,
  WorkProgramSummary
} from "@/shared/contracts";

export const improveApi = {
  listCandidates: () => apiClient.get<{ items: ImproveCandidateSummary[] }>("/api/improve/candidates"),
  getDashboard: () => apiClient.get<{ dashboard: DashboardSummary }>("/api/improve/dashboard"),
  listAttentionSignals: () => apiClient.get<{ items: ImproveAttentionSignalSummary[] }>("/api/improve/attention-signals"),
  listFollowUpQueue: (queueStatus?: string) =>
    apiClient.get<{ items: VerificationFollowUpSummary[] }>(
      queueStatus ? `/improve/follow-up-queue?queue_status=${encodeURIComponent(queueStatus)}` : "/api/improve/follow-up-queue"
    ),
  updateFollowUpQueue: (verificationId: string, body: { queue_status: string; due_date?: string; owner_party_id?: string; follow_up_note?: string }) =>
    apiClient.patch<{ item: VerificationFollowUpSummary }>(`/improve/follow-up-queue/${verificationId}`, body),
  listWorkPrograms: () => apiClient.get<{ items: WorkProgramSummary[] }>("/improve/work-programs"),
  createWorkProgram: (body: { name: string; priority: string; owner_name: string; owner_party_id?: string; candidate_ids: string[] }) =>
    apiClient.post<{ program: WorkProgramSummary }>("/improve/work-programs", body),
  listTasks: (programId?: string) =>
    apiClient.get<{ items: RemediationTaskSummary[] }>(
      programId ? `/improve/tasks?program_id=${encodeURIComponent(programId)}` : "/api/improve/tasks"
    ),
  updateTaskStatus: (taskId: string, status: string) =>
    apiClient.patch<{ task: RemediationTaskSummary }>(`/improve/tasks/${taskId}`, { status }),
  listVerifications: (candidateId?: string) =>
    apiClient.get<{ items: VerificationEvidenceSummary[] }>(
      candidateId ? `/improve/verifications?candidate_id=${encodeURIComponent(candidateId)}` : "/api/improve/verifications"
    ),
  createVerification: (body: {
    candidate_id: string;
    task_id?: string;
    result_id?: string;
    outcome: string;
    evidence_note: string;
    follow_up_required: boolean;
    verified_by_party_id?: string;
  }) => apiClient.post<{ verification: VerificationEvidenceSummary }>("/api/improve/verifications", body)
};
