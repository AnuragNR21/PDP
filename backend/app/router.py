from fastapi import APIRouter, Depends

from features.acceptance.api.router import router as acceptance_router
from features.accountability.api.router import router as accountability_router
from features.admin.api.router import router as admin_router
from features.admin.api.users_router import router as admin_users_router
from features.auth.api.router import router as auth_router
from features.discover.api.router import router as discover_router
from features.export.api.router import router as export_router
from features.home.api.router import router as home_router
from features.impact.api.router import router as impact_router
from features.improve.api.router import router as improve_router
from features.model.api.router import router as model_router
from features.platform.api.router import router as platform_router
from features.rules.api.router import router as rules_router
from features.search.api.router import router as search_router
from features.settings.api.router import router as settings_router
from features.structure.api.router import router as structure_router
from features.trial.api.router import router as trial_router
from shared.auth.dependencies import get_current_user, require_admin, require_role_for_writes
from shared.auth.roles import ADMIN, ANALYST, MODEL_AUTHOR, STRUCTURE_EDITOR

# Who may change what (PDP-251, ADM-03). Reading needs only a signed-in,
# active account; the role gates the writes. Admin is administration only,
# so it appears on the admin surfaces and nowhere else.
_signed_in = [Depends(get_current_user)]
_admin_only = [Depends(require_admin)]
_model_writes = [Depends(require_role_for_writes(MODEL_AUTHOR))]
_structure_writes = [Depends(require_role_for_writes(STRUCTURE_EDITOR))]
_analyst_writes = [Depends(require_role_for_writes(ANALYST))]
_admin_writes = [Depends(require_role_for_writes(ADMIN))]

api_router = APIRouter()

# Public routes (health, sign-in, invitation and reset links) protect
# themselves route by route inside these two routers.
api_router.include_router(platform_router)
api_router.include_router(auth_router)

api_router.include_router(home_router, dependencies=_signed_in)
api_router.include_router(search_router, dependencies=_signed_in)
# Preferences are a person's own; organisation settings are gated inside the router.
api_router.include_router(settings_router, dependencies=_signed_in)
api_router.include_router(accountability_router, dependencies=_admin_writes)

api_router.include_router(admin_router, dependencies=_admin_only)
api_router.include_router(admin_users_router, dependencies=_admin_only)
api_router.include_router(acceptance_router, dependencies=_admin_only)
api_router.include_router(trial_router, dependencies=_admin_only)

api_router.include_router(model_router, dependencies=_model_writes)
api_router.include_router(structure_router, dependencies=_structure_writes)
api_router.include_router(discover_router, dependencies=_analyst_writes)
api_router.include_router(rules_router, dependencies=_analyst_writes)
api_router.include_router(impact_router, dependencies=_analyst_writes)
api_router.include_router(improve_router, dependencies=_analyst_writes)
api_router.include_router(export_router, dependencies=_analyst_writes)
