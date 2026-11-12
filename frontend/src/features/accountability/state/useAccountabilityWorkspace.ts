import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { accountabilityApi } from "@/features/accountability/api/accountabilityApi";

export function useAccountabilityParties() {
  return useQuery({
    queryKey: ["accountability", "parties"],
    queryFn: async () => (await accountabilityApi.listParties()).items
  });
}

export function useAccountabilityAssignments(scopeType?: string, scopeId?: string) {
  return useQuery({
    queryKey: ["accountability", "assignments", scopeType ?? "all", scopeId ?? "all"],
    queryFn: async () => (await accountabilityApi.listAssignments(scopeType, scopeId)).items
  });
}

export function useCreateAccountabilityAssignment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: accountabilityApi.createAssignment,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["accountability", "assignments"] }),
        queryClient.invalidateQueries({ queryKey: ["improve", "tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["improve", "work-programs"] })
      ]);
    }
  });
}
