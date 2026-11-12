from __future__ import annotations

from uuid import uuid4

from shared.contracts.canonical_types import OrganisationSettingSummary, UserPreferenceSummary
from shared.db import get_connection, utc_now_iso

ORGANISATION_DESCRIPTIONS = {
    'default_model_id': 'Default model selected when trial users enter the workspace shell.',
    'guided_mode_enabled': 'Determines whether trial guidance cues are shown by default.',
    'default_due_days': 'Default remediation due date lead time for seeded trial operations.',
}

PREFERENCE_DESCRIPTIONS = {
    'theme_mode': 'Preferred visual appearance mode for the hosted prototype.',
    'results_page_size': 'Default number of rows shown in results-oriented tables.',
    'show_trial_hints': 'Controls whether guided trial hints are visible in user-facing workspaces.',
}


class SettingsRepository:
    def __init__(self, db_url: str):
        self._db_url = db_url

    def list_organisation_settings(self) -> list[OrganisationSettingSummary]:
        with get_connection(self._db_url) as connection:
            rows = connection.execute(
                'SELECT setting_key, setting_value, updated_at FROM organisation_setting ORDER BY setting_key'
            ).fetchall()
        return [
            OrganisationSettingSummary(
                setting_key=row['setting_key'],
                setting_value=row['setting_value'],
                description=ORGANISATION_DESCRIPTIONS.get(row['setting_key'], ''),
                updated_at=row['updated_at'],
            )
            for row in rows
        ]

    def list_user_preferences(self) -> list[UserPreferenceSummary]:
        with get_connection(self._db_url) as connection:
            rows = connection.execute(
                'SELECT preference_key, preference_value, updated_at FROM user_preference ORDER BY preference_key'
            ).fetchall()
        return [
            UserPreferenceSummary(
                preference_key=row['preference_key'],
                preference_value=row['preference_value'],
                description=PREFERENCE_DESCRIPTIONS.get(row['preference_key'], ''),
                updated_at=row['updated_at'],
            )
            for row in rows
        ]

    def update_organisation_setting(self, setting_key: str, setting_value: str, actor_label: str) -> OrganisationSettingSummary:
        timestamp = utc_now_iso()
        with get_connection(self._db_url) as connection:
            connection.execute(
                '''
                INSERT INTO organisation_setting (setting_key, setting_value, updated_at)
                VALUES (%s, %s, %s)
                ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value, updated_at=excluded.updated_at
                ''',
                (setting_key, setting_value, timestamp),
            )
            self._insert_audit_record(
                connection,
                category='settings',
                action_code='organisation_setting.updated',
                object_ref=setting_key,
                actor_label=actor_label,
                detail=f'Organisation setting {setting_key} updated to {setting_value}.',
            )
            row = connection.execute(
                'SELECT setting_key, setting_value, updated_at FROM organisation_setting WHERE setting_key = %s',
                (setting_key,),
            ).fetchone()
        return OrganisationSettingSummary(
            setting_key=row['setting_key'],
            setting_value=row['setting_value'],
            description=ORGANISATION_DESCRIPTIONS.get(row['setting_key'], ''),
            updated_at=row['updated_at'],
        )

    def update_user_preference(self, preference_key: str, preference_value: str, actor_label: str) -> UserPreferenceSummary:
        timestamp = utc_now_iso()
        with get_connection(self._db_url) as connection:
            connection.execute(
                '''
                INSERT INTO user_preference (preference_key, preference_value, updated_at)
                VALUES (%s, %s, %s)
                ON CONFLICT(preference_key) DO UPDATE SET preference_value=excluded.preference_value, updated_at=excluded.updated_at
                ''',
                (preference_key, preference_value, timestamp),
            )
            self._insert_audit_record(
                connection,
                category='settings',
                action_code='user_preference.updated',
                object_ref=preference_key,
                actor_label=actor_label,
                detail=f'User preference {preference_key} updated to {preference_value}.',
            )
            row = connection.execute(
                'SELECT preference_key, preference_value, updated_at FROM user_preference WHERE preference_key = %s',
                (preference_key,),
            ).fetchone()
        return UserPreferenceSummary(
            preference_key=row['preference_key'],
            preference_value=row['preference_value'],
            description=PREFERENCE_DESCRIPTIONS.get(row['preference_key'], ''),
            updated_at=row['updated_at'],
        )

    @staticmethod
    def _insert_audit_record(connection, category: str, action_code: str, object_ref: str, actor_label: str, detail: str) -> None:
        connection.execute(
            '''
            INSERT INTO audit_record (audit_id, category, action_code, object_ref, actor_label, detail, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ''',
            (f'audit_{uuid4().hex[:12]}', category, action_code, object_ref, actor_label, detail, utc_now_iso()),
        )
