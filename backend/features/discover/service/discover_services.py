from features.discover.domain.models import (
    CreateDiscoverySessionCommand,
    DiscoverySessionsResponse,
    ImportDatasetCommand,
    MappingsResponse,
    ProfileResponse,
    ResultsResponse,
    RunChecksCommand,
    SourceColumnsResponse,
    UpsertColumnMappingCommand,
)
from features.discover.repo.discover_repository import DiscoverRepository
from shared.contracts.refresh import RefreshRequest


class DiscoverService:
    def __init__(self, db_path: str):
        self._repository = DiscoverRepository(db_path)

    def list_sessions(self) -> DiscoverySessionsResponse:
        return DiscoverySessionsResponse(items=self._repository.list_sessions())

    def create_session(self, command: CreateDiscoverySessionCommand) -> dict[str, object]:
        session = self._repository.create_session(command)
        return {'session': session, 'refresh': RefreshRequest(scope='session', reason='Discovery session created.', targets=[session.session_id])}

    def import_dataset(self, session_id: str, command: ImportDatasetCommand) -> dict[str, object]:
        if not self._repository.session_exists(session_id):
            raise ValueError('Discovery session was not found.')
        self._repository.import_dataset(session_id, command)
        return {'session_id': session_id, 'refresh': RefreshRequest(scope='session', reason='Discover import completed.', targets=[session_id])}

    def list_columns(self, session_id: str) -> SourceColumnsResponse:
        if not self._repository.session_exists(session_id):
            raise ValueError('Discovery session was not found.')
        return SourceColumnsResponse(items=self._repository.list_columns(session_id))

    def get_profile(self, session_id: str, column_id: str) -> ProfileResponse:
        profile = self._repository.get_profile(session_id, column_id)
        if profile is None:
            raise ValueError('Column profile was not found.')
        return ProfileResponse(profile=profile)

    def list_mappings(self, session_id: str) -> MappingsResponse:
        return MappingsResponse(items=self._repository.list_mappings(session_id))

    def upsert_mapping(self, session_id: str, command: UpsertColumnMappingCommand) -> dict[str, object]:
        if not self._repository.column_exists(session_id, command.column_id):
            raise ValueError('Source column was not found in session context.')
        mapping = self._repository.upsert_mapping(session_id, command)
        return {'mapping': mapping, 'refresh': RefreshRequest(scope='session', reason='Discovery mapping updated.', targets=[session_id, command.column_id])}

    def clear_mapping(self, session_id: str, column_id: str) -> dict[str, object]:
        self._repository.clear_mapping(session_id, column_id)
        return {'session_id': session_id, 'column_id': column_id, 'refresh': RefreshRequest(scope='session', reason='Discovery mapping cleared.', targets=[session_id, column_id])}

    def run_checks(self, session_id: str, command: RunChecksCommand) -> dict[str, object]:
        execution = self._repository.run_checks(session_id, rule_version=command.rule_version)
        return {'execution': execution, 'refresh': RefreshRequest(scope='session', reason='Discovery checks completed.', targets=[session_id, execution.execution_id])}

    def list_results(self, session_id: str, severity: str | None) -> ResultsResponse:
        return ResultsResponse(execution=self._repository.latest_execution(session_id), items=self._repository.list_results(session_id, severity=severity))
