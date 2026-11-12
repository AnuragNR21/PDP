from fastapi import APIRouter, Depends, HTTPException, status

from app.dependencies import get_database_url
from features.impact.domain.models import (
    CreateImpactHandoffCommand,
    RunImpactAnalysisCommand,
    SaveImpactDiagramCommand,
)
from features.impact.service.impact_diagram_service import ImpactDiagramService
from features.impact.service.impact_services import ImpactAnalysisService, ImpactHandoffService

router = APIRouter(prefix='/impact', tags=['impact'])


@router.post('/analysis', status_code=status.HTTP_201_CREATED)
def run_analysis(command: RunImpactAnalysisCommand, db_url=Depends(get_database_url)):
    try:
        return ImpactAnalysisService(db_url).run_analysis(command)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get('/analysis/{analysis_id}')
def get_analysis(analysis_id: str, db_url=Depends(get_database_url)):
    try:
        return ImpactAnalysisService(db_url).get_analysis(analysis_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get('/analysis/{analysis_id}/affected-items')
def list_affected_items(analysis_id: str, db_url=Depends(get_database_url)):
    return ImpactAnalysisService(db_url).list_affected_items(analysis_id)


@router.get('/analysis/{analysis_id}/paths')
def list_paths(analysis_id: str, db_url=Depends(get_database_url)):
    return ImpactAnalysisService(db_url).list_paths(analysis_id)


@router.get('/analysis/{analysis_id}/findings')
def list_findings(analysis_id: str, db_url=Depends(get_database_url)):
    return ImpactAnalysisService(db_url).list_findings(analysis_id)


@router.post('/analysis/{analysis_id}/handoff')
def create_handoff(analysis_id: str, command: CreateImpactHandoffCommand, db_url=Depends(get_database_url)):
    try:
        return ImpactHandoffService(db_url).create_handoff(analysis_id, command)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# ── Saved impact diagrams ────────────────────────────────────────────────────


@router.get('/diagrams')
def list_impact_diagrams(db_url=Depends(get_database_url)):
    return ImpactDiagramService(db_url).list_diagrams()


@router.get('/diagrams/{diagram_id}')
def get_impact_diagram(diagram_id: str, db_url=Depends(get_database_url)):
    try:
        return ImpactDiagramService(db_url).get_diagram(diagram_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post('/diagrams', status_code=status.HTTP_201_CREATED)
def create_impact_diagram(command: SaveImpactDiagramCommand, db_url=Depends(get_database_url)):
    try:
        return ImpactDiagramService(db_url).create_diagram(command)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put('/diagrams/{diagram_id}')
def update_impact_diagram(
    diagram_id: str, command: SaveImpactDiagramCommand, db_url=Depends(get_database_url)
):
    try:
        return ImpactDiagramService(db_url).update_diagram(diagram_id, command)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete('/diagrams/{diagram_id}', status_code=status.HTTP_204_NO_CONTENT)
def delete_impact_diagram(diagram_id: str, db_url=Depends(get_database_url)):
    try:
        ImpactDiagramService(db_url).delete_diagram(diagram_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
