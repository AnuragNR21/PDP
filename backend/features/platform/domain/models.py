from pydantic import BaseModel, Field

from shared.contracts.workspace_context import WorkspaceCode


class HealthStatus(BaseModel):
    status: str = Field(default='ok')
    service: str = Field(default='pdp-backend')


class DiagnosticsStatus(BaseModel):
    status: str
    service: str
    version: str
    database_present: bool


class WorkspaceRoute(BaseModel):
    workspace: WorkspaceCode
    title: str
    route: str
    description: str
