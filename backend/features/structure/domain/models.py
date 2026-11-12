from typing import Literal

from pydantic import BaseModel, Field

from shared.model_config import HIERARCHY_MODEL, SUPPORT_DOMAIN_MODEL
from shared.contracts.canonical_types import (
    CanonicalNodeSummary,
    DiagramProjectionSummary,
    MatrixProjectionSummary,
    RelationshipInstanceSummary,
    TreePathItem,
)
from shared.contracts.model_config import ModelItemType


class CreateCanonicalNodeCommand(BaseModel):
    model_id: str = Field(min_length=1)
    node_type_id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    parent_node_id: str | None = None


class UpdateCanonicalNodeCommand(BaseModel):
    name: str = Field(min_length=1)
    #: draft | active | retired (shown as Archived); omitted leaves it unchanged.
    status: str | None = None


class ReparentNodeCommand(BaseModel):
    node_id: str = Field(min_length=1)
    new_parent_node_id: str | None = None
    requested_position: int | None = None


class ReorderNodeCommand(BaseModel):
    parent_node_id: str | None = None
    ordered_child_node_ids: list[str] = Field(min_length=1)


class CreateRelationshipCommand(BaseModel):
    semantic_key: str = Field(min_length=1)
    source_node_id: str = Field(min_length=1)
    target_node_id: str = Field(min_length=1)


class StructureTreeResponse(BaseModel):
    items: list[CanonicalNodeSummary]


class StructurePathResponse(BaseModel):
    items: list[TreePathItem]


class NodeDetail(BaseModel):
    node: CanonicalNodeSummary
    children: list[CanonicalNodeSummary]
    relationships: list[RelationshipInstanceSummary]


class DiagramProjectionResponse(BaseModel):
    projection: DiagramProjectionSummary


class MatrixProjectionResponse(BaseModel):
    projection: MatrixProjectionSummary


class CreateElementInstanceCommand(BaseModel):
    support_domain_model_id: str = Field(min_length=1)
    element_type_id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    description: str | None = None


class UpdateElementInstanceCommand(BaseModel):
    name: str = Field(min_length=1)
    description: str | None = None
    #: draft | active | retired (shown as Archived); omitted leaves it unchanged.
    status: str | None = None


class CreateCrossModelInstanceCommand(BaseModel):
    relationship_rule_id: str = Field(min_length=1)
    source_instance_id: str = Field(min_length=1)
    source_instance_type: str = Field(pattern=f'^({HIERARCHY_MODEL}|{SUPPORT_DOMAIN_MODEL})$')
    target_instance_id: str = Field(min_length=1)
    target_instance_type: str = Field(pattern=f'^({HIERARCHY_MODEL}|{SUPPORT_DOMAIN_MODEL})$')


class SdDiagramNode(BaseModel):
    """Where one element type card sits on a Support Domain model's diagram."""

    item_id: str = Field(min_length=1)
    item_kind: str = "element_type"
    pos_x: float
    pos_y: float


class ReplaceSdDiagramNodesCommand(BaseModel):
    support_domain_model_id: str = Field(min_length=1)
    nodes: list[SdDiagramNode] = Field(default_factory=list)


class CreateElementRelationshipInstanceCommand(BaseModel):
    """A link between two element instances of one Support Domain model, as an
    instance of one of that model's relationships."""

    support_domain_relationship_id: str = Field(min_length=1)
    source_instance_id: str = Field(min_length=1)
    target_instance_id: str = Field(min_length=1)


class UpdateCrossModelInstanceCommand(BaseModel):
    """An instance only ever picks one of the governed types defined in the Model
    workspace, so re-pointing it at another type is the whole of the update."""

    relationship_rule_id: str = Field(min_length=1)


class UpsertInstancePropertyCommand(BaseModel):
    property_type_id: str = Field(min_length=1)


class SetNodePropertyValueCommand(BaseModel):
    """The value a Node Instance gives a Property its Node Type defines. Empty clears it."""

    value: str = Field(default="", max_length=4000)


