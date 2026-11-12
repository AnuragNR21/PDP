from pydantic import BaseModel, Field

from shared.contracts.common import FocusReason
from shared.contracts.workspace_context import WorkspaceCode


class NavigationHandoffContract(BaseModel):
    source_workspace: WorkspaceCode
    destination_workspace: WorkspaceCode
    destination_route: str = Field(min_length=1)
    entity_kind: str = Field(min_length=1)
    entity_id: str = Field(min_length=1)
    reason: FocusReason
