from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.dependencies import get_settings
from app.config import Settings
from features.accountability.domain.models import (
    AccountabilityAssignmentsResponse,
    AccountabilityPartiesResponse,
    CreateAccountabilityAssignmentCommand,
    UpdateAccountabilityAssignmentCommand,
)
from features.accountability.service.accountability_services import AccountabilityService

router = APIRouter(prefix="/accountability", tags=["accountability"])


def get_service(settings: Settings = Depends(get_settings)) -> AccountabilityService:
    return AccountabilityService(settings.database_url)


@router.get('/parties', response_model=AccountabilityPartiesResponse)
def list_parties(service: AccountabilityService = Depends(get_service)) -> AccountabilityPartiesResponse:
    return AccountabilityPartiesResponse(items=service.list_parties())


@router.get('/assignments', response_model=AccountabilityAssignmentsResponse)
def list_assignments(
    scope_type: str | None = Query(default=None),
    scope_id: str | None = Query(default=None),
    service: AccountabilityService = Depends(get_service),
) -> AccountabilityAssignmentsResponse:
    return AccountabilityAssignmentsResponse(items=service.list_assignments(scope_type=scope_type, scope_id=scope_id))


@router.post('/assignments', status_code=status.HTTP_201_CREATED)
def create_assignment(
    command: CreateAccountabilityAssignmentCommand,
    service: AccountabilityService = Depends(get_service),
) -> dict[str, object]:
    try:
        assignment = service.create_assignment(
            scope_type=command.scope_type,
            scope_id=command.scope_id,
            role_code=command.role_code,
            party_id=command.party_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return {"assignment": assignment}


@router.patch('/assignments/{assignment_id}')
def update_assignment(
    assignment_id: str,
    command: UpdateAccountabilityAssignmentCommand,
    service: AccountabilityService = Depends(get_service),
) -> dict[str, object]:
    try:
        assignment = service.update_assignment(
            assignment_id=assignment_id,
            role_code=command.role_code,
            party_id=command.party_id,
            assignment_status=command.assignment_status,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return {"assignment": assignment}
