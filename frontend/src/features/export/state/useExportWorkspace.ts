import { useQuery } from "@tanstack/react-query";
import { exportApi } from "@/features/export/api/exportApi";

export function useExportPack() {
  return useQuery({
    queryKey: ["export", "pack"],
    queryFn: async () => (await exportApi.getPack()).pack
  });
}

export function useDemoStoryPack() {
  return useQuery({
    queryKey: ["export", "demo-story-pack"],
    queryFn: async () => (await exportApi.getDemoStoryPack()).story_pack
  });
}
