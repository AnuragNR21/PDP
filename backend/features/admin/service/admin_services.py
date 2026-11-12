from pathlib import Path

from features.admin.repo.admin_repository import AdminRepository
from shared.contracts.canonical_types import (
    AuditRecordSummary,
    IntegrationConfigSummary,
    PermissionAssignmentSummary,
)


class AdminService:
    def __init__(self, db_path: Path):
        self._repository = AdminRepository(db_path)

    def list_permissions(self) -> list[PermissionAssignmentSummary]:
        return self._repository.list_permissions()

    def update_permission(
        self, role_code: str, action_code: str, access_level: str, actor_label: str
    ) -> PermissionAssignmentSummary:
        return self._repository.update_permission(
            role_code=role_code,
            action_code=action_code,
            access_level=access_level,
            actor_label=actor_label,
        )

    def list_integrations(self) -> list[IntegrationConfigSummary]:
        return self._repository.list_integrations()

    def update_integration(
        self,
        integration_key: str,
        display_name: str | None,
        base_status: str | None,
        config_json: dict[str, str] | None,
        actor_label: str,
    ) -> IntegrationConfigSummary:
        return self._repository.update_integration(
            integration_key=integration_key,
            display_name=display_name,
            base_status=base_status,
            config_json=config_json,
            actor_label=actor_label,
        )

    def list_audit_records(self, limit: int = 50) -> list[AuditRecordSummary]:
        return self._repository.list_audit_records(limit=limit)
