from enum import StrEnum

from pydantic import BaseModel


class WorkspaceCode(StrEnum):
    HOME = "home"
    MODEL = "model"
    STRUCTURE = "structure"
    DISCOVER = "discover"
    IMPACT = "impact"
    IMPROVE = "improve"
    SETTINGS = "settings"
    ADMIN = "admin"


class WorkspaceContextContract(BaseModel):
    workspace: WorkspaceCode
    source_surface: str
    model_id: str | None = None
    scope_id: str | None = None
    analysis_mode: str | None = None
    projection_mode: str | None = None
    session_id: str | None = None
