from pydantic import BaseModel, Field

from shared.contracts.workspace_context import WorkspaceCode


class ActionRequestContract(BaseModel):
    requesting_workspace: WorkspaceCode
    action_family: str = Field(min_length=1)
    target_kind: str = Field(min_length=1)
    target_id: str = Field(min_length=1)
    requested_mutation: str = Field(min_length=1)
    parent_id: str | None = None
    scope_id: str | None = None
    correlation_id: str = Field(min_length=1)
    actor_id: str = Field(min_length=1)
