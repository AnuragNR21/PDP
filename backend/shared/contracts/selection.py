from pydantic import BaseModel, Field

from shared.contracts.common import FocusReason, SelectionMode
from shared.contracts.workspace_context import WorkspaceCode


class SelectionFocusContract(BaseModel):
    workspace: WorkspaceCode
    source_surface: str
    focused_item_kind: str = Field(min_length=1)
    canonical_entity_kind: str = Field(min_length=1)
    canonical_entity_id: str = Field(min_length=1)
    model_id: str | None = None
    scope_id: str | None = None
    reason: FocusReason
    selection_mode: SelectionMode = "single"
