from fastapi import APIRouter, Depends

from app.dependencies import get_database_url
from features.acceptance.domain.models import (
    AcceptanceRunCommand,
    AcceptanceRunSummary,
    AcceptanceScenario,
    ReleaseReadinessSummary,
    RouteEvidence,
)
from features.acceptance.service.acceptance_services import AcceptanceService

router = APIRouter(prefix='/acceptance', tags=['acceptance'])


@router.get('/scenarios', response_model=list[AcceptanceScenario])
def get_acceptance_scenarios(db_url=Depends(get_database_url)) -> list[AcceptanceScenario]:
    return AcceptanceService(db_url).list_scenarios()


@router.get('/routes', response_model=list[RouteEvidence])
def get_route_evidence(db_url=Depends(get_database_url)) -> list[RouteEvidence]:
    return AcceptanceService(db_url).list_route_evidence()


@router.post('/runs', response_model=AcceptanceRunSummary)
def run_acceptance_harness(command: AcceptanceRunCommand, db_url=Depends(get_database_url)) -> AcceptanceRunSummary:
    return AcceptanceService(db_url).run_harness(command)


@router.get('/release-readiness', response_model=ReleaseReadinessSummary)
def get_release_readiness(db_url=Depends(get_database_url)) -> ReleaseReadinessSummary:
    return AcceptanceService(db_url).get_release_readiness()
