import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getAcceptanceRoutes,
  getAcceptanceScenarios,
  getReleaseReadiness,
  runAcceptanceHarness,
  type AcceptanceRouteSummary,
  type AcceptanceRunResult,
  type AcceptanceScenarioSummary,
  type ReleaseReadinessSummary,
} from "@/features/acceptance/api/acceptanceApi";

type AcceptanceWorkspaceState = {
  scenarios: AcceptanceScenarioSummary[];
  routes: AcceptanceRouteSummary[];
  readiness: ReleaseReadinessSummary | null;
  latestRun: AcceptanceRunResult | null;
  isLoading: boolean;
  isRunning: boolean;
  includedRouteCount: number;
  scenarioOptions: Array<{ value: string; label: string }>;
  runHarness: (scenarioId?: string) => Promise<AcceptanceRunResult>;
  refreshAll: () => Promise<void>;
};

export function useAcceptanceWorkspace(): AcceptanceWorkspaceState {
  const queryClient = useQueryClient();

  const scenariosQuery = useQuery<AcceptanceScenarioSummary[]>({
    queryKey: ["acceptance", "scenarios"],
    queryFn: getAcceptanceScenarios,
  });

  const routesQuery = useQuery<AcceptanceRouteSummary[]>({
    queryKey: ["acceptance", "routes"],
    queryFn: getAcceptanceRoutes,
  });

  const readinessQuery = useQuery<ReleaseReadinessSummary>({
    queryKey: ["acceptance", "release-readiness"],
    queryFn: getReleaseReadiness,
  });

  const runMutation = useMutation({
    mutationFn: (scenarioId?: string) => runAcceptanceHarness({ scenario_id: scenarioId }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["acceptance", "scenarios"] }),
        queryClient.invalidateQueries({ queryKey: ["acceptance", "routes"] }),
        queryClient.invalidateQueries({ queryKey: ["acceptance", "release-readiness"] }),
      ]);
    },
  });

  const scenarios = scenariosQuery.data ?? [];
  const routes = routesQuery.data ?? [];
  const readiness = readinessQuery.data ?? null;
  const latestRun = runMutation.data ?? null;

  const scenarioOptions = useMemo(
    () =>
      scenarios.map((scenario: AcceptanceScenarioSummary) => ({
        value: scenario.scenario_id,
        label: scenario.name,
      })),
    [scenarios],
  );

  const includedRouteCount = useMemo(
    () => routes.filter((route: AcceptanceRouteSummary) => route.included_in_smoke).length,
    [routes],
  );

  const isLoading =
    scenariosQuery.isLoading || routesQuery.isLoading || readinessQuery.isLoading;

  async function refreshAll(): Promise<void> {
    await Promise.all([
      scenariosQuery.refetch(),
      routesQuery.refetch(),
      readinessQuery.refetch(),
    ]);
  }

  async function runHarness(scenarioId?: string): Promise<AcceptanceRunResult> {
    return await runMutation.mutateAsync(scenarioId);
  }

  return {
    scenarios,
    routes,
    readiness,
    latestRun,
    isLoading,
    isRunning: runMutation.isPending,
    includedRouteCount,
    scenarioOptions,
    runHarness,
    refreshAll,
  };
}