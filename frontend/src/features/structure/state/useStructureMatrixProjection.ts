import { useQuery } from "@tanstack/react-query";
import { structureApi } from "@/features/structure/api/structureApi";

export function useStructureMatrixProjection(modelId: string) {
  return useQuery({
    queryKey: ["structure", "matrixProjection", modelId],
    queryFn: async () => (await structureApi.getMatrixProjection(modelId)).projection,
    enabled: modelId.length > 0
  });
}
