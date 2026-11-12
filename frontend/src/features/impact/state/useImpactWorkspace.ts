import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { discoverApi } from "@/features/discover/api/discoverApi";
import { impactApi } from "@/features/impact/api/impactApi";
import { structureApi } from "@/features/structure/api/structureApi";

export function useImpactWorkspace() {
  const queryClient = useQueryClient();
  const [subjectType, setSubjectType] = useState<"node" | "check_result">("check_result");
  const [subjectId, setSubjectId] = useState<string>("res_seed_1");
  const [maxDepth, setMaxDepth] = useState<number>(3);
  const [includeRelationships, setIncludeRelationships] = useState<boolean>(true);
  const [analysisId, setAnalysisId] = useState<string>("");

  const structureDiagramQuery = useQuery({
    queryKey: ["impact", "subjectNodes", "mdl_business_information"],
    queryFn: async () => (await structureApi.getDiagramProjection("mdl_business_information")).projection.nodes
  });

  const seededResultsQuery = useQuery({
    queryKey: ["impact", "seedResults", "sess_seed_customer_extract"],
    queryFn: async () => (await discoverApi.listResults("sess_seed_customer_extract")).items
  });

  useEffect(() => {
    if (subjectType === "check_result") {
      setSubjectId((current) => current || seededResultsQuery.data?.[0]?.result_id || "res_seed_1");
    }
    if (subjectType === "node") {
      setSubjectId((current) => current || structureDiagramQuery.data?.[0]?.node_id || "node_customer_subject");
    }
  }, [subjectType, seededResultsQuery.data, structureDiagramQuery.data]);

  const runAnalysisMutation = useMutation({
    mutationFn: async () =>
      impactApi.runAnalysis({
        subject_type: subjectType,
        subject_id: subjectId,
        max_depth: maxDepth,
        include_relationships: includeRelationships
      }),
    onSuccess: async (response) => {
      setAnalysisId(response.analysis.analysis_id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["impact", "analysis", response.analysis.analysis_id] }),
        queryClient.invalidateQueries({ queryKey: ["improve", "candidates"] })
      ]);
    }
  });

  const analysisQuery = useQuery({
    queryKey: ["impact", "analysis", analysisId],
    queryFn: async () => (await impactApi.getAnalysis(analysisId)).analysis,
    enabled: analysisId.length > 0
  });

  const affectedItemsQuery = useQuery({
    queryKey: ["impact", "affected-items", analysisId],
    queryFn: async () => (await impactApi.listAffectedItems(analysisId)).items,
    enabled: analysisId.length > 0
  });

  const pathsQuery = useQuery({
    queryKey: ["impact", "paths", analysisId],
    queryFn: async () => (await impactApi.listPaths(analysisId)).items,
    enabled: analysisId.length > 0
  });

  const findingsQuery = useQuery({
    queryKey: ["impact", "findings", analysisId],
    queryFn: async () => (await impactApi.listFindings(analysisId)).items,
    enabled: analysisId.length > 0
  });

  const handoffMutation = useMutation({
    mutationFn: async (findingId: string) => impactApi.handoffToImprove(analysisId, findingId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["improve", "candidates"] });
    }
  });

  const subjectOptions = useMemo(() => {
    if (subjectType === "node") {
      return (structureDiagramQuery.data ?? []).map((item) => ({
        value: item.node_id,
        label: `${item.name} · ${item.node_type_id}`
      }));
    }
    return (seededResultsQuery.data ?? []).map((item) => ({
      value: item.result_id,
      label: `${item.column_name ?? item.result_id} · ${item.severity}`
    }));
  }, [seededResultsQuery.data, structureDiagramQuery.data, subjectType]);

  return {
    subjectType,
    setSubjectType,
    subjectId,
    setSubjectId,
    maxDepth,
    setMaxDepth,
    includeRelationships,
    setIncludeRelationships,
    analysisId,
    subjectOptions,
    runAnalysisMutation,
    analysisQuery,
    affectedItemsQuery,
    pathsQuery,
    findingsQuery,
    handoffMutation,
    seededResultsQuery,
    structureDiagramQuery
  };
}
