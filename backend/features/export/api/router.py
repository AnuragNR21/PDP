from fastapi import APIRouter, Depends

from app.dependencies import get_database_url
from features.export.service.export_services import ExportService

router = APIRouter(prefix='/export', tags=['export'])


@router.get('/pack')
def get_export_pack(db_url=Depends(get_database_url)):
    return ExportService(db_url).get_pack()


@router.get('/results')
def get_export_results(db_url=Depends(get_database_url)):
    return ExportService(db_url).get_results()


@router.get('/issues')
def get_export_issues(db_url=Depends(get_database_url)):
    return ExportService(db_url).get_issues()


@router.get('/actions')
def get_export_actions(db_url=Depends(get_database_url)):
    return ExportService(db_url).get_actions()


@router.get('/verifications')
def get_export_verifications(db_url=Depends(get_database_url)):
    return ExportService(db_url).get_verifications()


@router.get('/evaluation-summary')
def get_evaluation_summary(db_url=Depends(get_database_url)):
    return ExportService(db_url).get_evaluation_summary()


@router.get('/demo-story-pack')
def get_demo_story_pack(db_url=Depends(get_database_url)):
    return ExportService(db_url).get_demo_story_pack()
