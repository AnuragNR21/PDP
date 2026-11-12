"""FastAPI dependencies that put a signed-in user behind every API route.

`get_current_user` is the only place a bearer token is turned into a person.
`require_admin` and `require_role_for_writes` build on it; the routers in
app/router.py attach them, so a new route is protected by being included,
not by remembering a decorator.
"""

from __future__ import annotations

from collections.abc import Callable

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from app.config import Settings, get_settings
from shared.auth.roles import ROLE_LABELS, grants, is_administrator
from shared.auth.tokens import TokenError, decode_access_token
from shared.auth.user_repository import STATUS_ACTIVE, UserRepository

_bearer = HTTPBearer(auto_error=False)

# Requests that only read. Any active user may make them; the role check is
# for the ones that change something.
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


class CurrentUser(BaseModel):
    user_id: str
    email: str
    display_name: str
    roles: list[str]
    must_change_password: bool = False

    def has_role(self, role_code: str) -> bool:
        return grants(self.roles, role_code)

    @property
    def is_admin(self) -> bool:
        return is_administrator(self.roles)

    @property
    def actor_label(self) -> str:
        """How this person is named in the audit log."""
        return self.display_name or self.email


def _unauthorised(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    settings: Settings = Depends(get_settings),
) -> CurrentUser:
    if credentials is None or not credentials.credentials:
        raise _unauthorised("Not authenticated.")
    try:
        claims = decode_access_token(credentials.credentials, settings.jwt_secret)
    except TokenError:
        raise _unauthorised("Your session has expired. Please sign in again.") from None

    repository = UserRepository(settings.database_url)
    user = repository.get_by_id(str(claims.get("sub", "")))
    if user is None or user.status != STATUS_ACTIVE:
        raise _unauthorised("This account is not active.")

    return CurrentUser(
        user_id=user.user_id,
        email=user.email,
        display_name=user.display_name,
        roles=repository.roles_for(user.user_id),
        must_change_password=user.must_change_password,
    )


def require_admin(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="This area is for administrators."
        )
    return user


def require_role_for_writes(*role_codes: str) -> Callable[..., CurrentUser]:
    """Any active user may read; changing something needs one of the given roles."""

    labels = " or ".join(ROLE_LABELS.get(code, code) for code in role_codes)

    def dependency(request: Request, user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if request.method in SAFE_METHODS:
            return user
        if any(user.has_role(code) for code in role_codes):
            return user
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"This action requires the {labels} role.",
        )

    dependency.__name__ = f"require_{'_or_'.join(role_codes)}_for_writes"
    return dependency
