import { apiClient } from "@/shared/http/apiClient";

export interface AuditRecordSummary {
  audit_id: string;
  category: string;
  action_code: string;
  object_ref: string;
  actor_label: string;
  detail: string;
  created_at: string;
}

export const adminApi = {
  getAudit: () => apiClient.get<{ items: AuditRecordSummary[] }>("/api/admin/audit")
};

// ── Admin > Users and Admin > Roles (PDP-251) ───────────────────────────────

export type InvitationStatus = "Invited" | "Active" | "Expired" | "Inactive";

export interface AdminUserSummary {
  user_id: string;
  email: string;
  display_name: string;
  status: "INVITED" | "ACTIVE" | "INACTIVE";
  invitation_status: InvitationStatus;
  invitation_expires_at: string;
  roles: string[];
  must_change_password: boolean;
  last_login_at: string;
  created_at: string;
  updated_at: string;
}

export interface InvitationIssued {
  user: AdminUserSummary;
  invitation_link: string;
  expires_at: string;
}

export interface PasswordResetIssued {
  user: AdminUserSummary;
  reset_link: string;
  expires_at: string;
}

export interface RoleDefinition {
  role_code: string;
  label: string;
  description: string;
  active_users: number;
}

export interface RolePermission {
  area: string;
  function: string;
  roles: string[];
}

export interface AdminUserFilters {
  search?: string;
  status?: string;
  role?: string;
}

function userQuery(filters: AdminUserFilters): string {
  const params = new URLSearchParams();
  if (filters.search) params.set("search", filters.search);
  if (filters.status) params.set("status", filters.status);
  if (filters.role) params.set("role", filters.role);
  const query = params.toString();
  return query ? `?${query}` : "";
}

export const adminUsersApi = {
  list: (filters: AdminUserFilters = {}) =>
    apiClient.get<{ items: AdminUserSummary[] }>(`/api/admin/users${userQuery(filters)}`),
  get: (userId: string) => apiClient.get<{ user: AdminUserSummary }>(`/api/admin/users/${userId}`),
  invite: (email: string, displayName: string, roles: string[]) =>
    apiClient.post<InvitationIssued>("/api/admin/users", { email, display_name: displayName, roles }),
  create: (email: string, displayName: string, password: string, roles: string[], mustChangePassword: boolean) =>
    apiClient.post<{ user: AdminUserSummary }>("/api/admin/users/create", {
      email,
      display_name: displayName,
      password,
      roles,
      must_change_password: mustChangePassword
    }),
  update: (userId: string, displayName: string) =>
    apiClient.put<{ user: AdminUserSummary }>(`/api/admin/users/${userId}`, { display_name: displayName }),
  setRoles: (userId: string, roles: string[]) =>
    apiClient.put<{ user: AdminUserSummary }>(`/api/admin/users/${userId}/roles`, { roles }),
  activate: (userId: string) => apiClient.post<{ user: AdminUserSummary }>(`/api/admin/users/${userId}/activate`),
  deactivate: (userId: string) => apiClient.post<{ user: AdminUserSummary }>(`/api/admin/users/${userId}/deactivate`),
  resendInvitation: (userId: string) =>
    apiClient.post<InvitationIssued>(`/api/admin/users/${userId}/invitation/resend`),
  cancelInvitation: (userId: string) => apiClient.delete<void>(`/api/admin/users/${userId}/invitation`),
  issuePasswordReset: (userId: string) =>
    apiClient.post<PasswordResetIssued>(`/api/admin/users/${userId}/password-reset`),
  roles: () => apiClient.get<{ roles: RoleDefinition[]; permissions: RolePermission[] }>("/api/admin/roles")
};
