from __future__ import annotations


from features.accountability.repo.accountability_repository import AccountabilityRepository
from shared.contracts.canonical_types import AccountabilityAssignmentSummary, AccountabilityPartySummary


class AccountabilityService:
    def __init__(self, db_url: str):
        self._repository = AccountabilityRepository(db_url)

    def list_parties(self) -> list[AccountabilityPartySummary]:
        return self._repository.list_parties()

    def list_assignments(self, scope_type: str | None = None, scope_id: str | None = None) -> list[AccountabilityAssignmentSummary]:
        return self._repository.list_assignments(scope_type=scope_type, scope_id=scope_id)

    def create_assignment(self, scope_type: str, scope_id: str, role_code: str, party_id: str) -> AccountabilityAssignmentSummary:
        return self._repository.create_assignment(scope_type=scope_type, scope_id=scope_id, role_code=role_code, party_id=party_id)

    def update_assignment(self, assignment_id: str, role_code: str | None, party_id: str | None, assignment_status: str | None) -> AccountabilityAssignmentSummary:
        return self._repository.update_assignment(assignment_id=assignment_id, role_code=role_code, party_id=party_id, assignment_status=assignment_status)
