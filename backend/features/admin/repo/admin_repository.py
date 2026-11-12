from __future__ import annotations

import json
from pathlib import Path
from uuid import uuid4

from shared.contracts.canonical_types import (
    AuditRecordSummary,
    IntegrationConfigSummary,
    PermissionAssignmentSummary,
)
from shared.db import get_connection, utc_now_iso


class AdminRepository:
    def __init__(self, db_path: Path):
        self._db_path = db_path

    def list_permissions(self) -> list[PermissionAssignmentSummary]:
        with get_connection(self._db_path) as connection:
            rows = connection.execute(
                "SELECT permission_id, role_code, action_code, access_level, updated_at FROM permission_assignment ORDER BY role_code, action_code"
            ).fetchall()
        return [
            PermissionAssignmentSummary(
                permission_id=row["permission_id"],
                role_code=row["role_code"],
                action_code=row["action_code"],
                access_level=row["access_level"],
                updated_at=row["updated_at"],
            )
            for row in rows
        ]

    def update_permission(
        self, role_code: str, action_code: str, access_level: str, actor_label: str
    ) -> PermissionAssignmentSummary:
        timestamp = utc_now_iso()
        with get_connection(self._db_path) as connection:
            row = connection.execute(
                "SELECT permission_id FROM permission_assignment WHERE role_code = %s AND action_code = %s",
                (role_code, action_code),
            ).fetchone()
            permission_id = row["permission_id"] if row else f"perm_{uuid4().hex[:12]}"
            connection.execute(
                """
                INSERT INTO permission_assignment (permission_id, role_code, action_code, access_level, updated_at)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT(role_code, action_code)
                DO UPDATE SET permission_id=excluded.permission_id, access_level=excluded.access_level, updated_at=excluded.updated_at
                """,
                (permission_id, role_code, action_code, access_level, timestamp),
            )
            self._insert_audit_record(
                connection,
                category="admin",
                action_code="permission.updated",
                object_ref=f"{role_code}:{action_code}",
                actor_label=actor_label,
                detail=f"Permission {role_code}:{action_code} set to {access_level}.",
            )
            row = connection.execute(
                "SELECT permission_id, role_code, action_code, access_level, updated_at FROM permission_assignment WHERE role_code = %s AND action_code = %s",
                (role_code, action_code),
            ).fetchone()
        return PermissionAssignmentSummary(
            permission_id=row["permission_id"],
            role_code=row["role_code"],
            action_code=row["action_code"],
            access_level=row["access_level"],
            updated_at=row["updated_at"],
        )

    def list_integrations(self) -> list[IntegrationConfigSummary]:
        with get_connection(self._db_path) as connection:
            rows = connection.execute(
                "SELECT integration_key, display_name, base_status, config_json, updated_at FROM integration_config ORDER BY integration_key"
            ).fetchall()
        return [
            IntegrationConfigSummary(
                integration_key=row["integration_key"],
                display_name=row["display_name"],
                base_status=row["base_status"],
                config_json=json.loads(row["config_json"]),
                updated_at=row["updated_at"],
            )
            for row in rows
        ]

    def update_integration(
        self,
        integration_key: str,
        display_name: str | None,
        base_status: str | None,
        config_json: dict[str, str] | None,
        actor_label: str,
    ) -> IntegrationConfigSummary:
        with get_connection(self._db_path) as connection:
            current = connection.execute(
                "SELECT integration_key, display_name, base_status, config_json, updated_at FROM integration_config WHERE integration_key = %s",
                (integration_key,),
            ).fetchone()
            if current is None:
                raise ValueError(f"Unknown integration: {integration_key}")
            updated_display_name = display_name or current["display_name"]
            updated_base_status = base_status or current["base_status"]
            updated_config = (
                config_json if config_json is not None else json.loads(current["config_json"])
            )
            timestamp = utc_now_iso()
            connection.execute(
                """
                UPDATE integration_config
                SET display_name = %s, base_status = %s, config_json = %s, updated_at = %s
                WHERE integration_key = %s
                """,
                (
                    updated_display_name,
                    updated_base_status,
                    json.dumps(updated_config),
                    timestamp,
                    integration_key,
                ),
            )
            self._insert_audit_record(
                connection,
                category="admin",
                action_code="integration.updated",
                object_ref=integration_key,
                actor_label=actor_label,
                detail=f"Integration {integration_key} updated to status {updated_base_status}.",
            )
            row = connection.execute(
                "SELECT integration_key, display_name, base_status, config_json, updated_at FROM integration_config WHERE integration_key = %s",
                (integration_key,),
            ).fetchone()
        return IntegrationConfigSummary(
            integration_key=row["integration_key"],
            display_name=row["display_name"],
            base_status=row["base_status"],
            config_json=json.loads(row["config_json"]),
            updated_at=row["updated_at"],
        )

    def list_audit_records(self, limit: int = 50) -> list[AuditRecordSummary]:
        with get_connection(self._db_path) as connection:
            rows = connection.execute(
                "SELECT audit_id, category, action_code, object_ref, actor_label, detail, created_at FROM audit_record ORDER BY created_at DESC LIMIT %s",
                (limit,),
            ).fetchall()
        return [
            AuditRecordSummary(
                audit_id=row["audit_id"],
                category=row["category"],
                action_code=row["action_code"],
                object_ref=row["object_ref"],
                actor_label=row["actor_label"],
                detail=row["detail"],
                created_at=row["created_at"],
            )
            for row in rows
        ]

    @staticmethod
    def _insert_audit_record(
        connection, category: str, action_code: str, object_ref: str, actor_label: str, detail: str
    ) -> None:
        connection.execute(
            """
            INSERT INTO audit_record (audit_id, category, action_code, object_ref, actor_label, detail, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (
                f"audit_{uuid4().hex[:12]}",
                category,
                action_code,
                object_ref,
                actor_label,
                detail,
                utc_now_iso(),
            ),
        )
