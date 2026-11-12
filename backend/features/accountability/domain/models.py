from pydantic import BaseModel, Field

from shared.contracts.canonical_types import AccountabilityAssignmentSummary, AccountabilityPartySummary


class AccountabilityPartiesResponse(BaseModel):
    items: list[AccountabilityPartySummary]


class AccountabilityAssignmentsResponse(BaseModel):
    items: list[AccountabilityAssignmentSummary]


class CreateAccountabilityAssignmentCommand(BaseModel):
    scope_type: str = Field(min_length=1)
    scope_id: str = Field(min_length=1)
    role_code: str = Field(min_length=1)
    party_id: str = Field(min_length=1)


class UpdateAccountabilityAssignmentCommand(BaseModel):
    role_code: str | None = None
    party_id: str | None = None
    assignment_status: str | None = None
