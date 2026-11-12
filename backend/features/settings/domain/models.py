from pydantic import BaseModel

from shared.contracts.canonical_types import OrganisationSettingSummary, UserPreferenceSummary


class OrganisationSettingsResponse(BaseModel):
    items: list[OrganisationSettingSummary]


class UserPreferencesResponse(BaseModel):
    items: list[UserPreferenceSummary]


class UpdateOrganisationSettingCommand(BaseModel):
    setting_value: str
    actor_label: str = 'Settings administrator'


class UpdateUserPreferenceCommand(BaseModel):
    preference_value: str
    actor_label: str = 'Settings administrator'
