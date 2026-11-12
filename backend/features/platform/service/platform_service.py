from pathlib import Path

from app.config import get_settings
from features.platform.domain.models import DiagnosticsStatus, HealthStatus, WorkspaceRoute
from shared.contracts.workspace_context import WorkspaceCode


class PlatformService:
    """Owns platform-level foundation behaviour only."""

    def get_health(self) -> HealthStatus:
        return HealthStatus()

    def get_diagnostics(self) -> DiagnosticsStatus:
        settings = get_settings()
        return DiagnosticsStatus(
            status='ok',
            service='pdp-backend',
            version=settings.app_version,
            database_present=Path(settings.resolved_database_path).exists(),
        )

    def list_workspace_routes(self) -> list[WorkspaceRoute]:
        return [
            WorkspaceRoute(workspace=WorkspaceCode.HOME, title='Home', route='/home', description='Home workspace entry and overview.'),
            WorkspaceRoute(workspace=WorkspaceCode.MODEL, title='Model', route='/model/tree-models', description='Model-owned tree model management.'),
            WorkspaceRoute(workspace=WorkspaceCode.STRUCTURE, title='Structure', route='/structure/tree', description='Structure-owned tree projection.'),
            WorkspaceRoute(workspace=WorkspaceCode.DISCOVER, title='Discover', route='/discover/mapping', description='Discover-owned mapping workflow.'),
            WorkspaceRoute(workspace=WorkspaceCode.IMPACT, title='Impact', route='/impact/knowledge-graph', description='Impact-owned consequence analysis.'),
            WorkspaceRoute(workspace=WorkspaceCode.IMPROVE, title='Improve', route='/improve/dashboard', description='Improve-owned trend and action visibility.'),
            WorkspaceRoute(workspace=WorkspaceCode.SETTINGS, title='Settings Organisation', route='/settings/organisation', description='Settings-owned organisation defaults.'),
            WorkspaceRoute(workspace=WorkspaceCode.SETTINGS, title='Settings Preferences', route='/settings/preferences', description='Settings-owned user-facing preferences and reference defaults.'),
            WorkspaceRoute(workspace=WorkspaceCode.SETTINGS, title='Settings Ownership', route='/settings/ownership', description='Settings-owned typed accountability assignments.'),
            WorkspaceRoute(workspace=WorkspaceCode.ADMIN, title='Admin Permissions', route='/admin/permissions', description='Admin-owned access control settings.'),
            WorkspaceRoute(workspace=WorkspaceCode.ADMIN, title='Admin Integrations', route='/admin/integrations', description='Admin-owned integration status and configuration.'),
            WorkspaceRoute(workspace=WorkspaceCode.ADMIN, title='Admin Audit', route='/admin/audit', description='Admin-owned audit review surface.'),
            WorkspaceRoute(workspace=WorkspaceCode.ADMIN, title='Admin Trial Operations', route='/admin/trial-ops', description='Admin-owned reset and reseed support tools.'),
            WorkspaceRoute(workspace=WorkspaceCode.ADMIN, title='Acceptance', route='/admin/acceptance', description='Admin-owned acceptance evidence and smoke execution.'),
            WorkspaceRoute(workspace=WorkspaceCode.ADMIN, title='Release Readiness', route='/admin/release-readiness', description='Admin-owned release-candidate closure and packaging readiness summary.'),
        ]
