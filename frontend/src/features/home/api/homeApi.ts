import { apiGet } from "@/shared/http/apiClient";
import { HomeOverviewResponse } from "@/features/home/domain/types";

export function getHomeOverview(): Promise<HomeOverviewResponse> {
  return apiGet<HomeOverviewResponse>("/api/home/overview");
}
