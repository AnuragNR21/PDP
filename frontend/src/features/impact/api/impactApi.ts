import { apiClient } from "@/shared/http/apiClient";
import type {
  AffectedItemSummary,
  ImpactAnalysisSummary,
  ImpactFindingSummary,
  ImpactPathSummary,
  ImproveCandidateSummary,
  RefreshRequest
} from "@/shared/contracts";

export type RunImpactAnalysisCommand = {
  subject_type: "node" | "check_result";
  subject_id: string;
  max_depth: number;
  include_relationships: boolean;
};

export const impactApi = {
  runAnalysis: (payload: RunImpactAnalysisCommand) =>
    apiClient.post<{ analysis: ImpactAnalysisSummary; refresh: RefreshRequest }>("/api/impact/analysis", payload),
  getAnalysis: (analysisId: string) =>
    apiClient.get<{ analysis: ImpactAnalysisSummary }>(`/impact/analysis/${analysisId}`),
  listAffectedItems: (analysisId: string) =>
    apiClient.get<{ items: AffectedItemSummary[] }>(`/api/impact/analysis/${analysisId}/affected-items`),
  listPaths: (analysisId: string) =>
    apiClient.get<{ items: ImpactPathSummary[] }>(`/api/impact/analysis/${analysisId}/paths`),
  listFindings: (analysisId: string) =>
    apiClient.get<{ items: ImpactFindingSummary[] }>(`/api/impact/analysis/${analysisId}/findings`),
  handoffToImprove: (analysisId: string, findingId: string) =>
    apiClient.post<{ candidate: ImproveCandidateSummary; refresh: RefreshRequest }>(
      `/api/impact/analysis/${analysisId}/handoff`,
      { finding_id: findingId, destination: "improve" }
    )
};
