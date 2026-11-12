import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminUsersApi, type AdminUserFilters } from "@/features/admin/api/adminApi";
import { useAuth } from "@/features/auth/state/AuthContext";

const USERS_KEY = ["admin", "users"];

export function useAdminUsers(filters: AdminUserFilters) {
  return useQuery({
    queryKey: [...USERS_KEY, filters],
    queryFn: async () => (await adminUsersApi.list(filters)).items
  });
}

export function useAdminRoles() {
  return useQuery({
    queryKey: ["admin", "roles"],
    queryFn: () => adminUsersApi.roles()
  });
}

/**
 * Every user mutation refreshes the list, the role counts and the audit log.
 * A change to the signed-in administrator's own roles also refreshes the
 * session, so the menu and guards see it straight away.
 */
function useUserMutation<TArgs, TResult>(run: (args: TArgs) => Promise<TResult>, touchedUserId: (args: TArgs) => string | null) {
  const queryClient = useQueryClient();
  const { user, refresh } = useAuth();
  return useMutation({
    mutationFn: run,
    onSuccess: async (_result, args) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: USERS_KEY }),
        queryClient.invalidateQueries({ queryKey: ["admin", "roles"] }),
        queryClient.invalidateQueries({ queryKey: ["admin", "audit"] })
      ]);
      if (user && touchedUserId(args) === user.user_id) await refresh();
    }
  });
}

export function useInviteUser() {
  return useUserMutation(
    ({ email, displayName, roles }: { email: string; displayName: string; roles: string[] }) =>
      adminUsersApi.invite(email, displayName, roles),
    () => null
  );
}

export function useCreateUser() {
  return useUserMutation(
    ({ email, displayName, password, roles, mustChangePassword }: { email: string; displayName: string; password: string; roles: string[]; mustChangePassword: boolean }) =>
      adminUsersApi.create(email, displayName, password, roles, mustChangePassword),
    () => null
  );
}

export function useUpdateUser() {
  return useUserMutation(
    ({ userId, displayName }: { userId: string; displayName: string }) => adminUsersApi.update(userId, displayName),
    ({ userId }) => userId
  );
}

export function useSetUserRoles() {
  return useUserMutation(
    ({ userId, roles }: { userId: string; roles: string[] }) => adminUsersApi.setRoles(userId, roles),
    ({ userId }) => userId
  );
}

export function useActivateUser() {
  return useUserMutation((userId: string) => adminUsersApi.activate(userId), (userId) => userId);
}

export function useDeactivateUser() {
  return useUserMutation((userId: string) => adminUsersApi.deactivate(userId), (userId) => userId);
}

export function useResendInvitation() {
  return useUserMutation((userId: string) => adminUsersApi.resendInvitation(userId), () => null);
}

export function useCancelInvitation() {
  return useUserMutation((userId: string) => adminUsersApi.cancelInvitation(userId), () => null);
}

export function useIssuePasswordReset() {
  return useUserMutation((userId: string) => adminUsersApi.issuePasswordReset(userId), () => null);
}
