from fastapi import APIRouter

from features.home.domain.models import HomeOverviewResponse
from features.home.service.home_service import HomeService

router = APIRouter(prefix="/home", tags=["home"])
service = HomeService()


@router.get("/overview", response_model=HomeOverviewResponse)
def get_home_overview() -> HomeOverviewResponse:
    return service.get_overview()
