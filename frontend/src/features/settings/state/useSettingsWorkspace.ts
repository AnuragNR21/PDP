import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { settingsApi } from "@/features/settings/api/settingsApi";

export function useOrganisationSettings() {
  return useQuery({
    queryKey: ["settings", "organisation"],
    queryFn: async () => (await settingsApi.getOrganisationSettings()).items
  });
}

export function useUpdateOrganisationSetting() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ settingKey, settingValue, actorLabel }: { settingKey: string; settingValue: string; actorLabel: string }) =>
      settingsApi.updateOrganisationSetting(settingKey, settingValue, actorLabel),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["settings", "organisation"] });
      await queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
    }
  });
}

export function useUserPreferences() {
  return useQuery({
    queryKey: ["settings", "preferences"],
    queryFn: async () => (await settingsApi.getUserPreferences()).items
  });
}

export function useUpdateUserPreference() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ preferenceKey, preferenceValue, actorLabel }: { preferenceKey: string; preferenceValue: string; actorLabel: string }) =>
      settingsApi.updateUserPreference(preferenceKey, preferenceValue, actorLabel),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["settings", "preferences"] });
      await queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
    }
  });
}
