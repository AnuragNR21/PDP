
from pydantic import BaseModel, Field

from shared.contracts.canonical_types import (
    DashboardSummary,
    ImproveAttentionSignalSummary,
    ImproveCandidateSummary,
    RemediationTaskSummary,
    VerificationEvidenceSummary,
    VerificationFollowUpSummary,
    WorkProgramSummary,
)


class ImproveCandidatesResponse(BaseModel):
    items: list[ImproveCandidateSummary]


class CreateWorkProgramCommand(BaseModel):
    name: str = Field(min_length=1)
    priority: str = Field(min_length=1)
    owner_name: str = Field(min_length=1)
    owner_party_id: str | None = None
    candidate_ids: list[str] = Field(min_length=1)


class UpdateCandidateStatusCommand(BaseModel):
    status: str = Field(min_length=1)


class UpdateTaskStatusCommand(BaseModel):
    status: str = Field(min_length=1)


class CreateVerificationEvidenceCommand(BaseModel):
    candidate_id: str = Field(min_length=1)
    task_id: str | None = None
    result_id: str | None = None
    outcome: str = Field(min_length=1)
    evidence_note: str = Field(min_length=1)
    follow_up_required: bool = False
    verified_by_party_id: str | None = None


class UpdateVerificationFollowUpCommand(BaseModel):
    queue_status: str = Field(min_length=1)
    due_date: str | None = None
    owner_party_id: str | None = None
    follow_up_note: str | None = None


class WorkProgramsResponse(BaseModel):
    items: list[WorkProgramSummary]


class RemediationTasksResponse(BaseModel):
    items: list[RemediationTaskSummary]


class VerificationEvidenceResponse(BaseModel):
    items: list[VerificationEvidenceSummary]


class DashboardResponse(BaseModel):
    dashboard: DashboardSummary


class ImproveAttentionSignalsResponse(BaseModel):
    items: list[ImproveAttentionSignalSummary]


class VerificationFollowUpQueueResponse(BaseModel):
    items: list[VerificationFollowUpSummary]
