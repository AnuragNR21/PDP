from pydantic import BaseModel, Field

from shared.contracts.common import AuditStamp
from shared.contracts.navigation import NavigationHandoffContract
from shared.contracts.workspace_context import WorkspaceCode, WorkspaceContextContract


class HomeOverviewCard(BaseModel):
    key: str
    title: str
    value: str
    description: str
    handoff: NavigationHandoffContract


class RecentActivityItem(BaseModel):
    activity_id: str
    title: str
    description: str
    workspace: WorkspaceCode
    context: WorkspaceContextContract
    audit: AuditStamp


class AlertSummaryItem(BaseModel):
    alert_id: str
    severity: str
    title: str
    description: str
    handoff: NavigationHandoffContract


class HomeOverviewResponse(BaseModel):
    workspace: WorkspaceCode = Field(default=WorkspaceCode.HOME)
    cards: list[HomeOverviewCard]
    alerts: list[AlertSummaryItem]
    recent_activity: list[RecentActivityItem]
