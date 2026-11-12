import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { trialApi } from "@/features/trial/api/trialApi";

export function useTrialHome() {
  return useQuery({
    queryKey: ["trial", "home"],
    queryFn: trialApi.getHome
  });
}

export function useTrialSummary() {
  return useQuery({
    queryKey: ["trial", "summary"],
    queryFn: async () => (await trialApi.getSummary()).summary
  });
}

export function useCreateTrialEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: trialApi.createEvent,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["trial", "summary"] });
    }
  });
}

export function useCreateTrialFeedback() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: trialApi.createFeedback,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["trial", "summary"] });
    }
  });
}

export function useTrialReset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: trialApi.reset,
    onSuccess: async () => {
      await queryClient.invalidateQueries();
    }
  });
}

export function useTrialReseed() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: trialApi.reseed,
    onSuccess: async () => {
      await queryClient.invalidateQueries();
    }
  });
}
