
from fastapi import APIRouter, Depends, HTTPException, Query

from app.dependencies import get_database_url
from features.improve.domain.models import (
    CreateVerificationEvidenceCommand,
    CreateWorkProgramCommand,
    UpdateCandidateStatusCommand,
    UpdateTaskStatusCommand,
    UpdateVerificationFollowUpCommand,
)
from features.improve.service.improve_services import (
    ImproveAttentionService,
    ImproveCandidateService,
    ImproveDashboardService,
    ImproveTaskService,
    ImproveVerificationService,
    ImproveWorkProgramService,
)

router = APIRouter(prefix='/improve', tags=['improve'])


@router.get('/candidates')
def list_candidates(db_url=Depends(get_database_url)):
    return ImproveCandidateService(db_url).list_candidates()


@router.patch('/candidates/{candidate_id}')
def update_candidate_status(candidate_id: str, command: UpdateCandidateStatusCommand, db_url=Depends(get_database_url)):
    try:
        return ImproveCandidateService(db_url).update_candidate_status(candidate_id, command)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get('/dashboard')
def get_dashboard(db_url=Depends(get_database_url)):
    return ImproveDashboardService(db_url).get_dashboard()


@router.get('/attention-signals')
def list_attention_signals(db_url=Depends(get_database_url)):
    return ImproveAttentionService(db_url).list_attention_signals()


@router.get('/follow-up-queue')
def list_follow_up_queue(
    queue_status: str | None = Query(default=None),
    db_url=Depends(get_database_url),
):
    return ImproveAttentionService(db_url).list_follow_up_queue(queue_status)


@router.patch('/follow-up-queue/{verification_id}')
def update_follow_up_queue(verification_id: str, command: UpdateVerificationFollowUpCommand, db_url=Depends(get_database_url)):
    try:
        return ImproveAttentionService(db_url).update_follow_up_queue(verification_id, command)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get('/work-programs')
def list_work_programs(db_url=Depends(get_database_url)):
    return ImproveWorkProgramService(db_url).list_work_programs()


@router.post('/work-programs', status_code=201)
def create_work_program(command: CreateWorkProgramCommand, db_url=Depends(get_database_url)):
    try:
        return ImproveWorkProgramService(db_url).create_work_program(command)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get('/tasks')
def list_tasks(program_id: str | None = Query(default=None), db_url=Depends(get_database_url)):
    return ImproveTaskService(db_url).list_tasks(program_id)


@router.patch('/tasks/{task_id}')
def update_task_status(task_id: str, command: UpdateTaskStatusCommand, db_url=Depends(get_database_url)):
    try:
        return ImproveTaskService(db_url).update_task_status(task_id, command)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get('/verifications')
def list_verifications(candidate_id: str | None = Query(default=None), db_url=Depends(get_database_url)):
    return ImproveVerificationService(db_url).list_verifications(candidate_id)


@router.post('/verifications', status_code=201)
def create_verification(command: CreateVerificationEvidenceCommand, db_url=Depends(get_database_url)):
    try:
        return ImproveVerificationService(db_url).create_verification(command)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
