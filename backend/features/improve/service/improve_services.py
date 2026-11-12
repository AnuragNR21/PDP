
from pathlib import Path

from features.improve.domain.models import (
    CreateVerificationEvidenceCommand,
    CreateWorkProgramCommand,
    UpdateCandidateStatusCommand,
    UpdateTaskStatusCommand,
    UpdateVerificationFollowUpCommand,
)
from features.improve.repo.improve_repository import ImproveRepository
from shared.contracts.refresh import RefreshRequest


class ImproveCandidateService:
    def __init__(self, db_path: Path):
        self._repository = ImproveRepository(db_path)

    def list_candidates(self):
        return {'items': self._repository.list_candidates()}

    def update_candidate_status(self, candidate_id: str, command: UpdateCandidateStatusCommand):
        candidate = self._repository.update_candidate_status(candidate_id, command.status)
        refresh = RefreshRequest(scope='workspace', reason='improve.candidate.updated', targets=[candidate_id])
        return {'candidate': candidate, 'refresh': refresh}


class ImproveAttentionService:
    def __init__(self, db_path: Path):
        self._repository = ImproveRepository(db_path)

    def list_attention_signals(self):
        return {'items': self._repository.list_attention_signals()}

    def list_follow_up_queue(self, queue_status: str | None):
        return {'items': self._repository.list_follow_up_queue(queue_status)}

    def update_follow_up_queue(self, verification_id: str, command: UpdateVerificationFollowUpCommand):
        item = self._repository.update_follow_up_queue(
            verification_id=verification_id,
            queue_status=command.queue_status,
            due_date=command.due_date,
            owner_party_id=command.owner_party_id,
            follow_up_note=command.follow_up_note,
        )
        refresh = RefreshRequest(
            scope='workspace',
            reason='improve.follow_up.updated',
            targets=[verification_id, item.candidate_id, item.task_id] if item.task_id else [verification_id, item.candidate_id],
        )
        return {'item': item, 'refresh': refresh}


class ImproveWorkProgramService:
    def __init__(self, db_path: Path):
        self._repository = ImproveRepository(db_path)

    def create_work_program(self, command: CreateWorkProgramCommand):
        program = self._repository.create_work_program(command.name, command.priority, command.owner_name, command.candidate_ids, command.owner_party_id)
        refresh = RefreshRequest(scope='workspace', reason='improve.program.created', targets=[program.program_id])
        return {'program': program, 'refresh': refresh}

    def list_work_programs(self):
        return {'items': self._repository.list_work_programs()}


class ImproveTaskService:
    def __init__(self, db_path: Path):
        self._repository = ImproveRepository(db_path)

    def list_tasks(self, program_id: str | None):
        return {'items': self._repository.list_tasks(program_id)}

    def update_task_status(self, task_id: str, command: UpdateTaskStatusCommand):
        task = self._repository.update_task_status(task_id, command.status)
        refresh = RefreshRequest(scope='workspace', reason='improve.task.updated', targets=[task_id, task.program_id])
        return {'task': task, 'refresh': refresh}


class ImproveVerificationService:
    def __init__(self, db_path: Path):
        self._repository = ImproveRepository(db_path)

    def list_verifications(self, candidate_id: str | None):
        return {'items': self._repository.list_verifications(candidate_id)}

    def create_verification(self, command: CreateVerificationEvidenceCommand):
        verification = self._repository.create_verification_evidence(
            candidate_id=command.candidate_id,
            outcome=command.outcome,
            evidence_note=command.evidence_note,
            follow_up_required=command.follow_up_required,
            task_id=command.task_id,
            result_id=command.result_id,
            verified_by_party_id=command.verified_by_party_id,
        )
        refresh = RefreshRequest(
            scope='workspace',
            reason='improve.verification.created',
            targets=[target for target in [verification.verification_id, verification.candidate_id, verification.task_id] if target],
        )
        return {'verification': verification, 'refresh': refresh}


class ImproveDashboardService:
    def __init__(self, db_path: Path):
        self._repository = ImproveRepository(db_path)

    def get_dashboard(self):
        return {'dashboard': self._repository.get_dashboard()}
