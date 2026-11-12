from fastapi import APIRouter, Depends, Query

from app.dependencies import get_database_url
from features.search.service.global_search_service import GROUP_IDS, GlobalSearchService

router = APIRouter(prefix="/search", tags=["search"])


@router.get("")
def global_search(
    q: str = Query(default="", max_length=200),
    types: str | None = Query(default=None, description="Comma-separated groups: " + ", ".join(GROUP_IDS)),
    status: str | None = Query(default=None, pattern="^(draft|active|retired)$"),
    limit: int = Query(default=6, ge=1, le=50),
    db_url=Depends(get_database_url),
):
    """Search PDP: names, descriptions and metadata of models, types, instances,
    properties, relationships, rules, Discover content and quality findings."""
    groups = [g.strip() for g in types.split(",") if g.strip()] if types else None
    return GlobalSearchService(db_url).search(q, groups=groups, status=status, limit=limit)
