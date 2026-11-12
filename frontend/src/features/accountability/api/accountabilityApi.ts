import { apiClient } from "@/shared/http/apiClient";
import type { AccountabilityAssignmentSummary, AccountabilityPartySummary } from "@/shared/contracts";

export const accountabilityApi = {
  listParties: () => apiClient.get<{ items: AccountabilityPartySummary[] }>("/accountability/parties"),
  listAssignments: (scopeType?: string, scopeId?: string) => {
    const params = new URLSearchParams();
    if (scopeType) params.set("scope_type", scopeType);
    if (scopeId) params.set("scope_id", scopeId);
    const suffix = params.toString();
    return apiClient.get<{ items: AccountabilityAssignmentSummary[] }>(`/accountability/assignments${suffix ? `?${suffix}` : ""}`);
  },
  createAssignment: (body: { scope_type: string; scope_id: string; role_code: string; party_id: string }) =>
    apiClient.post<{ assignment: AccountabilityAssignmentSummary }>("/accountability/assignments", body)
};
