
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { improveApi } from "@/features/improve/api/improveApi";

export function useImproveDashboard() {
  return useQuery({
    queryKey: ["improve", "dashboard"],
    queryFn: async () => (await improveApi.getDashboard()).dashboard
  });
}

export function useImproveCandidates() {
  return useQuery({
    queryKey: ["improve", "candidates"],
    queryFn: async () => (await improveApi.listCandidates()).items
  });
}

export function useImproveAttentionSignals() {
  return useQuery({
    queryKey: ["improve", "attention-signals"],
    queryFn: async () => (await improveApi.listAttentionSignals()).items
  });
}

export function useImproveFollowUpQueue(queueStatus?: string) {
  return useQuery({
    queryKey: ["improve", "follow-up-queue", queueStatus ?? "all"],
    queryFn: async () => (await improveApi.listFollowUpQueue(queueStatus)).items
  });
}

export function useImproveWorkPrograms() {
  return useQuery({
    queryKey: ["improve", "work-programs"],
    queryFn: async () => (await improveApi.listWorkPrograms()).items
  });
}

export function useImproveTasks(programId?: string) {
  return useQuery({
    queryKey: ["improve", "tasks", programId ?? "all"],
    queryFn: async () => (await improveApi.listTasks(programId)).items
  });
}

export function useImproveVerifications(candidateId?: string) {
  return useQuery({
    queryKey: ["improve", "verifications", candidateId ?? "all"],
    queryFn: async () => (await improveApi.listVerifications(candidateId)).items
  });
}

export function useCreateWorkProgram() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: improveApi.createWorkProgram,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["improve", "work-programs"] }),
        queryClient.invalidateQueries({ queryKey: ["improve", "tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["improve", "dashboard"] }),
        queryClient.invalidateQueries({ queryKey: ["improve", "candidates"] }),
        queryClient.invalidateQueries({ queryKey: ["improve", "attention-signals"] })
      ]);
    }
  });
}

export function useUpdateTaskStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, status }: { taskId: string; status: string }) =>
      improveApi.updateTaskStatus(taskId, status),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["improve", "tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["improve", "dashboard"] }),
        queryClient.invalidateQueries({ queryKey: ["improve", "candidates"] }),
        queryClient.invalidateQueries({ queryKey: ["improve", "attention-signals"] }),
        queryClient.invalidateQueries({ queryKey: ["improve", "follow-up-queue"] })
      ]);
    }
  });
}

export function useCreateVerification() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: improveApi.createVerification,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["improve", "verifications"] }),
        queryClient.invalidateQueries({ queryKey: ["improve", "dashboard"] }),
        queryClient.invalidateQueries({ queryKey: ["improve", "tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["improve", "candidates"] }),
        queryClient.invalidateQueries({ queryKey: ["improve", "attention-signals"] }),
        queryClient.invalidateQueries({ queryKey: ["improve", "follow-up-queue"] }),
        queryClient.invalidateQueries({ queryKey: ["export", "pack"] })
      ]);
    }
  });
}

export function useUpdateFollowUpQueue() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      verificationId,
      queue_status,
      due_date,
      owner_party_id,
      follow_up_note
    }: {
      verificationId: string;
      queue_status: string;
      due_date?: string;
      owner_party_id?: string;
      follow_up_note?: string;
    }) =>
      improveApi.updateFollowUpQueue(verificationId, {
        queue_status,
        due_date,
        owner_party_id,
        follow_up_note
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["improve", "dashboard"] }),
        queryClient.invalidateQueries({ queryKey: ["improve", "candidates"] }),
        queryClient.invalidateQueries({ queryKey: ["improve", "tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["improve", "verifications"] }),
        queryClient.invalidateQueries({ queryKey: ["improve", "attention-signals"] }),
        queryClient.invalidateQueries({ queryKey: ["improve", "follow-up-queue"] }),
        queryClient.invalidateQueries({ queryKey: ["export", "pack"] })
      ]);
    }
  });
}
