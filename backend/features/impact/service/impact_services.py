from pathlib import Path

from features.impact.domain.models import CreateImpactHandoffCommand, RunImpactAnalysisCommand
from features.impact.repo.impact_repository import ImpactRepository


class ImpactAnalysisService:
    def __init__(self, db_path: Path):
        self._repository = ImpactRepository(db_path)

    def run_analysis(self, command: RunImpactAnalysisCommand):
        analysis, refresh = self._repository.run_analysis(command)
        return {'analysis': analysis, 'refresh': refresh}

    def get_analysis(self, analysis_id: str):
        return {'analysis': self._repository.get_analysis(analysis_id)}

    def list_affected_items(self, analysis_id: str):
        return {'items': self._repository.list_affected_items(analysis_id)}

    def list_paths(self, analysis_id: str):
        return {'items': self._repository.list_paths(analysis_id)}

    def list_findings(self, analysis_id: str):
        return {'items': self._repository.list_findings(analysis_id)}


class ImpactHandoffService:
    def __init__(self, db_path: Path):
        self._repository = ImpactRepository(db_path)

    def create_handoff(self, analysis_id: str, command: CreateImpactHandoffCommand):
        if command.destination != 'improve':
            raise ValueError(f'Unsupported impact handoff destination: {command.destination}')
        candidate, refresh = self._repository.create_handoff(analysis_id, command.finding_id)
        return {'candidate': candidate, 'refresh': refresh}
