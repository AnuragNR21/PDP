from pydantic import BaseModel, Field

from shared.contracts.common import RefreshScope


class RefreshRequest(BaseModel):
    scope: RefreshScope
    reason: str = Field(min_length=1)
    targets: list[str] = Field(default_factory=list)
