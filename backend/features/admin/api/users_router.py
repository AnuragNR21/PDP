"""Admin > Users and Admin > Roles. Mounted admin-only in app/router.py."""

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from app.config import Settings, get_settings
from features.admin.domain.user_models import (
    AdminUserResponse,
    AdminUsersResponse,
    CreateUserCommand,
    InvitationIssued,
    InviteUserCommand,
    PasswordResetIssued,
    RolesResponse,
    SetRolesCommand,
    UpdateUserCommand,
)
from features.admin.service.user_admin_service import UserAdminService
from features.auth.service.auth_service import AuthError
from shared.auth.dependencies import CurrentUser, get_current_user

router = APIRouter(prefix="/admin", tags=["admin"])


def get_service(settings: Settings = Depends(get_settings)) -> UserAdminService:
    return UserAdminService(settings)


def _raise(exc: AuthError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.detail)


@router.get("/roles", response_model=RolesResponse)
def list_roles(service: UserAdminService = Depends(get_service)) -> RolesResponse:
    return service.roles()


@router.get("/users", response_model=AdminUsersResponse)
def list_users(
    search: str = Query(default=""),
    status_filter: str = Query(default="", alias="status"),
    role: str = Query(default=""),
    service: UserAdminService = Depends(get_service),
) -> AdminUsersResponse:
    return AdminUsersResponse(
        items=service.list_users(search=search, status=status_filter, role=role)
    )


@router.post("/users", response_model=InvitationIssued, status_code=status.HTTP_201_CREATED)
def invite_user(
    command: InviteUserCommand,
    actor: CurrentUser = Depends(get_current_user),
    service: UserAdminService = Depends(get_service),
) -> InvitationIssued:
    try:
        user, link, expires_at = service.invite(
            actor, email=command.email, display_name=command.display_name, roles=command.roles
        )
    except AuthError as exc:
        raise _raise(exc) from exc
    return InvitationIssued(user=user, invitation_link=link, expires_at=expires_at)


@router.post("/users/create", response_model=AdminUserResponse, status_code=status.HTTP_201_CREATED)
def create_user(
    command: CreateUserCommand,
    actor: CurrentUser = Depends(get_current_user),
    service: UserAdminService = Depends(get_service),
) -> AdminUserResponse:
    try:
        user = service.create_user(
            actor,
            email=command.email,
            display_name=command.display_name,
            password=command.password,
            roles=command.roles,
            must_change_password=command.must_change_password,
        )
    except AuthError as exc:
        raise _raise(exc) from exc
    return AdminUserResponse(user=user)


@router.get("/users/{user_id}", response_model=AdminUserResponse)
def get_user(user_id: str, service: UserAdminService = Depends(get_service)) -> AdminUserResponse:
    try:
        return AdminUserResponse(user=service.get_user(user_id))
    except AuthError as exc:
        raise _raise(exc) from exc


@router.put("/users/{user_id}", response_model=AdminUserResponse)
def update_user(
    user_id: str,
    command: UpdateUserCommand,
    actor: CurrentUser = Depends(get_current_user),
    service: UserAdminService = Depends(get_service),
) -> AdminUserResponse:
    try:
        return AdminUserResponse(
            user=service.update_user(actor, user_id, display_name=command.display_name)
        )
    except AuthError as exc:
        raise _raise(exc) from exc


@router.put("/users/{user_id}/roles", response_model=AdminUserResponse)
def set_roles(
    user_id: str,
    command: SetRolesCommand,
    actor: CurrentUser = Depends(get_current_user),
    service: UserAdminService = Depends(get_service),
) -> AdminUserResponse:
    try:
        return AdminUserResponse(user=service.set_roles(actor, user_id, command.roles))
    except AuthError as exc:
        raise _raise(exc) from exc


@router.post("/users/{user_id}/activate", response_model=AdminUserResponse)
def activate_user(
    user_id: str,
    actor: CurrentUser = Depends(get_current_user),
    service: UserAdminService = Depends(get_service),
) -> AdminUserResponse:
    try:
        return AdminUserResponse(user=service.activate(actor, user_id))
    except AuthError as exc:
        raise _raise(exc) from exc


@router.post("/users/{user_id}/deactivate", response_model=AdminUserResponse)
def deactivate_user(
    user_id: str,
    actor: CurrentUser = Depends(get_current_user),
    service: UserAdminService = Depends(get_service),
) -> AdminUserResponse:
    try:
        return AdminUserResponse(user=service.deactivate(actor, user_id))
    except AuthError as exc:
        raise _raise(exc) from exc


@router.post("/users/{user_id}/invitation/resend", response_model=InvitationIssued)
def resend_invitation(
    user_id: str,
    actor: CurrentUser = Depends(get_current_user),
    service: UserAdminService = Depends(get_service),
) -> InvitationIssued:
    try:
        user, link, expires_at = service.resend_invitation(actor, user_id)
    except AuthError as exc:
        raise _raise(exc) from exc
    return InvitationIssued(user=user, invitation_link=link, expires_at=expires_at)


@router.delete("/users/{user_id}/invitation", status_code=status.HTTP_204_NO_CONTENT)
def cancel_invitation(
    user_id: str,
    actor: CurrentUser = Depends(get_current_user),
    service: UserAdminService = Depends(get_service),
) -> Response:
    try:
        service.cancel_invitation(actor, user_id)
    except AuthError as exc:
        raise _raise(exc) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/users/{user_id}/password-reset", response_model=PasswordResetIssued)
def issue_password_reset(
    user_id: str,
    actor: CurrentUser = Depends(get_current_user),
    service: UserAdminService = Depends(get_service),
) -> PasswordResetIssued:
    try:
        user, link, expires_at = service.issue_password_reset(actor, user_id)
    except AuthError as exc:
        raise _raise(exc) from exc
    return PasswordResetIssued(user=user, reset_link=link, expires_at=expires_at)
