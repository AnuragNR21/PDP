from fastapi import APIRouter, Depends, HTTPException, Query

from app.config import Settings
from app.dependencies import get_settings
from features.admin.domain.models import (
    AuditRecordsResponse,
    IntegrationsResponse,
    PermissionsResponse,
    UpdateIntegrationCommand,
    UpdatePermissionCommand,
)
from features.admin.service.admin_services import AdminService

router = APIRouter(prefix="/admin", tags=["admin"])


def get_service(settings: Settings = Depends(get_settings)) -> AdminService:
    return AdminService(settings.database_url)


@router.get("/permissions", response_model=PermissionsResponse)
def list_permissions(service: AdminService = Depends(get_service)) -> PermissionsResponse:
    return PermissionsResponse(items=service.list_permissions())


@router.put("/permissions")
def update_permission(
    command: UpdatePermissionCommand, service: AdminService = Depends(get_service)
) -> dict[str, object]:
    return {
        "permission": service.update_permission(
            role_code=command.role_code,
            action_code=command.action_code,
            access_level=command.access_level,
            actor_label=command.actor_label,
        )
    }


@router.get("/integrations", response_model=IntegrationsResponse)
def list_integrations(service: AdminService = Depends(get_service)) -> IntegrationsResponse:
    return IntegrationsResponse(items=service.list_integrations())


@router.put("/integrations/{integration_key}")
def update_integration(
    integration_key: str,
    command: UpdateIntegrationCommand,
    service: AdminService = Depends(get_service),
) -> dict[str, object]:
    try:
        integration = service.update_integration(
            integration_key=integration_key,
            display_name=command.display_name,
            base_status=command.base_status,
            config_json=command.config_json,
            actor_label=command.actor_label,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"integration": integration}


@router.get("/audit", response_model=AuditRecordsResponse)
def list_audit_records(
    limit: int = Query(default=50, ge=1, le=200),
    service: AdminService = Depends(get_service),
) -> AuditRecordsResponse:
    return AuditRecordsResponse(items=service.list_audit_records(limit=limit))
