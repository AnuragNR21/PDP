from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

from shared.contracts.model_config import ModelItemType, ModelType
from .models import LifecycleStatus, ModelDomain, RelationshipKind, support_domain_relationship_kind
from .badge_constants import (
    DEFAULT_BADGE_COLOR,
    DEFAULT_BADGE_CONTENT_TYPE,
    DEFAULT_BADGE_ICON,
    DEFAULT_BADGE_SHAPE,
    DEFAULT_BADGE_SIZE,
    DEFAULT_BADGE_TEXT,
    DEFAULT_BADGE_TEXT_COLOR,
)


class CreateHierarchyModelCommand(BaseModel):
    name: str = Field(min_length=1)
    purpose: str = Field(min_length=1)
    owning_domain: ModelDomain
    status: LifecycleStatus = "draft"


class UpdateHierarchyModelCommand(CreateHierarchyModelCommand):
    pass


class CreateHierarchyNodeTypeCommand(BaseModel):
    model_id: str = Field(min_length=1)
    parent_node_id: str | None = None
    name: str = Field(min_length=1)
    display_name: str = ""
    badge: str = ""
    description: str = ""
    sort_order: int = 0
    is_recursive: bool = False
    #: A property node holds a value, not a level. Nothing may be added under
    #: one — the check boxes the type in as a leaf on purpose.
    is_property: bool = False
    status: LifecycleStatus = "draft"


class UpdateHierarchyNodeTypeCommand(CreateHierarchyNodeTypeCommand):
    confirm_recursive_removal: bool = False


class CreateHierarchyNodeTypePropertyCommand(BaseModel):
    node_type_id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    description: str = ""
    inheritable: bool = False
    status: LifecycleStatus = "draft"


class UpdateHierarchyNodeTypePropertyCommand(CreateHierarchyNodeTypePropertyCommand):
    pass


class InstanceParentAssignmentInput(BaseModel):
    instance_id: str = Field(min_length=1)
    new_parent_instance_id: str | None = None


class ReorderHierarchyNodeTypeCommand(BaseModel):
    new_parent_node_id: str | None = None
    position: int = Field(ge=0, description="0-based index among siblings after the move.")
    confirm_instance_reparent: bool = Field(
        default=False,
        description="Required acknowledgement when the reparent affects existing Structure Workspace node instances.",
    )
    instance_parent_assignments: list[InstanceParentAssignmentInput] = Field(
        default_factory=list,
        description="Chosen new parent instance for each affected node instance (from the reparent-impact mapping).",
    )


class CreateHierarchyRuleCommand(BaseModel):
    model_id: str = Field(min_length=1)
    parent_node_id: str = Field(min_length=1)
    child_node_id: str = Field(min_length=1)
    relationship_kind: RelationshipKind = RelationshipKind.parent_child
    notes: str = ""
    status: LifecycleStatus = "draft"


class UpdateHierarchyRuleCommand(CreateHierarchyRuleCommand):
    pass


class CreateSupportDomainModelCommand(BaseModel):
    name: str = Field(min_length=1)
    purpose: str = Field(min_length=1)
    status: LifecycleStatus = "draft"


class UpdateSupportDomainModelCommand(CreateSupportDomainModelCommand):
    pass


class CreateSupportDomainElementCommand(BaseModel):
    model_id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    display_name: str = ""
    badge: str = ""
    description: str = ""
    status: LifecycleStatus = "draft"


class UpdateSupportDomainElementCommand(CreateSupportDomainElementCommand):
    pass

class UpdateSupportDomainElementPositionCommand(BaseModel):
    x: float
    y: float


class CreateSupportDomainElementPropertyCommand(BaseModel):
    element_id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    description: str = ""
    status: LifecycleStatus = "draft"


class UpdateSupportDomainElementPropertyCommand(CreateSupportDomainElementPropertyCommand):
    pass

class CreateSupportDomainDiagramNodesCommand(BaseModel):
    model_id: str = Field(min_length=1)


class CreateSupportDomainRelationshipCommand(BaseModel):
    model_id: str = Field(min_length=1)
    source_element_id: str = Field(min_length=1)
    target_element_id: str = Field(min_length=1)
    # A standard kind (key or label), or a name of the model's own such as "zz 123".
    relationship_kind: str = RelationshipKind.categorises.value
    notes: str = ""
    status: LifecycleStatus = "draft"

    @field_validator("relationship_kind", mode="before")
    @classmethod
    def _normalise_kind(cls, value: object) -> str:
        return support_domain_relationship_kind(value)


class UpdateSupportDomainRelationshipCommand(CreateSupportDomainRelationshipCommand):
    pass


class SaveBadgeCommand(BaseModel):
    badge_text: str = DEFAULT_BADGE_TEXT
    badge_shape: str = DEFAULT_BADGE_SHAPE
    badge_color: str = DEFAULT_BADGE_COLOR
    badge_text_color: str = DEFAULT_BADGE_TEXT_COLOR
    badge_icon: str | None = DEFAULT_BADGE_ICON
    badge_size: int = DEFAULT_BADGE_SIZE
    badge_content_type: str = DEFAULT_BADGE_CONTENT_TYPE


class CreateCrossModelRelationshipTypeCommand(BaseModel):
    name: str = Field(min_length=1)
    description: str | None = None
    source_model_type: ModelType = "HIERARCHY_MODEL"
    source_model_item_type_id: str | None = None
    target_model_type: ModelType = "HIERARCHY_MODEL"
    target_model_item_type_id: str | None = None
    #: What this relationship means to the rules, as opposed to the diagram.
    #: None is an ordinary modelling relationship. "approves_values" marks the
    #: one whose edges ARE the approved set a check runs against, so a value
    #: governed on the diagram is the same fact as a value picked in the
    #: Structure Rules panel.
    governance_role: Literal["approves_values"] | None = None
    status: LifecycleStatus = "active"


class UpdateCrossModelRelationshipTypeCommand(CreateCrossModelRelationshipTypeCommand):
    pass


class CrossModelRelationshipTypeDiagramNodeInput(BaseModel):
    item_type_id: str = Field(min_length=1)
    item_kind: ModelItemType
    pos_x: float = 0
    pos_y: float = 0


class CrossModelRelationshipTypeDiagramEdgeInput(BaseModel):
    """Per-connection line-style override; edge_key is the diagram's edge identifier."""

    edge_key: str = Field(min_length=1)
    edge_style: Literal["curved", "straight", "elbow"] = "curved"


class CrossModelRelationshipTypeDiagramShapeInput(BaseModel):
    """A drawn annotation — a box, circle, text or note. Carries no business data."""

    shape_kind: Literal["RECTANGLE", "ELLIPSE", "TEXT", "NOTE"]
    pos_x: float = 0
    pos_y: float = 0
    width: float = 200
    height: float = 120
    text: str = ""
    # Style overrides; None means "use the shape kind's default".
    stroke_color: str | None = None
    text_color: str | None = None
    font_size: float | None = None
    z_index: int | None = None


class SaveCrossModelRelationshipTypeDiagramCommand(BaseModel):
    name: str = Field(min_length=1)
    nodes: list[CrossModelRelationshipTypeDiagramNodeInput] = Field(default_factory=list)
    edges: list[CrossModelRelationshipTypeDiagramEdgeInput] = Field(default_factory=list)
    shapes: list[CrossModelRelationshipTypeDiagramShapeInput] = Field(default_factory=list)
