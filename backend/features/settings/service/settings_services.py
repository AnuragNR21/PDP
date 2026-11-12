
from features.settings.repo.settings_repository import SettingsRepository
from shared.contracts.canonical_types import OrganisationSettingSummary, UserPreferenceSummary


class SettingsService:
    def __init__(self, db_url: str):
        self._repository = SettingsRepository(db_url)

    def list_organisation_settings(self) -> list[OrganisationSettingSummary]:
        return self._repository.list_organisation_settings()

    def list_user_preferences(self) -> list[UserPreferenceSummary]:
        return self._repository.list_user_preferences()

    def update_organisation_setting(self, setting_key: str, setting_value: str, actor_label: str) -> OrganisationSettingSummary:
        return self._repository.update_organisation_setting(setting_key=setting_key, setting_value=setting_value, actor_label=actor_label)

    def update_user_preference(self, preference_key: str, preference_value: str, actor_label: str) -> UserPreferenceSummary:
        return self._repository.update_user_preference(preference_key=preference_key, preference_value=preference_value, actor_label=actor_label)
