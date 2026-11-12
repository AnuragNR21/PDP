import { apiGet, apiPost } from "@/shared/http/apiClient";

export type AcceptanceScenarioSummary = {
  scenario_id: string;
  name: string;
  description: string;
  expected_outcome: string;
};

export type AcceptanceRouteSummary = {
  route: string;
  title: string;
  area: string;
  included_in_smoke: boolean;
};

export type AcceptanceRunRequest = {
  scenario_id?: string;
};

export type AcceptanceRunResult = {
  run_id: string;
  executed_at: string;
  passed: boolean;
  scenarios_checked: number;
  routes_checked: number;
  notes: string[];
};

export type ReleaseReadinessSummary = {
  release_candidate: boolean;
  summary: string;
  open_items: string[];
  completed_checks: string[];
};

export function getAcceptanceScenarios(): Promise<AcceptanceScenarioSummary[]> {
  return apiGet<AcceptanceScenarioSummary[]>("/api/acceptance/scenarios");
}

export function getAcceptanceRoutes(): Promise<AcceptanceRouteSummary[]> {
  return apiGet<AcceptanceRouteSummary[]>("/api/acceptance/routes");
}

export function runAcceptanceHarness(
  request: AcceptanceRunRequest = {},
): Promise<AcceptanceRunResult> {
  return apiPost<AcceptanceRunResult, AcceptanceRunRequest>(
    "/api/acceptance/runs",
    request,
  );
}

export function getReleaseReadiness(): Promise<ReleaseReadinessSummary> {
  return apiGet<ReleaseReadinessSummary>("/api/acceptance/release-readiness");
}