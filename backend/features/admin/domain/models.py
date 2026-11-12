from pydantic import BaseModel

from shared.contracts.canonical_types import (
    AuditRecordSummary,
    IntegrationConfigSummary,
    PermissionAssignmentSummary,
)


class PermissionsResponse(BaseModel):
    items: list[PermissionAssignmentSummary]


class IntegrationsResponse(BaseModel):
    items: list[IntegrationConfigSummary]


class AuditRecordsResponse(BaseModel):
    items: list[AuditRecordSummary]


class UpdatePermissionCommand(BaseModel):
    role_code: str
    action_code: str
    access_level: str
    actor_label: str = "Platform administrator"


class UpdateIntegrationCommand(BaseModel):
    display_name: str | None = None
    base_status: str | None = None
    config_json: dict[str, str] | None = None
    actor_label: str = "Platform administrator"
