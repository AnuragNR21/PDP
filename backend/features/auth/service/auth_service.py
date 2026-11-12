"""Sign in, sign out, profile, and the password flows."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.config import Settings
from features.auth.domain.models import InvitationPreview, UserProfile
from shared.auth.dependencies import CurrentUser
from shared.auth.passwords import (
    hash_password,
    needs_rehash,
    password_policy_error,
    verify_password,
)
from shared.auth.tokens import hash_one_time_token, issue_access_token
from shared.auth.user_repository import (
    LOCKOUT_MINUTES,
    STATUS_ACTIVE,
    STATUS_INVITED,
    TOKEN_KIND_INVITE,
    TOKEN_KIND_RESET,
    UserRecord,
    UserRepository,
    normalise_email,
)

AUDIT_CATEGORY = "auth"
_GENERIC_LOGIN_FAILURE = "Invalid email or password."


class AuthError(Exception):
    """A problem the caller is told about; `status_code` says how."""

    def __init__(self, detail: str, status_code: int = 400):
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


def _profile(user: UserRecord, roles: list[str]) -> UserProfile:
    return UserProfile(
        user_id=user.user_id,
        email=user.email,
        display_name=user.display_name,
        roles=roles,
        must_change_password=user.must_change_password,
        last_login_at=user.last_login_at,
    )


def _is_locked(user: UserRecord) -> bool:
    if not user.locked_until:
        return False
    try:
        return datetime.fromisoformat(user.locked_until) > datetime.now(UTC)
    except ValueError:
        return False


def _is_expired(iso_timestamp: str) -> bool:
    try:
        return datetime.fromisoformat(iso_timestamp) <= datetime.now(UTC)
    except ValueError:
        return True


class AuthService:
    def __init__(self, settings: Settings):
        self._settings = settings
        self._repository = UserRepository(settings.database_url)

    # ── session ────────────────────────────────────────────────────────────

    def login(self, email: str, password: str) -> tuple[str, int, UserProfile]:
        email = normalise_email(email)
        user = self._repository.get_by_email(email)

        if user is None:
            self._audit(
                "login.failed", email, "unknown", f"Sign-in refused for {email}: no such account."
            )
            raise AuthError(_GENERIC_LOGIN_FAILURE, 401)

        if _is_locked(user):
            self._audit(
                "login.locked",
                user.user_id,
                user.email,
                f"Sign-in refused for {user.email}: account locked after repeated failures.",
            )
            raise AuthError(
                f"Too many failed attempts. Try again in {LOCKOUT_MINUTES} minutes.", 423
            )

        if user.status != STATUS_ACTIVE or not verify_password(user.password_hash, password):
            reason = "account not active" if user.status != STATUS_ACTIVE else "wrong password"
            if user.status == STATUS_ACTIVE:
                self._repository.record_login_failure(user.user_id)
            self._audit(
                "login.failed",
                user.user_id,
                user.email,
                f"Sign-in refused for {user.email}: {reason}.",
            )
            raise AuthError(_GENERIC_LOGIN_FAILURE, 401)

        if needs_rehash(user.password_hash):
            self._repository.set_password(
                user.user_id,
                hash_password(password),
                must_change_password=user.must_change_password,
            )

        self._repository.record_login_success(user.user_id)
        roles = self._repository.roles_for(user.user_id)
        token = issue_access_token(
            user.user_id, user.email, self._settings.jwt_secret, self._settings.jwt_hours
        )
        self._audit(
            "login.success",
            user.user_id,
            user.display_name or user.email,
            f"{user.display_name or user.email} signed in.",
        )
        refreshed = self._repository.get_by_id(user.user_id) or user
        return token, self._settings.jwt_hours * 3600, _profile(refreshed, roles)

    def logout(self, current: CurrentUser) -> None:
        self._audit(
            "logout", current.user_id, current.actor_label, f"{current.actor_label} signed out."
        )

    # ── profile ────────────────────────────────────────────────────────────

    def profile(self, current: CurrentUser) -> UserProfile:
        user = self._repository.get_by_id(current.user_id)
        if user is None:
            raise AuthError("This account no longer exists.", 401)
        return _profile(user, self._repository.roles_for(user.user_id))

    def update_profile(self, current: CurrentUser, *, display_name: str) -> UserProfile:
        display_name = display_name.strip()
        if not display_name:
            raise AuthError("Display name cannot be empty.")
        user = self._repository.update_profile(current.user_id, display_name=display_name)
        if user is None:
            raise AuthError("This account no longer exists.", 401)
        self._audit(
            "profile.updated",
            user.user_id,
            display_name,
            f"{display_name} updated their display name.",
        )
        return _profile(user, self._repository.roles_for(user.user_id))

    def change_password(
        self, current: CurrentUser, *, current_password: str, new_password: str
    ) -> None:
        user = self._repository.get_by_id(current.user_id)
        if user is None:
            raise AuthError("This account no longer exists.", 401)
        if not verify_password(user.password_hash, current_password):
            self._audit(
                "password.change_failed",
                user.user_id,
                current.actor_label,
                f"{current.actor_label} gave the wrong current password.",
            )
            raise AuthError("The current password is not correct.")
        self._set_new_password(user, new_password, current_password)
        self._audit(
            "password.changed",
            user.user_id,
            current.actor_label,
            f"{current.actor_label} changed their password.",
        )

    # ── forgotten password ─────────────────────────────────────────────────

    def request_password_reset(
        self, email: str, *, actor_label: str = ""
    ) -> tuple[UserRecord, str] | None:
        """Issue a reset token for an active account. Returns (user, raw token) or None.

        None is deliberately indistinguishable to the public caller: the
        endpoint answers the same whether or not the email exists.
        """
        from shared.auth.tokens import new_one_time_token

        user = self._repository.get_by_email(email)
        if user is None or user.status != STATUS_ACTIVE:
            self._audit(
                "password.reset_refused",
                normalise_email(email),
                actor_label or "unknown",
                f"Password reset requested for {normalise_email(email)}: no active account.",
            )
            return None
        raw = new_one_time_token()
        expires_at = (
            datetime.now(UTC) + timedelta(hours=self._settings.password_reset_hours)
        ).isoformat()
        self._repository.create_token(
            user_id=user.user_id,
            kind=TOKEN_KIND_RESET,
            token_hash=hash_one_time_token(raw),
            expires_at=expires_at,
            created_by=actor_label or user.email,
        )
        self._audit(
            "password.reset_requested",
            user.user_id,
            actor_label or user.email,
            f"Password reset link issued for {user.email}.",
        )
        return user, raw

    def reset_password(self, *, token: str, new_password: str) -> UserRecord:
        record = self._repository.find_live_token(
            kind=TOKEN_KIND_RESET, token_hash=hash_one_time_token(token)
        )
        if record is None or _is_expired(record.expires_at):
            raise AuthError("This reset link is not valid or has expired.", 400)
        user = self._repository.get_by_id(record.user_id)
        if user is None or user.status != STATUS_ACTIVE:
            raise AuthError("This reset link is not valid or has expired.", 400)
        self._set_new_password(user, new_password)
        self._repository.mark_token_used(record.token_id)
        self._audit(
            "password.reset",
            user.user_id,
            user.display_name or user.email,
            f"{user.display_name or user.email} reset their password.",
        )
        return user

    # ── invitations ────────────────────────────────────────────────────────

    def preview_invitation(self, token: str) -> InvitationPreview:
        record = self._repository.find_live_token(
            kind=TOKEN_KIND_INVITE, token_hash=hash_one_time_token(token)
        )
        if record is None or _is_expired(record.expires_at):
            raise AuthError("This invitation is not valid or has expired.", 400)
        user = self._repository.get_by_id(record.user_id)
        if user is None or user.status != STATUS_INVITED:
            raise AuthError("This invitation is not valid or has expired.", 400)
        return InvitationPreview(
            email=user.email, display_name=user.display_name, expires_at=record.expires_at
        )

    def accept_invitation(self, *, token: str, display_name: str, password: str) -> UserRecord:
        record = self._repository.find_live_token(
            kind=TOKEN_KIND_INVITE, token_hash=hash_one_time_token(token)
        )
        if record is None or _is_expired(record.expires_at):
            raise AuthError("This invitation is not valid or has expired.", 400)
        user = self._repository.get_by_id(record.user_id)
        if user is None or user.status != STATUS_INVITED:
            raise AuthError("This invitation is not valid or has expired.", 400)
        display_name = display_name.strip()
        if not display_name:
            raise AuthError("Display name cannot be empty.")
        problem = password_policy_error(password)
        if problem:
            raise AuthError(problem)
        self._repository.update_profile(user.user_id, display_name=display_name)
        self._repository.set_password(user.user_id, hash_password(password))
        self._repository.set_status(user.user_id, STATUS_ACTIVE)
        self._repository.mark_token_used(record.token_id)
        self._audit(
            "user.activated",
            user.user_id,
            display_name,
            f"{display_name} ({user.email}) accepted their invitation.",
        )
        refreshed = self._repository.get_by_id(user.user_id)
        assert refreshed is not None
        return refreshed

    # ── helpers ────────────────────────────────────────────────────────────

    def _set_new_password(
        self, user: UserRecord, new_password: str, current_password: str | None = None
    ) -> None:
        problem = password_policy_error(new_password)
        if problem:
            raise AuthError(problem)
        if current_password is not None and new_password == current_password:
            raise AuthError("The new password must be different from the current one.")
        self._repository.set_password(user.user_id, hash_password(new_password))

    def _audit(self, action_code: str, object_ref: str, actor_label: str, detail: str) -> None:
        self._repository.insert_audit(
            category=AUDIT_CATEGORY,
            action_code=action_code,
            object_ref=object_ref,
            actor_label=actor_label,
            detail=detail,
        )
