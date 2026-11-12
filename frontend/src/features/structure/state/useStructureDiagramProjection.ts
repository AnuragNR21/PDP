import { useQuery } from "@tanstack/react-query";
import { structureApi } from "@/features/structure/api/structureApi";

export function useStructureDiagramProjection(modelId: string) {
  return useQuery({
    queryKey: ["structure", "diagramProjection", modelId],
    queryFn: async () => (await structureApi.getDiagramProjection(modelId)).projection,
    enabled: modelId.length > 0
  });
}
