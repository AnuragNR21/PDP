import { useQuery } from "@tanstack/react-query";
import { getHomeOverview } from "@/features/home/api/homeApi";

export function useHomeOverview() {
  return useQuery({
    queryKey: ["home", "overview"],
    queryFn: getHomeOverview
  });
}
