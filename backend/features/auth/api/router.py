from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.config import Settings, get_settings
from features.auth.domain.models import (
    AcceptInvitationCommand,
    ChangePasswordCommand,
    ForgotPasswordCommand,
    InvitationPreview,
    LoginCommand,
    LoginResponse,
    MeResponse,
    ResetPasswordCommand,
    UpdateProfileCommand,
)
from features.auth.service.auth_service import AuthError, AuthService
from shared.auth.dependencies import CurrentUser, get_current_user

router = APIRouter(prefix="/auth", tags=["auth"])


def get_service(settings: Settings = Depends(get_settings)) -> AuthService:
    return AuthService(settings)


def _raise(exc: AuthError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.detail)


# ── public: no session needed ────────────────────────────────────────────────


@router.post("/login", response_model=LoginResponse)
def login(command: LoginCommand, service: AuthService = Depends(get_service)) -> LoginResponse:
    try:
        token, expires_in, user = service.login(str(command.email), command.password)
    except AuthError as exc:
        raise _raise(exc) from exc
    return LoginResponse(access_token=token, expires_in_seconds=expires_in, user=user)


@router.post("/forgot-password", status_code=status.HTTP_202_ACCEPTED)
def forgot_password(
    command: ForgotPasswordCommand, service: AuthService = Depends(get_service)
) -> dict[str, str]:
    # Same answer whether or not the address is known, so the form cannot be
    # used to discover who has an account.
    service.request_password_reset(str(command.email))
    return {"detail": "If that email belongs to an active account, a reset link has been issued."}


@router.post("/reset-password", status_code=status.HTTP_204_NO_CONTENT)
def reset_password(
    command: ResetPasswordCommand, service: AuthService = Depends(get_service)
) -> Response:
    try:
        service.reset_password(token=command.token, new_password=command.new_password)
    except AuthError as exc:
        raise _raise(exc) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/invitations/{token}", response_model=InvitationPreview)
def preview_invitation(
    token: str, service: AuthService = Depends(get_service)
) -> InvitationPreview:
    try:
        return service.preview_invitation(token)
    except AuthError as exc:
        raise _raise(exc) from exc


@router.post("/accept-invitation", status_code=status.HTTP_204_NO_CONTENT)
def accept_invitation(
    command: AcceptInvitationCommand, service: AuthService = Depends(get_service)
) -> Response:
    try:
        service.accept_invitation(
            token=command.token, display_name=command.display_name, password=command.password
        )
    except AuthError as exc:
        raise _raise(exc) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── signed in ────────────────────────────────────────────────────────────────


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    current: CurrentUser = Depends(get_current_user), service: AuthService = Depends(get_service)
) -> Response:
    service.logout(current)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me", response_model=MeResponse)
def me(
    current: CurrentUser = Depends(get_current_user), service: AuthService = Depends(get_service)
) -> MeResponse:
    try:
        return MeResponse(user=service.profile(current))
    except AuthError as exc:
        raise _raise(exc) from exc


@router.put("/me", response_model=MeResponse)
def update_me(
    command: UpdateProfileCommand,
    current: CurrentUser = Depends(get_current_user),
    service: AuthService = Depends(get_service),
) -> MeResponse:
    try:
        return MeResponse(user=service.update_profile(current, display_name=command.display_name))
    except AuthError as exc:
        raise _raise(exc) from exc


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    command: ChangePasswordCommand,
    current: CurrentUser = Depends(get_current_user),
    service: AuthService = Depends(get_service),
) -> Response:
    try:
        service.change_password(
            current, current_password=command.current_password, new_password=command.new_password
        )
    except AuthError as exc:
        raise _raise(exc) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)
