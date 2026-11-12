from typing import Literal

from pydantic import BaseModel, Field


class AcceptanceScenario(BaseModel):
    scenario_code: str
    title: str
    description: str
    primary_route: str
    status: Literal['ready', 'partial', 'blocked']
    evidence_count: int = Field(ge=0)


class RouteEvidence(BaseModel):
    route: str
    workspace: str
    title: str
    smoke_status: Literal['covered', 'pending']
    evidence_source: str


class AcceptanceRunCommand(BaseModel):
    actor_label: str = Field(min_length=1, max_length=120)
    scenario_codes: list[str] = Field(min_length=1)


class AcceptanceCheckResult(BaseModel):
    check_code: str
    title: str
    status: Literal['passed', 'warning', 'failed']
    detail: str


class AcceptanceRunSummary(BaseModel):
    run_id: str
    actor_label: str
    executed_at: str
    overall_status: Literal['passed', 'warning', 'failed']
    results: list[AcceptanceCheckResult]


class ReleaseChecklistItem(BaseModel):
    item_code: str
    title: str
    status: Literal['passed', 'warning', 'failed']
    detail: str
    related_route: str | None = None


class ScenarioReadinessSummary(BaseModel):
    scenario_code: str
    title: str
    status: Literal['ready', 'partial', 'blocked']
    evidence_count: int = Field(ge=0)
    key_routes: list[str]


class ReleaseReadinessSummary(BaseModel):
    release_label: str
    generated_at: str
    overall_status: Literal['passed', 'warning', 'failed']
    covered_route_count: int = Field(ge=0)
    total_route_count: int = Field(ge=0)
    scenario_ready_count: int = Field(ge=0)
    scenario_total_count: int = Field(ge=0)
    export_available: bool
    diagnostics_status: str
    checklist: list[ReleaseChecklistItem]
    scenario_summaries: list[ScenarioReadinessSummary]
