from pydantic import BaseModel, Field


class ProjectionReferenceContract(BaseModel):
    projection_kind: str = Field(min_length=1)
    projection_id: str = Field(min_length=1)
    canonical_entity_kind: str = Field(min_length=1)
    canonical_entity_id: str = Field(min_length=1)
    model_id: str | None = None
    scope_id: str | None = None
