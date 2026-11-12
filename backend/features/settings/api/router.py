from fastapi import APIRouter, Depends

from app.config import Settings
from app.dependencies import get_settings
from features.settings.domain.models import (
    OrganisationSettingsResponse,
    UpdateOrganisationSettingCommand,
    UpdateUserPreferenceCommand,
    UserPreferencesResponse,
)
from features.settings.service.settings_services import SettingsService
from shared.auth.dependencies import require_admin

router = APIRouter(prefix='/settings', tags=['settings'])


def get_service(settings: Settings = Depends(get_settings)) -> SettingsService:
    return SettingsService(settings.database_url)


@router.get('/organisation', response_model=OrganisationSettingsResponse)
def list_organisation_settings(service: SettingsService = Depends(get_service)) -> OrganisationSettingsResponse:
    return OrganisationSettingsResponse(items=service.list_organisation_settings())


@router.put('/organisation/{setting_key}', dependencies=[Depends(require_admin)])
def update_organisation_setting(
    setting_key: str,
    command: UpdateOrganisationSettingCommand,
    service: SettingsService = Depends(get_service),
) -> dict[str, object]:
    return {
        'setting': service.update_organisation_setting(
            setting_key=setting_key,
            setting_value=command.setting_value,
            actor_label=command.actor_label,
        )
    }


@router.get('/preferences', response_model=UserPreferencesResponse)
def list_user_preferences(service: SettingsService = Depends(get_service)) -> UserPreferencesResponse:
    return UserPreferencesResponse(items=service.list_user_preferences())


@router.put('/preferences/{preference_key}')
def update_user_preference(
    preference_key: str,
    command: UpdateUserPreferenceCommand,
    service: SettingsService = Depends(get_service),
) -> dict[str, object]:
    return {
        'preference': service.update_user_preference(
            preference_key=preference_key,
            preference_value=command.preference_value,
            actor_label=command.actor_label,
        )
    }
