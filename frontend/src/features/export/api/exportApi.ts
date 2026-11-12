import { apiClient } from "@/shared/http/apiClient";

export interface ExportPack {
  generated_at: string;
  results: Array<Record<string, unknown>>;
  issues: Array<Record<string, unknown>>;
  actions: Array<Record<string, unknown>>;
  verifications: Array<Record<string, unknown>>;
  evaluation_summary: Record<string, unknown>;
}

export interface DemoStorySection {
  section_code: string;
  title: string;
  narrative: string;
  primary_routes: string[];
  asset_counts: Record<string, number>;
}

export interface DemoPresentationAsset {
  asset_code: string;
  title: string;
  description: string;
  source_endpoint: string;
}

export interface DemoStoryPack {
  generated_at: string;
  headline: string;
  sections: DemoStorySection[];
  presentation_assets: DemoPresentationAsset[];
  evaluation_summary: Record<string, unknown>;
}

export const exportApi = {
  getPack: () => apiClient.get<{ pack: ExportPack }>("/export/pack"),
  getEvaluationSummary: () => apiClient.get<{ summary: Record<string, unknown> }>("/export/evaluation-summary"),
  getDemoStoryPack: () => apiClient.get<{ story_pack: DemoStoryPack }>("/export/demo-story-pack")
};
