from fastapi import APIRouter, Depends

from features.platform.domain.models import DiagnosticsStatus, HealthStatus, WorkspaceRoute
from features.platform.service.platform_service import PlatformService
from shared.auth.dependencies import get_current_user

router = APIRouter(prefix='/platform', tags=['platform'])
service = PlatformService()


@router.get('/health', response_model=HealthStatus)
def get_health() -> HealthStatus:
    return service.get_health()


@router.get('/diagnostics', response_model=DiagnosticsStatus, dependencies=[Depends(get_current_user)])
def get_diagnostics() -> DiagnosticsStatus:
    return service.get_diagnostics()


@router.get('/workspaces', response_model=list[WorkspaceRoute], dependencies=[Depends(get_current_user)])
def get_workspaces() -> list[WorkspaceRoute]:
    return service.list_workspace_routes()
