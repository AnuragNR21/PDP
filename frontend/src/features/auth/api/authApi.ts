import { apiClient } from "@/shared/http/apiClient";

export interface AuthUser {
  user_id: string;
  email: string;
  display_name: string;
  roles: string[];
  must_change_password: boolean;
  last_login_at: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: "bearer";
  expires_in_seconds: number;
  user: AuthUser;
}

export interface InvitationPreview {
  email: string;
  display_name: string;
  expires_at: string;
}

export const authApi = {
  login: (email: string, password: string) =>
    apiClient.post<LoginResponse>("/api/auth/login", { email, password }),
  logout: () => apiClient.post<void>("/api/auth/logout"),
  me: () => apiClient.get<{ user: AuthUser }>("/api/auth/me"),
  updateMe: (displayName: string) =>
    apiClient.put<{ user: AuthUser }>("/api/auth/me", { display_name: displayName }),
  changePassword: (currentPassword: string, newPassword: string) =>
    apiClient.post<void>("/api/auth/change-password", {
      current_password: currentPassword,
      new_password: newPassword
    }),
  forgotPassword: (email: string) =>
    apiClient.post<{ detail: string }>("/api/auth/forgot-password", { email }),
  resetPassword: (token: string, newPassword: string) =>
    apiClient.post<void>("/api/auth/reset-password", { token, new_password: newPassword }),
  previewInvitation: (token: string) =>
    apiClient.get<InvitationPreview>(`/api/auth/invitations/${encodeURIComponent(token)}`),
  acceptInvitation: (token: string, displayName: string, password: string) =>
    apiClient.post<void>("/api/auth/accept-invitation", { token, display_name: displayName, password })
};
