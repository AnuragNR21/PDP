from typing import Literal

from pydantic import BaseModel, Field

from shared.contracts.canonical_types import (
    AffectedItemSummary,
    ImpactAnalysisSummary,
    ImpactFindingSummary,
    ImpactPathSummary,
)

ImpactSubjectType = Literal['node', 'check_result']
ImpactDestination = Literal['improve']


class RunImpactAnalysisCommand(BaseModel):
    subject_type: ImpactSubjectType
    subject_id: str = Field(min_length=1)
    max_depth: int = Field(default=3, ge=1, le=6)
    include_relationships: bool = True


class CreateImpactHandoffCommand(BaseModel):
    finding_id: str = Field(min_length=1)
    destination: ImpactDestination = 'improve'


class ImpactAnalysisResponse(BaseModel):
    analysis: ImpactAnalysisSummary


class AffectedItemsResponse(BaseModel):
    items: list[AffectedItemSummary]


class ImpactPathsResponse(BaseModel):
    items: list[ImpactPathSummary]


class ImpactFindingsResponse(BaseModel):
    items: list[ImpactFindingSummary]


# ── Saved diagrams ───────────────────────────────────────────────────────────


class ImpactDiagramNodeCommand(BaseModel):
    item_id: str = Field(min_length=1)
    item_kind: str = ""
    pos_x: float = 0.0
    pos_y: float = 0.0


class ImpactDiagramEdgeCommand(BaseModel):
    edge_key: str = Field(min_length=1)
    edge_style: str = "curved"


class SaveImpactDiagramCommand(BaseModel):
    """
    One saved reading of the graph.

    Nodes and edges replace the diagram's whole contents: the canvas is what
    the person is looking at, and a saved diagram that merged old and new rows
    would show neither.
    """

    name: str = Field(min_length=1, max_length=200)
    nodes: list[ImpactDiagramNodeCommand] = Field(default_factory=list)
    edges: list[ImpactDiagramEdgeCommand] = Field(default_factory=list)
