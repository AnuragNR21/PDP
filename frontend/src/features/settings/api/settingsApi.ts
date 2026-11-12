import { apiClient } from "@/shared/http/apiClient";

export interface OrganisationSettingSummary {
  setting_key: string;
  setting_value: string;
  description: string;
  updated_at: string;
}

export interface UserPreferenceSummary {
  preference_key: string;
  preference_value: string;
  description: string;
  updated_at: string;
}

export const settingsApi = {
  getOrganisationSettings: () => apiClient.get<{ items: OrganisationSettingSummary[] }>("/api/settings/organisation"),
  updateOrganisationSetting: (settingKey: string, settingValue: string, actorLabel: string) =>
    apiClient.put<{ setting: OrganisationSettingSummary }>(`/settings/organisation/${settingKey}`, {
      setting_value: settingValue,
      actor_label: actorLabel
    }),
  getUserPreferences: () => apiClient.get<{ items: UserPreferenceSummary[] }>("/api/settings/preferences"),
  updateUserPreference: (preferenceKey: string, preferenceValue: string, actorLabel: string) =>
    apiClient.put<{ preference: UserPreferenceSummary }>(`/api/settings/preferences/${preferenceKey}`, {
      preference_value: preferenceValue,
      actor_label: actorLabel
    })
};
