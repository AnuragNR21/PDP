import { apiClient } from "@/shared/http/apiClient";
import type { SavedImpactNode } from "@/features/impact/domain/impactGraph";

export type ImpactDiagramSummary = {
  diagram_id: string;
  name: string;
  created_at: string;
  updated_at: string;
  node_count: number;
};

export type ImpactDiagramRecord = Omit<ImpactDiagramSummary, "node_count"> & {
  nodes: SavedImpactNode[];
  edges: { edge_key: string; edge_style: string; sort_order: number }[];
};

export type SaveImpactDiagramPayload = {
  name: string;
  nodes: SavedImpactNode[];
  edges: { edge_key: string; edge_style: string }[];
};

/** The Impact workspace's own saved diagrams. */
export const impactDiagramApi = {
  listDiagrams: () =>
    apiClient.get<{ items: ImpactDiagramSummary[]; total: number }>("/api/impact/diagrams"),

  getDiagram: (diagramId: string) =>
    apiClient.get<ImpactDiagramRecord>(`/api/impact/diagrams/${diagramId}`),

  createDiagram: (payload: SaveImpactDiagramPayload) =>
    apiClient.post<ImpactDiagramRecord>("/api/impact/diagrams", payload),

  updateDiagram: (diagramId: string, payload: SaveImpactDiagramPayload) =>
    apiClient.put<ImpactDiagramRecord>(`/api/impact/diagrams/${diagramId}`, payload),

  removeDiagram: (diagramId: string) =>
    apiClient.delete<void>(`/api/impact/diagrams/${diagramId}`),
};
