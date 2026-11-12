from datetime import datetime, timezone

from features.home.domain.models import (
    AlertSummaryItem,
    HomeOverviewCard,
    HomeOverviewResponse,
    RecentActivityItem,
)
from shared.contracts.common import AuditStamp
from shared.contracts.navigation import NavigationHandoffContract
from shared.contracts.workspace_context import WorkspaceCode, WorkspaceContextContract


class HomeService:
    """Owns Home workspace summary and launch-state behaviour."""

    def get_overview(self) -> HomeOverviewResponse:
        now = datetime.now(timezone.utc)
        return HomeOverviewResponse(
            cards=[
                HomeOverviewCard(
                    key="active-models",
                    title="Active model foundations",
                    value="1",
                    description="Governed model foundation available for MVP build start.",
                    handoff=NavigationHandoffContract(
                        source_workspace=WorkspaceCode.HOME,
                        destination_workspace=WorkspaceCode.MODEL,
                        destination_route="/model/tree-models",
                        entity_kind="treeModel",
                        entity_id="business-information-model",
                        reason="resume",
                    ),
                ),
                HomeOverviewCard(
                    key="structure-slices",
                    title="Structure slices",
                    value="0",
                    description="Authoritative Structure implementation begins after foundation.",
                    handoff=NavigationHandoffContract(
                        source_workspace=WorkspaceCode.HOME,
                        destination_workspace=WorkspaceCode.STRUCTURE,
                        destination_route="/structure/tree",
                        entity_kind="workspace",
                        entity_id="structure",
                        reason="launch",
                    ),
                ),
            ],
            alerts=[
                AlertSummaryItem(
                    alert_id="increment-1-foundation",
                    severity="info",
                    title="Increment 1 foundation is active",
                    description=(
                        "Platform baseline, canonical routes, and shared contracts "
                        "are ready for workspace delivery."
                    ),
                    handoff=NavigationHandoffContract(
                        source_workspace=WorkspaceCode.HOME,
                        destination_workspace=WorkspaceCode.ADMIN,
                        destination_route="/admin/permissions",
                        entity_kind="platformControl",
                        entity_id="increment-1",
                        reason="review",
                    ),
                )
            ],
            recent_activity=[
                RecentActivityItem(
                    activity_id="seed-home-1",
                    title="Backend foundation published",
                    description="FastAPI foundation, platform routes, and shared contracts added.",
                    workspace=WorkspaceCode.HOME,
                    context=WorkspaceContextContract(
                        workspace=WorkspaceCode.HOME,
                        source_surface="home.overview",
                        model_id=None,
                        scope_id="increment-1",
                        analysis_mode=None,
                        projection_mode="summary",
                        session_id=None,
                    ),
                    audit=AuditStamp(
                        actor_id="system",
                        occurred_at=now,
                        correlation_id="increment-1-seed-home-1",
                    ),
                )
            ],
        )
