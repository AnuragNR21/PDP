from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class AuditStamp(BaseModel):
    actor_id: str = Field(min_length=1)
    occurred_at: datetime
    correlation_id: str = Field(min_length=1)


SelectionMode = Literal["single", "multi"]
FocusReason = Literal["click", "launch", "resume", "programmatic", "review"]
ProjectionMode = Literal["tree", "diagram", "matrix", "summary", "dashboard", "graph"]
RefreshScope = Literal["workspace", "feature", "entity", "projection", "session"]