class StructureImportRow(BaseModel):
    row_number: int = Field(ge=1)
    object_type: str = Field(pattern='^(hierarchy_model_node_instance|support_domain_model_element_instance|support_domain_model_element_instance_relationship|support_domain_relationship_instance)$')
    action: str = Field(pattern='^(CREATE|UPSERT)$')
    status: str = Field(pattern='^(accepted|rejected)$')
    code: str = Field(min_length=1)
    message: str = Field(min_length=1)
    warnings: list[str] = Field(default_factory=list)
    key: str | None = None


class StructureImportPayload(BaseModel):
    template_metadata: dict = Field(default_factory=dict)
    load_hierarchy_node_instances: list[dict] = Field(default_factory=list)
    load_support_domain_elements: list[dict] = Field(default_factory=list)
    load_support_domain_element_relationships: list[dict] = Field(default_factory=list)
    load_support_domain_relationships: list[dict] = Field(default_factory=list)
    load_support_domain_element_instance_relationships: list[dict] = Field(default_factory=list)


class StructureImportValidateRequest(BaseModel):
    payload: StructureImportPayload


class StructureHierarchyImportValidateRequest(BaseModel):
    template_metadata: dict = Field(default_factory=dict)
    load_hierarchy_node_instances: list[dict] = Field(default_factory=list)


class StructureSupportDomainImportValidateRequest(BaseModel):
    template_metadata: dict = Field(default_factory=dict)
    load_support_domain_elements: list[dict] = Field(default_factory=list)
    # Links between those instances, checked against the MWS allowable relationships.
    load_support_domain_element_instance_relationships: list[dict] = Field(default_factory=list)


class StructureSupportDomainRelationshipImportValidateRequest(BaseModel):
    template_metadata: dict = Field(default_factory=dict)
    load_support_domain_element_relationships: list[dict] = Field(default_factory=list)


class StructureImportValidateResponse(BaseModel):
    stage_id: str
    summary: dict
    rows: list[StructureImportRow]


class StructureImportCommitRequest(BaseModel):
    stage_id: str = Field(min_length=1)
    selected_row_numbers: list[int] | None = None


class StructureImportCommitResponse(BaseModel):
    stage_id: str
    committed: int
    failed: int
    rows: list[StructureImportRow]


class CrossModelInstanceDiagramNodeInput(BaseModel):
    item_id: str = Field(min_length=1)
    item_kind: ModelItemType
    pos_x: float = 0
    pos_y: float = 0


class CrossModelInstanceDiagramEdgeInput(BaseModel):
    """Per-connection line-style override; edge_key is the diagram's edge identifier."""

    edge_key: str = Field(min_length=1)
    edge_style: Literal['curved', 'straight', 'elbow'] = 'curved'


class CrossModelInstanceDiagramShapeInput(BaseModel):
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


class SaveCrossModelInstanceDiagramCommand(BaseModel):
    name: str = Field(min_length=1)
    nodes: list[CrossModelInstanceDiagramNodeInput] = Field(default_factory=list)
    edges: list[CrossModelInstanceDiagramEdgeInput] = Field(default_factory=list)
    shapes: list[CrossModelInstanceDiagramShapeInput] = Field(default_factory=list)


# ── The structure governance graph ───────────────────────────────────────────────


class GovernanceGraphNeighbourhoodCommand(BaseModel):
    """
    What to show around a set of items.

    `depth` is capped: a walk is breadth-first over a graph with no natural
    bottom, and the difference between 3 and 30 is the difference between a
    diagram and the whole database.
    """

    item_ids: list[str] = Field(default_factory=list)
    depth: int = Field(default=1, ge=0, le=5)


class GovernanceGraphItemsCommand(BaseModel):
    """Hydrate items by id — what reopening a saved diagram needs."""

    item_ids: list[str] = Field(default_factory=list)
